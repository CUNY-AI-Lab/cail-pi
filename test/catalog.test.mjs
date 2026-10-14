import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CAIL_BASE_URL, newestDeepSeekFlash, parseCatalog, toPiModels } from "../src/cail-catalog.mjs";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/models-catalog.json", import.meta.url), "utf8"));

test("CAIL base URL is the v1 gateway", () => {
  assert.equal(CAIL_BASE_URL, "https://tools.ailab.gc.cuny.edu/v1");
});

test("parseCatalog keeps entries with nonempty string ids and skips malformed ones", () => {
  const entries = parseCatalog(fixture);
  assert.deepEqual(
    entries.map((e) => e.id),
    ["gemma-3-12b-it", "gpt-oss-120b", "whisper-large-v3-turbo", "qwen2.5-coder-32b-instruct", "llama-3.2-1b-instruct", "mystery-model", "sunset-model"],
  );
});

test("parseCatalog rejects a catalog that is not an OpenAI-style list", () => {
  for (const bad of [null, "x", 42, [], {}, { data: "nope" }, { data: {} }]) {
    assert.throws(() => parseCatalog(bad), /CUNY AI Lab .*model list/i, JSON.stringify(bad));
  }
});

test("toPiModels excludes non-text models and sunset models", () => {
  const ids = toPiModels(fixture).map((m) => m.id);
  assert.ok(!ids.includes("whisper-large-v3-turbo"), "speech model excluded");
  assert.ok(!ids.includes("sunset-model"), "sunset model excluded");
  assert.ok(ids.includes("gemma-3-12b-it"));
  assert.ok(ids.includes("gpt-oss-120b"));
  assert.ok(ids.includes("llama-3.2-1b-instruct"));
});

test("newestDeepSeekFlash prefers the higher version, then the later release", () => {
  const models = ["deepseek-v4-flash-0731", "deepseek-v4-pro-0813", "deepseek-v4-flash-0115", "deepseek-v3-flash", "gpt-oss-120b"].map((id) => ({ id }));
  assert.equal(newestDeepSeekFlash(models).id, "deepseek-v4-flash-0731");
  assert.equal(newestDeepSeekFlash([...models, { id: "deepseek-v5-flash-0101" }]).id, "deepseek-v5-flash-0101");
  assert.equal(newestDeepSeekFlash([{ id: "deepseek-v4-pro-0813" }, { id: "deepseek-r1-distill-qwen-32b" }]), undefined);
});

test("toPiModels lists the newest DeepSeek Flash first and keeps the rest in catalog order", () => {
  const entry = (id) => ({ id, capabilities: ["text-generation", "function-calling"] });
  const payload = { data: ["gpt-oss-120b", "deepseek-v4-flash-0731", "gemma-3-12b-it", "deepseek-v4-pro-0813"].map(entry) };
  assert.deepEqual(
    toPiModels(payload).map((m) => m.id),
    ["deepseek-v4-flash-0731", "gpt-oss-120b", "gemma-3-12b-it", "deepseek-v4-pro-0813"],
  );
  const withoutFlash = { data: ["gpt-oss-120b", "gemma-3-12b-it"].map(entry) };
  assert.deepEqual(toPiModels(withoutFlash).map((m) => m.id), ["gpt-oss-120b", "gemma-3-12b-it"]);
});

test("toPiModels excludes models that are known not to support tool calls, since Pi always sends tools", () => {
  const ids = toPiModels(fixture).map((m) => m.id);
  assert.ok(!ids.includes("qwen2.5-coder-32b-instruct"), "text-only model without function-calling excluded");
  assert.ok(ids.includes("mystery-model"), "model with unknown capabilities still offered");
});

test("toPiModels maps confirmed capabilities and pricing from the live catalog", () => {
  const models = toPiModels(fixture);
  const gemma = models.find((m) => m.id === "gemma-3-12b-it");
  assert.equal(gemma.name, "Gemma 3 12B IT");
  assert.equal(gemma.provider, "cail");
  assert.equal(gemma.api, "openai-completions");
  assert.equal(gemma.baseUrl, CAIL_BASE_URL);
  assert.equal(gemma.reasoning, false);
  assert.deepEqual(gemma.input, ["text", "image"]);
  assert.equal(gemma.contextWindow, 131072);
  assert.equal(gemma.maxTokens, 16384);
  assert.deepEqual(gemma.cost, { input: 0.09, output: 0.29, cacheRead: 0, cacheWrite: 0 });

  const oss = models.find((m) => m.id === "gpt-oss-120b");
  assert.equal(oss.reasoning, true);
  assert.deepEqual(oss.input, ["text"]);
});

test("toPiModels caps maxTokens for small context windows", () => {
  const llama = toPiModels(fixture).find((m) => m.id === "llama-3.2-1b-instruct");
  assert.equal(llama.contextWindow, 8192);
  assert.equal(llama.maxTokens, 4096);
});

test("toPiModels uses conservative defaults for an unknown live model", () => {
  const mystery = toPiModels(fixture).find((m) => m.id === "mystery-model");
  assert.ok(mystery, "unknown model still offered");
  assert.equal(mystery.name, "mystery-model");
  assert.equal(mystery.reasoning, false);
  assert.deepEqual(mystery.input, ["text"]);
  assert.equal(mystery.contextWindow, 128000);
  assert.equal(mystery.maxTokens, 16384);
  assert.deepEqual(mystery.cost, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
});

test("toPiModels never infers reasoning or vision from a model name", () => {
  const payload = { data: [{ id: "deepseek-r1-vision-reasoner" }] };
  const [model] = toPiModels(payload);
  assert.equal(model.reasoning, false);
  assert.deepEqual(model.input, ["text"]);
});
