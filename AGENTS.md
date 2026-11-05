# cail-pi agent notes

Product and developer documentation is in README.md.

## Releases and how people update

Pi installs npm packages into its own npm folder (`~/.pi/agent/npm`) and records each one with npm's default caret range, for example `"@cuny-ai-lab/cail-pi": "^0.4.0"`. The two Pi commands people use treat that record differently:

- `pi install npm:@cuny-ai-lab/cail-pi` on a machine that already has the package passes the bare name to npm, which keeps the recorded range. It picks up newer releases inside the range and reports "up to date" for anything outside it, and Pi still prints "Installed". While the package is 0.x, every minor release (0.4 to 0.5) is outside the range.
- `pi update --extensions`, `pi update --all` and `pi update npm:@cuny-ai-lab/cail-pi` ask npm for `@latest` and always reach the newest release. Plain `pi update`, which Pi's own update notice suggests, updates only Pi.

This kept fall-workshop users on 0.3.0, which offers only API-key login, after 0.4.0 added Sign in with CUNY AI Lab: they reran `pi install` and were told they were up to date. The README and the website guide therefore give the install command as `pi install npm:@cuny-ai-lab/cail-pi@latest`. `@latest` makes npm fetch the newest release on new and existing setups alike. Pi does not treat it as pinned, so its package update notice still covers the package, and `pi update` and `pi remove` with the bare name still match the entry. Keep `@latest` in any install instruction.

Observed with Pi 1.5.0 in November 2026: in `dist/core/package-manager.js`, `installNpm` passes the bare spec and `updateNpmBatch` passes `<name>@latest`. Check again if Pi changes how it installs packages.
