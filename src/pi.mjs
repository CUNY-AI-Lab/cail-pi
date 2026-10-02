/** Thin wrapper around the installed `pi` CLI (pi.cmd on Windows). Arguments are always arrays. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { captureCommand, runCommand } from "./platform.mjs";

export const WORKSHOP_PACKAGE_NAME = "@cuny-ai-lab/cail-pi";
export const WORKSHOP_PACKAGE_SOURCE = `npm:${WORKSHOP_PACKAGE_NAME}`;
/** The name this package was first published under; replaced on setup so the provider never loads twice. */
export const LEGACY_PACKAGE_SOURCE = "npm:@cuny-ai-lab/pi-workshop";
export const LAZYPI_PACKAGE = "@robzolkos/lazypi";
/**
 * Oldest Pi this package is tested with. Older Pi does not understand the
 * `+name` / `-name` tool entries written on Windows (added in 0.99).
 */
export const MIN_PI_VERSION = "1.0.0";

export function parsePiVersion(output) {
  const match = /(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/.exec(String(output ?? ""));
  return match ? match[1] : undefined;
}

/** Compares x.y.z versions; a prerelease sorts before its release. Returns -1, 0, or 1. */
export function compareVersions(a, b) {
  const parse = (version) => {
    const [core, prerelease] = String(version).split("-", 2);
    return { parts: core.split(".").map((part) => Number.parseInt(part, 10) || 0), prerelease };
  };
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < 3; i += 1) {
    const diff = (left.parts[i] ?? 0) - (right.parts[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  if (left.prerelease === right.prerelease) return 0;
  if (left.prerelease === undefined) return 1;
  if (right.prerelease === undefined) return -1;
  return left.prerelease < right.prerelease ? -1 : 1;
}

export function isSupportedPiVersion(version, minimum = MIN_PI_VERSION) {
  return typeof version === "string" && compareVersions(version, minimum) >= 0;
}

/** Developer override: install from a local checkout instead of npm (never needed by participants). */
export function resolveWorkshopPackageSource(env = process.env) {
  const override = env.PI_WORKSHOP_PACKAGE_SOURCE;
  return typeof override === "string" && override.trim() !== "" ? override.trim() : WORKSHOP_PACKAGE_SOURCE;
}

const SOURCE_LINE = /^ {2}(\S.*)$/;
const INSTALLED_PATH_LINE = /^ {4}(\S.*)$/;

/** Entries from `pi list`: each source with the installed path Pi prints beneath it, when any. */
export function parseInstalledPackageEntries(output) {
  const entries = [];
  for (const raw of String(output ?? "").split(/\r?\n/)) {
    const path = INSTALLED_PATH_LINE.exec(raw);
    if (path && entries.length > 0 && entries[entries.length - 1].installedPath === undefined) {
      entries[entries.length - 1].installedPath = path[1].trim();
      continue;
    }
    const source = SOURCE_LINE.exec(raw);
    if (!source) continue;
    const line = source[1].trim();
    if (/^(npm:|git:|https?:\/\/|ssh:\/\/|git@|\.{1,2}[\\/]|[\\/]|[A-Za-z]:[\\/])/.test(line)) entries.push({ source: line, installedPath: undefined });
  }
  return entries;
}

/** Package sources from `pi list`. */
export function parseInstalledPackages(output) {
  return parseInstalledPackageEntries(output).map((entry) => entry.source);
}

function packageNameAt(dir) {
  try {
    const path = join(dir, "package.json");
    if (!existsSync(path)) return undefined;
    return JSON.parse(readFileSync(path, "utf8")).name;
  } catch {
    return undefined;
  }
}

export function isWorkshopPackageEntry(entry) {
  if (entry.source === WORKSHOP_PACKAGE_SOURCE || entry.source.startsWith(`${WORKSHOP_PACKAGE_SOURCE}@`)) return true;
  if (entry.installedPath && packageNameAt(entry.installedPath) === WORKSHOP_PACKAGE_NAME) return true;
  return false;
}

export function isLegacyPackageEntry(entry) {
  return entry.source === LEGACY_PACKAGE_SOURCE || entry.source.startsWith(`${LEGACY_PACKAGE_SOURCE}@`);
}

/** Model ids for one provider from `pi --list-models` table output. */
export function parseListModels(output, providerId) {
  const ids = [];
  for (const raw of String(output ?? "").split(/\r?\n/)) {
    const cols = raw.trim().split(/\s+/);
    if (cols.length >= 2 && cols[0] === providerId) ids.push(cols[1]);
  }
  return ids;
}

export function createPi({ capture = captureCommand, run = runCommand, platform = process.platform, env = process.env } = {}) {
  const options = { platform, env };
  return {
    version() {
      const result = capture("pi", ["--version"], options);
      if (result.error || result.status !== 0) return undefined;
      return parsePiVersion(result.stdout);
    },
    isInstalled() {
      return this.version() !== undefined;
    },
    /** Pi's own self-update (`pi update --self`), which knows how Pi was installed. */
    updateSelf() {
      return run("pi", ["update", "--self"], options);
    },
    installWorkshopPackage() {
      return run("pi", ["install", resolveWorkshopPackageSource(env)], options);
    },
    installPackage(source) {
      return run("pi", ["install", source], options);
    },
    removeWorkshopPackage() {
      return run("pi", ["remove", WORKSHOP_PACKAGE_SOURCE], options);
    },
    installedPackages() {
      const result = capture("pi", ["list"], options);
      if (result.error || result.status !== 0) return undefined;
      return parseInstalledPackageEntries(result.stdout);
    },
    hasWorkshopPackage() {
      return this.installedPackages()?.some(isWorkshopPackageEntry) ?? false;
    },
    hasLegacyPackage() {
      return this.installedPackages()?.some(isLegacyPackageEntry) ?? false;
    },
    removeLegacyPackage() {
      return run("pi", ["remove", LEGACY_PACKAGE_SOURCE], options);
    },
    /** Starts Pi headlessly so it loads packages, refreshes catalogs, and lists models. */
    listModels(providerId) {
      const result = capture("pi", ["--list-models", providerId], options);
      if (result.error || result.status !== 0) return undefined;
      return parseListModels(result.stdout, providerId);
    },
    runLazyPi() {
      return run("npx", ["--yes", LAZYPI_PACKAGE], options);
    },
  };
}
