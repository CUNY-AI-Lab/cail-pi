# CUNY AI Lab × Pi Workshop Installer

## Objective

Build and publish a single npm package:

`@cuny-ai-lab/cail-pi`

The package has two roles:

1. A cross-platform workshop bootstrapper invoked with `npx`.
2. A Pi package containing the CUNY AI Lab provider extension.

The desired participant experience should be extremely simple.

### macOS / Linux

```bash
npx @cuny-ai-lab/cail-pi
```

### Windows PowerShell

```powershell
npx.cmd @cuny-ai-lab/cail-pi
```

The installer should then interactively do the rest:

```text
CUNY AI Lab × Pi
Workshop Setup

✓ Node.js 24.8.0
✓ Pi installed
✓ CUNY AI Lab provider installed

Paste your CUNY AI Lab API key:
> ********************************

✓ API key verified
✓ Credentials saved securely in Pi
✓ 14 CUNY AI Lab models available

Setup complete.

Start Pi with:

  pi

Then use /model to choose a CUNY AI Lab model.
```

The API-key prompt must hide the user's input.

Participants should **not** have to:

* edit `models.json`
* edit `.zshrc`
* edit PowerShell profiles
* set `AILAB_API_KEY`
* manually create a TypeScript extension
* manually run `/login`
* paste their API key into a command
* restart their computer
* use WSL on Windows

The API key must not appear in terminal history, logs, error messages, or process arguments.

---

# 1. Core architecture

Build one npm package:

```text
@cuny-ai-lab/cail-pi
```

That package contains:

```text
cail-pi/
├── package.json
├── README.md
├── LICENSE
│
├── bin/
│   └── setup.mjs
│
├── extensions/
│   └── cail.ts
│
├── src/
│   ├── platform.mjs
│   ├── credentials.mjs
│   ├── diagnostics.mjs
│   ├── settings.mjs
│   └── cail-api.mjs
│
├── test/
│   ├── bootstrap.test.mjs
│   ├── credentials.test.mjs
│   ├── platform.test.mjs
│   ├── provider.test.ts
│   ├── settings.test.mjs
│   └── fixtures/
│
└── .github/
    └── workflows/
        └── ci.yml
```

The package must be both:

* executable through `npx`
* installable by Pi as a Pi package

---

# 2. Target environment

Use the current Earendil Pi ecosystem:

```text
@earendil-works/pi-coding-agent
@earendil-works/pi-ai
```

Minimum supported Node:

```text
22.19.0
```

CAIL OpenAI-compatible API:

```text
https://tools.ailab.gc.cuny.edu/v1
```

Dynamic model endpoint:

```text
https://tools.ailab.gc.cuny.edu/v1/models
```

Public CAIL model catalog:

```text
https://ailab.gc.cuny.edu/models/
```

Provider ID:

```text
cail
```

Provider display name:

```text
CUNY AI Lab
```

---

# 3. package.json

Start with approximately:

```json
{
  "name": "@cuny-ai-lab/cail-pi",
  "version": "0.1.0",
  "description": "CUNY AI Lab workshop setup and model provider for Pi",
  "type": "module",
  "license": "MIT",
  "bin": {
    "cail-pi": "./bin/setup.mjs"
  },
  "files": [
    "bin",
    "extensions",
    "src",
    "README.md",
    "LICENSE"
  ],
  "engines": {
    "node": ">=22.19.0"
  },
  "keywords": [
    "pi-package",
    "cuny",
    "cuny-ai-lab",
    "ai",
    "coding-agent"
  ],
  "pi": {
    "extensions": [
      "./extensions/cail.ts"
    ]
  },
  "peerDependencies": {
    "@earendil-works/pi-ai": "*",
    "@earendil-works/pi-coding-agent": "*"
  },
  "publishConfig": {
    "access": "public"
  }
}
```

A small dependency for a secure cross-platform password prompt is acceptable.

Prefer an established library such as:

```text
@inquirer/prompts
```

rather than implementing password masking independently.

Verify its current API before coding.

---

# 4. Participant-facing setup sequence

The bootstrap flow should be:

