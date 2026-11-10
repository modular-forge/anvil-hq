// Argument parsing and command dispatch. Commands return an exit code (read-only commands) or a
// result with the paths they touched (commands that write, committed here). Nothing here calls
// process.exit, so main() can be tested in-process.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { detectProject, briefing } from './briefing.js';
import { DataDirError, TOOL_ROOT, resolveDataDir } from './data-dir.js';
import { doctor } from './doctor.js';
import { AnvilError, UsageError } from './errors.js';
import { commitPaths } from './git.js';
import { initSpace } from './init.js';
import { serializeItem } from './item.js';
import { archiveItems, search } from './maintenance.js';
import { migrate } from './migrate.js';
import { createProject, linkProject, promoteIdea, releaseProject, scaffoldProject } from './projects.js';
import { OPEN_STATUSES } from './rules.js';
import {
  CREATE_STATUSES, SETTABLE_FIELDS, addJournal, addStep, changeStep, createItem, getItem, getProject, listJournal,
  moveItem, openSpace, setFields, setStatus,
} from './store.js';
import { childrenOf, validateSpace } from './validate.js';

const GLOBAL_OPTIONS = {
  data: { type: 'string' },
  json: { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h', default: false },
  version: { type: 'boolean', short: 'v', default: false },
};

const STATUS_ORDER = ['doing', 'blocked', 'todo', 'backlog', 'done', 'released', 'cancelled'];
const PROJECT_OPTIONS = {
  prefix: { type: 'string' }, name: { type: 'string' }, kind: { type: 'string' }, release: { type: 'string' },
};

// Each command: usage, summary, args (a trailing ? marks an optional one), options, and one of
//   standalone: run({ values, args, io }) → exit code, without opening the data space;
//   read:       run({ ctx, values, args, io }) → exit code;
//   default:    run({ ctx, values, args, io, now }) → { paths, message, … }, committed afterwards.
const COMMANDS = {
  init: {
    usage: 'init [<path>] [--demo] [--default] [--git-email <email>] [--git-name <name>]',
    summary: 'Create a data space (default: the current folder) and make it the default on this machine',
    args: ['path?'],
    options: { demo: { type: 'boolean', default: false }, default: { type: 'boolean', default: false }, 'git-email': { type: 'string' }, 'git-name': { type: 'string' } },
    standalone: true,
    run: runInit,
  },
  validate: {
    usage: 'validate',
    summary: 'Check the whole data space against the format rules',
    standalone: true,
    run: runValidate,
  },
  doctor: {
    usage: 'doctor',
    summary: 'Check format, git identity, unpushed commits and that the data remote is private',
    standalone: true,
    run: runDoctor,
  },
  briefing: {
    usage: 'briefing [--project <id>]',
    summary: 'Summary of the open items of the current repository\'s project, for a session hook',
    options: { project: { type: 'string' } },
    standalone: true,
    run: runBriefing,
  },
  search: {
    usage: 'search "<text>" [--project <id>] [--all]',
    summary: 'Search items and journal notes; archived items only with --all',
    args: ['text'],
    options: { project: { type: 'string' }, all: { type: 'boolean', default: false } },
    read: true,
    run: runSearch,
  },
  archive: {
    usage: 'archive [--dry-run]',
    summary: 'Move items that have been in their final status for archiveAfterDays to the archive',
    options: { 'dry-run': { type: 'boolean', default: false } },
    run: ({ ctx, values, now }) => archiveItems(ctx, now, { dryRun: values['dry-run'] }),
    print: (r) => (r.archived.length
      ? r.archived.map((a) => `${a.id}: ${a.from} → ${a.to}`).join('\n')
      : `Nothing has been in its final status for ${r.days} days.`),
  },
  migrate: {
    usage: 'migrate',
    summary: 'Upgrade the data space to the current format version',
    run: ({ ctx }) => migrate(ctx),
    print: (r) => (r.from === r.to ? `Already at format version ${r.to}.` : `Migrated from format version ${r.from} to ${r.to}.`),
  },
  'project create': {
    usage: 'project create <id> --prefix <XX> --kind <kind> --release <versioned|none> [--name] [--summary] [--state] [--repo owner/name]… [--notion <url>] [--scaffold]',
    summary: 'Add a project to projects.json, optionally with its starting items',
    args: ['id'],
    options: {
      ...PROJECT_OPTIONS, summary: { type: 'string' }, state: { type: 'string' }, repo: { type: 'string', multiple: true },
      notion: { type: 'string' }, scaffold: { type: 'boolean', default: false },
    },
    run: ({ ctx, values, args, now }) => {
      const created = createProject(ctx, { ...values, id: args.id, repos: values.repo ?? [] });
      if (!values.scaffold) return created;
      const scaffold = scaffoldProject(openSpace(ctx.dir), args.id, now);
      return { ...created, created: scaffold.created, paths: [...created.paths, ...scaffold.paths] };
    },
    print: (r) => `Created project ${r.id}${r.created ? ` with ${r.created.length} starting item(s)` : ''}`,
  },
  'project scaffold': {
    usage: 'project scaffold <id>',
    summary: 'Create the starting items of the project\'s kind; skips titles it already has',
    args: ['id'],
    run: ({ ctx, args, now }) => scaffoldProject(ctx, args.id, now),
    print: (r) => `Created ${r.created.length ? r.created.join(', ') : 'nothing'} from the ${r.template ?? 'missing'} template${r.skipped.length ? `; skipped ${r.skipped.length} existing title(s)` : ''}`,
  },
  'project promote': {
    usage: 'project promote <idea-id> --id <id> --prefix <XX> --kind <kind> --release <versioned|none> [--name]',
    summary: 'Turn an idea into a new project in state idea, with the idea as its first item',
    args: ['idea'],
    options: { ...PROJECT_OPTIONS, id: { type: 'string' } },
    run: ({ ctx, values, args, now }) => promoteIdea(ctx.dir, args.idea, values, now),
    print: (r) => `Created project ${r.id}; the idea is now ${r.item}${r.created.length ? `, plus ${r.created.length} starting item(s)` : ''}`,
  },
  'project release': {
    usage: 'project release <id> <version> [--exclude <item>]… [--out <file>] [--dry-run]',
    summary: 'Mark the done items as released in a version and print the release notes',
    args: ['id', 'version'],
    options: { exclude: { type: 'string', multiple: true }, out: { type: 'string' }, 'dry-run': { type: 'boolean', default: false } },
    run: runRelease,
    print: (r) => `${r.dryRun ? 'Would release' : 'Released'} ${r.released.join(', ')} in ${r.version}${r.out ? `; notes written to ${r.out}` : `\n\n${r.notes}`}`,
  },
  'project link': {
    usage: 'project link [--id <id>] [--prefix <XX> --kind <kind> --release <versioned|none>] [--name] [--state]',
    summary: 'Register the project of the current git repository, or add the repository to it',
    options: { ...PROJECT_OPTIONS, id: { type: 'string' }, state: { type: 'string' } },
    run: ({ ctx, values, io }) => linkProject(ctx, io.cwd, values),
  },
  'item create': {
    usage: 'item create <project> --kind <kind> --title "…" [--status] [--parent] [--priority] [--labels a,b] [--body "…"] [--step "…"]…',
    summary: 'Create an item; prints its id',
    args: ['project'],
    options: {
      kind: { type: 'string' }, title: { type: 'string' }, status: { type: 'string' }, parent: { type: 'string' },
      priority: { type: 'string' }, labels: { type: 'string' }, body: { type: 'string' }, step: { type: 'string', multiple: true },
    },
    run: ({ ctx, values, args, now }) => {
      for (const name of ['kind', 'title']) if (!values[name]) throw new UsageError(`item create needs --${name}`);
      return createItem(ctx, { project: args.project, ...values, steps: values.step ?? [] }, now);
    },
    print: (r) => `Created ${r.id} (${r.file})`,
  },
  'item show': {
    usage: 'item show <id>',
    summary: 'Show an item, its steps and its child tasks',
    args: ['id'],
    read: true,
    run: runShow,
  },
  'item list': {
    usage: 'item list [--project <id>] [--status <status>]… [--kind <kind>] [--label <label>] [--all]',
    summary: 'List items; cancelled and archived ones only with --all',
    options: {
      project: { type: 'string' }, status: { type: 'string', multiple: true }, kind: { type: 'string' },
      label: { type: 'string' }, all: { type: 'boolean', default: false },
    },
    read: true,
    run: runList,
  },
  'item status': {
    usage: 'item status <id> <status> [--reason "…"] [--evidence "…"] [--release <version>]',
    summary: 'Change the status, applying the closing rules',
    args: ['id', 'status'],
    options: { reason: { type: 'string' }, evidence: { type: 'string' }, release: { type: 'string' } },
    run: ({ ctx, values, args, now }) => setStatus(ctx, args.id, args.status, values, now),
  },
  'item set': {
    usage: `item set <id> ${SETTABLE_FIELDS.map((f) => `[--${f} <value>]`).join(' ')}`,
    summary: 'Change fields; an empty value removes the field, lists are comma-separated',
    args: ['id'],
    options: Object.fromEntries(SETTABLE_FIELDS.map((field) => [field, { type: 'string' }])),
    run: ({ ctx, values, args }) => setFields(ctx, args.id, pick(values, SETTABLE_FIELDS)),
  },
  'item move': {
    usage: 'item move <id> <project>',
    summary: 'Move an item, and its child tasks, to another project',
    args: ['id', 'project'],
    run: ({ ctx, args }) => moveItem(ctx, args.id, args.project),
    print: (r) => `Moved ${r.moved.map(([from, to]) => `${from} → ${to}`).join(', ')}`,
  },
  'step add': {
    usage: 'step add <id> "<text>"',
    summary: 'Add an unchecked step',
    args: ['id', 'text'],
    run: ({ ctx, args }) => addStep(ctx, args.id, args.text),
  },
  'step check': {
    usage: 'step check <id> <n>',
    summary: 'Check step n',
    args: ['id', 'n'],
    run: ({ ctx, args }) => changeStep(ctx, args.id, stepNumber(args.n), 'check'),
  },
  'step uncheck': {
    usage: 'step uncheck <id> <n>',
    summary: 'Uncheck step n (a skipped step gets its plain text back)',
    args: ['id', 'n'],
    run: ({ ctx, args }) => changeStep(ctx, args.id, stepNumber(args.n), 'uncheck'),
  },
  'step skip': {
    usage: 'step skip <id> <n> --reason "…"',
    summary: 'Strike out step n as no longer needed',
    args: ['id', 'n'],
    options: { reason: { type: 'string' } },
    run: ({ ctx, values, args }) => changeStep(ctx, args.id, stepNumber(args.n), 'skip', values.reason),
  },
  'journal add': {
    usage: 'journal add <project> "<text>"',
    summary: "Append a timestamped entry to today's note",
    args: ['project', 'text'],
    run: ({ ctx, args, now }) => addJournal(ctx, args.project, args.text, now),
  },
  'journal list': {
    usage: 'journal list <project>',
    summary: 'List the notes of a project, newest first',
    args: ['project'],
    read: true,
    run: ({ ctx, values, args, io }) => {
      const notes = listJournal(ctx, args.project);
      io.stdout.write(values.json ? `${JSON.stringify(notes, null, 2)}\n` : notes.map((n) => `${n.date}  ${n.file}\n`).join(''));
      return 0;
    },
  },
};

/** Runs the CLI with `argv` (without node and script) and returns the exit code. */
export async function main(argv, options = {}) {
  const io = { stdout: process.stdout, stderr: process.stderr, env: process.env, cwd: process.cwd(), now: () => new Date(), ...options };
  try {
    return await dispatch(argv, io);
  } catch (error) {
    if (error instanceof UsageError || error instanceof DataDirError) {
      io.stderr.write(`anvil: ${error.message}\n`);
      return 2;
    }
    if (error instanceof AnvilError) {
      io.stderr.write(`anvil: ${error.message}\n`);
      return 1;
    }
    throw error;
  }
}

async function dispatch(argv, io) {
  // A lenient first pass finds the command, so global options may come before it.
  const words = parseArgs({ args: argv, options: GLOBAL_OPTIONS, allowPositionals: true, strict: false }).positionals;
  const name = [`${words[0]} ${words[1]}`, words[0]].find((candidate) => Object.hasOwn(COMMANDS, candidate));
  const command = COMMANDS[name];

  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: { ...GLOBAL_OPTIONS, ...command?.options }, allowPositionals: true, strict: true });
  } catch (error) {
    throw new UsageError(error.message);
  }
  const { values, positionals } = parsed;

  if (values.version) {
    io.stdout.write(`${readVersion()}\n`);
    return 0;
  }
  if (!command) {
    if (values.help) {
      io.stdout.write(usage());
      return 0;
    }
    io.stderr.write(words.length ? `anvil: unknown command "${words.slice(0, 2).join(' ')}"\n\n${usage()}` : usage());
    return 2;
  }
  if (values.help) {
    io.stdout.write(`Usage: anvil ${command.usage}\n\n${command.summary}\n`);
    return 0;
  }
  const args = bindArgs(command, positionals.slice(name.split(' ').length));

  if (command.standalone) return command.run({ values, args, io });
  const { dir } = resolveDataDir({ flag: values.data, env: io.env, cwd: io.cwd });
  const ctx = openSpace(dir);
  if (command.read) return command.run({ ctx, values, args, io });

  const result = command.run({ ctx, values, args, io, now: io.now() });
  const commit = result.paths.length ? commitPaths(dir, result.paths, result.message) : null;
  if (values.json) {
    io.stdout.write(`${JSON.stringify({ ...result, commit }, null, 2)}\n`);
    return 0;
  }
  io.stdout.write(`${command.print ? command.print(result) : result.message}\n`);
  if (commit) io.stdout.write(commit.committed ? `Committed ${commit.hash}\n` : `Not committed: ${commit.reason}\n`);
  if (result.hint) io.stdout.write(`Hint: ${result.hint}\n`);
  return 0;
}

