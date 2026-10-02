# Implementation notes

Findings from inspecting Pi 0.85.1 (`@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`)
and the CAIL gateway on 2026-09-16, and the decisions they drove. Section numbers refer to `SPEC.md`.

## Deviations from the spec, with reasons

| Spec | Finding | Decision |
| --- | --- | --- |
| §7 validate the key with `GET /v1/models` | `/v1/models` is **public**: it returns 200 with no key and with a bogus key. `/v1/quota` requires a valid bearer (401 on a bad key, `quota:read` scope) and performs no inference. | Validate with `GET /v1/quota`; use `/v1/models` afterwards for the model count. Statuses: 401 → invalid, 403 → forbidden, 429 → rate limited, 5xx → server error, exceptions → network error. |
| §21 refresh with `pi update --models` | `pi update --models` builds a `ModelRuntime` from `models.json` only; it does not load packages, so extension providers are not refreshed. `pi --list-models` loads packages but creates the runtime without network access. Interactive Pi refreshes catalogs after the TUI starts and on `/model`. | The extension fetches the public catalog in its async factory (Pi docs: "fetch and register models in the factory ... so the provider is available ... to `pi --list-models`"), with a 5 s timeout and `PI_OFFLINE` respected, and keeps `fetchModels` for Pi's refreshes. Setup verifies with `pi --list-models cail`. |
| §22 investigate a metadata source | The gateway's `/v1/models` already returns `name`, `task`, `capabilities` (`vision`, `reasoning`, `function-calling`), `context_length`, `pricing`, `status`, `sunset`. The public catalog page reads `/v1/catalog` (same data). | No generated metadata file. `src/cail-catalog.mjs` maps the live fields; unknown models fall back to spec §23 defaults. |
| §12 avoid `shell: true` | Node refuses to spawn `.cmd`/`.bat` without a shell (EINVAL, since the CVE-2024-27980 fix). | On win32 only, spawn plans set `shell: true` and quote each argument themselves (`windowsShellArg`). No secret is ever an argument. |
| §8 credential API | Pi has no automation login command (`pi auth` only prints/checks). `dist/core/auth-storage.js` exports `AuthStorage.create(authPath)` and imports cleanly from the global install. | Option 3: dynamic import from the installed Pi. Option 4 fallback writer kept for machines where the import fails. Pi applies 0600 only on file creation, so the installer chmods after a Pi-store write too. |
| §3 peer dependencies | npm 7+ auto-installs peers, which would pull a second Pi into the `npx` cache. Pi installs packages with `--legacy-peer-deps`. | Peers declared with `peerDependenciesMeta.optional = true`. |

## Extension resolution inside Pi

Package extensions import `@earendil-works/pi-ai` through Pi's jiti aliases (root, `/compat`,
`/oauth`, `/providers/all`). Other subpaths are not aliased and the package is not installed next to
the extension, so the extension imports from `@earendil-works/pi-ai/compat`, which re-exports
`createProvider`, `envApiKeyAuth`, and `openAICompletionsApi`.

## Tool support filter

Pi sends its tool definitions on every request. The gateway answers
`400 capability_unsupported` for models whose catalog entry lacks `function-calling`
(observed with `gemma-3-12b-it`). The mapper therefore drops models with known capabilities
that exclude function calling (57 → 41 on 2026-09-16). Models with no capability data are kept.

## Verified on this machine (macOS, Pi 0.85.1)

* `pi install <local path>` into an isolated `PI_CODING_AGENT_DIR`, then `pi --list-models cail`: 41 models listed with live context windows and reasoning flags.
* `pi -p --model cail/qwen3-coder-next` and `cail/gpt-oss-20b` answer through the provider.
* Stored credential via Pi's `AuthStorage` (env var hidden from Pi): other providers preserved, file mode 0600, `pi --list-models cail` still lists the models.
* `--doctor` against the isolated profile reports every check without printing the key.
* Unit suite: `npm test` (mocked gateway), 97 tests.

## Pi 1.0 (2026-10-01)

* `createProvider`, `envApiKeyAuth`, and `fetchModels` are unchanged. The root `@earendil-works/pi-ai` export still lacks `openAICompletionsApi`, and the extension loader aliases only root, `/compat`, `/oauth`, and `/providers/all`, so the extension stays on `/compat` (Pi's own 1.0 provider example does the same).
* Pi 0.99 added `+name` / `-name` entries to `defaultTools`. On Windows the installer now writes `["-bash", "+powershell"]` when the setting is absent and appends `"+powershell"` to a list the participant chose, instead of skipping it. A list that already names `powershell` in any form is left alone.
* Older Pi would misread those entries, so `MIN_PI_VERSION` is 1.0.0: setup runs `pi update --self` below it and stops with instructions if that fails, and `--doctor` flags it.
* `pi update --all` upgrades Pi and every package. On the Dell (scratch npm prefix and agent dir copied from the `nml` LazyPi setup) it went 0.85.1 → 1.0.0, then listed 41 CAIL models and answered a call. Pi 1.0 prints startup warnings for three LazyPi packages that list host modules in `dependencies`, and for `pi-mcp-adapter` overriding the new built-in MCP; neither involves this package.
* Verified 2026-10-01: unit suite on macOS and Windows (117 pass, 3 live skipped), live suite 3/3, installer from 0.85.1 with automatic update on both platforms, hidden key prompt over a pty, `--doctor` all green, and the `powershell` tool executing a command on Windows under `["-bash", "+powershell"]`.

## Still to do before the workshop

* Run the manual acceptance matrix in `SPEC.md` §38 on Windows 11 (Windows PowerShell and PowerShell 7) and Ubuntu.
* Create the `@cuny-ai-lab` npm organisation / grant publish rights, then `npm publish --access public`.
* Optionally set `CAIL_LIVE_TEST_KEY` as a protected repository secret for the live CI job.
