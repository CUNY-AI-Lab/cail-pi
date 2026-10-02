import { test } from "node:test";
import assert from "node:assert/strict";
import { runDoctor } from "../src/diagnostics.mjs";
import { makeDeps, FAKE_KEY } from "./helpers/harness.mjs";

test("doctor reports every check and makes no changes", async () => {
  const h = makeDeps({ platform: "win32", release: "10.0.22631", credentials: { state: "configured" } });
  const result = await runDoctor(h.deps);
  assert.equal(result.exitCode, 0);
  const text = h.text();
  for (const section of ["Platform", "Node", "npm", "Pi", "CAIL extension", "CAIL credential", "CAIL endpoint", "CAIL authentication", "Available CAIL models", "PowerShell tool"]) {
    assert.match(text, new RegExp(`^${section}$`, "m"), section);
  }
  assert.match(text, /Windows 11/);
  assert.match(text, /v24\.8\.0 ✓/);
  assert.match(text, /configured ✓/);
  assert.match(text, /valid ✓/);
  assert.match(text, /14 ✓/);
  assert.match(text, /enabled ✓/);
  assert.match(text, /\/opt\/node\/bin\/node/);
  const mutating = ["lazypi", "pi.install", "credentials.save", "credentials.remove", "settings.applyWindows", "prompt.key"];
  assert.ok(!h.calls.some((c) => mutating.includes(c.name)));
  assert.ok(!text.includes("stored-old-key"));
  assert.ok(!text.includes(FAKE_KEY));
  assert.doesNotMatch(text, /Bearer/);
});

test("doctor flags missing pieces without exposing secrets", async () => {
  const h = makeDeps({
    pi: { installed: false, hasWorkshopPackage: () => false },
    credentials: { state: "missing" },
    fetchModelCatalog: async () => ({ ok: false, status: "network_error", message: "The CUNY AI Lab service could not be reached." }),
  });
  const result = await runDoctor(h.deps);
  assert.equal(result.exitCode, 1);
  const text = h.text();
  assert.match(text, /^Pi\n {2}not installed ✗/m);
  assert.match(text, /^CAIL credential\n {2}not configured ✗/m);
  assert.match(text, /^CAIL endpoint\n {2}unreachable ✗/m);
  assert.match(text, /^CAIL authentication\n {2}skipped/m);
});

test("doctor warns about a legacy hand-written cail.ts extension", async () => {
  const h = makeDeps({ legacyExtensionPresent: () => true });
  await runDoctor(h.deps);
  assert.match(h.text(), /extensions[\\/]cail\.ts/);
  assert.match(h.text(), /duplicate|conflict/i);
});

test("doctor omits the PowerShell check on macOS and Linux", async () => {
  const h = makeDeps();
  await runDoctor(h.deps);
  assert.doesNotMatch(h.text(), /PowerShell tool/);
});

test("doctor flags a Pi older than the supported minimum", async () => {
  const h = makeDeps({ platform: "win32", release: "10.0.22631", pi: { installedVersion: "0.85.1" } });
  const result = await runDoctor(h.deps);
  assert.equal(result.exitCode, 1);
  assert.match(h.text(), /^Pi\n {2}installed \(0\.85\.1\), 1\.0\.0 or newer needed ✗/m);
  assert.match(h.text(), /pi\.cmd update --all/);
  assert.ok(!h.calls.some((c) => c.name === "pi.updateSelf"), "doctor changes nothing");
});