```text
START
  │
  ├── check Node version
  │
  ├── check npm/npx
  │
  ├── run LazyPi
  │
  ├── verify Pi
  │
  ├── install @cuny-ai-lab/cail-pi into Pi
  │
  ├── configure Windows PowerShell support if relevant
  │
  ├── prompt for CAIL API key
  │
  ├── validate key against /v1/models
  │
  ├── save key in Pi credential storage
  │
  ├── refresh CAIL models
  │
  ├── diagnostics
  │
  └── print:
          pi
          /model
```

The participant should not need a separate authentication step afterward.

---

# 5. Interactive API-key prompt

After the CAIL provider extension has been installed, show something like:

```text
CUNY AI Lab authentication

Paste your CUNY AI Lab API key below.

Your input will be hidden and the key will be stored in Pi's
credential store on this computer.

CUNY AI Lab API key:
> ***********************
```

Prefer wording like:

```text
CUNY AI Lab API key:
```

or:

```text
Paste your CUNY AI Lab API key:
```

rather than a verbose question.

The input must be hidden.

Do NOT use:

```text
readline.question()
```

with ordinary visible input.

Use a proper password/secret prompt.

Example conceptually:

```js
const key = await password({
  message: "CUNY AI Lab API key:",
  mask: "*"
});
```

Verify the current prompt-library API before implementation.

Trim accidental surrounding whitespace from the entered key.

Never print the value back to the user.

---

# 6. Allow authentication to be skipped

Although workshop participants will normally have API keys, allow setup to continue without one.

The prompt should support something equivalent to:

```text
Press Enter to configure this later with /login.
```

or provide:

```text
--skip-auth
```

If authentication is skipped, setup still installs the CAIL provider.

The final message should then say:

```text
CAIL authentication has not been configured.

Start Pi:

  pi

Then run:

  /login

and choose "CUNY AI Lab".
```

The default workshop flow, however, should request the key during installation.

---

# 7. Validate the key before saving it

Do not save an unverified API key immediately.

First call:

```http
GET https://tools.ailab.gc.cuny.edu/v1/models
Authorization: Bearer <API KEY>
```

Use:

```js
fetch()
```

with a reasonable timeout.

Interpret results carefully.

### Success

HTTP 200 + valid OpenAI-style model response:

```json
{
  "data": [
    {
      "id": "some-model"
    }
  ]
}
```

Then show:

```text
✓ API key verified
✓ 14 CUNY AI Lab models available
```

### HTTP 401

Show:

```text
That API key was not accepted by CUNY AI Lab.

Please check the key and try again.
```

Prompt again.

### HTTP 403

Show a message distinguishing authorization from malformed key where possible:

```text
The key was recognized, but it does not have access to this resource.
```

### Network failure

Do not tell the user their key is wrong.

Instead:

```text
The CUNY AI Lab service could not be reached.

Your key has not been saved yet.

[R]etry
[S]kip authentication for now
```

Never include the API key in an error.

---

# 8. Credential persistence

Once validation succeeds, persist the credential under provider:

```text
cail
```

The resulting logical Pi credential should be:

```json
{
  "type": "api_key",
  "key": "<SECRET>"
}
```

stored for provider:

```text
cail
```

Pi's default credential location is:

```text
~/.pi/agent/auth.json
```

unless its agent directory has been overridden.

Respect:

```text
PI_CODING_AGENT_DIR
```

if present.

## Preferred implementation

Use Pi's current official credential-storage API if it can be consumed safely from the bootstrap context.

Inspect the installed Pi version and current exports before implementation.

Pi currently exposes an `AuthStorage` abstraction backed by `auth.json`.

Prefer conceptually:

```ts
const authStorage = AuthStorage.create();

await authStorage.modify(
  "cail",
  async () => ({
    type: "api_key",
    key
  })
);
```

Verify the exact current public API and credential type before shipping.

This is preferable because Pi's implementation handles:

* auth-file location
* locking
* merging
* file permissions
* concurrent writes
* credential format

## Important packaging issue

Do not blindly bundle a second incompatible copy of Pi core merely to gain access to `AuthStorage`.

Codex should investigate the cleanest supported way for the bootstrap package to access the installed Pi credential API.

Potential approaches, in order of preference:

1. Supported public Pi SDK/API exposed to packages.
2. A Pi-provided authentication command/API suitable for automation.
3. Use Pi's `AuthStorage` module if dependency resolution can be done without introducing conflicting Pi copies.
4. Only if none of those is practical, implement a narrowly scoped credential writer matching Pi's documented credential schema.

