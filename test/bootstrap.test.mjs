import { test } from "node:test";
import assert from "node:assert/strict";
import { runSetup } from "../src/setup.mjs";
import { parseArgs } from "../src/args.mjs";
import { makeDeps, FAKE_KEY } from "./helpers/harness.mjs";

const opts = (...argv) => parseArgs(argv);

test("happy path: lazypi, install, key prompt, verify, save, refresh, final instructions", async () => {
  const h = makeDeps({ pi: { installed: false } });
  const result = await runSetup(opts(), h.deps);
  assert.equal(result.exitCode, 0);
  const names = h.calls.map((c) => c.name);
  assert.ok(names.indexOf("lazypi") < names.indexOf("pi.install"));
  assert.ok(names.indexOf("pi.install") < names.indexOf("prompt.key"));
  assert.ok(names.indexOf("checkApiKey") < names.indexOf("credentials.save"));
  assert.ok(names.indexOf("credentials.save") < names.indexOf("pi.listModels"));
  const text = h.text();
  assert.match(text, /✓ API key verified/);
  assert.match(text, /✓ 14 CUNY AI Lab models available/);
  assert.match(text, /✓ Credential saved securely in Pi/);
  assert.match(text, /✓ Model catalog updated/);
  assert.match(text, /Setup complete/);
  assert.match(text, /\n {2}pi\n/);
  assert.match(text, /\/model/);
  const finalMessage = text.slice(text.indexOf("Setup complete!"));
  assert.doesNotMatch(finalMessage, /\/login/);
  assert.ok(!text.includes(FAKE_KEY));
});

test("stops before any change when Node is too old", async () => {
  const h = makeDeps({ nodeVersion: "v22.18.0", execPath: "/Users/example/.nvm/versions/node/v22.18.0/bin/node" });
  const result = await runSetup(opts(), h.deps);
  assert.equal(result.exitCode, 1);
  assert.deepEqual(h.calls.filter((c) => c.name !== "pi.version"), []);
  assert.match(h.text(), /requires Node\.js 22\.19\.0 or newer/);
  assert.match(h.text(), /v22\.18\.0/);
  assert.match(h.text(), /\.nvm\/versions\/node\/v22\.18\.0\/bin\/node/);
});

test("stops when LazyPi exits nonzero", async () => {
  const h = makeDeps({ pi: { runLazyPi() { return { status: 2 }; } } });
  const result = await runSetup(opts(), h.deps);
  assert.equal(result.exitCode, 1);
  assert.ok(!h.calls.some((c) => c.name === "pi.install"));
  assert.match(h.text(), /LazyPi/);
});

test("--skip-lazypi requires Pi to already be installed", async () => {
  const h = makeDeps({ pi: { installed: false } });
  const result = await runSetup(opts("--skip-lazypi"), h.deps);
  assert.equal(result.exitCode, 1);
  assert.ok(!h.calls.some((c) => c.name === "lazypi"));
  assert.match(h.text(), /Pi is not installed/);
});

test("stops when the package install fails", async () => {
  const h = makeDeps({ pi: { installWorkshopPackage() { return { status: 1 }; } } });
  const result = await runSetup(opts("--skip-lazypi"), h.deps);
  assert.equal(result.exitCode, 1);
  assert.ok(!h.calls.some((c) => c.name === "prompt.key"));
});

test("--skip-auth installs the provider and points to /login", async () => {
  const h = makeDeps();
  const result = await runSetup(opts("--skip-lazypi", "--skip-auth"), h.deps);
  assert.equal(result.exitCode, 0);
  assert.ok(!h.calls.some((c) => c.name === "prompt.key"));
  assert.match(h.text(), /authentication has not been configured/);
  assert.match(h.text(), /\/login/);
  assert.match(h.text(), /CUNY AI Lab/);
});

