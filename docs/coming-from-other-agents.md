# Coming from Claude Code, Codex or Cursor

Pi is a separate program with its own settings folder. You can install it next to Claude Code, Codex or Cursor and use any of them in the same project. This page explains how an existing setup carries over to Pi with CUNY AI Lab models. It was checked against Pi 1.5.2 and 1.0.2 in November 2026. For details, follow the links to Pi's own documentation.

## Running Pi next to other tools

Pi keeps its settings, saved keys, sessions and installed packages in `~/.pi/agent` (on Windows, `%USERPROFILE%\.pi\agent`). In a project, it reads its own settings from a `.pi` folder. Pi does not read or change `~/.claude`, `~/.codex` or Cursor's settings. This package writes only inside `~/.pi/agent`: Pi saves your CUNY AI Lab key in `auth.json`, and on Windows the package turns on the PowerShell tool in `settings.json`. Pi's installer can also install Node.js for Pi and offers to add Pi to your `PATH`.

You can use Pi and another agent in the same repository. They do not know about each other, so avoid running two of them on the same files at the same time, and commit or review changes before switching.

One difference matters from the first session: Pi does not ask before it runs a command or edits a file. Work in a repository with git, or in a copy of your files. Pi's [security page](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/security.md) explains the options, and the [permission-gate example](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/permission-gate.ts) shows how an extension can ask for confirmation before risky commands.

## Instruction files

When Pi starts, and again after `/reload`, it reads one instruction file from `~/.pi/agent`, then one from each folder on the path from the top of the disk down to the folder where you started Pi. In each folder it takes the first of these that exists:

1. `AGENTS.override.md`
2. `AGENTS.md`
3. `CLAUDE.md`

In practice:

