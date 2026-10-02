/**
 * Workshop setup orchestrator. All side effects go through `deps`, which
 * `bin/setup.mjs` wires to the real platform and tests replace with fakes.
 *
 * The API key travels: hidden prompt → in-memory string → CAIL validation →
 * Pi credential store. It is never logged, never passed as an argument, and
 * never part of an error message.
 */
import { checkNodeVersion } from "./preflight.mjs";
import { LEGACY_PACKAGE_SOURCE, MIN_PI_VERSION, isSupportedPiVersion } from "./pi.mjs";
import { executable, platformLabel } from "./platform.mjs";
import { RULE, banner, fail, indentLines, ok, warn } from "./ui.mjs";

function piCommand(deps) {
  return executable("pi", deps.platform);
}

function printFinal(deps, { authConfigured }) {
  const { out } = deps;
  const pi = piCommand(deps);
  out("");
  out(RULE);
  out("Setup complete!");
  out(RULE);
  out("");
  if (!authConfigured) {
    out("CUNY AI Lab authentication has not been configured.");
    out("");
    out("Start Pi:");
    out("");
    out(`  ${pi}`);
    out("");
    out("Then run:");
    out("");
    out("  /login");
    out("");
    out('and choose "CUNY AI Lab".');
    out("");
    return;
  }
  out("Start Pi:");
  out("");
  out(`  ${pi}`);
  out("");
  out("Then type:");
  out("");
  out("  /model");
  out("");
  out("and choose a CUNY AI Lab model.");
  out("");
}

function safeErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Validate and store a key. Returns "configured", "skipped", or "failed".
 * `existingKey` (never printed) is validated first when the participant keeps it.
 */
async function authenticate(deps, options) {
  const { out, prompts, credentials } = deps;
  out("");
  out("CUNY AI Lab authentication");
  out("");

  const status = credentials.status();
  if (status.state === "malformed" || status.state === "unreadable") {
    out(fail(`Pi's credential store (${credentials.authPath}) could not be read.`));
    try {
      await credentials.save("probe-never-stored");
    } catch (error) {
      out("");
      out(indentLines(safeErrorMessage(error)));
    }
    return "failed";
  }

  if (status.state === "configured" && !options.replaceKey) {
    out("A CUNY AI Lab API key is already configured for Pi.");
    out("");
    const keep = await prompts.confirmUseExistingKey();
    if (keep) {
      const stored = credentials.storedKey();
      if (stored) {
        out("");
        out("Checking your existing key...");
        const result = await runCheck(deps, stored);
        if (result.status === "valid") {
          out(ok("Existing API key verified"));
          if (typeof result.modelCount === "number") out(ok(`${result.modelCount} CUNY AI Lab models available`));
          return "configured";
        }
        if (result.status === "network_error" || result.status === "rate_limited" || result.status === "server_error") {
          out("");
          out(result.message);
          out("");
          out("Your existing credential has been left in place.");
          const action = await prompts.askNetworkFailureAction();
          if (action === "retry") return authenticate(deps, options);
          return "skipped";
        }
        out("");
        out("The existing CUNY AI Lab credential is no longer valid.");
        out("");
      } else {
        out("The existing credential is not an API key, so a new one is needed.");
        out("");
      }
    }
  }

  out("Paste your CUNY AI Lab API key.");
  out("Your input is hidden. Press Enter with no key to configure this later with /login.");
  out("");

  for (;;) {
    const key = await prompts.askApiKey();
    if (!key) return "skipped";

    out("");
    out("Checking your key...");
    const result = await runCheck(deps, key);

    if (result.status === "valid") {
      out(ok("API key verified"));
      if (typeof result.modelCount === "number") out(ok(`${result.modelCount} CUNY AI Lab models available`));
      try {
        await credentials.save(key);
      } catch (error) {
        out("");
        out(fail("The key could not be saved in Pi's credential store."));
        out("");
        out(indentLines(safeErrorMessage(error)));
        return "failed";
      }
      out(ok("Credential saved securely in Pi"));
      return "configured";
    }

    out("");
    out(result.message);
    out("");
    if (result.status === "invalid" || result.status === "forbidden") {
      const action = await prompts.askRetryOrSkipAfterRejection();
      if (action !== "retry") return "skipped";
      out("");
      continue;
    }
    out("Your key has not been saved yet.");
    out("");
    const action = await prompts.askNetworkFailureAction();
    if (action !== "retry") return "skipped";
    out("");
  }
}

