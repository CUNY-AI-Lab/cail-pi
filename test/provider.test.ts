import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildCailProvider } from "../extensions/cail.ts";

const FAKE_KEY = "cail-test-super-secret-12345";
const catalog = readFileSync(new URL("./fixtures/models-catalog.json", import.meta.url), "utf8");

function fetchStub(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  };
  return Object.assign(fetch, { calls });
}

function refreshContext(overrides: Record<string, unknown> = {}) {
  return {
    credential: { type: "api_key" as const, key: FAKE_KEY },
    allowNetwork: true,
    signal: new AbortController().signal,
    publish: async () => true,
    ...overrides,
  };
}

test("provider is registered as cail / CUNY AI Lab on the gateway base URL with sign-in, key and env auth", () => {
  const provider = buildCailProvider({ fetch: fetchStub(() => new Response(catalog)) });
  assert.equal(provider.id, "cail");
  assert.equal(provider.name, "CUNY AI Lab");
  assert.equal(provider.baseUrl, "https://tools.ailab.gc.cuny.edu/v1");
  assert.equal(provider.auth.apiKey?.name, "CUNY AI Lab API key");
  assert.equal(typeof provider.auth.apiKey?.login, "function", "supports /login");
  assert.equal(provider.auth.oauth?.loginLabel, "Sign in with CUNY AI Lab", "offers browser sign-in in /login");
  assert.deepEqual(provider.getModels(), [], "no hard-coded models");
});

test("stored credential wins over AILAB_API_KEY when resolving auth", async () => {
  const provider = buildCailProvider({ fetch: fetchStub(() => new Response(catalog)) });
  const ctx = { env: async (name: string) => (name === "AILAB_API_KEY" ? "env-key" : undefined), fileExists: async () => false };
  const stored = await provider.auth.apiKey!.resolve({ ctx, credential: { type: "api_key", key: FAKE_KEY }, signal: new AbortController().signal });
  assert.equal(stored?.auth.apiKey, FAKE_KEY);
  const fromEnv = await provider.auth.apiKey!.resolve({ ctx, credential: undefined, signal: new AbortController().signal });
  assert.equal(fromEnv?.auth.apiKey, "env-key");
});

test("fetchModels calls /v1/models with the effective credential and honors the abort signal", async () => {
  const fetch = fetchStub(() => new Response(catalog, { headers: { "content-type": "application/json" } }));
  const provider = buildCailProvider({ fetch });
  const controller = new AbortController();
  const models = await provider.fetchModels(refreshContext({ signal: controller.signal }));
  assert.equal(fetch.calls[0].url, "https://tools.ailab.gc.cuny.edu/v1/models");
  assert.equal((fetch.calls[0].init.headers as Record<string, string>).Authorization, `Bearer ${FAKE_KEY}`);
  assert.equal(fetch.calls[0].init.signal, controller.signal);
  assert.ok(models.length >= 3);
  assert.ok(models.every((m) => m.provider === "cail" && m.api === "openai-completions"));
  assert.ok(!models.some((m) => m.id === "whisper-large-v3-turbo"));
});

test("fetchModels works without a stored credential because the catalog is public", async () => {
  const fetch = fetchStub(() => new Response(catalog));
  const provider = buildCailProvider({ fetch });
  const models = await provider.fetchModels(refreshContext({ credential: undefined }));
  assert.equal((fetch.calls[0].init.headers as Record<string, string>).Authorization, undefined);
  assert.ok(models.length > 0);
});

test("fetchModels raises a useful error for HTTP failures and malformed catalogs without leaking the key", async () => {
  const bad = buildCailProvider({ fetch: fetchStub(() => new Response("nope", { status: 500 })) });
  await assert.rejects(bad.fetchModels(refreshContext()), (error: Error) => {
    assert.match(error.message, /CUNY AI Lab/);
    assert.match(error.message, /500/);
    assert.ok(!error.message.includes(FAKE_KEY));
    return true;
  });
  const malformed = buildCailProvider({ fetch: fetchStub(() => new Response(JSON.stringify({ models: [] }))) });
  await assert.rejects(malformed.fetchModels(refreshContext()), /model list/);
});

test("publishing through Pi's createProvider merges fetched models into getModels()", async () => {
  const provider = buildCailProvider({ fetch: fetchStub(() => new Response(catalog)) });
  let update: (() => void) | undefined;
  await provider.refreshModels!({
    ...refreshContext(),
    publish: async (publication: { update?: () => void; persist?: unknown }) => {
      update = publication.update;
      publication.update?.();
      assert.ok(publication.persist, "fetched catalog is persisted for the next session");
      return true;
    },
  } as never);
  assert.ok(update);
  assert.ok(provider.getModels().length >= 3);
});

test("loadStartupModels fetches the public catalog so models are visible before any refresh", async () => {
  const { loadStartupModels } = await import("../extensions/cail.ts");
  const fetch = fetchStub(() => new Response(catalog));
  const models = await loadStartupModels({ fetch, env: {} });
  assert.ok(models.length >= 3);
  assert.equal((fetch.calls[0].init.headers as Record<string, string>).Authorization, undefined, "no credential needed");
  assert.ok(fetch.calls[0].init.signal instanceof AbortSignal, "bounded by a timeout");
});

