/**
 * The `/cail` health check inside Pi. Formats results the extension has
 * already gathered; reads nothing, changes nothing, and prints no secrets.
 */

function firstLine(message) {
  return String(message ?? "").split("\n")[0];
}

/**
 * @param {object} input
 * @param {{ ok: boolean, message?: string }} input.catalog  fetchModelCatalog() result
 * @param {boolean} input.hasKey  whether Pi has a CUNY AI Lab key (stored or AILAB_API_KEY)
 * @param {{ status: string, message: string } | undefined} input.keyCheck  checkApiKey() result, when checked
 * @param {number} input.availableModels  CUNY AI Lab models Pi can use
 * @param {string | undefined} input.currentModel  "provider/id" of the session model
 * @param {string} input.platform
 * @param {boolean} [input.powershellEnabled]
 * @returns {{ text: string, healthy: boolean }}
 */
export function formatDoctorReport({ catalog, hasKey, keyCheck, availableModels, currentModel, platform, powershellEnabled }) {
  const lines = ["CUNY AI Lab setup"];
  let healthy = true;
  const row = (label, value, ok) => {
    if (ok === false) healthy = false;
    lines.push(`  ${label}: ${value}${ok === undefined ? "" : ok ? " ✓" : " ✗"}`);
  };

  row("Endpoint", catalog.ok ? "reachable" : `unreachable (${firstLine(catalog.message)})`, catalog.ok);
  if (!hasKey) row("API key", 'not configured; run /login and choose "CUNY AI Lab"', false);
  else if (!keyCheck) row("API key", "not checked (endpoint unreachable)");
  else row("API key", keyCheck.status === "valid" ? "valid" : firstLine(keyCheck.message), keyCheck.status === "valid");
  row("Models available", String(availableModels), availableModels > 0);
  row("Current model", currentModel ?? "none selected");
  if (platform === "win32") row("PowerShell tool", powershellEnabled ? "enabled" : "not enabled", Boolean(powershellEnabled));

  return { text: lines.join("\n"), healthy };
}
