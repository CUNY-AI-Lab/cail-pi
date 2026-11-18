/**
 * "Sign in with CUNY AI Lab": the `cail` provider's OAuth login in Pi.
 *
 * Pi opens the Lab's connect page in the browser with a PKCE challenge. After
 * CUNY Login, the participant approves Pi, and the page hands a one-time code
 * back: to a loopback callback on this computer, or, over SSH, as a code to
 * paste. Pi trades the code and its verifier for a personal key named
 * "Pi on <computer>" that expires after 180 days. Signing in again from the
 * same computer replaces that key rather than adding another.
 *
 * Pi stores the key as an OAuth credential. Nothing here logs it.
 */
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import { join } from "node:path";
import { resolveAgentDir } from "./settings.mjs";

export const CONNECT_URL = "https://tools.ailab.gc.cuny.edu/model-access/connect";
export const TOKEN_URL = "https://tools.ailab.gc.cuny.edu/model-access/v1/connect/token";
export const LOGIN_LABEL = "Sign in with CUNY AI Lab";
export const EXPIRED_MESSAGE = "Your CUNY AI Lab sign-in has expired. Type /login cail to sign in again.";

const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;
const EXCHANGE_TIMEOUT_MS = 30_000;
const CALLBACK_PATH = "/callback";
const SIGN_IN_CODE = /^[A-Za-z0-9_-]{43}$/;
const PERSONAL_KEY = /^sk-cail-p_([0-9a-f]{32})_[A-Za-z0-9]{40}$/;

const base64Url = (bytes) => Buffer.from(bytes).toString("base64url");

export function pkcePair() {
  const verifier = base64Url(randomBytes(32));
  return { verifier, challenge: base64Url(createHash("sha256").update(verifier).digest()) };
}

/** The computer's name as the Lab shows it: the hostname, limited to the characters it accepts. */
export function deviceName(hostname = os.hostname()) {
  const name = hostname
    .replace(/\.local$/i, "")
    .replace(/[^A-Za-z0-9._ -]+/g, "-")
    .slice(0, 64)
    .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
  return name || "computer";
}

/** The key id inside a personal key, formatted as the UUID the Lab uses. */
export function keyIdFromKey(key) {
  const hex = typeof key === "string" ? PERSONAL_KEY.exec(key)?.[1] : undefined;
  if (!hex) return undefined;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * The key from this computer's last sign-in, read from Pi's auth.json. A key
 * pasted with "Sign in with an API key" is never replaced: it may be in use
 * elsewhere.
 */
export function previousSignInKeyId({ env = process.env } = {}) {
  try {
    const stored = JSON.parse(readFileSync(join(resolveAgentDir(env), "auth.json"), "utf8"))?.cail;
    return stored?.type === "oauth" ? keyIdFromKey(stored.access) : undefined;
  } catch {
    return undefined;
  }
}

/** Over SSH the browser runs on another computer and cannot reach a callback here. */
export function isRemoteSession(env = process.env) {
  return Boolean(env.SSH_CONNECTION || env.SSH_CLIENT || env.SSH_TTY);
}

/** Accept the code itself, or the callback address a browser on another computer could not open. */
export function codeFromInput(input, state) {
  const value = String(input ?? "").trim();
  if (SIGN_IN_CODE.test(value)) return value;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("That is not a CUNY AI Lab sign-in code. Copy the code from the browser and try again.");
  }
  if (state !== undefined && url.searchParams.get("state") !== state) {
    throw new Error("That address belongs to a different sign-in. Use the code or address from the current browser approval.");
  }
  const code = url.searchParams.get("code") ?? "";
  if (!SIGN_IN_CODE.test(code)) throw new Error("That address has no sign-in code. Copy the code from the browser and try again.");
  return code;
}

const MAX_EXCHANGE_BYTES = 64 * 1024;

