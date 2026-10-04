# CUNY AI Lab × Pi

Adds CUNY AI Lab to [Pi](https://pi.dev): the lab's models through the CUNY AI Lab Gateway, web search and page reading, and a way for Pi to ask you questions. You need a CUNY AI Lab account with model access.

## Set up

1. Install Pi with Pi's own installer.

   macOS or Linux:

   ```bash
   curl -fsSL https://pi.dev/install.sh | sh
   ```

   Windows PowerShell:

   ```powershell
   irm https://pi.dev/install.ps1 | iex
   ```

   Press Enter to accept Pi's suggestions. It installs Node.js too when your computer needs it.

2. Add the CUNY AI Lab package:

   ```text
   pi install npm:@cuny-ai-lab/cail-pi
   ```

3. Start Pi and sign in:

   ```text
   pi
   ```

   Type `/login cail` and choose **Sign in with CUNY AI Lab**. Your browser opens the lab's sign-in page. Sign in with CUNY Login, click **Connect Pi**, and return to Pi.

   Pi then reports that it logged in "but no default model is configured for provider "cail"". That message is expected. Type your first message and Pi answers with DeepSeek V4 Flash.

   Working on another computer over SSH? Pi shows a link instead of opening a browser. Open the link on any computer, click **Connect Pi**, and paste the code it shows into Pi.

   You can also choose **Sign in with an API key** and paste a personal key from [Model access](https://tools.ailab.gc.cuny.edu/model-access).

## What you get

* **CUNY AI Lab models**, listed live from the gateway, so new models appear without updating anything. Choose one with `/model`. Sessions start on the newest DeepSeek Flash unless you have saved a default model yourself (`Ctrl+S` in `/model`).
* **Web search and page reading** from [pi-web-access](https://www.npmjs.com/package/pi-web-access): `web_search`, `fetch_content`, `get_search_content` and `source_check`. Search uses Exa's free service and needs no key. Many searches sent at the same moment from one network can be refused briefly; Pi can simply search again.
* **Questions from Pi** through [pi-ask-user](https://www.npmjs.com/package/pi-ask-user): the `ask_user` tool lets Pi ask you to choose between options before it goes ahead.
* **`/cail`**, a health check for your setup.
* **On Windows**, Pi's PowerShell tool is turned on in `%USERPROFILE%\.pi\agent\settings.json`. With no `defaultTools` set, it becomes `["-bash", "+powershell"]`, so the model uses PowerShell in place of bash and keeps Pi's other default tools. A tool list you chose yourself gets `"+powershell"` added, unless it already names `powershell` (including `"-powershell"`). A backup of the previous file is kept next to it. Run `/reload` to use the tool in the session where it was turned on.

## Troubleshooting

Type `/cail` inside Pi. It reports whether the gateway is reachable, whether your key is saved and accepted, how many CUNY AI Lab models you can use, which model is active, and on Windows whether the PowerShell tool is on. It never shows your key.

**"No API key found for the selected model"**
Run `/login cail` and sign in, as in step 3.

**"Your CUNY AI Lab sign-in has expired"**
Keys from signing in last 180 days. Type `/login cail` and sign in again.

**"Your CUNY AI Lab access is not active yet"**
Signing in works only for accounts with lab model access. Open [Model access](https://tools.ailab.gc.cuny.edu/model-access) to see how to request it.

**"That API key was not accepted"** (in `/cail`)
Check for missing or extra characters and run `/login` again. Keys are individual; use the one issued to you.

**No CUNY AI Lab models in `/model`**
Pi lists them once a key is saved. If `/cail` says the key is valid but the list stays empty, restart Pi.

**Windows: "running scripts is disabled on this system"**
Pi's installer removes its PowerShell launcher when the execution policy would block it, so `pi` runs `pi.cmd`. If the policy changed after installing, type `pi.cmd` instead of `pi`. There is no need to change the execution policy.

**Coming from the earlier setup**
Versions up to 0.3.0 installed through `npx @cuny-ai-lab/cail-pi` and LazyPi. That installer is gone. To keep Pi lean, list your packages with `pi list` and remove the ones you do not use with `pi remove <source>`. Remove any hand-written `cail` provider from `~/.pi/agent/models.json` and any `~/.pi/agent/extensions/cail.ts`, since the package registers the same provider. The deprecated `npm:@cuny-ai-lab/pi-workshop` package also registers it; remove it with `pi remove npm:@cuny-ai-lab/pi-workshop`.

## Privacy and security

* Signing in creates a personal key for this computer, named "Pi on" and the computer's name, that expires after 180 days. It is listed in [Model access](https://tools.ailab.gc.cuny.edu/model-access), where you can revoke it. Signing in again from the same computer replaces that key; a key you pasted yourself is never replaced.
* Pi stores your key when you run `/login`, in `~/.pi/agent/auth.json` with owner-only permissions on macOS and Linux.
* The CUNY AI Lab extension sends your key only to the CUNY AI Lab gateway: with every model request, and to check it when you run `/cail`.
* Web searches go to Exa. Pages are fetched directly from your computer.
* Advanced users can set `AILAB_API_KEY` instead of running `/login`.

## Updates and removal

Update the package with `pi update npm:@cuny-ai-lab/cail-pi`, and update Pi itself with `pi update`.

Remove the package with `pi remove npm:@cuny-ai-lab/cail-pi`. Your key stays in Pi until you run `/logout`. Logging out does not revoke the key; revoke it in Model access if you no longer need it.

---

## For developers

### What the package contains

```text
extensions/cail.ts    Pi extension: the "cail" provider, the session-start model, the Windows
                      PowerShell setting and the /cail command
src/cail-catalog.mjs  gateway catalog → Pi models, newest DeepSeek Flash first
src/cail-api.mjs      key check (/v1/quota) and catalog fetch (/v1/models)
src/doctor.mjs        /cail report formatting
src/signin.mjs        "Sign in with CUNY AI Lab": loopback or copy-code sign-in, PKCE, key exchange
src/settings.mjs      Windows defaultTools merge
test/                 node:test suites with a mocked gateway; test/live for the real gateway
```

`pi-ask-user` and `pi-web-access` are exact-version `dependencies`, listed in `bundleDependencies` so they ship inside this package's tarball, and loaded through the `pi` manifest's `node_modules/...` paths. Pi's [package documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md) requires that form for Pi packages used as dependencies. Their versions change only when this package is released; read their changelogs before raising them. `.npmrc` sets `legacy-peer-deps` so their peer dependencies, which Pi provides, are never installed or bundled.

### How it fits Pi

* The provider is a native pi-ai provider built with `createProvider` from `@earendil-works/pi-ai/compat`, using `envApiKeyAuth("CUNY AI Lab API key", ["AILAB_API_KEY"])`, an OAuth sign-in, and `openAICompletionsApi()`. Pi owns `/login`, `/logout`, credential storage, streaming and catalog persistence.
* Sign-in follows the lab's connect flow, documented in the Model Access API README. Pi opens `/model-access/connect` with a PKCE challenge and, on its own computer, a `127.0.0.1` callback; over SSH (`SSH_CONNECTION`, `SSH_CLIENT` or `SSH_TTY` set) it asks for the code the page shows. It trades the code at `/model-access/v1/connect/token` for an ordinary personal key and stores it as an OAuth credential whose expiry is the key's. When Pi's stored `cail` credential came from an earlier sign-in, the exchange names that key so the lab replaces it. An expired credential cannot be refreshed; Pi reports that the participant should sign in again.
* Models come from `GET /v1/models`. The response carries names, capabilities, context length, pricing, status and sunset dates, so the package has no static model list. The extension fetches the catalog once at load (public endpoint, 5 s timeout, skipped when `PI_OFFLINE` is set) and again through `fetchModels` on Pi's refreshes.
* Speech models, sunset models, and models whose catalog entry lacks `function-calling` are dropped, because Pi sends its tools with every request and the gateway rejects tool calls to such models. Models with no capability information are offered with conservative defaults.
* With no saved default, Pi starts on the first available model of a provider it has no built-in default for, so the catalog lists the newest DeepSeek Flash first. After `/login`, Pi selects no model for such a provider and holds a placeholder model instead; an `input` handler selects the newest DeepSeek Flash for that session when the first message arrives. Neither writes settings, and a saved default always wins.
* `/cail` checks the key with `GET /v1/quota`, which needs a valid bearer credential and runs no inference.

### Developing

```bash
npm install
npm test                 # unit tests, mocked gateway
CAIL_LIVE_TEST_KEY=... npm run test:live   # optional, real gateway
npm pack --dry-run       # review the published files and bundled packages
```

Try a build in an isolated Pi profile without touching your own. Install it from an unpacked tarball rather than from the checkout, whose `node_modules` also holds the development copy of `@earendil-works/pi-ai`:

```bash
npm pack --pack-destination /tmp
mkdir -p /tmp/cail-pi-build && tar xzf /tmp/cuny-ai-lab-cail-pi-*.tgz -C /tmp/cail-pi-build --strip-components 1
PI_CODING_AGENT_DIR=/tmp/pi-scratch pi install /tmp/cail-pi-build
PI_CODING_AGENT_DIR=/tmp/pi-scratch pi
```

### Publishing

Releases are published by GitHub Actions through npm trusted publishing, so no npm token exists and nobody publishes from their own machine. After testing a build in a clean Pi profile on macOS and Windows, bump the version and push the tag from `main`:

```bash
npm version patch        # or minor; commits the bump and tags vX.Y.Z
git push --follow-tags
```

The tag starts the `publish` job in `.github/workflows/ci.yml`. It waits for the unit suite to pass on Linux, macOS and Windows, checks that the tag matches the `package.json` version, and publishes with provenance. The trusted publisher on npmjs.com is tied to that workflow filename, so renaming the file breaks publishing until the npm setting is updated. `files` in `package.json` limits our own files to `extensions`, `src`, `README.md` and `LICENSE`; the bundled packages are added by `bundleDependencies`.
