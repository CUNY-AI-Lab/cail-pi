/**
 * CUNY AI Lab credential persistence in Pi's auth.json.
 *
 * Preferred path: Pi's own `AuthStorage` (file locking, permissions, schema),
 * dynamically imported from the *installed* Pi package so no second copy of
 * Pi is bundled. Fallback: a narrow writer that mirrors Pi's schema
 * (`{ "<provider>": { "type": "api_key", "key": "..." } }`), writes
 * atomically, backs up, preserves other providers and refuses malformed JSON.
 *
 * No function here logs or returns the key except `readStoredApiKey`, which
 * exists only so the bootstrapper can validate an existing credential in-process.
 */
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { captureCommand, executable } from "./platform.mjs";
import { backupFilePath, resolveAgentDir, writeJsonAtomic } from "./settings.mjs";

export const CAIL_PROVIDER_ID = "cail";
export const PI_PACKAGE_NAME = "@earendil-works/pi-coding-agent";

export function resolveAuthPath({ agentDir, env = process.env, homedir } = {}) {
  return join(agentDir ?? resolveAgentDir(env, homedir), "auth.json");
}

function readAuthFile(authPath) {
  if (!existsSync(authPath)) return { state: "absent", data: {} };
  let text;
  try {
    text = readFileSync(authPath, "utf8");
  } catch (error) {
    return { state: "unreadable", error };
  }
  if (text.trim() === "") return { state: "present", data: {} };
  try {
    const parsed = JSON.parse(text.replace(/^﻿/, ""));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { state: "malformed" };
    return { state: "present", data: parsed };
  } catch {
    return { state: "malformed" };
  }
}

/** Non-secret status of the CAIL credential: absent | missing | configured | malformed | unreadable. */
export function readCredentialStatus(authPath, providerId = CAIL_PROVIDER_ID) {
  const file = readAuthFile(authPath);
  if (file.state === "absent") return { state: "absent" };
  if (file.state === "malformed" || file.state === "unreadable") return { state: file.state };
  const entry = file.data[providerId];
  if (!entry || typeof entry !== "object") return { state: "missing" };
  return { state: "configured", type: typeof entry.type === "string" ? entry.type : "unknown" };
}

/** The stored API key, for in-process validation only. Never print this. */
export function readStoredApiKey(authPath, providerId = CAIL_PROVIDER_ID) {
  const file = readAuthFile(authPath);
  if (file.state !== "present") return undefined;
  const entry = file.data[providerId];
  if (!entry || typeof entry !== "object" || entry.type !== "api_key") return undefined;
  return typeof entry.key === "string" && entry.key.trim() !== "" ? entry.key : undefined;
}

function malformedError(authPath) {
  return new Error(
    [
      `${authPath} is not valid JSON, so it was left untouched to protect any credentials inside it.`,
      "",
      "To recover: move or rename the file (for example, back up auth.json as auth.json.broken),",
      "then run this setup again and Pi will create a fresh credential store.",
    ].join("\n"),
  );
}

function restrictPermissions(path, mode) {
  if (process.platform === "win32") return;
  try {
    chmodSync(path, mode);
  } catch {
    // Best effort; some filesystems do not support POSIX modes.
  }
}

function modifyAuthFile(authPath, mutate) {
  const file = readAuthFile(authPath);
  if (file.state === "malformed") throw malformedError(authPath);
  if (file.state === "unreadable") throw new Error(`${authPath} could not be read: ${file.error?.message ?? "unknown error"}`);

  const dir = dirname(authPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  restrictPermissions(dir, 0o700);

  let backupPath;
  if (file.state === "present") {
    backupPath = backupFilePath(authPath);
    copyFileSync(authPath, backupPath);
    restrictPermissions(backupPath, 0o600);
  }

  const next = mutate({ ...file.data });
  writeJsonAtomic(authPath, next, { mode: 0o600 });
  restrictPermissions(authPath, 0o600);
  return { authPath, backupPath };
}

/** Narrow credential writer mirroring Pi's auth.json schema. */
export function writeCredentialFallback(authPath, providerId, credential) {
  return modifyAuthFile(authPath, (data) => ({ ...data, [providerId]: credential }));
}

export function deleteCredentialFallback(authPath, providerId) {
  return modifyAuthFile(authPath, (data) => {
    const next = { ...data };
    delete next[providerId];
    return next;
  });
}

function isPiPackageDir(dir) {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    return pkg.name === PI_PACKAGE_NAME;
  } catch {
    return false;
  }
}