/** Bound decoded bytes, including responses without a trustworthy Content-Length. */
async function readExchangeResponse(response) {
  if (Number(response.headers.get("content-length")) > MAX_EXCHANGE_BYTES) {
    await response.body?.cancel().catch(() => {});
    throw new Error("Response too large");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty response");
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_EXCHANGE_BYTES) throw new Error("Response too large");
      chunks.push(value);
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

function exchangeFailure(status) {
  if (status === 400 || status === 401) return "This sign-in code is no longer valid. Run /login cail to try again.";
  if (status === 403) return "Your CUNY AI Lab access is not active or does not permit sign-in. Contact CUNY AI Lab.";
  if (status === 429) return "Too many sign-in attempts. Wait a moment, then run /login cail again.";
  return "CUNY AI Lab could not finish signing in. Try /login cail again later.";
}

export async function exchangeCode({ code, verifier, replaceKeyId, fetch = globalThis.fetch, tokenUrl = TOKEN_URL, signal }) {
  const body = { code, code_verifier: verifier };
  if (replaceKeyId) body.replace_key_id = replaceKeyId;
  let response;
  try {
    response = await fetch(tokenUrl, {
      method: "POST",
      redirect: "error",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(EXCHANGE_TIMEOUT_MS)]),
    });
  } catch {
    if (signal?.aborted) throw new Error("Login cancelled");
    throw new Error("Pi could not reach CUNY AI Lab to finish signing in. Check your connection and try again.");
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(exchangeFailure(response.status));
  }
  let payload;
  try {
    payload = await readExchangeResponse(response);
  } catch {
    if (signal?.aborted) throw new Error("Login cancelled");
    throw new Error("CUNY AI Lab sent an unexpected sign-in response. Try /login cail again.");
  }
  if (signal?.aborted) throw new Error("Login cancelled");
  const key = payload?.key;
  const expires = payload?.credential?.expiresAt;
  if (typeof key !== "string" || !PERSONAL_KEY.test(key) || !Number.isSafeInteger(expires)) {
    throw new Error("CUNY AI Lab sent an unexpected sign-in response.");
  }
  return { type: "oauth", access: key, refresh: "", expires };
}

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

function page(title, message) {
  title = escapeHtml(title);
  message = escapeHtml(message);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1.5rem;color:#182d40}@media(prefers-color-scheme:dark){body{background:#0c1620;color:#e3ebf3}}</style></head><body><h1>${title}</h1><p>${message}</p></body></html>`;
}

/**
 * One-shot loopback server for the connect page's redirect. It finishes the
 * exchange before answering, so the browser reports the real outcome.
 */
async function startCallbackServer({ state, complete, signal }) {
  let settle;
  const outcome = new Promise((resolve, reject) => {
    settle = { resolve, reject };
  });
  outcome.catch(() => {});
  let exchangePromise;
  let settled = false;
  const finish = (result) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (result.error) settle.reject(result.error);
    else settle.resolve(result.value);
  };
  const timer = setTimeout(() => finish({ error: new Error("CUNY AI Lab sign-in timed out. Type /login cail to try again.") }), LOGIN_TIMEOUT_MS);
  // Browser and paste input share one claim and one retained result.
  const completeOnce = (code) => {
    if (settled) return outcome;
    if (!exchangePromise) {
      exchangePromise = Promise.resolve().then(() => settled ? outcome : complete(code)).then(
        (value) => { finish({ value }); return outcome; },
        (error) => { finish({ error }); return outcome; },
      );
      exchangePromise.catch(() => {});
    }
    return exchangePromise;
  };
  const server = createServer((request, response) => {
    const send = (status, title, message) => {
      response.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      response.once("finish", () => { if (settled) server.closeIdleConnections(); });
      response.end(page(title, message));
    };
    let url;
    try {
      // Accept only origin-form paths, never an authority or absolute URL.
      if (!request.url?.startsWith("/") || request.url.startsWith("//")) throw new Error("Invalid target");
      url = new URL(request.url, "http://127.0.0.1");
      if (url.origin !== "http://127.0.0.1") throw new Error("Invalid target");
    } catch {
      send(400, "Invalid request", "Return to Pi and continue signing in.");
      return;
    }
    if (request.method !== "GET" || url.pathname !== CALLBACK_PATH || url.searchParams.get("state") !== state) {
      send(404, "Not found", "This is Pi's sign-in helper. Nothing is waiting at this address.");
      return;
    }
    if (!exchangePromise && url.searchParams.get("error") === "access_denied") {
      send(200, "Sign-in cancelled", "Pi was not connected. You can close this tab.");
      finish({ error: new Error("Login cancelled") });
      return;
    }
    let code;
    try {
      code = codeFromInput(url.href, state);
    } catch (error) {
      send(400, "Sign-in failed", error.message);
      return;
    }
    completeOnce(code).then(
      () => {
        send(200, "Sign-in approved", "Return to Pi to continue. You can close this tab.");
      },
      (error) => {
        send(502, "Sign-in not completed", error.message);
      },
    );
  });
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
  } catch (error) {
    clearTimeout(timer);
    server.close();
    throw error;
  }
  const onAbort = () => finish({ error: new Error("Login cancelled") });
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();
  return {
    redirectUri: `http://127.0.0.1:${server.address().port}${CALLBACK_PATH}`,
    outcome,
    complete: completeOnce,
    fail(error) { finish({ error }); },
    isCompleting: () => Boolean(exchangePromise),
    close() {
      signal?.removeEventListener("abort", onAbort);
      finish({ error: new Error("Sign-in callback closed") });
      server.close();
    },
  };
}

