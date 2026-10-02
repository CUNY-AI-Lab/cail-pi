import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parsePiVersion, compareVersions, isSupportedPiVersion, MIN_PI_VERSION, parseInstalledPackages, parseInstalledPackageEntries, parseListModels, resolveWorkshopPackageSource, WORKSHOP_PACKAGE_SOURCE, LEGACY_PACKAGE_SOURCE, createPi } from "../src/pi.mjs";

test("workshop package source is the npm spec Pi installs", () => {
  assert.equal(WORKSHOP_PACKAGE_SOURCE, "npm:@cuny-ai-lab/cail-pi");
});

test("parsePiVersion extracts a semver from pi --version output", () => {
  assert.equal(parsePiVersion("0.85.1\n"), "0.85.1");
  assert.equal(parsePiVersion("pi 1.2.3-beta.1"), "1.2.3-beta.1");
  assert.equal(parsePiVersion("garbage"), undefined);
});

test("parseInstalledPackages reads package sources from pi list output", () => {
  const output = [
    "User packages:",
    "  npm:@cuny-ai-lab/cail-pi",
    "    /Users/x/.pi/agent/npm/node_modules/@cuny-ai-lab/cail-pi",
    "  git:github.com/user/repo@v1",
    "",
    "Project packages:",
    "  ./local/pkg",
  ].join("\n");
  assert.deepEqual(parseInstalledPackages(output), [
    "npm:@cuny-ai-lab/cail-pi",
    "git:github.com/user/repo@v1",
    "./local/pkg",
  ]);
  assert.deepEqual(parseInstalledPackages("No packages installed.\n"), []);
});

test("parseListModels counts rows for a provider from pi --list-models output", () => {
  const output = [
    "provider  model            context  max-out  thinking  images",
    "cail      gemma-3-12b-it   128K     16.4K    no        yes   ",
    "cail      gpt-oss-120b     128K     16.4K    yes       no    ",
    "openai    gpt-5            400K     128K     yes       yes   ",
  ].join("\n");
  assert.deepEqual(parseListModels(output, "cail"), ["gemma-3-12b-it", "gpt-oss-120b"]);
  assert.deepEqual(parseListModels("No models matching \"cail\"", "cail"), []);
});

test("createPi runs pi through the platform spawn plan with argument arrays", () => {
  const calls = [];
  const runner = (name, args, options) => {
    calls.push({ name, args, options });
    return { status: 0, stdout: "0.85.1\n", stderr: "" };
  };
  const pi = createPi({ capture: runner, run: runner, platform: "win32" });
  assert.equal(pi.version(), "0.85.1");
  pi.installWorkshopPackage();
  pi.updateSelf();
  assert.deepEqual(calls[0].args, ["--version"]);
  assert.deepEqual(calls[1].args, ["install", "npm:@cuny-ai-lab/cail-pi"]);
  assert.deepEqual(calls[2].args, ["update", "--self"]);
  assert.ok(calls.every((c) => c.name === "pi"));
  assert.ok(calls.every((c) => c.options.platform === "win32"));
});

test("createPi treats a missing pi executable as not installed", () => {
  const runner = () => ({ status: null, error: Object.assign(new Error("spawn pi ENOENT"), { code: "ENOENT" }), stdout: "", stderr: "" });
  const pi = createPi({ capture: runner, run: runner });
  assert.equal(pi.version(), undefined);
  assert.equal(pi.isInstalled(), false);
});

test("parseInstalledPackageEntries pairs each source with its installed path when printed", () => {
  const output = [
    "User packages:",
    "  npm:@cuny-ai-lab/cail-pi",
    "    /Users/x/.pi/agent/npm/node_modules/@cuny-ai-lab/cail-pi",
    "  ../../../Users/x/dev/cail-pi",
    "    /Users/x/dev/cail-pi",
    "  git:github.com/user/repo@v1",
  ].join("\n");
  assert.deepEqual(parseInstalledPackageEntries(output), [
    { source: "npm:@cuny-ai-lab/cail-pi", installedPath: "/Users/x/.pi/agent/npm/node_modules/@cuny-ai-lab/cail-pi" },
    { source: "../../../Users/x/dev/cail-pi", installedPath: "/Users/x/dev/cail-pi" },
    { source: "git:github.com/user/repo@v1", installedPath: undefined },
  ]);
});