function bindArgs(command, given) {
  const expected = command.args ?? [];
  const required = expected.filter((arg) => !arg.endsWith('?')).length;
  if (given.length < required || given.length > expected.length) {
    const shown = expected.length ? expected.map((a) => (a.endsWith('?') ? `[<${a.slice(0, -1)}>]` : `<${a}>`)).join(' ') : 'no arguments';
    throw new UsageError(`expected ${shown}\nUsage: anvil ${command.usage}`);
  }
  return Object.fromEntries(expected.map((arg, i) => [arg.replace(/\?$/, ''), given[i]]));
}

function runInit({ values, args, io }) {
  const result = initSpace(resolve(io.cwd, args.path ?? '.'), {
    demo: values.demo, setDefault: values.default, gitEmail: values['git-email'], gitName: values['git-name'], env: io.env,
  });
  if (values.json) {
    io.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }
  io.stdout.write(`Created a data space in ${result.dir}${result.demo ? ' with the demo projects' : ''}\n`);
  io.stdout.write(result.commit.committed ? `Committed ${result.commit.hash}\n` : `Not committed: ${result.commit.reason}\n`);
  io.stdout.write(result.config.written
    ? `Default data space on this machine: ${result.dir} (${result.config.file})\n`
    : `The default data space on this machine is still ${result.config.data}; use --default to change it.\n`);
  io.stdout.write('Next: keep it in a private repository, for example: git remote add origin <url> && git push -u origin main\n');
  return 0;
}

