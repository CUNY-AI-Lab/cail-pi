/** Test harness for the setup orchestrator and doctor: fully injected dependencies, captured output. */
export const FAKE_KEY = "cail-test-super-secret-12345";

export function makeDeps(overrides = {}) {
  const out = [];
  const err = [];
  const calls = [];
  const record = (name) => (...args) => { calls.push({ name, args }); return { changed: true, reason: "created" }; };

  const deps = {
    platform: "darwin",
    release: "25.5.0",
    nodeVersion: "v24.8.0",
    execPath: "/opt/node/bin/node",
    env: {},
    homedir: "/home/jane",
    version: "0.1.0",
    out: (line = "") => out.push(String(line)),
    err: (line = "") => err.push(String(line)),
    npmVersion: () => "10.9.3",
    pi: {
      installed: true,
      installedVersion: "1.0.0",
      version() { calls.push({ name: "pi.version" }); return this.installed ? this.installedVersion : undefined; },
      updateSelf() { calls.push({ name: "pi.updateSelf" }); this.installedVersion = "1.0.0"; return { status: 0 }; },
      isInstalled() { return this.version() !== undefined; },
      runLazyPi() { calls.push({ name: "lazypi" }); this.installed = true; return { status: 0 }; },
      installWorkshopPackage() { calls.push({ name: "pi.install" }); return { status: 0 }; },
      removeWorkshopPackage() { calls.push({ name: "pi.remove" }); return { status: 0 }; },
      hasWorkshopPackage() { return true; },
      legacy: false,
      hasLegacyPackage() { return this.legacy; },
      removeLegacyPackage() { calls.push({ name: "pi.removeLegacy" }); this.legacy = false; return { status: 0 }; },
      listModels() { calls.push({ name: "pi.listModels" }); return ["gemma-3-12b-it", "gpt-oss-120b"]; },
    },
    prompts: {
      askApiKey: async () => { calls.push({ name: "prompt.key" }); return FAKE_KEY; },
      confirmUseExistingKey: async () => { calls.push({ name: "prompt.useExisting" }); return true; },
      askNetworkFailureAction: async () => { calls.push({ name: "prompt.network" }); return "skip"; },
      askRetryOrSkipAfterRejection: async () => { calls.push({ name: "prompt.rejected" }); return "skip"; },
      confirmRemoveKey: async () => { calls.push({ name: "prompt.removeKey" }); return false; },
    },
    checkApiKey: async (key) => {
      calls.push({ name: "checkApiKey", key });
      return { status: "valid", message: "API key verified", modelCount: 14 };
    },
    fetchModelCatalog: async () => ({ ok: true, models: new Array(14).fill({}) }),
    credentials: {
      state: "absent",
      authPath: "/home/jane/.pi/agent/auth.json",
      status() { return { state: this.state }; },
      storedKey() { return this.state === "configured" ? "stored-old-key" : undefined; },
      async save(key) { calls.push({ name: "credentials.save", key }); this.state = "configured"; return { method: "pi", authPath: this.authPath }; },
      async remove() { calls.push({ name: "credentials.remove" }); this.state = "missing"; return { method: "pi" }; },
    },
    settings: {
      applyWindows: record("settings.applyWindows"),
      powershellEnabled: () => true,
    },
    agentDir: "/home/jane/.pi/agent",
    legacyExtensionPresent: () => false,
    piPackageDir: () => "/global/node_modules/@earendil-works/pi-coding-agent",
  };

  const merged = { ...deps, ...overrides };
  if (overrides.pi) merged.pi = { ...deps.pi, ...overrides.pi };
  if (overrides.prompts) merged.prompts = { ...deps.prompts, ...overrides.prompts };
  if (overrides.credentials) merged.credentials = { ...deps.credentials, ...overrides.credentials };
  if (overrides.settings) merged.settings = { ...deps.settings, ...overrides.settings };
  return { deps: merged, out, err, calls, text: () => [...out, ...err].join("\n") };
}
