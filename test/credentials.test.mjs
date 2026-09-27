import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CAIL_PROVIDER_ID,
  readCredentialStatus,
  readStoredApiKey,
  writeCredentialFallback,
  saveApiKey,
  deleteCredentialFallback,
  locatePiPackageDir,
  managedPiReleaseModules,
} from "../src/credentials.mjs";

const FAKE_KEY = "cail-test-super-secret-12345";

function scratch() {
  return mkdtempSync(join(tmpdir(), "cail-pi-auth-"));
}

test("readCredentialStatus reports absent, missing, configured and malformed without exposing secrets", () => {
  const dir = scratch();
  const authPath = join(dir, "auth.json");
  assert.deepEqual(readCredentialStatus(authPath), { state: "absent" });

  writeFileSync(authPath, JSON.stringify({ anthropic: { type: "api_key", key: "sk-other" } }));
  assert.deepEqual(readCredentialStatus(authPath), { state: "missing" });

  writeFileSync(authPath, JSON.stringify({ cail: { type: "api_key", key: FAKE_KEY } }));
  const status = readCredentialStatus(authPath);
  assert.deepEqual(status, { state: "configured", type: "api_key" });
  assert.ok(!JSON.stringify(status).includes(FAKE_KEY));

  writeFileSync(authPath, "{ broken");
  assert.equal(readCredentialStatus(authPath).state, "malformed");
});

test("readStoredApiKey returns the key only for api_key credentials", () => {
  const dir = scratch();
  const authPath = join(dir, "auth.json");
  assert.equal(readStoredApiKey(authPath), undefined);
  writeFileSync(authPath, JSON.stringify({ cail: { type: "api_key", key: FAKE_KEY } }));
  assert.equal(readStoredApiKey(authPath), FAKE_KEY);
  writeFileSync(authPath, JSON.stringify({ cail: { type: "oauth", access: "a", refresh: "r", expires: 1 } }));
  assert.equal(readStoredApiKey(authPath), undefined);
});

test("writeCredentialFallback creates the directory and file with owner-only permissions", () => {
  const dir = join(scratch(), "nested", "agent");
  const authPath = join(dir, "auth.json");
  writeCredentialFallback(authPath, CAIL_PROVIDER_ID, { type: "api_key", key: FAKE_KEY });
  const data = JSON.parse(readFileSync(authPath, "utf8"));
  assert.deepEqual(data, { cail: { type: "api_key", key: FAKE_KEY } });
  if (process.platform !== "win32") {
    assert.equal(statSync(authPath).mode & 0o777, 0o600);
    assert.equal(statSync(dir).mode & 0o777, 0o700);
  }
});

test("writeCredentialFallback preserves other providers, backs up, and leaves no secret in temp names", () => {
  const dir = scratch();
  const authPath = join(dir, "auth.json");
  const existing = {
    anthropic: { type: "api_key", key: "sk-ant-existing" },
    openai: { type: "oauth", access: "a", refresh: "r", expires: 123 },
  };
  writeFileSync(authPath, JSON.stringify(existing));
  const result = writeCredentialFallback(authPath, CAIL_PROVIDER_ID, { type: "api_key", key: FAKE_KEY });
  const data = JSON.parse(readFileSync(authPath, "utf8"));
  assert.deepEqual(data.anthropic, existing.anthropic);
  assert.deepEqual(data.openai, existing.openai);
  assert.deepEqual(data.cail, { type: "api_key", key: FAKE_KEY });
  assert.ok(result.backupPath && existsSync(result.backupPath));
  assert.deepEqual(JSON.parse(readFileSync(result.backupPath, "utf8")), existing);
  for (const name of readdirSync(dir)) assert.ok(!name.includes(FAKE_KEY), name);
  if (process.platform !== "win32") assert.equal(statSync(result.backupPath).mode & 0o777, 0o600);
});

test("writeCredentialFallback refuses to overwrite malformed JSON and explains recovery", () => {
  const dir = scratch();
  const authPath = join(dir, "auth.json");
  writeFileSync(authPath, "{ broken json");
  assert.throws(
    () => writeCredentialFallback(authPath, CAIL_PROVIDER_ID, { type: "api_key", key: FAKE_KEY }),
    (error) => {
      assert.match(error.message, /auth\.json/);
      assert.match(error.message, /not valid JSON/i);
      assert.match(error.message, /rename|move|back up/i);
      assert.ok(!error.message.includes(FAKE_KEY));
      return true;
    },
  );
  assert.equal(readFileSync(authPath, "utf8"), "{ broken json");
  assert.deepEqual(readdirSync(dir), ["auth.json"]);
});