Do not assume option 4 is necessary without investigating the current API.

---

# 9. Credential-writer fallback

If direct use of Pi's credential API from the bootstrap process is genuinely impractical, implement credential persistence carefully rather than simply overwriting `auth.json`.

Resolve agent directory:

```text
PI_CODING_AGENT_DIR
```

if set, otherwise:

```text
~/.pi/agent
```

Credential file:

```text
<agent-dir>/auth.json
```

Required behavior:

* create directory if absent
* preserve all existing provider credentials
* refuse to overwrite malformed JSON
* write atomically through a temporary file
* make a backup before modifying an existing file
* set restrictive POSIX permissions where supported
* do not alter unrelated credentials
* do not log file contents
* do not log the API key

For example, existing:

```json
{
  "anthropic": {
    "type": "api_key",
    "key": "..."
  }
}
```

should become logically:

```json
{
  "anthropic": {
    "type": "api_key",
    "key": "..."
  },
  "cail": {
    "type": "api_key",
    "key": "..."
  }
}
```

Never replace the entire credential store with only `cail`.

The implementation should mirror Pi's current credential schema exactly.

---

# 10. Existing CAIL credential

Before asking for a new key, determine whether a CAIL credential already exists.

If it exists, do not expose it.

Display:

```text
A CUNY AI Lab API key is already configured for Pi.

Use existing key? [Y/n]
```

Default:

```text
Y
```

If the user chooses yes:

* validate the existing credential
* leave it unchanged
* continue

If validation fails:

```text
The existing CUNY AI Lab credential is no longer valid.
```

Then prompt for a replacement.

If the participant chooses to replace it, prompt securely.

---

# 11. API keys must never enter shell history

Do NOT instruct participants to run:

```bash
export AILAB_API_KEY="secret"
```

as part of the standard workshop.

Do NOT use:

```powershell
$env:AILAB_API_KEY = "secret"
```

for the standard workflow.

Do NOT put the key in command-line arguments such as:

```text
--api-key SECRET
```

The installer should receive the secret only through its interactive hidden prompt.

This ensures the secret does not appear in:

* Bash history
* zsh history
* PowerShell history
* process listings
* workshop screenshots of commands

Environment-variable support may remain available for advanced users through the provider's `envApiKeyAuth`, but it must not be the normal workshop flow.

---

# 12. Bootstrap CLI

Implement:

```text
bin/setup.mjs
```

as cross-platform Node.js.

Do not write the installer itself in Bash or PowerShell.

Start with:

```js
#!/usr/bin/env node
```

Detect platform using:

```js
process.platform
```

Native Windows:

```text
win32
```

Use a helper:

```js
function executable(name) {
  return process.platform === "win32"
    ? `${name}.cmd`
    : name;
}
```

This is important for:

```text
npm
npx
pi
```

On Windows use programmatically:

```text
npm.cmd
npx.cmd
pi.cmd
```

Use `spawn()`/`spawnSync()` with argument arrays.

Avoid:

```js
shell: true
```

unless demonstrably necessary.

Avoid concatenated shell commands.

---

# 13. Node preflight

Require:

```text
Node >=22.19.0
```

Inspect:

```js
process.version
process.execPath
```

If unsupported, stop before making changes.

Example:

```text
CUNY AI Lab × Pi requires Node.js 22.19.0 or newer.

Detected:
  Node v22.18.0
  /Users/example/.nvm/versions/node/v22.18.0/bin/node
```

That executable path is especially useful when NVM, Homebrew, Conda, etc. conflict.

---

# 14. Windows Node instructions

If Node is absent, the npm installer cannot run at all, so this remains a prerequisite.

Workshop instructions should say:

```powershell
node --version
```

If Node is not installed, recommend:

```powershell
winget install OpenJS.NodeJS.LTS
```

Then:

```text
Close PowerShell and open a new PowerShell window.
```

Do not attempt to bootstrap Node from inside an npm script.

---

# 15. Run LazyPi

Invoke:

```text
npx --yes @robzolkos/lazypi
```

Programmatically, Windows must use:

```text
npx.cmd
```

Do not suppress LazyPi's UI.

Allow participants to use LazyPi's normal setup/package picker.

If LazyPi returns nonzero, stop rather than continuing into an inconsistent installation.

Support:

```text
--skip-lazypi
```

for experienced/repeat users.

If `--skip-lazypi` is supplied, require that Pi already exists.

---

# 16. Install this package into Pi

After LazyPi:

```text
pi install npm:@cuny-ai-lab/cail-pi
```

On Windows invoke:

```text
pi.cmd
```

This allows Pi to manage the extension's lifecycle.

Do not manually copy:

```text
extensions/cail.ts
```

into the user's global extensions directory.

The setup must be idempotent.

Running it again must update/confirm the package, not duplicate configuration.

---

# 17. Native Windows / PowerShell support

Native Windows PowerShell is a first-class workshop platform.

Do not require WSL.

Pi has native PowerShell tooling.

On Windows, if the participant has not explicitly configured `defaultTools`, set:

```json
{
  "defaultTools": [
    "read",
    "powershell",
    "edit",
    "write"
  ]
}
```

Do not overwrite an existing `defaultTools` choice.

Resolve settings directory using:

```text
PI_CODING_AGENT_DIR
```

or default:

```text
~/.pi/agent
```

Modify:

```text
settings.json
```

using a safe JSON merge.

Requirements:

* preserve all unrelated settings
* back up existing settings first
* do not overwrite invalid JSON
* do not remove Git Bash configuration
* do not alter an explicit existing `defaultTools`

Support:

```text
--no-windows-settings
```

---

# 18. Windows execution policy

Do not instruct participants to weaken PowerShell execution policy.

Never recommend:

```powershell
Set-ExecutionPolicy Unrestricted
```

or equivalent.

Workshop instructions should use:

```powershell
npx.cmd @cuny-ai-lab/cail-pi
```

This avoids PowerShell selecting an npm-generated `.ps1` wrapper that may be blocked by policy.

Likewise troubleshooting can use:

```powershell
npm.cmd
npx.cmd
pi.cmd
```

The Node bootstrapper itself should spawn `.cmd` variants on Windows.

---

# 19. CAIL Pi provider

Implement:

```text
extensions/cail.ts
```

Use Pi's current provider abstraction.

Conceptually import:

```ts
import {
  createProvider,
  envApiKeyAuth,
  type Model
} from "@earendil-works/pi-ai";

import {
  openAICompletionsApi
} from "@earendil-works/pi-ai/api/openai-completions.lazy";

import type {
  ExtensionAPI
} from "@earendil-works/pi-coding-agent";
```

Verify actual exports against the current Pi release.

Provider:

```ts
const provider = createProvider({
  id: "cail",
  name: "CUNY AI Lab",

  baseUrl:
    "https://tools.ailab.gc.cuny.edu/v1",

  auth: {
    apiKey: envApiKeyAuth(
      "CUNY AI Lab API key",
      ["AILAB_API_KEY"]
    )
  },

  models: [],

  fetchModels: async (context) => {
    // retrieve current models
  },

  api: openAICompletionsApi()
});

pi.registerProvider(provider);
```

Use native `fetchModels`, rather than maintaining `models.json`.

---

# 20. Dynamic model discovery

CAIL model availability must come dynamically from:

```http
GET https://tools.ailab.gc.cuny.edu/v1/models
```

authenticated with the user's CAIL credential.

Send:

```http
Authorization: Bearer <key>
```

Use the effective credential supplied by Pi's provider/model runtime.

Honor the provided `AbortSignal`.

Expected shape:

```json
{
  "data": [
    {
      "id": "model-name"
    }
  ]
}
```

Validate:

* HTTP status
* JSON parsing
* `data` array
* nonempty string model IDs

Malformed individual entries can be skipped.

A malformed entire catalog should produce a useful error.

Do not hard-code model availability into the npm package.

---

# 21. Refresh model catalog immediately after setup

Once the setup script has:

1. installed the provider
2. validated the API key
3. stored the credential

refresh Pi's model catalog.

Prefer Pi's native model-refresh mechanism.

The documented user command is conceptually:

```text
pi update --models
```

Use the currently supported equivalent.

Then diagnostics should verify that at least one `cail` model is visible.

The final participant workflow should therefore be:

```text
npx installer
→ enter API key
→ pi
→ /model
```

not:

```text
npx installer
→ pi
→ /login
→ API key
→ restart
→ model refresh
→ /model
```

---

# 22. CAIL model metadata