/** Pi's OAuth auth for the `cail` provider. */
export function createSignIn({ fetch = globalThis.fetch, env = process.env, hostname, connectUrl = CONNECT_URL, tokenUrl = TOKEN_URL } = {}) {
  return {
    name: "CUNY AI Lab account",
    loginLabel: LOGIN_LABEL,
    async login(interaction) {
      const lifetime = new AbortController();
      const signal = AbortSignal.any([interaction.signal ?? new AbortController().signal, lifetime.signal]);
      signal.throwIfAborted();
      try {
        const { verifier, challenge } = pkcePair();
        const replaceKeyId = previousSignInKeyId({ env });
        const exchange = (code) => exchangeCode({ code, verifier, replaceKeyId, fetch, tokenUrl, signal });
        const request = new URLSearchParams({ client: "pi", device: deviceName(hostname), code_challenge: challenge });

        if (isRemoteSession(env)) {
          interaction.notify({
            type: "auth_url",
            url: `${connectUrl}?${request}`,
            instructions: "Open this link in a browser on any computer and approve Pi. Then paste the code it shows here.",
          });
          const input = await interaction.prompt({ type: "manual_code", message: "Paste the sign-in code:", signal });
          interaction.notify({ type: "progress", message: "Finishing sign-in…" });
          return await exchange(codeFromInput(input));
        }

        const state = base64Url(randomBytes(24));
        const callback = await startCallbackServer({ state, complete: exchange, signal });
        const pasted = new AbortController();
        try {
          signal.throwIfAborted();
          request.set("redirect_uri", callback.redirectUri);
          request.set("state", state);
          interaction.notify({
            type: "auth_url",
            url: `${connectUrl}?${request}`,
            instructions: "Approve Pi in your browser, then return here. Paste a code or callback address only if needed.",
          });
          // Paste is a fallback into the same operation, never a second exchange.
          const manual = async () => {
            while (!signal.aborted) {
              try {
                const input = await interaction.prompt({ type: "manual_code", message: "Waiting for browser approval. Paste a code or address if needed:", signal: pasted.signal });
                if (callback.isCompleting()) return;
                let code;
                try {
                  code = codeFromInput(input, state);
                } catch (error) {
                  interaction.notify({ type: "progress", message: error.message });
                  continue;
                }
                interaction.notify({ type: "progress", message: "Finishing sign-in…" });
                await callback.complete(code);
                return;
              } catch (error) {
                if (!pasted.signal.aborted && !callback.isCompleting()) callback.fail(error);
                return;
              }
            }
          };
          void manual();
          return await callback.outcome;
        } finally {
          pasted.abort();
          callback.close();
        }
      } finally {
        lifetime.abort();
      }
    },
    async refresh() {
      throw new Error(EXPIRED_MESSAGE);
    },
    async toAuth(credential) {
      return { apiKey: credential.access };
    },
  };
}