test("pressing Enter at the key prompt skips authentication", async () => {
  const h = makeDeps({ prompts: { askApiKey: async () => undefined } });
  const result = await runSetup(opts("--skip-lazypi"), h.deps);
  assert.equal(result.exitCode, 0);
  assert.ok(!h.calls.some((c) => c.name === "credentials.save"));
  assert.match(h.text(), /\/login/);
});

test("a rejected key is reported and re-prompted, then saved once accepted", async () => {
  let attempt = 0;
  const h = makeDeps({
    checkApiKey: async () => (++attempt === 1 ? { status: "invalid", message: "That API key was not accepted by CUNY AI Lab.\n\nPlease check the key and try again." } : { status: "valid", modelCount: 3 }),
    prompts: { askRetryOrSkipAfterRejection: async () => "retry" },
  });
  const result = await runSetup(opts("--skip-lazypi"), h.deps);
  assert.equal(result.exitCode, 0);
  assert.equal(h.calls.filter((c) => c.name === "prompt.key").length, 2);
  assert.equal(h.calls.filter((c) => c.name === "credentials.save").length, 1);
  assert.match(h.text(), /not accepted/);
  assert.ok(!h.text().includes(FAKE_KEY));
});

test("403 explains authorization rather than a malformed key", async () => {
  const h = makeDeps({ checkApiKey: async () => ({ status: "forbidden", message: "The key was recognized, but it does not have access to this resource." }) });
  await runSetup(opts("--skip-lazypi"), h.deps);
  assert.match(h.text(), /recognized/);
  assert.ok(!h.calls.some((c) => c.name === "credentials.save"));
});

test("network failure never blames the key, offers retry/skip, and saves nothing", async () => {
  const h = makeDeps({ checkApiKey: async () => ({ status: "network_error", message: "The CUNY AI Lab service could not be reached. (DNS lookup failed)", retryable: true }) });
  const result = await runSetup(opts("--skip-lazypi"), h.deps);
  assert.equal(result.exitCode, 0);
  assert.match(h.text(), /could not be reached/);
  assert.match(h.text(), /has not been saved/);
  assert.doesNotMatch(h.text(), /not accepted|invalid/i);
  assert.ok(h.calls.some((c) => c.name === "prompt.network"));
  assert.ok(!h.calls.some((c) => c.name === "credentials.save"));
});

test("429 and 500 are never reported as an invalid key", async () => {
  for (const status of ["rate_limited", "server_error"]) {
    const h = makeDeps({ checkApiKey: async () => ({ status, message: "Your key was not rejected.", retryable: true }) });
    await runSetup(opts("--skip-lazypi"), h.deps);
    assert.doesNotMatch(h.text(), /not accepted|invalid key/i, status);
    assert.ok(!h.calls.some((c) => c.name === "credentials.save"), status);
  }
});

test("existing valid credential is kept when the participant accepts the default", async () => {
  const h = makeDeps({ credentials: { state: "configured" } });
  const result = await runSetup(opts("--skip-lazypi"), h.deps);
  assert.equal(result.exitCode, 0);
  assert.match(h.text(), /already configured/);
  assert.ok(h.calls.some((c) => c.name === "prompt.useExisting"));
  assert.ok(!h.calls.some((c) => c.name === "prompt.key"));
  assert.ok(!h.calls.some((c) => c.name === "credentials.save"));
  assert.deepEqual(h.calls.find((c) => c.name === "checkApiKey").key, "stored-old-key");
  assert.ok(!h.text().includes("stored-old-key"));
});

test("existing credential that fails validation triggers a replacement prompt", async () => {
  let n = 0;
  const h = makeDeps({
    credentials: { state: "configured" },
    checkApiKey: async () => (++n === 1 ? { status: "invalid", message: "nope" } : { status: "valid", modelCount: 2 }),
  });
  await runSetup(opts("--skip-lazypi"), h.deps);
  assert.match(h.text(), /no longer valid/);
  assert.ok(h.calls.some((c) => c.name === "prompt.key"));
  assert.equal(h.calls.find((c) => c.name === "credentials.save").key, FAKE_KEY);
});