async function runCheck(deps, key) {
  try {
    return await deps.checkApiKey(key);
  } catch (error) {
    return { status: "network_error", message: `The CUNY AI Lab service could not be reached. (${describeUnexpected(error)})`, retryable: true };
  }
}

function describeUnexpected(error) {
  const message = safeErrorMessage(error);
  return message.length > 120 ? `${message.slice(0, 117)}...` : message;
}

/**
 * Brings an older Pi up to MIN_PI_VERSION with Pi's own updater. Returns the
 * installed version, or undefined (after explaining what to do) when Pi is still too old.
 */
function ensurePiVersion(deps) {
  const { out, err } = deps;
  const current = deps.pi.version();
  if (isSupportedPiVersion(current)) return current;

  out("");
  out(`Pi ${current} is installed; this setup needs Pi ${MIN_PI_VERSION} or newer.`);
  out("Updating Pi...");
  out("");
  const result = deps.pi.updateSelf();
  const updated = deps.pi.version();
  if (!result.error && result.status === 0 && isSupportedPiVersion(updated)) {
    out("");
    out(ok(`Pi updated from ${current} to ${updated}`));
    return updated;
  }
  const pi = piCommand(deps);
  const npm = deps.platform === "win32" ? "npm.cmd" : "npm";
  err("");
  err(fail(`Pi could not be updated (still ${updated ?? "unknown"}), so setup stopped before changing anything else.`));
  err("Close every Pi window, then run:");
  err("");
  err(`  ${pi} update --self`);
  err("");
  err("If that reports it cannot update this installation, run:");
  err("");
  err(`  ${npm} install -g @earendil-works/pi-coding-agent@latest`);
  err("");
  err("Then run this installer again.");
  return undefined;
}

/** Removes the package's earlier name. Both register the `cail` provider, so only one may stay. */
function removeLegacyPackage(deps, successMessage) {
  const { out } = deps;
  if (!deps.pi.hasLegacyPackage()) return;
  const result = deps.pi.removeLegacyPackage();
  if (result.error || result.status !== 0) {
    out(warn("The earlier pi-workshop package could not be removed. Remove it yourself with:"));
    out(`  ${piCommand(deps)} remove ${LEGACY_PACKAGE_SOURCE}`);
    return;
  }
  out(ok(successMessage));
}

function refreshModels(deps) {
  const { out } = deps;
  out("");
  out("Refreshing models...");
  let ids;
  try {
    ids = deps.pi.listModels("cail");
  } catch (error) {
    out(warn(`Could not refresh the model catalog now (${describeUnexpected(error)}). Pi will refresh it on startup.`));
    return 0;
  }
  if (!ids) {
    out(warn("Could not refresh the model catalog now. Pi will refresh it on startup."));
    return 0;
  }
  if (ids.length === 0) {
    out(warn("No CUNY AI Lab models are visible yet. Pi refreshes the catalog on startup; run --doctor if /model stays empty."));
    return 0;
  }
  out(ok("Model catalog updated"));
  out(ok(`${ids.length} CUNY AI Lab models visible in Pi`));
  return ids.length;
}