function ancestorsOf(path) {
  const out = [];
  let current = path;
  for (let i = 0; i < 8; i++) {
    out.push(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return out;
}

/**
 * Pi's own installer (pi.dev/install.sh, install.ps1) makes a managed install:
 * `<agent>/bin/pi` is a launcher for `<agent>/install/releases/<current-version>`.
 * Returns that release's node_modules for a launcher directory, if it is one.
 */
export function managedPiReleaseModules(binDir) {
  const installRoot = join(dirname(binDir), "install");
  let version;
  try {
    version = readFileSync(join(installRoot, "current-version"), "utf8").trim();
  } catch {
    return undefined;
  }
  if (!/^[0-9A-Za-z._+-]+$/.test(version) || version === "." || version === "..") return undefined;
  return join(installRoot, "releases", version, "node_modules");
}

/** Default places to look for the installed Pi package. */
export function defaultPiPackageCandidates({ platform = process.platform, env = process.env } = {}) {
  const roots = [];
  const npmRoot = captureCommand("npm", ["root", "-g"], { platform, env });
  if (!npmRoot.error && npmRoot.status === 0 && npmRoot.stdout.trim()) roots.push(npmRoot.stdout.trim());
  const where = captureCommand(platform === "win32" ? "where" : "which", [executable("pi", platform)], { platform, env });
  // `where`/`which` are plain executables on both platforms; captureCommand adds no suffix for them
  // on win32 because we pass the .cmd name of the *target*, not of the lookup tool.
  if (!where.error && where.status === 0) {
    for (const line of where.stdout.split(/\r?\n/)) {
      const bin = line.trim();
      if (!bin) continue;
      let real = bin;
      try {
        real = realpathSync(bin);
      } catch {
        // keep the shim path
      }
      const managed = managedPiReleaseModules(dirname(real));
      if (managed) roots.push(managed);
      for (const ancestor of ancestorsOf(dirname(real))) {
        roots.push(ancestor);
        roots.push(join(ancestor, "node_modules"));
      }
    }
  }
  return roots;
}

/** Locate the installed @earendil-works/pi-coding-agent package directory, if any. */
export function locatePiPackageDir({ candidates } = {}) {
  const roots = candidates ?? defaultPiPackageCandidates();
  for (const root of roots) {
    for (const dir of [root, join(root, "@earendil-works", "pi-coding-agent")]) {
      if (isPiPackageDir(dir)) return resolve(dir);
    }
  }
  return undefined;
}

/**
 * Load Pi's AuthStorage from the installed package and open it on `authPath`.
 * Returns undefined when Pi or its module cannot be loaded.
 */
export async function loadPiAuthStorage(authPath, { packageDir } = {}) {
  const dir = packageDir ?? locatePiPackageDir();
  if (!dir) return undefined;
  const modulePath = join(dir, "dist", "core", "auth-storage.js");
  if (!existsSync(modulePath)) return undefined;
  try {
    const mod = await import(pathToFileURL(modulePath).href);
    if (typeof mod.AuthStorage?.create !== "function") return undefined;
    return mod.AuthStorage.create(authPath);
  } catch {
    return undefined;
  }
}

/**
 * Persist the CAIL API key. Prefers Pi's AuthStorage; falls back to the narrow writer.
 * Returns { method: "pi" | "fallback", authPath, backupPath? } and never the key.
 */
export async function saveApiKey(apiKey, { authPath, loadStore = loadPiAuthStorage, providerId = CAIL_PROVIDER_ID } = {}) {
  const key = String(apiKey).trim();
  if (!key) throw new Error("Refusing to store an empty API key.");
  const path = authPath ?? resolveAuthPath();
  const credential = { type: "api_key", key };

  const before = readAuthFile(path);
  if (before.state === "malformed") throw malformedError(path);

  let store;
  try {
    store = await loadStore(path);
  } catch {
    store = undefined;
  }
  if (store && typeof store.modify === "function") {
    await store.modify(providerId, async () => credential);
    // Pi applies 0600 only when it creates auth.json; tighten an existing file too.
    restrictPermissions(path, 0o600);
    return { method: "pi", authPath: path };
  }
  const result = writeCredentialFallback(path, providerId, credential);
  return { method: "fallback", ...result };
}

/** Remove the CAIL credential (used by the uninstall helper; asks first at the CLI layer). */
export async function deleteApiKey({ authPath, loadStore = loadPiAuthStorage, providerId = CAIL_PROVIDER_ID } = {}) {
  const path = authPath ?? resolveAuthPath();
  let store;
  try {
    store = await loadStore(path);
  } catch {
    store = undefined;
  }
  if (store && typeof store.delete === "function") {
    await store.delete(providerId);
    return { method: "pi", authPath: path };
  }
  if (!existsSync(path)) return { method: "fallback", authPath: path };
  return { method: "fallback", ...deleteCredentialFallback(path, providerId) };
}

export function authFileMode(authPath) {
  return statSync(authPath).mode & 0o777;
}