test("network failure while validating an existing credential leaves it in place", async () => {
  const h = makeDeps({
    credentials: { state: "configured" },
    checkApiKey: async () => ({ status: "network_error", message: "The CUNY AI Lab service could not be reached.", retryable: true }),
  });
  await runSetup(opts("--skip-lazypi"), h.deps);
  assert.ok(!h.calls.some((c) => c.name === "credentials.save"));
  assert.ok(!h.calls.some((c) => c.name === "credentials.remove"));
  assert.equal(h.deps.credentials.state, "configured");
});

test("--replace-key skips the existing-key question and prompts securely", async () => {
  const h = makeDeps({ credentials: { state: "configured" } });
  await runSetup(opts("--skip-lazypi", "--replace-key"), h.deps);
  assert.ok(!h.calls.some((c) => c.name === "prompt.useExisting"));
  assert.ok(h.calls.some((c) => c.name === "prompt.key"));
  assert.equal(h.calls.find((c) => c.name === "credentials.save").key, FAKE_KEY);
});

test("malformed auth store is reported with recovery instructions and left untouched", async () => {
  const h = makeDeps({
    credentials: {
      state: "malformed",
      async save() { throw new Error("/home/jane/.pi/agent/auth.json is not valid JSON, so it was left untouched. To recover: move or rename the file."); },
    },
  });
  const result = await runSetup(opts("--skip-lazypi"), h.deps);
  assert.equal(result.exitCode, 1);
  assert.match(h.text(), /not valid JSON/);
  assert.match(h.text(), /rename/);
  assert.ok(!h.text().includes(FAKE_KEY));
});

test("Windows enables the PowerShell tool and prints pi.cmd, unless --no-windows-settings", async () => {
  const h = makeDeps({ platform: "win32", release: "10.0.22631" });
  await runSetup(opts("--skip-lazypi"), h.deps);
  assert.ok(h.calls.some((c) => c.name === "settings.applyWindows"));
  assert.match(h.text(), /Windows 11/);
  assert.match(h.text(), /\n {2}pi\.cmd\n/);

  const h2 = makeDeps({ platform: "win32", release: "10.0.22631" });
  await runSetup(opts("--skip-lazypi", "--no-windows-settings"), h2.deps);
  assert.ok(!h2.calls.some((c) => c.name === "settings.applyWindows"));
});

test("Windows reports an extended tool list differently from a fresh one", async () => {
  const h = makeDeps({ platform: "win32", release: "10.0.22631", settings: { applyWindows: () => ({ changed: true, reason: "extended" }) } });
  await runSetup(opts("--skip-lazypi"), h.deps);
  assert.match(h.text(), /PowerShell tool added to your Pi tool list/);
});

test("an older Pi is updated with Pi's own updater before anything else changes", async () => {
  const h = makeDeps({ pi: { installedVersion: "0.85.1" } });
  const result = await runSetup(opts("--skip-lazypi"), h.deps);
  assert.equal(result.exitCode, 0);
  const names = h.calls.map((c) => c.name);
  assert.ok(names.indexOf("pi.updateSelf") < names.indexOf("pi.install"), "update runs before the package install");
  assert.match(h.text(), /Pi updated from 0\.85\.1 to 1\.0\.0/);
});

test("a current Pi is not updated", async () => {
  const h = makeDeps();
  await runSetup(opts("--skip-lazypi"), h.deps);
  assert.ok(!h.calls.some((c) => c.name === "pi.updateSelf"));
});