Separate:

## Availability

Authoritative source:

```text
/v1/models
```

## Capabilities

Potential authoritative source:

```text
https://ailab.gc.cuny.edu/models/
```

Investigate what machine-readable source powers that page.

Do not scrape rendered HTML every time Pi starts.

Preferred design:

```text
/v1/models
       │
       │ tells us what the user can use
       ↓
live model IDs
       │
       + metadata registry
       ↓
Pi Model[]
```

Supplemental metadata may include:

* display name
* model family
* vision support
* reasoning support
* context window
* output-token limit
* pricing
* tool support
* compatibility options

If the website already reads from JSON/API, consume that stable source.

If no stable machine-readable source exists, generate a metadata file at development/release time.

Unknown live models must still work.

---

# 23. Safe fallback model metadata

For live models that have no metadata entry, use conservative defaults.

For example:

```ts
{
  id: remote.id,
  name: remote.id,
  provider: "cail",
  api: "openai-completions",
  baseUrl: BASE_URL,
  reasoning: false,
  input: ["text"],
  contextWindow: 128000,
  maxTokens: 16384,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0
  }
}
```

These are fallback values only.

Do not infer:

```text
reasoning: true
```

from a model name unless the registry confirms it.

Do not advertise image support unless confirmed.

---

# 24. Bootstrap output

Desired complete install experience:

```text
CUNY AI Lab × Pi
Workshop Setup
────────────────────────────────

Checking your computer...

✓ macOS
✓ Node v24.8.0
✓ npm available

Starting LazyPi...

[LazyPi interface]

Installing CUNY AI Lab integration...

✓ CAIL provider installed

CUNY AI Lab authentication

Paste your CUNY AI Lab API key.
Your input is hidden.

CUNY AI Lab API key:
> ************************

Checking your key...

✓ API key verified
✓ 14 CUNY AI Lab models available
✓ Credential saved securely in Pi

Refreshing models...

✓ Model catalog updated

────────────────────────────────
Setup complete!
────────────────────────────────

Start Pi:

  pi

Then type:

  /model

and choose a CUNY AI Lab model.
```

Windows version:

```text
CUNY AI Lab × Pi
Workshop Setup
────────────────────────────────

✓ Windows 11
✓ Node v24.8.0
✓ PowerShell detected
✓ Pi configured for PowerShell

...

Setup complete!

Start Pi:

  pi.cmd

Then type:

  /model
```

---

# 25. `--doctor`

Implement:

```text
--doctor
```

It must make no changes and expose no secrets.

Example:

```text
CUNY AI Lab Pi Workshop Doctor

Platform
  Windows 11

Node
  v24.8.0 ✓

npm
  available ✓

Pi
  installed ✓

CAIL extension
  installed ✓

CAIL credential
  configured ✓

CAIL endpoint
  reachable ✓

CAIL authentication
  valid ✓

Available CAIL models
  14 ✓

PowerShell tool
  enabled ✓
```

Never show:

* the key
* first/last characters of the key
* Authorization header
* raw `auth.json`

---

# 26. CLI flags

Support:

```text
--help
--version
--doctor
--skip-lazypi
--skip-auth
--no-windows-settings
```

Potentially:

```text
--replace-key
```

to force reauthentication when a key is already configured.

---

# 27. Windows participant documentation

## Step 1 — Node

Open PowerShell.

```powershell
node --version
```

Need:

```text
v22.19.0
```

or newer.

If Node is missing:

```powershell
winget install OpenJS.NodeJS.LTS
```

Close and reopen PowerShell afterward.

## Step 2 — Run workshop setup

```powershell
npx.cmd @cuny-ai-lab/cail-pi
```

The installer will ask:

```text
CUNY AI Lab API key:
```

Paste the key distributed to the participant.

Characters must be hidden.

## Step 3 — Start Pi

```powershell
pi.cmd
```

## Step 4 — Choose model

Inside Pi:

```text
/model
```

No `/login` should normally be necessary because setup already configured authentication.

---

# 28. macOS participant documentation

Check Node:

```bash
node --version
```

Run:

```bash
npx @cuny-ai-lab/cail-pi
```

Enter the CAIL API key when prompted.

Then:

```bash
pi
```

and:

```text
/model
```

---

# 29. Linux participant documentation

Same basic flow:

```bash
node --version
npx @cuny-ai-lab/cail-pi
pi
```

Then:

```text
/model
```

Do not assume Homebrew.

---

# 30. Security requirements

The API key is the most important security requirement.

The package must:

* use hidden terminal input
* never echo the key
* never log the key
* never place the key in argv
* never place the key in shell history
* never store it in `settings.json`
* never store it in `models.json`
* never store it in `.zshrc`
* never store it in a PowerShell profile
* never send it anywhere except CAIL and Pi's credential storage
* never include it in telemetry
* never include it in crash output
* never include it in tests
* never commit sample real credentials

Do not modify PowerShell execution policy.

Do not require administrator privileges except where an external prerequisite installer such as `winget` itself legitimately requires them.

No telemetry should be added by this package unless explicitly approved by CUNY.

---

# 31. Individual workshop keys

Assume each participant receives their own CUNY AI Lab API key.

Do not design around one shared workshop credential.

Individual credentials allow:

* revocation
* user-specific access
* usage attribution
* damage containment if a key is exposed

The installer should not collect identity information merely to associate a key with a participant.

CAIL handles the relationship upstream.

---

# 32. Testing credential handling

Tests must specifically verify:

### Hidden input

Ensure the prompt library uses password/secret input mode.

### Logs

Given a fake key:

```text
cail-test-super-secret-12345
```

run all common success/error paths and assert that this string never appears in:

```text
stdout
stderr
exceptions
diagnostic output
temporary filenames
```

### Existing credential

Existing CAIL auth should be preserved when requested.

### Other providers

Existing credentials for OpenAI, Anthropic, etc. must remain unchanged.

### Corrupt auth store

If credential storage is malformed:

* do not overwrite it
* inform user
* preserve original
* provide recovery instructions

### Permissions

On POSIX systems, verify credential file permissions are appropriately restrictive when our code is responsible for a write.

---

# 33. API validation tests

Mock:

```text
GET /v1/models
```

with:

```text
200 valid models
200 empty models
200 malformed payload
401
403
429
500
timeout
DNS failure
TLS failure
aborted request
```

A 429 must not be reported as "invalid API key."

A 500 must not be reported as "invalid API key."

Network failure must not delete an existing credential.

---

# 34. Node version tests

Verify:

```text
22.18.0 → reject
22.19.0 → accept
22.19.1 → accept
23.x → accept
24.x → accept
26.x → accept unless Pi itself imposes a newer compatibility restriction
```

Never assume the globally installed Homebrew/npm Node is the one executing the installer.

Use:

```text
process.execPath
```

in diagnostics.

---

# 35. Platform tests

Command resolution:

```text
darwin:
  npm
  npx
  pi

linux:
  npm
  npx
  pi

win32:
  npm.cmd
  npx.cmd
  pi.cmd
```

Test Windows paths containing spaces.

Do not construct commands through string concatenation.

---

# 36. Windows settings tests

Test:

* settings absent
* settings exists
* defaultTools absent
* defaultTools already explicitly configured
* unrelated settings preserved
* malformed JSON
* custom `PI_CODING_AGENT_DIR`
* backup behavior

Never overwrite an explicit user's tool selection.

---

# 37. CI

GitHub Actions matrix:

```text
ubuntu-latest
macos-latest
windows-latest
```

Node:

```text
22.19.x
24.x
```

Windows tests must run in PowerShell.

Production CAIL keys should not be necessary for normal CI.

Use mocked CAIL APIs.

Have a separately protected optional integration test for the live CAIL service.

---

# 38. Manual acceptance tests

Before workshop deployment test:

```text
macOS + zsh
Windows 11 + Windows PowerShell
Windows 11 + PowerShell 7
Ubuntu + Bash
```

Scenarios:

```text
fresh computer
Pi absent
Pi already present
CAIL package already present
CAIL credential absent
CAIL credential valid
CAIL credential invalid
Node too old
multiple Node installations
offline network
CAIL 500 response
interrupted installation
second execution after successful installation
```

---

# 39. Update behavior

Changing the available CAIL models must not require a package update.

Pi should dynamically use:

```text
/v1/models
```

Package updates should only be needed when:

* extension code changes
* metadata logic changes
* Pi API changes
* CAIL gateway compatibility changes
* bootstrap UX changes

