import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { resolveAgentDir, applyWindowsDefaultTools, effectiveDefaultTools, powershellToolEnabled, WINDOWS_DEFAULT_TOOLS } from "../src/settings.mjs";

function scratch() {
  return mkdtempSync(join(tmpdir(), "cail-pi-settings-"));
}

test("resolveAgentDir defaults to ~/.pi/agent", () => {
  assert.equal(resolveAgentDir({}, "/home/jane"), join("/home/jane", ".pi", "agent"));
});

test("resolveAgentDir honors PI_CODING_AGENT_DIR including a ~ prefix", () => {
  assert.equal(resolveAgentDir({ PI_CODING_AGENT_DIR: "/custom/agent" }, "/home/jane"), resolve("/custom/agent"));
  assert.equal(resolveAgentDir({ PI_CODING_AGENT_DIR: "~/alt/agent" }, "/home/jane"), resolve("/home/jane", "alt", "agent"));
});

test("applyWindowsDefaultTools creates settings.json when absent", () => {
  const agentDir = join(scratch(), "agent");
  const result = applyWindowsDefaultTools({ agentDir });
  assert.equal(result.changed, true);
  assert.equal(result.reason, "created");
  const written = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8"));
  assert.deepEqual(written.defaultTools, WINDOWS_DEFAULT_TOOLS);
  assert.deepEqual(WINDOWS_DEFAULT_TOOLS, ["-bash", "+powershell"]);
  assert.deepEqual(effectiveDefaultTools(written.defaultTools), ["read", "edit", "write", "powershell"]);
});

test("applyWindowsDefaultTools adds defaultTools while preserving unrelated settings and backing up", () => {
  const agentDir = scratch();
  const path = join(agentDir, "settings.json");
  writeFileSync(path, JSON.stringify({ theme: "dark", shellPath: "C:\\Program Files\\Git\\bin\\bash.exe", packages: ["npm:x"] }, null, 2));
  const result = applyWindowsDefaultTools({ agentDir });
  assert.equal(result.changed, true);
  assert.equal(result.reason, "added");
  const written = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(written.theme, "dark");
  assert.equal(written.shellPath, "C:\\Program Files\\Git\\bin\\bash.exe");
  assert.deepEqual(written.packages, ["npm:x"]);
  assert.deepEqual(written.defaultTools, WINDOWS_DEFAULT_TOOLS);
  assert.ok(result.backupPath && existsSync(result.backupPath), "backup written");
  const backup = JSON.parse(readFileSync(result.backupPath, "utf8"));
  assert.equal(backup.defaultTools, undefined);
});

test("applyWindowsDefaultTools appends +powershell to a tool list the participant chose, keeping their entries", () => {
  const agentDir = scratch();
  const path = join(agentDir, "settings.json");
  writeFileSync(path, JSON.stringify({ theme: "dark", defaultTools: ["read", "bash", "edit", "write", "grep"] }));
  const result = applyWindowsDefaultTools({ agentDir });
  assert.equal(result.changed, true);
  assert.equal(result.reason, "extended");
  const written = JSON.parse(readFileSync(path, "utf8"));
  assert.deepEqual(written.defaultTools, ["read", "bash", "edit", "write", "grep", "+powershell"]);
  assert.equal(written.theme, "dark");
  assert.ok(result.backupPath && existsSync(result.backupPath), "backup written");
});

test("applyWindowsDefaultTools leaves any list that already names powershell untouched", () => {
  for (const defaultTools of [["read", "powershell", "edit", "write"], ["-bash", "+powershell"], ["+codemode", "-powershell"]]) {
    const agentDir = scratch();
    const path = join(agentDir, "settings.json");
    const original = JSON.stringify({ defaultTools });
    writeFileSync(path, original);
    const result = applyWindowsDefaultTools({ agentDir });
    assert.equal(result.changed, false, JSON.stringify(defaultTools));
    assert.equal(result.reason, "already-configured");
    assert.equal(readFileSync(path, "utf8"), original);
    assert.equal(readdirSync(agentDir).length, 1, "no backup created");
  }
});

test("applyWindowsDefaultTools leaves a defaultTools value that is not a list untouched", () => {
  const agentDir = scratch();
  const path = join(agentDir, "settings.json");
  writeFileSync(path, JSON.stringify({ defaultTools: "read,bash" }));
  const result = applyWindowsDefaultTools({ agentDir });
  assert.equal(result.changed, false);
  assert.equal(result.reason, "unrecognized");
  assert.match(result.message, /\+powershell/);
});

test("effectiveDefaultTools follows Pi's plain, +name and -name rules", () => {
  assert.deepEqual(effectiveDefaultTools(undefined), ["read", "bash", "edit", "write"]);
  assert.deepEqual(effectiveDefaultTools([]), []);
  assert.deepEqual(effectiveDefaultTools(["+codemode"]), ["read", "bash", "edit", "write", "codemode"]);
  assert.deepEqual(effectiveDefaultTools(["-bash", "+powershell"]), ["read", "edit", "write", "powershell"]);
  assert.deepEqual(effectiveDefaultTools(["read", "+powershell", "-read"]), ["powershell"]);
});

test("powershellToolEnabled reads plain and +powershell entries and respects -powershell", () => {
  const cases = [
    [undefined, false],
    [["read", "powershell", "edit", "write"], true],
    [["-bash", "+powershell"], true],
    [["+powershell", "-powershell"], false],
  ];
  for (const [defaultTools, expected] of cases) {
    const agentDir = scratch();
    writeFileSync(join(agentDir, "settings.json"), JSON.stringify(defaultTools === undefined ? {} : { defaultTools }));
    assert.equal(powershellToolEnabled({ agentDir }), expected, JSON.stringify(defaultTools));
  }
  assert.equal(powershellToolEnabled({ agentDir: join(scratch(), "missing") }), false);
});

test("applyWindowsDefaultTools refuses to touch malformed JSON", () => {
  const agentDir = scratch();
  const path = join(agentDir, "settings.json");
  writeFileSync(path, "{ not json");
  const result = applyWindowsDefaultTools({ agentDir });
  assert.equal(result.changed, false);
  assert.equal(result.reason, "malformed");
  assert.match(result.message, /settings\.json/);
  assert.equal(readFileSync(path, "utf8"), "{ not json");
});

test("applyWindowsDefaultTools uses a custom agent dir from the environment", () => {
  const custom = join(scratch(), "custom-agent");
  mkdirSync(custom, { recursive: true });
  const result = applyWindowsDefaultTools({ env: { PI_CODING_AGENT_DIR: custom } });
  assert.equal(result.settingsPath, join(custom, "settings.json"));
  assert.ok(existsSync(result.settingsPath));
});

test("applyWindowsDefaultTools is idempotent", () => {
  const agentDir = scratch();
  applyWindowsDefaultTools({ agentDir });
  const second = applyWindowsDefaultTools({ agentDir });
  assert.equal(second.changed, false);
  assert.equal(second.reason, "already-configured");
});