test("loadStartupModels returns no models offline or on failure instead of breaking Pi startup", async () => {
  const { loadStartupModels } = await import("../extensions/cail.ts");
  const offline = fetchStub(() => new Response(catalog));
  assert.deepEqual(await loadStartupModels({ fetch: offline, env: { PI_OFFLINE: "1" } }), []);
  assert.equal(offline.calls.length, 0);
  const failing = fetchStub(() => { throw new TypeError("fetch failed"); });
  assert.deepEqual(await loadStartupModels({ fetch: failing, env: {} }), []);
  const malformed = fetchStub(() => new Response("<html>"));
  assert.deepEqual(await loadStartupModels({ fetch: malformed, env: {} }), []);
});

type Handler = (event: unknown, ctx: unknown) => unknown;

function fakePi() {
  const handlers: Record<string, Handler[]> = {};
  const commands: Record<string, { handler: (args: string, ctx: unknown) => Promise<void> }> = {};
  const registered: unknown[] = [];
  const selected: unknown[] = [];
  const pi = {
    registerProvider: (provider: unknown) => registered.push(provider),
    on: (event: string, handler: Handler) => {
      (handlers[event] ??= []).push(handler);
      return () => {};
    },
    registerCommand: (name: string, options: (typeof commands)[string]) => {
      commands[name] = options;
    },
    setModel: async (model: unknown) => {
      selected.push(model);
      return true;
    },
  };
  return { pi, handlers, commands, registered, selected };
}

function sessionContext(overrides: Record<string, unknown> = {}) {
  const notes: { message: string; type?: string }[] = [];
  const available = [
    { provider: "cail", id: "gpt-oss-120b" },
    { provider: "cail", id: "deepseek-v4-flash-0731" },
    { provider: "other", id: "deepseek-v5-flash-0101" },
  ];
  return {
    notes,
    model: undefined,
    modelRegistry: {
      getAvailable: () => available,
      getApiKeyForProvider: async () => FAKE_KEY,
    },
    ui: { notify: (message: string, type?: string) => notes.push({ message, type }) },
    ...overrides,
  };
}

async function loadExtension(options: Record<string, unknown> = {}) {
  const mod = await import("../extensions/cail.ts");
  const fake = fakePi();
  const fetch = fetchStub(() => new Response(catalog));
  await mod.default(fake.pi as never, { fetch, env: {}, platform: "darwin", ...options } as never);
  return { mod, ...fake };
}

test("the extension factory registers the provider with startup models as its baseline", async () => {
  const { registered } = await loadExtension();
  assert.equal(registered.length, 1);
  const provider = registered[0] as { id: string; getModels: () => unknown[] };
  assert.equal(provider.id, "cail");
  assert.ok(provider.getModels().length >= 3, "models available immediately after load");
});

test("a message sent with no model selected starts the session on the newest CUNY AI Lab DeepSeek Flash", async () => {
  const { handlers, selected } = await loadExtension();
  const result = await handlers.input[0]({ type: "input", text: "hello" }, sessionContext());
  assert.deepEqual(result, { action: "continue" });
  assert.deepEqual(selected, [{ provider: "cail", id: "deepseek-v4-flash-0731" }]);
});

test("Pi's placeholder model after /login counts as no model", async () => {
  const { handlers, selected } = await loadExtension();
  const placeholder = { provider: "unknown", id: "unknown", api: "unknown" };
  await handlers.input[0]({ type: "input", text: "hello" }, sessionContext({ model: placeholder }));
  assert.deepEqual(selected, [{ provider: "cail", id: "deepseek-v4-flash-0731" }]);
});

test("a model the participant already chose is never replaced", async () => {
  const { handlers, selected } = await loadExtension();
  const result = await handlers.input[0]({ type: "input", text: "hello" }, sessionContext({ model: { provider: "cail", id: "gpt-oss-120b" } }));
  assert.deepEqual(result, { action: "continue" });
  assert.deepEqual(selected, []);
});

test("the PowerShell setting is applied only on Windows, and only once", async () => {
  const { mkdtempSync, readFileSync: read } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const agentDir = mkdtempSync(join(tmpdir(), "cail-pi-agent-"));

  assert.equal((await loadExtension()).handlers.session_start, undefined, "not registered off Windows");

  const { handlers } = await loadExtension({ platform: "win32", env: { PI_CODING_AGENT_DIR: agentDir } });
  const first = sessionContext();
  await handlers.session_start[0]({ type: "session_start", reason: "startup" }, first);
  assert.deepEqual(JSON.parse(read(join(agentDir, "settings.json"), "utf8")).defaultTools, ["-bash", "+powershell"]);
  assert.match(first.notes[0].message, /enabled Pi's PowerShell tool/);

  const second = sessionContext();
  await handlers.session_start[0]({ type: "session_start", reason: "startup" }, second);
  assert.deepEqual(second.notes, [], "an existing defaultTools is left alone");
});

test("/cail reports the setup without printing the key", async () => {
  const { mod, commands } = await loadExtension({
    fetch: fetchStub((url) => (url.endsWith("/quota") ? new Response("{}") : new Response(catalog))),
  });
  const ctx = sessionContext({ model: { provider: "cail", id: "deepseek-v4-flash-0731" } });
  await commands[mod.COMMAND_NAME].handler("", ctx);
  assert.equal(ctx.notes.length, 1);
  assert.equal(ctx.notes[0].type, "info");
  assert.match(ctx.notes[0].message, /API key: valid ✓/);
  assert.match(ctx.notes[0].message, /Current model: cail\/deepseek-v4-flash-0731/);
  assert.ok(!ctx.notes[0].message.includes(FAKE_KEY));
});