export async function runSetup(options, deps) {
  const { out, err } = deps;
  banner(out, "Workshop Setup");
  out("");
  out("Checking your computer...");
  out("");

  const node = checkNodeVersion(deps.nodeVersion, deps.execPath);
  if (!node.ok) {
    err("");
    err(node.message);
    err("");
    return { exitCode: 1, stage: "node" };
  }
  out(ok(platformLabel(deps.platform, deps.release)));
  out(ok(`Node ${deps.nodeVersion}`));

  const npm = deps.npmVersion();
  if (!npm) {
    err("");
    err(fail("npm is not available on this computer, so the installer cannot continue."));
    err("Install Node.js LTS (which includes npm), open a new terminal window, and run this again.");
    return { exitCode: 1, stage: "npm" };
  }
  out(ok("npm available"));

  if (options.skipLazypi) {
    if (!deps.pi.isInstalled()) {
      err("");
      err(fail("Pi is not installed, and --skip-lazypi was given."));
      err("Run again without --skip-lazypi so LazyPi can install Pi for you.");
      return { exitCode: 1, stage: "pi" };
    }
  } else {
    out("");
    out("Starting LazyPi...");
    out("");
    const result = deps.pi.runLazyPi();
    if (result.error || result.status !== 0) {
      err("");
      err(fail("LazyPi did not finish successfully, so setup stopped here to avoid a half-configured Pi."));
      err("Fix the problem LazyPi reported and run this installer again.");
      return { exitCode: 1, stage: "lazypi" };
    }
    if (!deps.pi.isInstalled()) {
      err("");
      err(fail("Pi is still not available after LazyPi finished."));
      err("Open a new terminal window and run this installer again. If it persists, run: npm install -g @earendil-works/pi-coding-agent");
      return { exitCode: 1, stage: "pi" };
    }
  }
  const piVersion = ensurePiVersion(deps);
  if (!piVersion) return { exitCode: 1, stage: "pi-version" };
  out(ok(`Pi ${piVersion} installed`));

  out("");
  out("Installing CUNY AI Lab integration...");
  out("");
  const install = deps.pi.installWorkshopPackage();
  if (install.error || install.status !== 0) {
    err("");
    err(fail("Pi could not install the CUNY AI Lab package. See the output above."));
    return { exitCode: 1, stage: "install" };
  }
  out(ok("CAIL provider installed"));
  removeLegacyPackage(deps, "Earlier pi-workshop package replaced");

  if (deps.platform === "win32") {
    out(ok("PowerShell detected"));
    if (options.windowsSettings) {
      const result = deps.settings.applyWindows();
      if (result?.reason === "extended") out(ok("PowerShell tool added to your Pi tool list"));
      else if (result?.changed) out(ok("Pi configured for PowerShell"));
      else if (result?.reason === "already-configured") out(ok("Pi tool settings left as you configured them"));
      else if (result?.message) out(warn(result.message));
    }
  }

  let authState = "skipped";
  if (options.skipAuth) {
    out("");
    out("Skipping CUNY AI Lab authentication (--skip-auth).");
  } else {
    authState = await authenticate(deps, options);
    if (authState === "failed") return { exitCode: 1, stage: "auth" };
  }

  let modelCount = 0;
  if (authState === "configured") modelCount = refreshModels(deps);

  printFinal(deps, { authConfigured: authState === "configured" });
  return { exitCode: 0, stage: "done", authConfigured: authState === "configured", modelCount };
}

export async function runUninstall(deps) {
  const { out, err, pi, prompts, credentials } = deps;
  banner(out, "Remove workshop package");
  out("");
  if (!pi.isInstalled()) {
    err(fail("Pi is not installed; nothing to remove."));
    return { exitCode: 1 };
  }
  const result = pi.removeWorkshopPackage();
  if (result.error || result.status !== 0) {
    err(fail("Pi could not remove the package. See the output above."));
    return { exitCode: 1 };
  }
  out(ok("CUNY AI Lab package removed from Pi"));
  removeLegacyPackage(deps, "Earlier pi-workshop package removed from Pi");
  if (credentials.status().state === "configured") {
    out("");
    const remove = await prompts.confirmRemoveKey();
    if (remove) {
      await credentials.remove();
      out(ok("Saved CUNY AI Lab API key removed"));
    } else {
      out("Your saved CUNY AI Lab API key was kept in Pi's credential store.");
    }
  }
  out("");
  return { exitCode: 0 };
}
