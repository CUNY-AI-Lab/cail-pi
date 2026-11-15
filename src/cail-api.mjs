/**
 * CUNY AI Lab gateway client used by the bootstrapper.
 *
 * Key validation uses `GET /v1/quota`: it requires a valid bearer credential
 * (401 otherwise), needs only the `quota:read` scope, and performs no
 * inference. `GET /v1/models` is public on the gateway, so it cannot verify a
 * key; it is used afterwards for the model count.
 *
 * Nothing returned from this module ever contains the API key.
 */
import { CAIL_BASE_URL, CatalogError, toPiModels } from "./cail-catalog.mjs";

export const DEFAULT_TIMEOUT_MS = 15000;

export const MESSAGES = {
  invalid: "That API key was not accepted by CUNY AI Lab.\n\nPlease check the key and try again.",
  forbidden: "The key was recognized, but it does not have access to this resource.\n\nContact CUNY AI Lab if you think this is a mistake.",
  rate_limited: "CUNY AI Lab is rate-limiting requests right now. Your key was not rejected.\n\nWait a moment and try again.",
  server_error: "CUNY AI Lab returned a server error. Your key was not rejected.\n\nTry again in a few minutes.",
  network_error: "The CUNY AI Lab service could not be reached.",
  unexpected: "CUNY AI Lab returned an unexpected response.",
};

function describeNetworkFailure(error) {
  const name = error?.name ?? "";
  const code = error?.cause?.code ?? error?.code ?? "";
  if (name === "TimeoutError" || code === "UND_ERR_CONNECT_TIMEOUT" || code === "ETIMEDOUT") return "timed out";
  if (name === "AbortError") return "request aborted";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "DNS lookup failed";
  if (code === "ECONNREFUSED") return "connection refused";
  if (/CERT|SSL|TLS|SELF_SIGNED|DEPTH_ZERO/i.test(String(code))) return "TLS certificate problem";
  return "network error";
}

function classifyStatus(status) {
  if (status === 401) return "invalid";
  if (status === 403) return "forbidden";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  return "unexpected";
}

/** Read account allowance without running inference or returning raw error bodies. */
export async function fetchQuota(apiKey, options = {}) {
  const key = typeof apiKey === "string" ? apiKey.trim() : "";
  if (!key) return { ok: false, message: "CAIL sign-in required. Run /login and choose CUNY AI Lab." };
  const { response, networkError } = await request(`${options.baseUrl ?? CAIL_BASE_URL}/quota`, { ...options, apiKey: key });
  if (networkError) return { ok: false, message: `CAIL usage unavailable (${describeNetworkFailure(networkError)}). Try /usage again.` };
  if (!response.ok) {
    const status = classifyStatus(response.status);
    const messages = {
      invalid: "CAIL sign-in was not accepted. Run /login to sign in again.",
      forbidden: "This CAIL key cannot read usage. Contact CUNY AI Lab.",
      rate_limited: "Too many requests. Wait a moment, then run /usage again.",
      server_error: "CAIL usage is temporarily unavailable. Try /usage again later.",
      unexpected: "CAIL usage unavailable. Try /usage again later.",
    };
    return { ok: false, message: messages[status] };
  }
  try {
    return { ok: true, quota: await response.json() };
  } catch {
    return { ok: false, message: "CAIL usage unavailable. Try /usage again later." };
  }
}

async function request(url, { fetch: fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS, apiKey, signal } = {}) {
  const headers = { Accept: "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const signals = [AbortSignal.timeout(timeoutMs)];
  if (signal) signals.push(signal);
  try {
    const response = await fetchImpl(url, { method: "GET", headers, signal: AbortSignal.any(signals), redirect: "error" });
    return { response };
  } catch (error) {
    return { networkError: error };
  }
}

/**
 * Check whether an API key is accepted by CUNY AI Lab.
 * Resolves to { status: "valid" | "invalid" | "forbidden" | "rate_limited" | "server_error" | "network_error" | "unexpected", message, retryable }.
 */
export async function validateApiKey(apiKey, options = {}) {
  const key = typeof apiKey === "string" ? apiKey.trim() : "";
  if (!key) return { status: "invalid", message: MESSAGES.invalid, retryable: false };
  const baseUrl = options.baseUrl ?? CAIL_BASE_URL;
  const { response, networkError } = await request(`${baseUrl}/quota`, { ...options, apiKey: key });
  if (networkError) {
    const detail = describeNetworkFailure(networkError);
    return { status: "network_error", message: `${MESSAGES.network_error} (${detail})`, retryable: true, detail };
  }
  if (response.ok) return { status: "valid", message: "API key verified", retryable: false };
  const status = classifyStatus(response.status);
  return {
    status,
    httpStatus: response.status,
    message: status === "unexpected" ? `${MESSAGES.unexpected} (HTTP ${response.status})` : MESSAGES[status],
    retryable: status === "rate_limited" || status === "server_error",
  };
}

/** Fetch the public model catalog and convert it to Pi models. */
export async function fetchModelCatalog(options = {}) {
  const baseUrl = options.baseUrl ?? CAIL_BASE_URL;
  const { response, networkError } = await request(`${baseUrl}/models`, options);
  if (networkError) {
    const detail = describeNetworkFailure(networkError);
    return { ok: false, status: "network_error", message: `${MESSAGES.network_error} (${detail})`, detail };
  }
  if (!response.ok) {
    const status = classifyStatus(response.status);
    return { ok: false, status, httpStatus: response.status, message: `Could not load the CUNY AI Lab model list (HTTP ${response.status}).` };
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, status: "malformed", message: "CUNY AI Lab returned a model list that is not valid JSON." };
  }
  try {
    return { ok: true, models: toPiModels(payload, { baseUrl }) };
  } catch (error) {
    if (error instanceof CatalogError) return { ok: false, status: "malformed", message: error.message };
    throw error;
  }
}

/** Validate a key, then count the models it can use. */
export async function checkApiKey(apiKey, options = {}) {
  const validation = await validateApiKey(apiKey, options);
  if (validation.status !== "valid") return validation;
  const catalog = await fetchModelCatalog({ ...options, apiKey: apiKey.trim() });
  if (!catalog.ok) return { ...validation, modelCount: undefined, catalogMessage: catalog.message };
  return { ...validation, modelCount: catalog.models.length };
}
