# anvil-hq

A local, dependency-free project manager for one person and many projects. Projects, tasks,
features, bugs, decisions and ideas live as JSON and Markdown files in a git repository of your
own, so every change has history and a backup. The `anvil` command reads and writes them, a local
web board shows them, and Claude Code sessions share the same state through it.

> **Status:** early development. The data format and the `validate` command work; the rest of
> the CLI, the web board and the Claude Code integration are not built yet.

## Requirements

- Node.js 24 or later. No `npm install`: anvil uses only modules built into Node.
- git.

## Quick start

```bash
git clone https://github.com/modular-forge/anvil-hq.git
cd anvil-hq
npm link                                   # optional: puts `anvil` on your PATH
anvil validate --data examples             # or: node bin/anvil.js validate --data examples
```

The name `anvil` clashes with the `anvil` command of Foundry (Ethereum). If you have Foundry
installed, skip `npm link` and add an alias instead, for example `alias av='node /path/to/anvil-hq/bin/anvil.js'`
(bash/zsh) or `function av { node C:\path\to\anvil-hq\bin\anvil.js @args }` (PowerShell).

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

```bash
npm test                    # unit tests (node:test)
npm run validate:examples   # the example data space must always be valid
```

## License

[MIT](LICENSE)