test("hasWorkshopPackage recognizes a local-path install by the installed package's name", () => {
  const dir = mkdtempSync(join(tmpdir(), "cail-pi-pkg-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "@cuny-ai-lab/cail-pi" }));
  const other = mkdtempSync(join(tmpdir(), "pi-other-pkg-"));
  writeFileSync(join(other, "package.json"), JSON.stringify({ name: "something-else" }));
  const listing = (path) => ({ status: 0, stdout: `User packages:\n  ../rel/path\n    ${path}\n`, stderr: "" });
  assert.equal(createPi({ capture: () => listing(dir) }).hasWorkshopPackage(), true);
  assert.equal(createPi({ capture: () => listing(other) }).hasWorkshopPackage(), false);
  assert.equal(createPi({ capture: () => ({ status: 0, stdout: "User packages:\n  npm:@cuny-ai-lab/cail-pi@0.1.0\n", stderr: "" }) }).hasWorkshopPackage(), true);
});

test("resolveWorkshopPackageSource defaults to npm but accepts a developer override from the environment", () => {
  assert.equal(resolveWorkshopPackageSource({}), WORKSHOP_PACKAGE_SOURCE);
  assert.equal(resolveWorkshopPackageSource({ PI_WORKSHOP_PACKAGE_SOURCE: "/Users/x/dev/cail-pi" }), "/Users/x/dev/cail-pi");
  const calls = [];
  const runner = (name, args) => { calls.push(args); return { status: 0, stdout: "", stderr: "" }; };
  createPi({ run: runner, capture: runner, env: { PI_WORKSHOP_PACKAGE_SOURCE: "/Users/x/dev/cail-pi" } }).installWorkshopPackage();
  assert.deepEqual(calls[0], ["install", "/Users/x/dev/cail-pi"]);
});

test("the earlier pi-workshop package is detected in pi list and removed by its npm source", () => {
  const listing = (body) => () => ({ status: 0, stdout: `User packages:\n${body}`, stderr: "" });
  assert.equal(LEGACY_PACKAGE_SOURCE, "npm:@cuny-ai-lab/pi-workshop");
  assert.equal(createPi({ capture: listing("  npm:@cuny-ai-lab/pi-workshop\n") }).hasLegacyPackage(), true);
  assert.equal(createPi({ capture: listing("  npm:@cuny-ai-lab/pi-workshop@0.1.1\n") }).hasLegacyPackage(), true);
  assert.equal(createPi({ capture: listing("  npm:@cuny-ai-lab/cail-pi\n") }).hasLegacyPackage(), false);
  assert.equal(createPi({ capture: listing("  npm:@cuny-ai-lab/pi-workshop\n") }).hasWorkshopPackage(), false);

  const calls = [];
  const runner = (name, args) => { calls.push({ name, args }); return { status: 0, stdout: "", stderr: "" }; };
  createPi({ run: runner, capture: runner }).removeLegacyPackage();
  assert.deepEqual(calls[0], { name: "pi", args: ["remove", "npm:@cuny-ai-lab/pi-workshop"] });
});

test("compareVersions orders releases numerically and prereleases before their release", () => {
  assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
  assert.equal(compareVersions("0.85.1", "1.0.0"), -1);
  assert.equal(compareVersions("0.99.10", "0.99.9"), 1);
  assert.equal(compareVersions("1.0.0-rc.1", "1.0.0"), -1);
  assert.equal(compareVersions("1.0.1", "1.0.0-rc.1"), 1);
});

test("isSupportedPiVersion requires MIN_PI_VERSION or newer", () => {
  assert.equal(MIN_PI_VERSION, "1.0.0");
  assert.equal(isSupportedPiVersion("1.0.0"), true);
  assert.equal(isSupportedPiVersion("1.2.3"), true);
  assert.equal(isSupportedPiVersion("0.99.2"), false);
  assert.equal(isSupportedPiVersion(undefined), false);
});
