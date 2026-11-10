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
| Server | `server/server.ts`, `server/security.ts`, `server/api.ts`, `server/events.ts`, `server/static.ts` | `anvil serve`: the board's HTTP server, API and change feed |

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

The CLI, the web board and several Claude Code sessions may write at the same time.

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

## The local server

`anvil serve` starts a plain `node:http` server on `127.0.0.1:4747` (no dependencies). It serves
the built board from `ui-dist/`, a JSON API under `/api` and a Server-Sent Events stream of
changes. The API reads the data space afresh on every request with the same functions as the
CLI, so the board always shows what is on disk.

**Who may talk to it.** Listening on 127.0.0.1 keeps other machines out, but any page open in the
browser can still send requests to localhost. Every request is checked (`server/security.ts`):

- **Host** must be `127.0.0.1:<port>` or `localhost:<port>`. This defeats DNS rebinding, where a
  foreign domain resolves to 127.0.0.1.
- **Origin** and **Sec-Fetch-Site**, when the browser sends them, must say the request comes from
  the board itself; `same-site` is refused too, because another app on another localhost port
  is a different origin. No CORS headers are ever sent.
- **API requests carry a session token** in the `X-Anvil-Token` header. A new random token
  (256 bits) is made on each start and printed in the URL fragment (`#token=…`). Browsers never
  send the fragment to a server or put it in a Referer, and the board moves it to
  `sessionStorage`. Tokens are compared in constant time.
- **Request bodies must be JSON** (`415` otherwise), so a plain HTML form cannot post to it.
- Every response carries a strict Content-Security-Policy (`'self'` only, no framing),
  `nosniff` and `no-referrer`. API responses are `no-store`.

Static files are limited to known types inside `ui-dist/`, never dotfiles; paths without an
extension are app routes and get `index.html`. Until the board is built, a placeholder page says
so.

**Development.** `npm start` in `ui/` runs Angular's dev server on `127.0.0.1:4200` and
proxies `/api` to `anvil serve` on 4747, rewriting the `Origin` header so the server's origin
check still passes.

**Read API.** `GET /api/space` (projects with counts per status, validation problems, `readOnly`
when the space does not validate, and a `stamp` that changes with any file), `/api/items`
(`?project=`, `?all=1` adds cancelled and archived items), `/api/items/<id>` (an id or alias;
body, steps and child tasks), `/api/items/<id>/history` (its commits through moves and
archiving, from `git log --follow`), `/api/projects/<id>/journal[/<date>]`, `/api/search?q=`
and `/api/git` (unpushed commits, uncommitted files, and `stale` when there is no upstream, 10
or more unpushed commits, or the oldest one is 2 days old). Item responses carry an `ETag` made
from the file's modification time; `If-None-Match` gets a `304`. Errors are
`{ "error": "…" }`; a data space that cannot be read answers `503`.

**Write API** (`server/writes.ts`). Each route calls the same operation as the matching CLI
command and commits the touched paths the same way, so the board can never write what
`anvil validate` would reject:

| Route | Operation |
| --- | --- |
| `POST /api/items` | `item create` (answers `201`) |
| `PATCH /api/items/<id>` | `item set`; lists as arrays, `null` removes a field |
| `POST /api/items/<id>/status` | `item status`; `done` without evidence saves `confirmed by user (board)` |
| `POST /api/items/<id>/move` | `item move` |
| `POST /api/items/<id>/promote` | `project promote` |
| `POST /api/items/<id>/steps` | `step add` |
| `POST /api/items/<id>/steps/<n>` | `step check`, `uncheck` or `skip` (`action`) |
| `POST /api/projects/<id>/journal` | `journal add` |
| `POST /api/projects/<id>/release` | `project release` (`dryRun` for the preview) |

- Routes on an item need `If-Match` with the ETag the board last saw (`428` without it). If the
  file changed since, the answer is `409` with the current item under `current`, and nothing is
  written; the board shows it in the "changed on disk" dialog. A change between the request's
  read and its write is caught by the write path's own modification-time check, with the same
  answer.
- While the data space does not validate, every write answers `423`: the board is read-only
  until `anvil validate` passes.
- A successful write returns the operation's result, the `commit` (or why there was none) and
  the changed `item` with its new ETag. A failed commit does not undo the write; it is reported.
- Bad bodies answer `400` (unknown fields included, to catch typos), broken rules `422` with the
  same message as the CLI, bodies over 256 KiB `413`. Request handling is asynchronous only
  while the body arrives; each operation then runs synchronously, so two board requests never
  interleave their writes.