function runValidate({ values, io }) {
  const { dir } = resolveDataDir({ flag: values.data, env: io.env, cwd: io.cwd });
  const { errors, stats } = validateSpace(dir);
  if (values.json) {
    io.stdout.write(`${JSON.stringify({ ok: errors.length === 0, errors, stats }, null, 2)}\n`);
  } else if (errors.length === 0) {
    io.stdout.write(`OK: ${stats.projects} project(s), ${stats.items} item(s) in ${dir}\n`);
  } else {
    for (const { file, message } of errors) io.stdout.write(`${file}: ${message}\n`);
    const files = new Set(errors.map((e) => e.file)).size;
    io.stdout.write(`\n${errors.length} problem(s) in ${files} file(s)\n`);
  }
  return errors.length === 0 ? 0 : 1;
}

function runDoctor({ values, io }) {
  const { dir } = resolveDataDir({ flag: values.data, env: io.env, cwd: io.cwd });
  const results = doctor(dir);
  if (values.json) {
    io.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
  } else {
    const marks = { ok: 'ok  ', warn: 'warn', fail: 'FAIL' };
    for (const r of results) io.stdout.write(`${marks[r.status]}  ${r.check.padEnd(11)} ${r.detail}\n`);
  }
  return results.some((r) => r.status === 'fail') ? 1 : 0;
}

