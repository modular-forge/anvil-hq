# Data format

This is the public contract of an anvil data space, format version 1. It is checked by the JSON
Schemas in [`schema/`](../schema/) and by `anvil validate`, and [`examples/`](../examples/) is a
complete data space that follows it.

## Layout

```txt
<data space>/
  projects.json                   registry and settings
  templates/<kind>.json           optional: replaces the built-in starting items of a kind
  projects/<project>/items/       one Markdown file per item: <id>.md
  projects/<project>/archive/<year>/   items moved out by `anvil archive`
  projects/<project>/journal/     session notes, one file per day: YYYY-MM-DD.md
```

- `inbox` (prefix `IN`) and `general` (prefix `GN`) are fixed areas with the same layout as a
  project. They are not listed in `projects.json`. `inbox` holds ideas and problems that have no
  project yet; `general` holds decisions that affect every project.
- Folders are created when first needed, never in advance.
- A data space is a git repository of its own, kept private. anvil refuses to work on a data
  space inside its own repository.

## `projects.json`

```json
{
  "$schema": "../anvil-hq/schema/projects.schema.json",
  "schemaVersion": 1,
  "archiveAfterDays": 60,
  "projects": [
    { "id": "bakery-site", "prefix": "BS", "name": "Bakery site", "summary": "Website for a bakery",
      "state": "active", "kind": "web", "release": "none", "repos": ["example-org/bakery-site"] }
  ]
}
```

| Field | Required | Content |
| --- | --- | --- |
| `schemaVersion` | yes | Format version, `1`. `anvil migrate` upgrades older data |
| `archiveAfterDays` | no | Days in a final status before an item is archived. Default 60 |
| `projects[].id` | yes | Folder name: lowercase letters, digits and hyphens. Not `inbox` or `general` |
| `projects[].prefix` | yes | Item id prefix: 2 to 4 capital letters, unique. Not `IN` or `GN` |
| `projects[].name` | yes | Display name |
| `projects[].summary` | no | One line |
| `projects[].state` | yes | `idea`, `planning`, `design`, `active`, `paused`, `done` or `cancelled` |
| `projects[].kind` | yes | `web`, `mobile`, `server` or `tooling`. Picks the template of starting items |
| `projects[].release` | yes | `versioned` (items are released in versions) or `none` (`done` is final) |
| `projects[].repos` | no | Git repositories as `owner/name`. anvil recognises a clone by its remote |
| `projects[].notion` | no | URL of the project's page |

No local paths: they differ on every machine. A clone is recognised by its git remote or by an
optional `.anvil.json` file at its root with `{ "project": "<id>" }`.

## Items

An item is a Markdown file named after its id, with a header between two `---` lines:

```markdown
---
id: BS-3
title: "Send orders by email: one message per order"
kind: task
status: doing
since: 2026-10-14
created: 2026-09-28
parent: BS-1
links: [https://example.com/docs/forms]
---
- [x] Pick a form-to-email service
- [ ] Email template with the order lines
- [x] ~~Spam protection~~ (skipped: the service filters spam)
```

### Header syntax

The header is a flat subset of YAML: one `key: value` per line, nothing nested.

- Every value is text. Dates are `YYYY-MM-DD`.
- Lists use the flow style: `labels: [content, urgent]`, or `[]` when empty.
- A value may be wrapped in double quotes (JSON escapes) or single quotes (`''` for a quote).
  anvil quotes any value a YAML parser could misread, such as `release: "1.10"` (YAML reads
  `1.10` as the number 1.1), `no`, `null`, or a title containing `: `. Hand-written files should
  do the same.
- Values fit on one line. Comments, multi-line values and nested structures are not supported.

### Fields

| Field | Required | Content |
| --- | --- | --- |
| `id` | yes | Project prefix, a hyphen and a number: `BS-12`. The next number comes from the existing files, archive included; there is no stored counter |
| `title` | yes | Short title, up to 200 characters |
| `kind` | yes | `task`, `feature`, `bug`, `decision` or `idea` |
| `status` | yes | See [Statuses](#statuses) |
| `since` | yes | Date of the last status change. The rest of the history is in git |
| `created` | yes | Creation date |
| `priority` | no | `high`, `medium` or `low` |
| `reason` | no | Why the item is `blocked` or `cancelled` (required then) |
| `evidence` | no | What proves the item is done: a URL (pull request, CI run) or text such as `confirmed by user`. `anvil item status <id> done` requires it; the web board does not, since the user's own action is the evidence |
| `release` | no | Version the item was released in (required with `released`, forbidden otherwise) |
| `parent` | no | Feature or bug of the same project that a task belongs to. Only tasks have a parent |
| `related` | no | Related items, from any project |
| `labels` | no | Free labels: lowercase letters, digits and hyphens |
| `links` | no | URLs: pull requests, commits, documentation… |
| `aliases` | no | Former ids, kept when the item moved to another project |
| `supersededBy` | no | Decision that replaces this one. Only on decisions |

A task's flavour comes from its parent: under a feature it is feature work, under a bug it is a
fix, and without a parent it is maintenance. There is no field for it.

### Kinds

- `task`: a unit of work.
- `feature`: new functionality; groups tasks.
- `bug`: something broken. Groups tasks or is worked on directly; its body records symptoms,
  cause and fix.
- `decision`: a decision with its context and reason. It can be replaced by a newer one
  (`supersededBy`).
- `idea`: something to evaluate. A problem is an idea with the label `problem`.

### Statuses

| Status | Meaning |
| --- | --- |
| `backlog` | Noted, no commitment |
| `todo` | Next up |
| `doing` | In progress |
| `blocked` | Stopped; needs a `reason` |
| `done` | Finished, with evidence |
| `released` | Published in a version (`release`). Only in `versioned` projects, never for decisions or ideas |
| `cancelled` | Will not be done; needs a `reason` |

Decisions and ideas accept every status except `released`.

### Steps

Steps are the task-list checkboxes of the body (`- [ ]` and `- [x]`), numbered from 1 in order.
Checkboxes inside fenced code blocks are not steps.

- A step that is no longer needed is struck through with its reason:
  `- [x] ~~text~~ (skipped: reason)`. It counts as resolved and stays visible.
- If a step needs a status of its own (it can be blocked or discussed), it becomes a separate
  task of the feature instead.

### Closing rules

- An item with unchecked steps cannot be `done` or `released`.
- A feature or a bug cannot be `done` or `released` while any of its child tasks is open
  (`backlog`, `todo`, `doing` or `blocked`). Its status is set by hand, never computed.
- Cancelling never requires anything to be finished.

### Final statuses and archiving

An item is in its final status when it is `released` (in a `versioned` project), `done` (in other
projects, and always for decisions and ideas) or `cancelled`. `anvil archive` moves items that
have been in their final status for `archiveAfterDays` days, counted from `since`, to
`archive/<year>/`. Items are never deleted. Decisions still in force are never archived; only
superseded or cancelled ones are.

## Journal

`projects/<project>/journal/YYYY-MM-DD.md` holds free Markdown notes for that day, with no
header. `anvil journal add` appends an entry under a `## HH:MM` heading. Search includes the
journal.

## Templates

`kind` picks a template of starting items, applied by `anvil project scaffold`. anvil ships one
per kind in `templates/<kind>.json`; a data space can replace one with its own
`templates/<kind>.json`. Scaffolding never overwrites an existing item. The template format is
documented with the `project scaffold` command.