**Changes on disk.** `GET /api/events` is an event stream fed by a recursive `fs.watch` of the
data space (`server/events.ts`). It sends `hello` with `{ watching }` on connect, then `change`
with the paths that changed, debounced. An empty `paths` list means "reload everything": Windows
sends events without a name when many files change at once (a git commit). Hidden temp files of atomic writes and `.git/` are
ignored. If watching is unavailable or fails, it sends `mode` with `{ watching: false }` and the
board polls `/api/space` every 5 seconds, comparing `stamp`. Because the stream also needs the
token header, the board reads it with `fetch` instead of `EventSource`, which cannot send
headers.

## The board

The board is an Angular 22.2 app in `ui/` (standalone components, signals, zoneless change
detection), with its own `package.json`, lockfile and `.npmrc`. It is the one build-time
exception to "no build step": `npm run build` writes it to `ui-dist/`, which is committed, so a
clone can run `anvil serve` without installing anything. The production build has no hashed file
names and is deterministic; CI rebuilds it and fails when the committed copy differs. After
`ng build`, `ui/scripts/normalize-eol.ts` rewrites CRLF line endings as LF (some third-party
licence texts ship with CRLF), so the output has the same bytes on every system.

- `core/`: the API client (`api.ts`, which adds the token header), the change feed
  (`change-feed.ts`, Server-Sent Events read with `fetch`), the store (`space-store.ts`: the
  space overview and git status as signals, refreshed on each change, polling every 5 seconds
  when the feed says it cannot watch), the token (`token.ts`) and the theme (`theme.ts`).
- `shell/`: the sidebar, the top bar, and the locked screen shown without a valid token.
- `shared/`: icons (the design's own SVG paths, no icon package), the logo, the dialogs and the
  notices (screen reader announcements and visible errors).
- `pages/`: one folder per route, lazy-loaded. `pages/project/` holds the board.

**The project board.** One column per status (cancelled on demand), a card per item, and the
selected item (`?item=AB-1` in the URL, so a reload keeps it) in a panel beside the board.
`project-board.ts` owns the board's state and every change it makes:

- **Moving** a card: drag it to another column, press Shift ← → on it (or in the panel), or
  pick a status in the panel. Cards are buttons; after a keyboard move the focus follows the card
  and the move is announced. Released is never a target: only publishing a release gets there.
- **What a move needs** comes first, in a dialog: a reason for blocked and cancelled; for done,
  the unchecked steps and open tasks if there are any (and nothing is sent), otherwise optional
  evidence. Without it the server saves `confirmed by user (board)`. After the last open task of
  a feature or bug closes, the board offers to close the parent too, never on its own.
- **Steps** are checkboxes; skipping one asks for the reason. The panel also adds steps, moves an
  item to another project and cancels it.
- **One change at a time.** Changes queue up: each waits for the previous one's dialog, write
  and reload, then acts on the item as it is by then. Each write's answer replaces the item with
  its new ETag at once. So quick key presses move a card one column each, and the board never
  sends a stale ETag or trips over its own changes.
- **Conflicts.** A `409` opens the "changed on disk" dialog with the differences between the
  item the board had and the one on disk (`itemDiff`), then reloads. Nothing was overwritten.
- **Read-only.** While the data space does not validate, cards cannot be dragged, the panel's
  controls are disabled and a notice says why.

Dialogs use the native modal `<dialog>`: the browser traps the focus, makes the page behind it
inert and closes it with Escape. Item bodies are shown as paragraphs and lists built from data,
never as HTML, with mentions of other items turned into links.

**The token** reaches the page in the fragment. `main.ts` moves it to `sessionStorage` and
removes it from the address bar before the router starts, so it never shows in the URL again,
in history or in bookmarks. A new tab needs the printed link again.

**Fonts** come from `@fontsource-variable` packages and are bundled into `ui-dist/media/`: the
board never loads anything from another origin, which the Content-Security-Policy enforces.

**Theme**: dark (Graphite) or light (Bone) tokens in `ui/src/styles.scss`. The board follows
the system until the user picks one; the choice is kept in `localStorage`.

**Tests**: Vitest unit tests through `ng test`, and Playwright end-to-end tests (`ui/e2e/`; the
item tests run in order, each leaving the data as the next expects)
that start the real `anvil serve` over a git copy of `examples/` and drive the built board in
the Chrome already installed on the machine or CI runner, so no browser is downloaded.

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
- `test/server.test.ts` and `test/server-writes.test.ts` start real servers on free ports over
  made-up data spaces and check the security rules with raw HTTP requests (foreign Host, Origin
  and Sec-Fetch-Site, missing token, path traversal), the read and write API, conflicts, history
  and git status, and the change feed.
- `npm run check` (types, tests and the example data space) must pass before any change is done.
