# Architecture

How anvil is built, for anyone changing it. The data format itself is described in
[format.md](format.md).

## Principles

- **State lives in files, history in git.** An item file holds only its current state; git keeps
  every change. Anything that can be derived (the next id, a task's flavour, release notes) is
  derived instead of stored.
- **One source for each fact.** The JSON Schemas define the shape of the data; the same
  validation runs in `anvil validate` and before every write.
- **Local and private.** anvil runs on the user's machine, never writes outside the data space,
  and refuses a data space inside its own (public) repository.
- **No runtime dependencies.** Only `node:` modules. The code is TypeScript that Node runs
  directly, so cloning the repository is enough to use it.

## TypeScript without a build

Node 24 and later strip type annotations when they load a `.ts` file. anvil relies on that:
there is no compiler output and no `dist/` folder, and `bin/anvil.ts` is the real entry point.
Two consequences shape the code:

- Only erasable syntax is allowed (`erasableSyntaxOnly` in `tsconfig.json`): no `enum`,
  `namespace`, parameter properties or decorators.
- Relative imports name the `.ts` file, and type-only imports use `import type`.

`tsc` runs only to check the types (`npm run typecheck`, part of `npm run check`). TypeScript and
`@types/node` are development dependencies; users never install them.

## Modules

| Layer | Modules | Role |
| --- | --- | --- |
| Entry | `bin/anvil.ts`, `src/cli.ts` | Parse arguments, pick the command, print, map errors to exit codes |
| Commands | `store.ts`, `projects.ts`, `maintenance.ts`, `init.ts`, `briefing.ts`, `doctor.ts`, `migrate.ts` | One function per operation |
| Model | `types.ts`, `rules.ts`, `validate.ts`, `json-schema.ts` | The data model, status and closing rules, validation |
| Files | `space.ts`, `item.ts`, `frontmatter.ts`, `registry.ts` | Reading a data space; parsing and writing items and `projects.json` |
| System | `data-dir.ts`, `fsutil.ts`, `git.ts`, `errors.ts` | Finding the data space, safe writes, git, error types |

Commands never print and never call `process.exit`: they return a result, and `cli.ts` decides
how to show it (`--json` or text). That keeps every command testable in-process.

## The write path

Every command that changes data follows the same steps:

1. **Read** the whole data space once (`openSpace`): registry, items, journal notes, plus each
   file's modification time.
2. **Build** the new state in memory.
3. **Validate** it with the same checks as `anvil validate` (`itemProblems`,
   `referenceProblems`, `registryProblems`, `closeBlockers`). If anything fails, nothing is
   written.
4. **Write** each file atomically: a temp file, then a rename. If the file changed on disk since
   step 1 (someone edited it, or another session wrote it), the write is refused with a
   `ConflictError`.
5. **Commit** exactly the paths the command touched, deletions included, with a message such as
   `AB-3: todo → doing`. Never `git add -A`. git runs without a shell, with fixed arguments.

Pushing is left to the user.

## Several writers

The CLI, the future web board and several Claude Code sessions may write at the same time.

- **New ids** come from the files themselves (the highest number in use, archive and aliases
  included, plus one). Files are created in exclusive mode, so two writers can never both
  create `AB-12`: the second gets an error and tries `AB-13`.
- **Edits** are protected by the modification-time check in the write path.
- **git's index lock** is retried with a growing delay when another git process holds it.
- **Windows** file locks from editors or antivirus software (`EPERM`, `EBUSY`) are retried too.
- **Other machines:** writers on different machines only meet when the user pulls. A duplicate
  id that arrives that way is reported by `anvil validate`.

## Keeping personal data out

The tool is public and every user's data is private, so the repository guards itself in layers:

1. anvil refuses to work on a data space inside its own repository (`assertOutsideTool`), except
   the made-up one in `examples/`, and never writes outside the data space.
2. `.gitignore` lists the names of data space files.
3. The pre-commit hook (`.githooks/pre-commit`, activated with `npm run hooks`) runs
   `scripts/check-leaks.ts --staged`, which reads the staged content of each file and rejects
   item files, `projects.json` registries and anything under `projects/<id>/items`, `archive` or
   `journal` outside `examples/` (`src/leak-guard.ts`). It then runs gitleaks on the staged
   changes when gitleaks is installed. The hook is a two-command shell script because git runs
   hooks by file name, and Node only strips types from `.ts` files.
4. CI runs the same check on every tracked file (`npm run leaks`, part of `npm run check`) and
   gitleaks on the whole history, with a pinned and checksum-verified gitleaks binary.
5. `anvil doctor` warns when the hook is not active in the clone anvil runs from, and checks
   with `gh` that the data repository is private.

## Errors and exit codes

| Code | Meaning | Error type |
| --- | --- | --- |
| 0 | Done | |
| 1 | A rule or the data prevents it (also: `validate` found problems) | `AnvilError`, `ConflictError` |
| 2 | The command line is wrong, or no data space was found | `UsageError`, `DataDirError` |

`anvil briefing` always exits with 0: it runs from a Claude Code session hook, which must never
break a session.

## Tests

- `node:test`, one test file per module, all data made up and written to temp folders.
- Tests that commit create a real git repository with a made-up identity.
- `test/item.test.ts` checks that every example item survives a parse and a write byte for
  byte, so rewriting an item only changes what a command meant to change.
- `npm run check` (types, tests and the example data space) must pass before any change is done.
