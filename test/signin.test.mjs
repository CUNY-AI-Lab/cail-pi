import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONNECT_URL,
  EXPIRED_MESSAGE,
  LOGIN_LABEL,
  codeFromInput,
  createSignIn,
  deviceName,
  exchangeCode,
  keyIdFromKey,
  previousSignInKeyId,
} from "../src/signin.mjs";

const KEY_ID_HEX = "0123456789ab4cde8123456789abcdef";
const KEY_ID = "01234567-89ab-4cde-8123-456789abcdef";
const KEY = `sk-cail-p_${KEY_ID_HEX}_${"a".repeat(40)}`;
const NEW_KEY = `sk-cail-p_${"f".repeat(32)}_${"b".repeat(40)}`;
const CODE = "c".repeat(43);
const EXPIRES = Date.UTC(2027, 3, 2);
/** The Lab's accepted device names (Model Access API). */
const LAB_DEVICE = /^[A-Za-z0-9](?:[A-Za-z0-9._ -]{0,62}[A-Za-z0-9])?$/;

function labStub(respond = () => Response.json({ key: NEW_KEY, credential: { expiresAt: EXPIRES } }, { status: 201 })) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body), init });
    return respond();
  };
  return Object.assign(fetch, { calls });
}

function agentDir(stored) {
  const dir = mkdtempSync(join(tmpdir(), "cail-pi-signin-"));
  if (stored) writeFileSync(join(dir, "auth.json"), JSON.stringify({ cail: stored }));
  return dir;
}

/** Pi's login interaction: records events and holds a paste prompt open until cancelled. */
function interaction({ pasted } = {}) {
  const events = [];
  let urlSeen;
  const url = new Promise((resolve) => {
    urlSeen = resolve;
  });
  return {
    events,
    url,
    signal: new AbortController().signal,
    notify(event) {
      events.push(event);
      if (event.type === "auth_url") urlSeen(new URL(event.url));
    },
    prompt(prompt) {
      events.push({ type: "prompt", prompt: prompt.type });
      if (pasted !== undefined) return url.then(pasted);
      return new Promise((_resolve, reject) => {
        prompt.signal?.addEventListener("abort", () => reject(new Error("prompt closed")));
      });
    },
  };
}

test("the device name is the hostname, cut to what the Lab accepts", () => {
  assert.equal(deviceName("Stephens-MacBook-Pro.local"), "Stephens-MacBook-Pro");
  assert.equal(deviceName("lab_box!!"), "lab_box");
  assert.equal(deviceName("José's Mac"), "Jos-s Mac");
  assert.equal(deviceName("---"), "computer");
  for (const name of ["Stephens-MacBook-Pro.local", "José's Mac", `${"x".repeat(63)}-yz`, "---", "a"]) {
    assert.match(deviceName(name), LAB_DEVICE, name);
  }
});

test("a personal key carries its id; other values do not", () => {
  assert.equal(keyIdFromKey(KEY), KEY_ID);
  assert.equal(keyIdFromKey("sk-cail-d_" + KEY.slice(10)), undefined);
  assert.equal(keyIdFromKey(undefined), undefined);
});

test("only a key from an earlier sign-in is offered for replacement", () => {
  assert.equal(previousSignInKeyId({ env: { PI_CODING_AGENT_DIR: agentDir({ type: "oauth", access: KEY, refresh: "", expires: EXPIRES }) } }), KEY_ID);
  assert.equal(previousSignInKeyId({ env: { PI_CODING_AGENT_DIR: agentDir({ type: "api_key", key: KEY }) } }), undefined);
  assert.equal(previousSignInKeyId({ env: { PI_CODING_AGENT_DIR: agentDir() } }), undefined);
});

test("a pasted code or callback address yields the code; anything else is refused", () => {
  assert.equal(codeFromInput(`  ${CODE}\n`), CODE);
  assert.equal(codeFromInput(`http://127.0.0.1:5000/callback?code=${CODE}&state=s1`, "s1"), CODE);
  assert.throws(() => codeFromInput(`http://127.0.0.1:5000/callback?code=${CODE}&state=other`, "s1"), /different sign-in/);
  assert.throws(() => codeFromInput("http://127.0.0.1:5000/callback?state=s1", "s1"), /no sign-in code/);
  assert.throws(() => codeFromInput("not a code"), /not a CUNY AI Lab sign-in code/);
});

test("the exchange sends the code, verifier and key to replace, and stores the key until it expires", async () => {
  const lab = labStub();
  const credential = await exchangeCode({ code: CODE, verifier: "v".repeat(43), replaceKeyId: KEY_ID, fetch: lab, tokenUrl: "https://lab.test/token" });
  assert.deepEqual(credential, { type: "oauth", access: NEW_KEY, refresh: "", expires: EXPIRES });
  assert.equal(lab.calls[0].url, "https://lab.test/token");
  assert.deepEqual(lab.calls[0].body, { code: CODE, code_verifier: "v".repeat(43), replace_key_id: KEY_ID });
  assert.equal(lab.calls[0].init.headers["content-type"], "application/json");
});