test("setup stops with instructions when Pi cannot be updated", async () => {
  const h = makeDeps({
    platform: "win32",
    release: "10.0.22631",
    pi: { installedVersion: "0.85.1", updateSelf() { h.calls.push({ name: "pi.updateSelf" }); return { status: 1 }; } },
  });
  const result = await runSetup(opts("--skip-lazypi"), h.deps);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stage, "pi-version");
  assert.match(h.text(), /still 0\.85\.1/);
  assert.match(h.text(), /pi\.cmd update --self/);
  assert.match(h.text(), /npm\.cmd install -g @earendil-works\/pi-coding-agent@latest/);
  const mutating = ["pi.install", "settings.applyWindows", "prompt.key", "credentials.save"];
  assert.ok(!h.calls.some((c) => mutating.includes(c.name)));
});

test("macOS never touches Windows settings", async () => {
  const h = makeDeps();
  await runSetup(opts("--skip-lazypi"), h.deps);
  assert.ok(!h.calls.some((c) => c.name === "settings.applyWindows"));
  assert.match(h.text(), /✓ macOS/);
});

test("model refresh problems are reported without failing setup", async () => {
  const h = makeDeps({ pi: { listModels: () => [] } });
  const result = await runSetup(opts("--skip-lazypi"), h.deps);
  assert.equal(result.exitCode, 0);
  assert.match(h.text(), /No CUNY AI Lab models/);
});

test("the fake key never appears in output across every error path", async () => {
  const scenarios = [
    {},
    { checkApiKey: async () => ({ status: "invalid", message: "not accepted" }) },
    { checkApiKey: async () => ({ status: "network_error", message: "unreachable" }) },
    { checkApiKey: async () => { throw new Error("boom"); } },
    { credentials: { async save() { throw new Error("disk full"); } } },
    { pi: { listModels: () => { throw new Error("pi crashed"); } } },
  ];
  for (const scenario of scenarios) {
    const h = makeDeps(scenario);
    await runSetup(opts("--skip-lazypi"), h.deps);
    assert.ok(!h.text().includes(FAKE_KEY), JSON.stringify(Object.keys(scenario)));
  }
});

test("--uninstall removes the package and keeps the key unless confirmed", async () => {
  const h = makeDeps({ credentials: { state: "configured" } });
  const { runUninstall } = await import("../src/setup.mjs");
  const result = await runUninstall(h.deps);
  assert.equal(result.exitCode, 0);
  assert.ok(h.calls.some((c) => c.name === "pi.remove"));
  assert.ok(h.calls.some((c) => c.name === "prompt.removeKey"));
  assert.ok(!h.calls.some((c) => c.name === "credentials.remove"));
  assert.match(h.text(), /kept/i);
});

test("setup replaces the earlier pi-workshop package so the provider is never loaded twice", async () => {
  const h = makeDeps({ pi: { legacy: true } });
  const result = await runSetup(parseArgs([]), h.deps);
  assert.equal(result.exitCode, 0);
  const names = h.calls.map((c) => c.name);
  assert.ok(names.indexOf("pi.removeLegacy") > names.indexOf("pi.install"), "legacy package is removed only after the new one is in");
  assert.match(h.text(), /pi-workshop/);
});

test("setup leaves Pi's packages alone when the earlier package is absent", async () => {
  const h = makeDeps();
  await runSetup(parseArgs([]), h.deps);
  assert.ok(!h.calls.some((c) => c.name === "pi.removeLegacy"));
});

test("a failed removal of the earlier package is a warning with the manual command, not a failed setup", async () => {
  const h = makeDeps({ pi: { legacy: true, removeLegacyPackage: () => ({ status: 1 }) } });
  const result = await runSetup(parseArgs([]), h.deps);
  assert.equal(result.exitCode, 0);
  assert.match(h.text(), /pi remove npm:@cuny-ai-lab\/pi-workshop/);
});

test("--uninstall also removes the earlier pi-workshop package when present", async () => {
  const h = makeDeps({ pi: { legacy: true } });
  const { runUninstall } = await import("../src/setup.mjs");
  const result = await runUninstall(h.deps);
  assert.equal(result.exitCode, 0);
  assert.ok(h.calls.some((c) => c.name === "pi.remove"));
  assert.ok(h.calls.some((c) => c.name === "pi.removeLegacy"));
});
