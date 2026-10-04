# Implementation notes

> **Historical.** This is the specification for the `npx @cuny-ai-lab/cail-pi` installer (0.1–0.2), which was replaced by a Pi package installed with `pi install npm:@cuny-ai-lab/cail-pi`. The README describes the current design.

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

## Still to do before the workshop

* Run the manual acceptance matrix in `SPEC.md` §38 on Windows 11 (Windows PowerShell and PowerShell 7) and Ubuntu.
* Create the `@cuny-ai-lab` npm organisation / grant publish rights, then `npm publish --access public`.
* Optionally set `CAIL_LIVE_TEST_KEY` as a protected repository secret for the live CI job.
