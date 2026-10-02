/**
 * Safe merge of Pi's settings.json for the Windows PowerShell tool.
 * Uses Pi's `+name` / `-name` tool entries (Pi 0.99+), so a tool list the
 * participant chose is extended rather than replaced. Never touches a list that
 * already names `powershell`, never overwrites malformed JSON, preserves every
 * unrelated key, and backs up before modifying.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, copyFileSync } from "node:fs";
import os from "node:os";
import { join, resolve } from "node:path";

/** Pi's built-in tool selection when `defaultTools` is unset. */
export const PI_DEFAULT_TOOLS = ["read", "bash", "edit", "write"];
/** Written when `defaultTools` is unset: swap the model-facing bash tool for powershell, keep the rest of Pi's defaults. */
export const WINDOWS_DEFAULT_TOOLS = ["-bash", "+powershell"];
/** Appended to a tool list the participant already chose, which keeps their bash choice. */
export const POWERSHELL_TOOL_ENTRY = "+powershell";

export function expandHome(path, homedir = os.homedir()) {
  if (path === "~") return homedir;
  if (path.startsWith("~/") || path.startsWith("~\\")) return join(homedir, path.slice(2));
  return path;
}

/** Pi's agent directory: PI_CODING_AGENT_DIR when set, otherwise ~/.pi/agent. */
export function resolveAgentDir(env = process.env, homedir = os.homedir()) {
  const configured = env.PI_CODING_AGENT_DIR;
  if (typeof configured === "string" && configured.trim() !== "") {
    return resolve(expandHome(configured.trim(), homedir));
  }
  return join(homedir, ".pi", "agent");
}

export function backupFilePath(path, now = new Date()) {
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  return `${path}.bak-${stamp}`;
}

/** Write JSON atomically: temp file in the same directory, then rename over the target. */
export function writeJsonAtomic(path, value, { mode } = {}) {
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, mode ? { encoding: "utf8", mode } : "utf8");
  renameSync(tmp, path);
}

export function readSettings(settingsPath) {
  if (!existsSync(settingsPath)) return { state: "absent", settings: {} };
  let text;
  try {
    text = readFileSync(settingsPath, "utf8");
  } catch (error) {
    return { state: "unreadable", error };
  }
  try {
    const parsed = JSON.parse(text.replace(/^﻿/, ""));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { state: "malformed" };
    return { state: "present", settings: parsed };
  } catch {
    return { state: "malformed" };
  }
}

function isToolDelta(entry) {
  return entry.startsWith("+") || entry.startsWith("-");
}

/**
 * The tools Pi enables at startup for a `defaultTools` value, following Pi's rules:
 * plain names form the selection (otherwise Pi's defaults are inherited), then
 * `+name` and `-name` apply in order. An empty list disables every built-in tool.
 */
export function effectiveDefaultTools(defaultTools) {
  if (!Array.isArray(defaultTools)) return [...PI_DEFAULT_TOOLS];
  const entries = defaultTools.filter((entry) => typeof entry === "string");
  const plain = entries.filter((entry) => !isToolDelta(entry));
  const deltasOnly = entries.length > 0 && plain.length === 0;
  const selection = new Set(deltasOnly ? PI_DEFAULT_TOOLS : plain);
  for (const entry of entries) {
    if (entry.startsWith("+")) selection.add(entry.slice(1));
    else if (entry.startsWith("-")) selection.delete(entry.slice(1));
  }
  return [...selection];
}

/** True when the list names powershell in any form, including a deliberate `-powershell`. */
function mentionsPowershell(defaultTools) {
  return defaultTools.some((entry) => typeof entry === "string" && entry.replace(/^[+-]/, "") === "powershell");
}

/**
 * Ensure Pi's `defaultTools` enables the PowerShell tool on Windows.
 * Returns { changed, reason, settingsPath, backupPath?, message? }, where reason is
 * "created", "added", "extended", "already-configured", "malformed", "unreadable", or "unrecognized".
 */
export function applyWindowsDefaultTools({ agentDir, env = process.env, homedir } = {}) {
  const dir = agentDir ?? resolveAgentDir(env, homedir);
  const settingsPath = join(dir, "settings.json");
  const current = readSettings(settingsPath);

  if (current.state === "malformed" || current.state === "unreadable") {
    return {
      changed: false,
      reason: current.state,
      settingsPath,
      message: `${settingsPath} is not valid JSON, so it was left untouched. Fix or rename it, then add "defaultTools": ${JSON.stringify(WINDOWS_DEFAULT_TOOLS)} to enable the PowerShell tool.`,
    };
  }

  let tools = WINDOWS_DEFAULT_TOOLS;
  let reason = current.state === "present" ? "added" : "created";
  if (current.state === "present" && Object.hasOwn(current.settings, "defaultTools")) {
    const existing = current.settings.defaultTools;
    if (!Array.isArray(existing)) {
      return {
        changed: false,
        reason: "unrecognized",
        settingsPath,
        message: `"defaultTools" in ${settingsPath} is not a list, so it was left untouched. Add "${POWERSHELL_TOOL_ENTRY}" to it to enable the PowerShell tool.`,
      };
    }
    if (mentionsPowershell(existing)) return { changed: false, reason: "already-configured", settingsPath };
    tools = [...existing, POWERSHELL_TOOL_ENTRY];
    reason = "extended";
  }

  mkdirSync(dir, { recursive: true });
  let backupPath;
  if (current.state === "present") {
    backupPath = backupFilePath(settingsPath);
    copyFileSync(settingsPath, backupPath);
  }
  writeJsonAtomic(settingsPath, { ...current.settings, defaultTools: [...tools] });
  return { changed: true, reason, settingsPath, backupPath };
}

/** True when the global settings.json leads Pi to enable the powershell tool (Pi's own defaults exclude it). */
export function powershellToolEnabled({ agentDir, env = process.env, homedir } = {}) {
  const dir = agentDir ?? resolveAgentDir(env, homedir);
  const current = readSettings(join(dir, "settings.json"));
  if (current.state !== "present") return false;
  return effectiveDefaultTools(current.settings.defaultTools).includes("powershell");
}