* A project that has only a `CLAUDE.md` works in Pi without changes.
* In a folder with both `AGENTS.md` and `CLAUDE.md`, Pi reads `AGENTS.md` and ignores `CLAUDE.md`.
* Pi reads instruction files only from the start folder and the folders above it. A `CLAUDE.md` or `AGENTS.md` in a subfolder below the start folder is not read. Start Pi from the top folder of the project.
* Pi does not read `.claude/CLAUDE.md`, `CLAUDE.local.md` or `.claude/rules/`.
* Pi passes the file to the model as written. An `@path` import line in a `CLAUDE.md` is not expanded; the model sees the line itself, not the imported file.
* Instruction files load even when you decline [project trust](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/security.md#understand-project-trust). Read them in repositories you did not write.

### One file for every tool

For a repository that people use with different agents, keep the shared instructions in `AGENTS.md`:

* Pi and Codex read `AGENTS.md`.
* Claude Code 2.1.277 and later reads `AGENTS.md` when the project has no `CLAUDE.md`.
* When you need instructions for Claude Code alone, add a `CLAUDE.md` next to `AGENTS.md` that starts with the line `@AGENTS.md` and puts the Claude Code notes below it. Claude Code reads both files. Pi reads only `AGENTS.md`, so the Claude Code notes never reach Pi.
* A `CLAUDE.md` that is a symbolic link to `AGENTS.md` also works if you have no Claude-only notes.

Avoid keeping two hand-edited copies of the same instructions. They drift apart.

## Personal and project instructions

| Claude Code | Pi |
|---|---|
| `~/.claude/CLAUDE.md` | `~/.pi/agent/AGENTS.md` |
| `CLAUDE.md` in the project | `AGENTS.md` (or `CLAUDE.md`) in the project |
| `CLAUDE.local.md` | `AGENTS.override.md`, which replaces the file in its own folder |

Pi does not read `~/.claude/CLAUDE.md`. To use the same personal instructions in both tools on macOS or Linux, link the file into Pi's folder:

```bash
ln -s ~/.claude/CLAUDE.md ~/.pi/agent/AGENTS.md
```

Check it first for instructions that only make sense in Claude Code.

`AGENTS.override.md` takes the place of the `AGENTS.md` or `CLAUDE.md` in the same folder; files in other folders still load. You can use it for a personal version of a project's instructions. Keep it out of git with `.gitignore`. Claude Code does not read it.

Pi has two more files that most people will not need:

* `SYSTEM.md` replaces Pi's built-in instructions to the model. Your `AGENTS.md` files and skills are still added after it.
* `APPEND_SYSTEM.md` adds text to Pi's built-in instructions.

Each can live in `~/.pi/agent` or in the project's `.pi` folder. The project file is used instead of the personal one, and only in a project you have trusted. See [Configuration](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/configuration.md).

## Skills, commands and MCP

| Claude Code | Pi |
|---|---|
| Skills in `~/.claude/skills/` and `.claude/skills/` | [Skills](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md) in `~/.pi/agent/skills/` and `.pi/skills/`, or `~/.agents/skills/` and `.agents/skills/`. Same `SKILL.md` format. Run one directly with `/skill:name`. |
| Custom slash commands in `.claude/commands/` | [Prompt templates](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/prompt-templates.md) in `~/.pi/agent/prompts/` and `.pi/prompts/`. `$ARGUMENTS` and `$1` work. The file name is the command name. |
| MCP servers | [Built in](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/mcp.md): `pi mcp add`, `~/.pi/agent/mcp.json` and `.pi/mcp.json`. An existing `mcpServers` entry can be copied as it is. |
| Hooks | [Extensions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md), written in TypeScript |
| Subagents, plan mode | Not included. Pi ships [examples](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/examples/extensions) of both (`subagent/`, `plan-mode/`), and the [package gallery](https://pi.dev/packages) lists others. |
| `/model`, `/compact`, `/resume`, `/login` | The same commands |

Pi can also read your Claude Code skills and commands where they are. Add their folders to `~/.pi/agent/settings.json`:

```json
{
  "skills": ["~/.claude/skills"],
  "prompts": ["~/.claude/commands"]
}
```

For a project's own folders, put `{"skills": ["../.claude/skills"], "prompts": ["../.claude/commands"]}` in `.pi/settings.json`; paths there start from the `.pi` folder. Skills and commands written for Claude Code can mention tools Pi does not have, such as subagents. Read them before relying on them. Pi's own tools are `read`, `bash`, `edit` and `write`, plus `grep`, `find` and `ls` if you turn them on.

Everything in a project's `.pi` folder and `.agents/skills/` loads only after you trust the project, and Pi looks for `.pi` only in the folder where you started it.

This package recommends two community packages for tools that Claude Code has built in: [pi-web-access](https://www.npmjs.com/package/pi-web-access) for web search and [pi-ask-user](https://www.npmjs.com/package/pi-ask-user) for questions with choices. Step 4 of the [README](../README.md#set-up) installs them.

## Instructions for CUNY AI Lab models

CUNY AI Lab models are open-weight models served through the lab's Gateway. Unless you have saved a default model, Pi starts on the newest DeepSeek Flash (DeepSeek V4.1 Flash, `deepseek-v4.1-flash-1017`, in November 2026); GLM 5.3 (`glm-5.3`) is another choice in `/model`. The [model catalog](https://tools.ailab.gc.cuny.edu/v1/catalog) lists every model with its context length and retirement date.

These models can follow a long instruction file written for Claude differently. Some changes help with any model:

* Keep `AGENTS.md` short. Put the rules that matter most at the top.
* Name exact commands and paths: "run `npm test`" instead of "run the tests".
* Write separate, plain rules instead of chains of conditions such as "if A, unless B, then C".
* Remove references to Claude Code features that Pi lacks, such as plan mode or subagents. A model may try to use a tool that is not there.
* Move long procedures into skills, which load only when a task needs them.
* Test with the model you will use. Give it a small task and see whether it follows the file. Models differ from one another as well as from Claude, so test again after switching.
