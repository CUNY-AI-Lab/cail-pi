# CUNY AI Lab × Pi

Set up [Pi](https://pi.dev) for the CUNY AI Lab workshop.

## Windows PowerShell

```powershell
npx.cmd @cuny-ai-lab/cail-pi
```

## macOS / Linux

```bash
npx @cuny-ai-lab/cail-pi
```

The installer will:

* set up Pi through LazyPi, and update Pi to 1.0 or newer if an older version is installed
* install the CUNY AI Lab provider
* ask for your CUNY AI Lab API key (your typing is hidden)
* verify the key
* store it securely in Pi
* load the CUNY AI Lab models

Then start Pi:

```text
pi
```

and type:

```text
/model
```

and choose a CUNY AI Lab model.

---

## Prerequisites

You need Node.js **22.19.0 or newer**. Check with:

```text
node --version
```

### Windows

If Node is missing, open PowerShell and run:

```powershell
winget install OpenJS.NodeJS.LTS
```

Then **close PowerShell and open a new PowerShell window** before running the installer.

You do not need WSL, Git Bash, administrator rights, or any change to the PowerShell execution policy.

### macOS

Install Node.js from [nodejs.org](https://nodejs.org) (or with Homebrew or nvm if you already use them). The installer works with any of them.

### Linux

Install Node.js 22.19 or newer with your distribution's package manager, [nvm](https://github.com/nvm-sh/nvm), or the official binaries.

## Step by step (Windows)

1. Open PowerShell and check Node:

   ```powershell
   node --version
   ```

2. Run the workshop setup:

   ```powershell
   npx.cmd @cuny-ai-lab/cail-pi
   ```

   LazyPi will offer to install Pi and a curated set of packages. Accept the defaults.

   When you see `CUNY AI Lab API key:`, paste the key you were given. The characters stay hidden.

3. Start Pi:

   ```powershell
   pi.cmd
   ```

4. Inside Pi, type `/model` and pick a CUNY AI Lab model.

No `/login` is needed. Setup already stored your key in Pi.

## Step by step (macOS / Linux)

```bash
node --version
npx @cuny-ai-lab/cail-pi
pi
```

Then `/model` inside Pi.

## Already have Pi?

Update Pi and every Pi package, including this one, with Pi's own updater:

```bash
pi update --all          # macOS / Linux
```

```powershell
pi.cmd update --all      # Windows
```

Close any open Pi sessions first. Your saved key and settings are kept.

Running the installer again is also safe. It updates Pi if it is older than 1.0, updates the CUNY AI Lab package, and asks whether to keep the key you already saved (default: yes). Useful flags:

| Flag | Effect |
| --- | --- |
| `--skip-lazypi` | Do not run LazyPi. Pi must already be installed. |
| `--skip-auth` | Install the provider without asking for a key. Use `/login` in Pi later. |
| `--replace-key` | Ask for a new key even if one is already saved. |
| `--no-windows-settings` | Do not enable Pi's PowerShell tool on Windows. |
| `--doctor` | Check this computer without changing anything. |
| `--uninstall` | Remove the CUNY AI Lab package from Pi. |

## Troubleshooting

Run the health check first:

```powershell
npx.cmd @cuny-ai-lab/cail-pi --doctor     # Windows
```

```bash
npx @cuny-ai-lab/cail-pi --doctor         # macOS / Linux
```

It reports platform, Node, npm, Pi, the CUNY AI Lab extension, whether a key is saved, whether the gateway is reachable, whether the saved key is accepted, how many models are available, and (on Windows) whether Pi's PowerShell tool is enabled. It never prints the key.

**"requires Node.js 22.19.0 or newer"**
The message shows which `node` executable ran. If you have several (nvm, Homebrew, conda, winget), switch to a current one and run the installer again.

**"That API key was not accepted"**
Check for missing or extra characters and paste it again. Keys are individual; use the one issued to you.

**"The CUNY AI Lab service could not be reached"**
Your key was not saved. Check your network (VPN, captive portal, firewall) and choose Retry.

**No CUNY AI Lab models in `/model`**
Pi refreshes the catalog when it starts. If the list stays empty, run `--doctor`. If `--doctor` says the credential is not configured, run `/login` inside Pi and choose "CUNY AI Lab".

**PowerShell says scripts are disabled**
Use the `.cmd` forms: `npx.cmd`, `npm.cmd`, `pi.cmd`. There is no need to change the execution policy.

**Windows: `pi` is not recognized after LazyPi**
Close the window and open a new PowerShell window so it picks up the updated PATH, then run `pi.cmd`.

**Warnings about other extensions after updating to Pi 1.0**
Pi 1.0 prints warnings when it starts if some community packages installed by LazyPi declare Pi's modules the old way (`Host-provided extension packages must be declared in peerDependencies`), or when `pi-mcp-adapter` replaces Pi's new built-in MCP support. They come from those packages, not from CUNY AI Lab, and Pi still works. Pi turns off its built-in MCP by itself while `pi-mcp-adapter` is installed.

**A hand-written `extensions/cail.ts` from an earlier setup**
`--doctor` warns if one exists. Delete it once the package works, otherwise the provider is registered twice.

## Windows notes

* The installer, LazyPi, and Pi all run natively in Windows PowerShell 5.1 and PowerShell 7.
* On Windows the installer enables Pi's built-in `powershell` tool in `%USERPROFILE%\.pi\agent\settings.json`. Without a `defaultTools` setting it writes `["-bash", "+powershell"]`, which swaps the model's Bash tool for PowerShell and keeps Pi's other default tools. If you already chose a tool list, it appends `"+powershell"` and leaves your entries alone; a list that already mentions `powershell`, including `"-powershell"`, is not touched. A backup of the previous settings file is written next to it.
* Nothing is written to your PowerShell profile and the execution policy is never changed.

## Privacy and security

* Your API key is entered only at a hidden prompt. It is never accepted on the command line, so it never lands in Bash, zsh, or PowerShell history.
* The key is sent to exactly two places: the CUNY AI Lab gateway (to verify it) and Pi's credential store on this computer (`~/.pi/agent/auth.json`, created with owner-only permissions on macOS and Linux).
* The key is never written to `settings.json`, `models.json`, shell profiles, logs, or error messages, and `--doctor` never shows it.
* This package sends no telemetry.
* Keys are individual. Do not share yours; CUNY AI Lab can revoke and reissue keys.

Advanced users may instead set the `AILAB_API_KEY` environment variable; the provider reads it when no key is stored in Pi. That is not the workshop flow.

## Updates

The list of CUNY AI Lab models comes live from the gateway each time Pi starts, so new models appear without updating anything.

Update Pi and all packages, including this one, with `pi update --all` (`pi.cmd update --all` on Windows), or update only this package with:

```text
pi update npm:@cuny-ai-lab/cail-pi
```

or re-run the installer. This package needs Pi 1.0 or newer; the installer updates an older Pi through `pi update --self`, and `--doctor` flags one.

### Renamed from `@cuny-ai-lab/pi-workshop`

This package was first published as `@cuny-ai-lab/pi-workshop`. If you installed that one, run the installer above once: it installs `@cuny-ai-lab/cail-pi` and removes the old package, so the CUNY AI Lab provider is not loaded twice. Your saved key is kept.

## Uninstall

```text
pi remove npm:@cuny-ai-lab/cail-pi
```

Windows:

```powershell
pi.cmd remove npm:@cuny-ai-lab/cail-pi
```

This removes only this package. Your other Pi packages are untouched, and **your saved CUNY AI Lab key is kept** in Pi's credential store. To remove the key too, run the installer with `--uninstall`; it asks `Remove your saved CUNY AI Lab API key from Pi? [y/N]` (default: no). You can also remove it from inside Pi with `/logout`.

---

## For developers

### What the package contains

```text
bin/setup.mjs        npx entry point (thin wiring)
extensions/cail.ts   Pi extension: native "cail" provider with dynamic models
src/args.mjs         CLI flags
src/cail-api.mjs     key validation (/v1/quota) and catalog fetch (/v1/models)
src/cail-catalog.mjs catalog → Pi Model[] mapping (shared with the extension)
src/credentials.mjs  Pi AuthStorage integration + narrow fallback writer
src/diagnostics.mjs  --doctor
src/pi.mjs           pi / npx command wrapper
src/platform.mjs     .cmd resolution, spawn plans, platform labels
src/preflight.mjs    Node version check
src/prompts.mjs      hidden key prompt (@inquirer/prompts password)
src/settings.mjs     Windows defaultTools merge
src/setup.mjs        setup orchestrator (all side effects injected)
test/                node:test suites, mocked gateway; test/live for the real gateway
```

### How it fits Pi

* The provider is a native pi-ai provider built with `createProvider` from `@earendil-works/pi-ai/compat`, using `envApiKeyAuth("CUNY AI Lab API key", ["AILAB_API_KEY"])` and `openAICompletionsApi()`. Pi therefore owns `/login`, `/logout`, credential resolution, streaming, and catalog persistence.
* Models are discovered from `GET /v1/models`. The gateway response already carries names, capabilities (vision, reasoning), context length, pricing, status, and sunset dates, so there is no static model list in this package. The extension fetches the catalog once at load (public endpoint, 5 s timeout, skipped when `PI_OFFLINE` is set) so `/model` and `pi --list-models` work immediately, and again through `fetchModels` on Pi's normal refreshes.
* Speech models, sunset models, and models whose catalog entry lacks `function-calling` are filtered out: Pi sends its tools with every request and the gateway rejects tool calls to such models (`capability_unsupported`). Models with no capability information are still offered, with conservative defaults (text only, no reasoning, 128K context, 16K output).
* Key validation calls `GET /v1/quota`, which requires a valid bearer credential and performs no inference. `/v1/models` is public on the gateway and cannot validate a key.
* The extension imports from `@earendil-works/pi-ai/compat`. Pi's extension loader aliases only the root, `/compat`, `/oauth`, and `/providers/all` entry points, and in Pi 1.0 only `/compat` exports `openAICompletionsApi`. Pi's own 1.0 provider examples import from `/compat` too.
* The Windows tool setting relies on Pi's `+name` / `-name` `defaultTools` entries (Pi 0.99+), which is why the installer requires Pi 1.0 (`MIN_PI_VERSION` in `src/pi.mjs`) and runs `pi update --self` on older installs.
* Credentials are stored through Pi's own `AuthStorage`, dynamically imported from the installed `@earendil-works/pi-coding-agent` (found via `npm root -g` or the `pi` executable), so no second copy of Pi is bundled. If that import is unavailable, a narrow writer with the same `auth.json` schema is used: atomic write, backup, owner-only permissions, other providers preserved, malformed JSON refused.

### Developing

```bash
npm install
npm test                 # unit tests, mocked gateway
CAIL_LIVE_TEST_KEY=... npm run test:live   # optional, real gateway
npm pack --dry-run       # review the published file list
```

Try the extension in an isolated Pi profile without touching your own:

```bash
PI_CODING_AGENT_DIR=/tmp/pi-scratch pi install ./
PI_CODING_AGENT_DIR=/tmp/pi-scratch pi --list-models cail
```

Run the full installer against an unpublished checkout by pointing it at the local package instead of npm:

```bash
PI_CODING_AGENT_DIR=/tmp/pi-scratch PI_WORKSHOP_PACKAGE_SOURCE="$PWD" node bin/setup.mjs --skip-lazypi
```

### Publishing

Releases are published by GitHub Actions through npm trusted publishing, so no npm token exists and nobody publishes from their own machine. After the manual acceptance scenarios in `SPEC.md` §38 have been run, bump the version and push the tag from `main`:

```bash
npm version patch        # or minor; commits the bump and tags vX.Y.Z
git push --follow-tags
```

The tag starts the `publish` job in `.github/workflows/ci.yml`. It waits for the unit suite to pass on Linux, macOS, and Windows, checks that the tag matches the `package.json` version, and publishes with provenance. The trusted publisher on npmjs.com is tied to that workflow filename, so renaming the file breaks publishing until the npm setting is updated. `files` in `package.json` limits the tarball to `bin`, `extensions`, `src`, `README.md`, and `LICENSE`.