test("exchange failures carry the Lab's message and never the key", async () => {
  const refused = labStub(() => Response.json({ error: "invalid_grant", message: "This sign-in code is no longer valid. Sign in again from the app." }, { status: 400 }));
  await assert.rejects(exchangeCode({ code: CODE, verifier: "v".repeat(43), fetch: refused }), /no longer valid/);
  const notAdmitted = labStub(() => Response.json({ error: { code: "admission_required", message: "Your CUNY AI Lab access is not active yet." } }, { status: 403 }));
  await assert.rejects(exchangeCode({ code: CODE, verifier: "v".repeat(43), fetch: notAdmitted }), /access is not active/);
  const malformed = labStub(() => Response.json({ key: "nope" }, { status: 201 }));
  await assert.rejects(exchangeCode({ code: CODE, verifier: "v".repeat(43), fetch: malformed }), /unexpected sign-in response/);
  const offline = Object.assign(async () => {
    throw new TypeError("fetch failed");
  });
  await assert.rejects(exchangeCode({ code: CODE, verifier: "v".repeat(43), fetch: offline }), /could not reach CUNY AI Lab/);
});

test("on this computer, approving in the browser finishes sign-in through the loopback callback", async () => {
  const lab = labStub();
  const signIn = createSignIn({ fetch: lab, env: { PI_CODING_AGENT_DIR: agentDir() }, hostname: "test-laptop.local" });
  assert.equal(signIn.loginLabel, LOGIN_LABEL);
  const ui = interaction();
  const login = signIn.login(ui);
  const url = await ui.url;
  assert.equal(`${url.origin}${url.pathname}`, CONNECT_URL);
  assert.equal(url.searchParams.get("client"), "pi");
  assert.equal(url.searchParams.get("device"), "test-laptop");
  const redirect = new URL(url.searchParams.get("redirect_uri"));
  assert.equal(redirect.hostname, "127.0.0.1");
  assert.equal(redirect.pathname, "/callback");
  const state = url.searchParams.get("state");

  const stray = await fetch(`${redirect.href}?code=${CODE}&state=wrong`);
  assert.equal(stray.status, 404);

  const browser = await fetch(`${redirect.href}?code=${CODE}&state=${state}`);
  assert.equal(browser.status, 200);
  assert.match(await browser.text(), /Pi is connected/);
  assert.deepEqual(await login, { type: "oauth", access: NEW_KEY, refresh: "", expires: EXPIRES });

  const sent = lab.calls[0].body;
  assert.equal(sent.code, CODE);
  assert.equal(createHash("sha256").update(sent.code_verifier).digest("base64url"), url.searchParams.get("code_challenge"));
  assert.equal(sent.replace_key_id, undefined, "nothing to replace on a first sign-in");
  await assert.rejects(fetch(redirect.href), "the callback closes after sign-in");
});

test("signing in again names this computer's earlier key", async () => {
  const lab = labStub();
  const env = { PI_CODING_AGENT_DIR: agentDir({ type: "oauth", access: KEY, refresh: "", expires: EXPIRES }) };
  const ui = interaction({ pasted: () => CODE });
  await createSignIn({ fetch: lab, env, hostname: "test-laptop" }).login(ui);
  assert.equal(lab.calls[0].body.replace_key_id, KEY_ID);
});

test("Cancel on the consent page stops the login", async () => {
  const ui = interaction();
  const cancelled = assert.rejects(createSignIn({ fetch: labStub(), env: { PI_CODING_AGENT_DIR: agentDir() } }).login(ui), /Login cancelled/);
  const url = await ui.url;
  const redirect = url.searchParams.get("redirect_uri");
  const page = await fetch(`${redirect}?error=access_denied&state=${url.searchParams.get("state")}`);
  assert.match(await page.text(), /Sign-in cancelled/);
  await cancelled;
});

test("a browser on another computer: the participant pastes the address it ended on", async () => {
  const lab = labStub();
  const ui = interaction({
    pasted: (url) => `${url.searchParams.get("redirect_uri")}?code=${CODE}&state=${url.searchParams.get("state")}`,
  });
  const credential = await createSignIn({ fetch: lab, env: { PI_CODING_AGENT_DIR: agentDir() } }).login(ui);
  assert.equal(credential.access, NEW_KEY);
  assert.equal(lab.calls[0].body.code, CODE);
});

test("over SSH, Pi asks for the code the consent page shows", async () => {
  const lab = labStub();
  const ui = interaction({ pasted: () => CODE });
  const env = { PI_CODING_AGENT_DIR: agentDir(), SSH_CONNECTION: "10.0.0.2 52000 10.0.0.1 22" };
  const credential = await createSignIn({ fetch: lab, env, hostname: "server" }).login(ui);
  assert.equal(credential.access, NEW_KEY);
  const url = await ui.url;
  assert.equal(url.searchParams.get("redirect_uri"), null);
  assert.equal(url.searchParams.get("state"), null);
  assert.equal(url.searchParams.get("device"), "server");
  assert.match(ui.events.find((event) => event.type === "auth_url").instructions, /paste the code/);
});

test("an expired sign-in asks for a new one; the stored key is the request key", async () => {
  const signIn = createSignIn();
  await assert.rejects(signIn.refresh({ type: "oauth", access: KEY, refresh: "", expires: 1 }), (error) => error.message === EXPIRED_MESSAGE);
  assert.deepEqual(await signIn.toAuth({ type: "oauth", access: KEY, refresh: "", expires: EXPIRES }), { apiKey: KEY });
});
