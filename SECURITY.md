# Security

anvil is a local tool. The CLI only reads and writes files in your data space, and the board
(`anvil serve`) is a small web server on your own machine. This page says what the board protects
against, what it does not, and how to report a problem.

## The local board

A server on `127.0.0.1` cannot be reached from other machines, but **any web page open in your
browser can try to send requests to it**. Browsers are starting to ask before a public site talks
to `localhost` (Chrome's Local Network Access, Firefox's local network permission), but not all
of them do, and a permission granted once stays granted. So `anvil serve` treats every request as
suspect until it proves it comes from the board:

| Threat | Protection |
| --- | --- |
| Another site posting to the board (CSRF) | `Origin` and `Sec-Fetch-Site` must name the board itself, `same-site` included; bodies must be JSON, which a plain form cannot send; no CORS headers |
| DNS rebinding (a foreign domain resolving to 127.0.0.1) | the `Host` header must be `127.0.0.1:<port>` or `localhost:<port>` |
| Requests without the board | every API call carries a 256-bit token in the `X-Anvil-Token` header, new on each start, compared in constant time |
| The token leaking | it arrives in the URL fragment (`#token=…`), which browsers never send to a server or put in a Referer; the board moves it to `sessionStorage` and removes it from the address bar |
| Script injection from item text (copied from issues or web pages) | the board shows every text as text, never as HTML; links only become anchors when they are `http(s)`; a strict Content-Security-Policy allows nothing from other origins and no framing |
| Paths outside the data space | ids are validated, static files are confined to `ui-dist/`, writes never leave the data space |
| Overwriting changes made elsewhere (by you, an editor or Claude) | every write sends the version it saw (`If-Match`); if the file changed, nothing is written and the board shows the difference |
| Writing data that breaks the format | each write runs the same validation as the CLI; while the data space does not validate, the board is read-only |

Details are in [docs/architecture.md](docs/architecture.md#the-local-server).

## What you should do

- **Keep the board's link to yourself.** Anyone with the token can change your data while the
  server runs. Each start makes a new one; stop the server (Ctrl C) when you are done.
- **Never expose the port.** Do not forward it, tunnel it or put it behind a proxy reachable from
  other machines. anvil is built for one person on one machine.
- **Keep your data space in a private repository**, and push it: the board warns when the only
  copy is on your machine and pushes only when you press "Push now" (the current branch to its
  upstream, never with force). The CLI and the Claude Code plugin never push. `anvil doctor` checks that the remote is
  private, using the GitHub CLI when it is installed.
- **Never put secrets in items.** They are plain Markdown in a git repository.

## Not covered

- Software already running on your machine as your user can read your files and the token. The
  board does not defend against it.
- The board does not encrypt anything: the data space is plain files, protected by your system's
  file permissions and your git host.
- Browsers that are not up to date, or extensions with access to every page, can bypass the
  browser protections the board relies on.

## Reporting a vulnerability

Please report it privately through GitHub: on this repository, **Security → Report a
vulnerability**. Do not open a public issue. Include what you found, how to reproduce it and the
version (commit) you used. You will get an answer as soon as possible; this is a personal
project, so please allow a few days.
