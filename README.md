# anvil-hq

A local, dependency-free project manager for one person and many projects. Projects, tasks,
features, bugs, decisions and ideas live as JSON and Markdown files in a git repository of your
own, so every change has history and a backup. The `anvil` command reads and writes them, a local
web board shows them, and Claude Code sessions share the same state through it.

> **Status:** early development. The CLI works; the web board and the Claude Code integration
> are not built yet.

## Requirements

- Node.js 24 or later. No `npm install`: anvil is written in TypeScript that Node runs directly
  (it strips the types when loading a file), and it uses only modules built into Node.
- git.

## Quick start

```bash
git clone https://github.com/modular-forge/anvil-hq.git
cd anvil-hq
npm link                                   # optional: puts `anvil` on your PATH
anvil validate --data examples             # or: node bin/anvil.ts validate --data examples
```

The name `anvil` clashes with the `anvil` command of Foundry (Ethereum). If you have Foundry
installed, skip `npm link` and add an alias instead, for example `alias av='node /path/to/anvil-hq/bin/anvil.ts'`
(bash/zsh) or `function av { node C:\path\to\anvil-hq\bin\anvil.ts @args }` (PowerShell).

## Getting started with your own data

```bash
anvil init ~/dev/my-anvil-data --git-email you@users.noreply.github.com --git-name "Your Name"
cd ~/dev/my-anvil-data
git remote add origin git@github.com:you/my-anvil-data.git   # create it PRIVATE and empty first
git push -u origin main

anvil project create blog --prefix BL --kind web --release none --scaffold
anvil item create blog --kind feature --title "Comments"
anvil item create blog --kind task --title "Store comments" --parent BL-6 --step "Schema" --step "API"
anvil item status BL-7 doing
anvil step check BL-7 1
anvil doctor                                                  # is everything committed, pushed and private?
```

`anvil init` makes the new data space the default on this machine, so the other commands find it
from any folder. Each change is committed for you; pushing stays a manual step (`git push`).

## Concepts

- **Projects** live in `projects.json`, each with an id, an item prefix (`BL`), a state, a kind
  (`web`, `mobile`, `server`, `tooling`) and a release mode: `versioned` projects publish done
  items in versions, `none` projects are finished when items are done.
- **Items** are Markdown files with a small header: tasks, features and bugs (which group
  tasks), decisions and ideas. Ideas without a project go to the `inbox`; decisions that affect
  every project go to `general`.
- **Statuses:** `backlog`, `todo`, `doing`, `blocked` (with a reason), `done` (with evidence),
  `released` (in a version) and `cancelled` (with a reason).
- **Steps** are the checkboxes in an item's body. An item with unchecked steps, or a feature with
  open tasks, cannot be done. A step that is no longer needed is skipped with a reason.
- **History** is git: an item stores only its current state and the date it got there. Finished
  items are archived after 60 days, never deleted.

The full rules are in [docs/format.md](docs/format.md).

## Commands

```bash
anvil init [<path>] [--demo]                              # new data space, default on this machine
anvil project create <id> --prefix AB --kind web --release none [--scaffold]
anvil project scaffold <id>                               # starting items from the kind's template
anvil project promote <idea-id> --id <id> --prefix AB --kind mobile --release versioned
anvil project release <id> <version> [--exclude AB-7]… [--dry-run] [--out notes.md]
anvil project link                                        # register the current repository
anvil item create <project> --kind task --title "…" [--parent AB-3] [--step "…"]…
anvil item list [--project <id>] [--status doing]… [--all]
anvil item show <id>
anvil item status <id> doing
anvil item status <id> done --evidence "https://github.com/…/pull/12"
anvil item status <id> blocked --reason "…"
anvil item set <id> --priority high --labels ui,forms     # an empty value removes a field
anvil item move <id> <project>                            # new id, old one kept as an alias
anvil step add <id> "…" | step check <id> <n> | step uncheck <id> <n> | step skip <id> <n> --reason "…"
anvil journal add <project> "…" | journal list <project>
anvil search "…" [--all]                                  # items and journal; --all adds the archive
anvil archive [--dry-run]                                 # archive what is final for archiveAfterDays
anvil briefing                                            # open items of the current repo's project
anvil validate | anvil doctor | anvil migrate
```

`anvil doctor` checks the format, the git identity, unpushed commits, the pre-commit hook of your
anvil-hq clone and, through the [GitHub CLI](https://cli.github.com/) (`gh`) if installed, that
your data repository is private.

Every command accepts `--json`. Commands that change data validate the result first, write it
atomically and commit only the files they touched to the data space's git repository. Run
`anvil <command> --help` for the options of each command.

## Your data

Keep your data in a **separate, private** git repository, never inside this one: anvil refuses to
run on a data space inside its own repository (except the fake one in `examples/`). anvil finds
your data space in this order:

1. the `--data <path>` option;
2. the `ANVIL_DATA` environment variable;
3. the user configuration file (`%APPDATA%\anvil\config.json` on Windows,
   `$XDG_CONFIG_HOME/anvil/config.json` or `~/.config/anvil/config.json` elsewhere), with
   `{ "data": "<path>" }`;
4. the nearest folder, from the current one upwards, that holds a `projects.json` data registry.

The format is described in [docs/format.md](docs/format.md) and checked by the JSON Schemas in
[schema/](schema/). [examples/](examples/) holds a complete data space with made-up data.

## Development

Development needs two pinned dev dependencies (TypeScript and the Node type definitions) to
check the types; using anvil does not.

```bash
npm ci                      # dev dependencies only, install scripts disabled in .npmrc
npm run hooks               # once per clone: activates the pre-commit hook
npm run check               # type check, unit tests, example data space and personal-data check
npm run typecheck           # tsc, no output files
npm test                    # unit tests (node:test)
```

This repository is public, so personal data must never reach it. Three layers guard it:

1. **The pre-commit hook** (`.githooks/pre-commit`) rejects any staged file that looks like a data
   space (an item file, a `projects.json` registry, or a file under `projects/<id>/items`,
   `archive` or `journal`) outside `examples/`, and runs [gitleaks](https://github.com/gitleaks/gitleaks)
   on the staged changes if it is installed.
2. **CI** runs the same personal-data check on every tracked file and gitleaks on the whole
   history, on every push and pull request. It is an alarm, not a barrier: when it fires, the
   file is already pushed.
3. **`anvil doctor`** warns when the hook is not active in your clone.

CI also runs `npm run check` on Linux and Windows with Node 24 and 26. Its actions are pinned by
full commit SHA.

How the code is organised, and why, is in [docs/architecture.md](docs/architecture.md).

## License

[MIT](LICENSE)