/** Never fails: a session hook must not break a session. Problems go to stderr only. */
function runBriefing({ values, io }) {
  try {
    const { dir } = resolveDataDir({ flag: values.data, env: io.env, cwd: io.cwd });
    const ctx = openSpace(dir);
    const project = values.project ? getProject(ctx, values.project) : detectProject(ctx, io.cwd);
    if (project) io.stdout.write(briefing(ctx, project));
  } catch (error) {
    io.stderr.write(`anvil briefing: ${error.message}\n`);
  }
  return 0;
}

function runSearch({ ctx, values, args, io }) {
  if (values.project) getProject(ctx, values.project);
  const { items, journal } = search(ctx, args.text, { project: values.project, includeArchive: values.all });
  if (values.json) {
    io.stdout.write(`${JSON.stringify({ items, journal }, null, 2)}\n`);
    return 0;
  }
  if (!items.length && !journal.length) io.stdout.write('No matches.\n');
  for (const r of items) io.stdout.write(`${r.id}  ${r.status.padEnd(9)} ${r.title}${r.archived ? ' (archived)' : ''}\n`);
  for (const hit of journal) io.stdout.write(`${hit.file}:${hit.line}  ${hit.text}\n`);
  return 0;
}

function runRelease({ ctx, values, args, now }) {
  const out = values.out && resolve(values.out);
  if (out && existsSync(out)) throw new AnvilError(`${out} already exists; anvil does not overwrite it (print the notes and paste them instead)`);
  const dryRun = values['dry-run'];
  const result = releaseProject(ctx, args.id, args.version, { exclude: values.exclude ?? [], dryRun }, now);
  if (out && !dryRun) writeFileSync(out, `${result.notes}\n`, { flag: 'wx' });
  return { ...result, out: dryRun ? undefined : out };
}

