/** `--doctor`: read-only checks. Prints no secrets, changes nothing. */
import { checkNodeVersion } from "./preflight.mjs";
import { MIN_PI_VERSION, isSupportedPiVersion } from "./pi.mjs";
import { executable, platformLabel } from "./platform.mjs";

function section(out, title, value, mark) {
  out(title);
  out(`  ${value}${mark === undefined ? "" : ` ${mark}`}`);
  out("");
}

export async function runDoctor(deps) {
  const { out } = deps;
  let healthy = true;
  const bad = () => { healthy = false; return "✗"; };

  out("");
  out("CUNY AI Lab Pi Workshop Doctor");
  out("");

  section(out, "Platform", platformLabel(deps.platform, deps.release));

  const node = checkNodeVersion(deps.nodeVersion, deps.execPath);
  out("Node");
  out(`  ${deps.nodeVersion} ${node.ok ? "✓" : bad()}`);
  out(`  ${deps.execPath}`);
  out("");

  const npm = deps.npmVersion();
  section(out, "npm", npm ? `available (${npm})` : "not found", npm ? "✓" : bad());

  const piVersion = deps.pi.version();
  if (!piVersion) {
    section(out, "Pi", "not installed", bad());
  } else if (!isSupportedPiVersion(piVersion)) {
    section(out, "Pi", `installed (${piVersion}), ${MIN_PI_VERSION} or newer needed`, bad());
    out(`  Update it with: ${executable("pi", deps.platform)} update --all`);
    out("");
  } else {
    section(out, "Pi", `installed (${piVersion})`, "✓");
  }

  const extension = piVersion ? deps.pi.hasWorkshopPackage() : false;
  section(out, "CAIL extension", extension ? "installed" : "not installed", extension ? "✓" : bad());
  if (deps.legacyExtensionPresent()) {
    out(`  ! A hand-written extensions/cail.ts also exists in ${deps.agentDir}.`);
    out("    It registers the same provider and may conflict with (duplicate) the package.");
    out("    Delete it once the package works.");
    out("");
  }

  const status = deps.credentials.status();
  const configured = status.state === "configured";
  const credentialLabel = { configured: "configured", missing: "not configured", absent: "not configured", malformed: "auth.json is malformed", unreadable: "auth.json is unreadable" }[status.state] ?? status.state;
  section(out, "CAIL credential", credentialLabel, configured ? "✓" : bad());

  const catalog = await deps.fetchModelCatalog();
  section(out, "CAIL endpoint", catalog.ok ? "reachable" : "unreachable", catalog.ok ? "✓" : bad());

  let modelCount;
  const stored = configured ? deps.credentials.storedKey() : undefined;
  if (!catalog.ok) {
    section(out, "CAIL authentication", "skipped (endpoint unreachable)");
  } else if (!stored) {
    section(out, "CAIL authentication", configured ? "skipped (credential is not an API key)" : "skipped (no key configured)");
  } else {
    const result = await deps.checkApiKey(stored);
    if (result.status === "valid") {
      section(out, "CAIL authentication", "valid", "✓");
      modelCount = result.modelCount;
    } else {
      section(out, "CAIL authentication", result.status.replace("_", " "), bad());
    }
  }

  const count = modelCount ?? (catalog.ok ? catalog.models.length : undefined);
  section(out, "Available CAIL models", count === undefined ? "unknown" : String(count), count ? "✓" : bad());

  if (deps.platform === "win32") {
    const enabled = deps.settings.powershellEnabled();
    section(out, "PowerShell tool", enabled ? "enabled" : "not enabled", enabled ? "✓" : bad());
  }

  return { exitCode: healthy ? 0 : 1 };
}
