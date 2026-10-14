/**
 * Smoke test of the packed package inside a real Pi.
 *
 * The unit suite imports pi-ai from this checkout's node_modules. An installed
 * package has no pi-ai of its own: Pi's extension loader maps only some pi-ai
 * entry points, so an import can pass the unit suite and still fail to load in
 * Pi. This test packs the package, unpacks it outside the checkout, installs it
 * into an empty Pi profile with the Pi version in package-lock.json, and sends
 * one prompt with `pi -p`.
 *
 * The key is deliberately invalid. The gateway's `invalid_credential` reply
 * shows that the extensions loaded, the catalog's models were registered, and
 * the request reached the gateway. No model runs and no secret is needed.
 *
 * Run it with `npm run test:smoke`. It needs network access to the gateway.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchModelCatalog } from "../../src/cail-api.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const PI_PACKAGE = join(ROOT, "node_modules", "@earendil-works", "pi-coding-agent");
const PI_CLI = join(PI_PACKAGE, JSON.parse(readFileSync(join(PI_PACKAGE, "package.json"), "utf8")).bin.pi);
const INVALID_KEY = "sk-cail-smoke-test-invalid";

/** Runs a command and returns its exit status and combined output. */
function run(command, args, options) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 120_000, ...options });
  if (result.error) throw result.error;
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

test("pi -p loads the packed package and reaches the gateway", { timeout: 300_000 }, async (t) => {
  // npm sets npm_execpath to its own CLI script; running it with Node needs no shell on Windows.
  const npmCli = process.env.npm_execpath;
  assert.ok(npmCli, "run this with `npm run test:smoke`");

  // Outside the checkout, so the extension cannot resolve the checkout's node_modules.
  const work = mkdtempSync(join(tmpdir(), "cail-pi-smoke-"));
  t.after(() => rmSync(work, { recursive: true, force: true }));
  const packDir = join(work, "pack");
  mkdirSync(packDir);
  const pack = run(process.execPath, [npmCli, "pack", "--pack-destination", packDir], { cwd: ROOT });
  assert.equal(pack.status, 0, pack.output);
  const [tarball] = readdirSync(packDir);
  // A relative archive path keeps GNU tar on Windows from reading "C:" as a remote host.
  const unpack = run("tar", ["-xzf", tarball, "-C", ".."], { cwd: packDir });
  assert.equal(unpack.status, 0, unpack.output);

  const env = {
    ...process.env,
    PI_CODING_AGENT_DIR: join(work, "agent"),
    PI_TELEMETRY: "0",
    AILAB_API_KEY: INVALID_KEY,
  };
  delete env.PI_OFFLINE;

  const install = run(process.execPath, [PI_CLI, "install", join(work, "package")], { env });
  assert.equal(install.status, 0, install.output);

  const catalog = await fetchModelCatalog();
  assert.ok(catalog.ok, catalog.message);
  const model = `cail/${catalog.models[0].id}`;

  const prompt = run(process.execPath, [PI_CLI, "-p", "--no-session", "--model", model, "ping"], { env });
  assert.doesNotMatch(prompt.output, /Failed to load extension/);
  assert.match(prompt.output, /"code":"invalid_credential"/);
});
