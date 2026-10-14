import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDoctorReport } from "../src/doctor.mjs";

const healthy = {
  catalog: { ok: true },
  hasKey: true,
  keyCheck: { status: "valid", message: "API key verified" },
  availableModels: 41,
  currentModel: "cail/deepseek-v4-flash-0731",
  platform: "darwin",
};

test("a working setup reports every check as passing", () => {
  const report = formatDoctorReport(healthy);
  assert.equal(report.healthy, true);
  assert.match(report.text, /Endpoint: reachable ✓/);
  assert.match(report.text, /API key: valid ✓/);
  assert.match(report.text, /Models available: 41 ✓/);
  assert.match(report.text, /Current model: cail\/deepseek-v4-flash-0731/);
  assert.doesNotMatch(report.text, /PowerShell/);
});

test("a missing key points to /login", () => {
  const report = formatDoctorReport({ ...healthy, hasKey: false, keyCheck: undefined, availableModels: 0, currentModel: undefined });
  assert.equal(report.healthy, false);
  assert.match(report.text, /API key: not configured; run \/login and choose "CUNY AI Lab" ✗/);
  assert.match(report.text, /Current model: none selected/);
});

test("a rejected key shows only the first line of the message", () => {
  const report = formatDoctorReport({ ...healthy, keyCheck: { status: "invalid", message: "That API key was not accepted by CUNY AI Lab.\n\nPlease check the key and try again." } });
  assert.equal(report.healthy, false);
  assert.match(report.text, /API key: That API key was not accepted by CUNY AI Lab\. ✗/);
  assert.doesNotMatch(report.text, /Please check/);
});

test("an unreachable endpoint skips the key check without failing it", () => {
  const report = formatDoctorReport({ ...healthy, catalog: { ok: false, message: "The CUNY AI Lab service could not be reached. (timed out)" }, keyCheck: undefined });
  assert.equal(report.healthy, false);
  assert.match(report.text, /Endpoint: unreachable \(The CUNY AI Lab service could not be reached\. \(timed out\)\) ✗/);
  assert.match(report.text, /API key: not checked \(endpoint unreachable\)$/m);
});

test("Windows reports the PowerShell tool", () => {
  assert.match(formatDoctorReport({ ...healthy, platform: "win32", powershellEnabled: true }).text, /PowerShell tool: enabled ✓/);
  const off = formatDoctorReport({ ...healthy, platform: "win32", powershellEnabled: false });
  assert.equal(off.healthy, false);
  assert.match(off.text, /PowerShell tool: not enabled ✗/);
});