function runShow({ ctx, values, args, io }) {
  const entry = getItem(ctx, args.id);
  const children = childrenOf(entry, ctx.space.items, ctx.byId).map((child) => ({
    id: child.item.fields.id, status: child.item.fields.status, title: child.item.fields.title,
  }));
  if (values.json) {
    const { fields, body, steps } = entry.item;
    io.stdout.write(`${JSON.stringify({ file: entry.file, project: entry.project, archived: entry.archived, fields, body, steps, children }, null, 2)}\n`);
    return 0;
  }
  io.stdout.write(`# ${entry.file}${entry.archived ? ' (archived)' : ''}\n${serializeItem(entry.item)}`);
  if (children.length) {
    io.stdout.write(`\nChild tasks:\n${children.map((c) => `  ${c.id}  ${c.status.padEnd(9)} ${c.title}\n`).join('')}`);
  }
  return 0;
}

function runList({ ctx, values, io }) {
  if (values.project && !ctx.projects.has(values.project)) throw new AnvilError(`unknown project "${values.project}"`);
  const rows = ctx.space.items
    .filter((entry) => {
      const { fields } = entry.item;
      if (!values.all && (entry.archived || fields.status === 'cancelled')) return false;
      if (values.project && entry.project !== values.project) return false;
      if (values.status && !values.status.includes(fields.status)) return false;
      if (values.kind && fields.kind !== values.kind) return false;
      return !values.label || (fields.labels ?? []).includes(values.label);
    })
    .map((entry) => {
      const { fields, steps } = entry.item;
      const done = steps.filter((s) => s.checked).length;
      return { id: fields.id, project: entry.project, status: fields.status, kind: fields.kind, title: fields.title, steps: steps.length ? `${done}/${steps.length}` : '', archived: entry.archived };
    })
    .sort((a, b) => a.project.localeCompare(b.project)
      || STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)
      || Number(a.id.split('-')[1]) - Number(b.id.split('-')[1]));

  if (values.json) {
    io.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
  } else if (rows.length === 0) {
    io.stdout.write('No items.\n');
  } else {
    const width = Math.max(...rows.map((r) => r.id.length));
    for (const r of rows) {
      io.stdout.write(`${r.id.padEnd(width)}  ${r.status.padEnd(9)} ${r.kind.padEnd(8)} ${r.title}${r.steps ? ` [${r.steps}]` : ''}${r.archived ? ' (archived)' : ''}\n`);
    }
  }
  return 0;
}

function usage() {
  const lines = Object.entries(COMMANDS).map(([name, c]) => `  ${name.padEnd(16)} ${c.summary}`);
  return `Usage: anvil <command> [options]

Commands:
${lines.join('\n')}

Run "anvil <command> --help" for its options.

Global options:
  --data <path>  Data space to use (default: ANVIL_DATA, user config, or search upwards)
  --json         Machine-readable output
  -h, --help     Show help
  -v, --version  Show the version

New items start as ${CREATE_STATUSES.join(', ')}. Open statuses: ${OPEN_STATUSES.join(', ')}.
`;
}

function stepNumber(text) {
  if (!/^[1-9][0-9]*$/.test(text)) throw new UsageError(`"${text}" is not a step number`);
  return Number(text);
}

function pick(values, keys) {
  return Object.fromEntries(keys.filter((key) => values[key] !== undefined).map((key) => [key, values[key]]));
}

function readVersion() {
  return JSON.parse(readFileSync(join(TOOL_ROOT, 'package.json'), 'utf8')).version;
}
