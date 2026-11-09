// Argument parsing and command dispatch. Commands return an exit code; nothing here calls
// process.exit, so main() can be tested in-process.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { DataDirError, TOOL_ROOT, resolveDataDir } from './data-dir.js';
import { AnvilError, UsageError } from './errors.js';
import { commitPaths } from './git.js';
import { serializeItem } from './item.js';
import { OPEN_STATUSES } from './rules.js';
import {
  CREATE_STATUSES, SETTABLE_FIELDS, addJournal, addStep, changeStep, createItem, getItem, listJournal,
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

const COMMANDS = {
  validate: {
    usage: 'validate',
    summary: 'Check the whole data space against the format rules',
    run: runValidate,
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
    print: (result) => `Created ${result.id} (${result.file})`,
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
    print: (result) => `Moved ${result.moved.map(([from, to]) => `${from} → ${to}`).join(', ')}`,
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

  const given = positionals.slice(name.split(' ').length);
  const expected = command.args ?? [];
  if (given.length !== expected.length) {
    throw new UsageError(`expected ${expected.length ? expected.map((a) => `<${a}>`).join(' ') : 'no arguments'}\nUsage: anvil ${command.usage}`);
  }
  const args = Object.fromEntries(expected.map((arg, i) => [arg, given[i]]));

  if (name === 'validate') return command.run({ values, io });
  const { dir } = resolveDataDir({ flag: values.data, env: io.env, cwd: io.cwd });
  const ctx = openSpace(dir);
  if (command.read) return command.run({ ctx, values, args, io });

  const result = command.run({ ctx, values, args, io, now: io.now() });
  const commit = commitPaths(dir, result.paths, result.message);
  if (values.json) {
    io.stdout.write(`${JSON.stringify({ ...result, commit }, null, 2)}\n`);
  } else {
    io.stdout.write(`${command.print ? command.print(result) : result.message}\n`);
    io.stdout.write(commit.committed ? `Committed ${commit.hash}\n` : `Not committed: ${commit.reason}\n`);
    if (result.hint) io.stdout.write(`Hint: ${result.hint}\n`);
  }
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
  const lines = Object.values(COMMANDS).map((c) => `  ${c.usage.split(' ').slice(0, 2).join(' ').padEnd(14)} ${c.summary}`);
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