Users may update packages through Pi's normal extension/package update mechanisms.

The installer can optionally detect an old installed version and offer to update it.

---

# 40. Uninstall

Document:

```text
pi remove npm:@cuny-ai-lab/cail-pi
```

Windows:

```powershell
pi.cmd remove npm:@cuny-ai-lab/cail-pi
```

Do not delete the user's other Pi packages.

Be explicit about whether uninstalling the extension removes the CAIL credential.

Prefer **not** to silently delete credentials.

If providing an uninstall helper, ask:

```text
Remove your saved CUNY AI Lab API key from Pi? [y/N]
```

Default:

```text
N
```

---

# 41. README structure

README should begin with participant instructions, not developer details.

Suggested opening:

````markdown
# CUNY AI Lab × Pi

Set up Pi for the CUNY AI Lab workshop.

## Windows PowerShell

```powershell
npx.cmd @cuny-ai-lab/cail-pi
````

## macOS / Linux

```bash
npx @cuny-ai-lab/cail-pi
```

The installer will:

* set up Pi through LazyPi
* install the CUNY AI Lab provider
* ask for your CUNY AI Lab API key
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

````

After that add:

- prerequisites
- troubleshooting
- Windows notes
- privacy/security
- updates
- uninstall
- developer documentation

---

# 42. Important implementation principle

Do not reinvent Pi functionality unnecessarily.

Use Pi for:

```text
credential persistence where possible
provider lifecycle
model catalog persistence
/model
OpenAI-compatible API handling
model refresh
package installation
package updates
````

Our package is responsible for:

```text
workshop bootstrap
CAIL provider registration
CAIL authentication UX
CAIL credential validation
dynamic CAIL model discovery
CAIL metadata enrichment
Windows-friendly setup
diagnostics
```

---

# 43. Definition of done

The implementation is complete when the following experience works on a clean Windows 11 machine with Node >=22.19:

```powershell
npx.cmd @cuny-ai-lab/cail-pi
```

The participant gets LazyPi.

Pi is installed.

The CAIL Pi package is installed.

The terminal then asks:

```text
CUNY AI Lab API key:
```

The participant pastes the key.

The pasted key is not displayed.

The installer validates it through:

```text
https://tools.ailab.gc.cuny.edu/v1/models
```

The credential is safely stored as Pi's `cail` credential.

The dynamic CAIL catalog is refreshed.

The participant runs:

```powershell
pi.cmd
```

and then:

```text
/model
```

and can immediately select a CUNY AI Lab model.

No `/login` is required in the normal path.

No `.zshrc` edit is required.

No PowerShell profile edit is required.

No execution-policy change is required.

No WSL installation is required.

No static CAIL `models.json` is required.

Changing the CAIL model roster does not require republishing the npm package.

The same package works on macOS with:

```bash
npx @cuny-ai-lab/cail-pi
```

and Linux with the same command.

No API key is exposed through:

```text
stdout
stderr
process arguments
shell history
settings.json
models.json
source code
Git
```

Repeated execution is safe.

---

# 44. Implementation order for Codex

Implement in this order:

1. Inspect the current Pi provider, package, and authentication APIs.
2. Create npm package skeleton.
3. Implement platform-safe process execution.
4. Implement Node/npm preflight.
5. Implement LazyPi invocation.
6. Implement Pi self-installation.
7. Implement the CAIL provider.
8. Implement `/v1/models` dynamic discovery.
9. Implement secure hidden API-key prompt.
10. Implement API-key validation.
11. Determine the best supported way to persist the `cail` credential through Pi.
12. Implement credential persistence.
13. Implement model refresh after authentication.
14. Implement existing-credential detection.
15. Implement safe Windows settings merge.
16. Implement diagnostics and `--doctor`.
17. Investigate CAIL machine-readable model metadata.
18. Implement metadata enrichment.
19. Add unit tests.
20. Add secret-leak tests.
21. Add Windows/macOS/Linux CI.
22. Test on clean Windows and macOS environments.
23. Write participant-first README.
24. Run `npm pack --dry-run`.
25. Review packaged files for credentials or unwanted content.
26. Publish only after all acceptance tests pass.

Before coding against Pi internals, inspect the current installed Pi release and official source.

Do not copy assumptions from older `@mariozechner/*` Pi examples if the current `@earendil-works/*` API has changed.