test("writeCredentialFallback replaces an existing cail entry in place", () => {
  const dir = scratch();
  const authPath = join(dir, "auth.json");
  writeFileSync(authPath, JSON.stringify({ cail: { type: "api_key", key: "old" }, other: { type: "api_key", key: "o" } }));
  writeCredentialFallback(authPath, CAIL_PROVIDER_ID, { type: "api_key", key: FAKE_KEY });
  const data = JSON.parse(readFileSync(authPath, "utf8"));
  assert.equal(data.cail.key, FAKE_KEY);
  assert.equal(data.other.key, "o");
});

test("deleteCredentialFallback removes only the cail entry", () => {
  const dir = scratch();
  const authPath = join(dir, "auth.json");
  writeFileSync(authPath, JSON.stringify({ cail: { type: "api_key", key: FAKE_KEY }, other: { type: "api_key", key: "o" } }));
  deleteCredentialFallback(authPath, CAIL_PROVIDER_ID);
  assert.deepEqual(JSON.parse(readFileSync(authPath, "utf8")), { other: { type: "api_key", key: "o" } });
});

test("saveApiKey uses the injected Pi credential store when one is provided", async () => {
  const calls = [];
  const store = {
    async modify(provider, fn) {
      const next = await fn(undefined);
      calls.push({ provider, next });
      return next;
    },
  };
  const result = await saveApiKey(FAKE_KEY, { authPath: join(scratch(), "auth.json"), loadStore: async () => store });
  assert.equal(result.method, "pi");
  assert.deepEqual(calls, [{ provider: "cail", next: { type: "api_key", key: FAKE_KEY } }]);
  assert.ok(!JSON.stringify(result).includes(FAKE_KEY));
});

test("saveApiKey falls back to the narrow writer when Pi's store cannot be loaded", async () => {
  const authPath = join(scratch(), "auth.json");
  writeFileSync(authPath, JSON.stringify({ anthropic: { type: "api_key", key: "keep" } }));
  const result = await saveApiKey(FAKE_KEY, { authPath, loadStore: async () => undefined });
  assert.equal(result.method, "fallback");
  const data = JSON.parse(readFileSync(authPath, "utf8"));
  assert.equal(data.anthropic.key, "keep");
  assert.equal(data.cail.key, FAKE_KEY);
});

test("saveApiKey trims surrounding whitespace before storing", async () => {
  const authPath = join(scratch(), "auth.json");
  await saveApiKey(`  ${FAKE_KEY}\n`, { authPath, loadStore: async () => undefined });
  assert.equal(JSON.parse(readFileSync(authPath, "utf8")).cail.key, FAKE_KEY);
});

test("locatePiPackageDir finds a package.json under the given global npm root", () => {
  const root = scratch();
  const pkgDir = join(root, "@earendil-works", "pi-coding-agent");
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "0.85.1" }));
  assert.equal(locatePiPackageDir({ candidates: [root] }), pkgDir);
  assert.equal(locatePiPackageDir({ candidates: [join(root, "nope")] }), undefined);
});

test("managedPiReleaseModules follows a managed Pi launcher to its current release", () => {
  const agentDir = scratch();
  const binDir = join(agentDir, "bin");
  const pkgDir = join(agentDir, "install", "releases", "0.87.1", "node_modules", "@earendil-works", "pi-coding-agent");
  mkdirSync(binDir, { recursive: true });
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "0.87.1" }));
  writeFileSync(join(agentDir, "install", "current-version"), "0.87.1\n");

  const modules = managedPiReleaseModules(binDir);
  assert.equal(modules, join(agentDir, "install", "releases", "0.87.1", "node_modules"));
  assert.equal(locatePiPackageDir({ candidates: [modules] }), pkgDir);

  writeFileSync(join(agentDir, "install", "current-version"), "../escape\n");
  assert.equal(managedPiReleaseModules(binDir), undefined);
  assert.equal(managedPiReleaseModules(join(scratch(), "bin")), undefined);
});

test("saveApiKey stores through the installed Pi AuthStorage when Pi is present (integration)", async (t) => {
  const { loadPiAuthStorage } = await import("../src/credentials.mjs");
  const authPath = join(scratch(), "auth.json");
  writeFileSync(authPath, JSON.stringify({ anthropic: { type: "api_key", key: "keep" } }));
  const store = await loadPiAuthStorage(authPath);
  if (!store) {
    t.skip("Pi is not installed on this machine");
    return;
  }
  const result = await saveApiKey(FAKE_KEY, { authPath });
  assert.equal(result.method, "pi");
  const data = JSON.parse(readFileSync(authPath, "utf8"));
  assert.equal(data.anthropic.key, "keep");
  assert.deepEqual(data.cail, { type: "api_key", key: FAKE_KEY });
  if (process.platform !== "win32") assert.equal(statSync(authPath).mode & 0o777, 0o600);
  assert.equal(readdirSync(dirnameOf(authPath)).some((n) => n.includes(FAKE_KEY)), false);
});

function dirnameOf(p) {
  return p.slice(0, p.lastIndexOf("/") === -1 ? p.lastIndexOf("\\") : p.lastIndexOf("/"));
}
