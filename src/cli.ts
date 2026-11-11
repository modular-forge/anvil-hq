// Argument parsing and command dispatch. Commands return an exit code (read-only commands) or a
// result with the paths they touched (commands that write, committed here). Nothing here calls
// process.exit, so main() can be tested in-process.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, type ParseArgsOptionsConfig } from 'node:util';
import { audit } from './audit.ts';
import { briefing, detectProject } from './briefing.ts';
import { DataDirError, TOOL_ROOT, resolveDataDir, type Env } from './data-dir.ts';
import { doctor } from './doctor.ts';
import { AnvilError, UsageError } from './errors.ts';
import { commitPaths } from './git.ts';
import { initSpace } from './init.ts';
import { serializeItem } from './item.ts';
import { archiveItems, search, type ArchiveResult } from './maintenance.ts';
import { migrate } from './migrate.ts';
import { DEFAULT_PORT, startServer } from './server/server.ts';
import { PROJECT_SETTABLE, createProject, linkProject, promoteIdea, releaseProject, scaffoldProject, setProject, type ProjectChanges, type ReleaseResult } from './projects.ts';
import { OPEN_STATUSES } from './rules.ts';
import {
  CREATE_STATUSES, SETTABLE_FIELDS, addJournal, addStep, changeStep, createItem, getItem, getProject, listJournal,
  moveItem, openSpace, setFields, setStatus,
} from './store.ts';
import type { Change, Context } from './types.ts';
import { childrenOf, validateSpace } from './validate.ts';

export interface Writable {
  write(text: string): unknown;
}

export interface Io {
  stdout: Writable;
  stderr: Writable;
  env: Env;
  cwd: string;
  now: () => Date;
}

type Values = Record<string, string | boolean | string[] | undefined>;
type Args = Record<string, string | undefined>;

interface Invocation {
  values: Values;
  args: Args;
  io: Io;
}

/** A command result: what an operation returns, printed as JSON with --json. */
type Result = Change;

interface CommandBase {
  usage: string;
  summary: string;
  /** Positional arguments; a trailing ? marks an optional one. */
  args?: string[];
  options?: ParseArgsOptionsConfig;
}

/** Runs without opening the data space and returns an exit code. */
interface StandaloneCommand extends CommandBase {
  kind: 'standalone';
  run: (call: Invocation) => number | Promise<number>;
}

/** Reads the data space and returns an exit code. */
interface ReadCommand extends CommandBase {
  kind: 'read';
  run: (call: Invocation & { ctx: Context }) => number;
}

/** Changes the data space; its result is committed and printed. */
interface WriteCommand<R extends Result = Result> extends CommandBase {
  kind: 'write';
  run: (call: Invocation & { ctx: Context; now: Date }) => R;
  print?: (result: R) => string;
}

type Command = StandaloneCommand | ReadCommand | WriteCommand;

/** Keeps each write command's result type tied to its print function. */
function write<R extends Result>(command: Omit<WriteCommand<R>, 'kind'>): WriteCommand {
  return { kind: 'write', ...command } as unknown as WriteCommand;
}

const GLOBAL_OPTIONS = {
  data: { type: 'string' },
  json: { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h', default: false },
  version: { type: 'boolean', short: 'v', default: false },
} satisfies ParseArgsOptionsConfig;

const STATUS_ORDER = ['doing', 'blocked', 'todo', 'backlog', 'done', 'released', 'cancelled'];
const PROJECT_OPTIONS = {
  prefix: { type: 'string' }, name: { type: 'string' }, kind: { type: 'string' }, release: { type: 'string' },
} satisfies ParseArgsOptionsConfig;

const COMMANDS: Record<string, Command> = {
  init: {
    kind: 'standalone',
    usage: 'init [<path>] [--demo] [--default] [--git-email <email>] [--git-name <name>]',
    summary: 'Create a data space (default: the current folder) and make it the default on this machine',
    args: ['path?'],
    options: { demo: { type: 'boolean', default: false }, default: { type: 'boolean', default: false }, 'git-email': { type: 'string' }, 'git-name': { type: 'string' } },
    run: runInit,
  },
  validate: {
    kind: 'standalone',
    usage: 'validate',
    summary: 'Check the whole data space against the format rules',
    run: runValidate,
  },
  doctor: {
    kind: 'standalone',
    usage: 'doctor',
    summary: 'Check format, git identity, unpushed commits and that the data remote is private',
    run: runDoctor,
  },
  audit: {
    kind: 'read',
    usage: 'audit [--project <id>]',
    summary: 'Point out items that have probably fallen behind: a feature whose tasks are all closed, long stays in doing…',
    options: { project: { type: 'string' } },
    run: runAudit,
  },
  briefing: {
    kind: 'standalone',
    usage: 'briefing [--project <id>]',
    summary: "Summary of the open items of the current repository's project, for a session hook",
    options: { project: { type: 'string' } },
    run: runBriefing,
  },
  serve: {
    kind: 'standalone',
    usage: 'serve',
    summary: `Start the local board on http://127.0.0.1:${DEFAULT_PORT} and print its private URL (Ctrl+C stops it)`,
    run: runServe,
  },
  search: {
    kind: 'read',
    usage: 'search "<text>" [--project <id>] [--all]',
    summary: 'Search items and journal notes; archived items only with --all',
    args: ['text'],
    options: { project: { type: 'string' }, all: { type: 'boolean', default: false } },
    run: runSearch,
  },
  archive: write<ArchiveResult>({
    usage: 'archive [--dry-run]',
    summary: 'Move items that have been in their final status for archiveAfterDays to the archive',
    options: { 'dry-run': { type: 'boolean', default: false } },
    run: ({ ctx, values, now }) => archiveItems(ctx, now, { dryRun: bool(values, 'dry-run') }),
    print: (r) => (r.archived.length
      ? r.archived.map((a) => `${a.id}: ${a.from} → ${a.to}`).join('\n')
      : `Nothing has been in its final status for ${r.days} days.`),
  }),
  migrate: write({
    usage: 'migrate',
    summary: 'Upgrade the data space to the current format version',
    run: ({ ctx }) => migrate(ctx),
    print: (r) => (r.from === r.to ? `Already at format version ${r.to}.` : `Migrated from format version ${r.from} to ${r.to}.`),
  }),
  'project create': write({
    usage: 'project create <id> --prefix <XX> --kind <kind> --release <versioned|none> [--name] [--summary] [--state] [--repo owner/name]… [--notion <url>] [--scaffold]',
    summary: 'Add a project to projects.json, optionally with its starting items',
    args: ['id'],
    options: {
      ...PROJECT_OPTIONS, summary: { type: 'string' }, state: { type: 'string' }, repo: { type: 'string', multiple: true },
      notion: { type: 'string' }, scaffold: { type: 'boolean', default: false },
    },
    run: ({ ctx, values, args, now }) => {
      const id = arg(args, 'id');
      const created = createProject(ctx, {
        id, prefix: str(values, 'prefix'), name: str(values, 'name'), summary: str(values, 'summary'), state: str(values, 'state'),
        kind: str(values, 'kind'), release: str(values, 'release'), repos: list(values, 'repo'), notion: str(values, 'notion'),
      });
      if (!bool(values, 'scaffold')) return { ...created, created: null };
      const scaffold = scaffoldProject(openSpace(ctx.dir), id, now);
      return { ...created, created: scaffold.created, paths: [...created.paths, ...scaffold.paths] };
    },
    print: (r) => `Created project ${r.id}${r.created ? ` with ${r.created.length} starting item(s)` : ''}`,
  }),
  'project scaffold': write({
    usage: 'project scaffold <id>',
    summary: "Create the starting items of the project's kind; skips titles it already has",
    args: ['id'],
    run: ({ ctx, args, now }) => scaffoldProject(ctx, arg(args, 'id'), now),
    print: (r) => `Created ${r.created.length ? r.created.join(', ') : 'nothing'} from the ${r.template ?? 'missing'} template${r.skipped.length ? `; skipped ${r.skipped.length} existing title(s)` : ''}`,
  }),
  'project promote': write({
    usage: 'project promote <idea-id> --id <id> --prefix <XX> --kind <kind> --release <versioned|none> [--name]',
    summary: 'Turn an idea into a new project in state idea, with the idea as its first item',
    args: ['idea'],
    options: { ...PROJECT_OPTIONS, id: { type: 'string' } },
    run: ({ ctx, values, args, now }) => promoteIdea(ctx.dir, arg(args, 'idea'), {
      id: str(values, 'id'), prefix: str(values, 'prefix'), name: str(values, 'name'), kind: str(values, 'kind'), release: str(values, 'release'),
    }, now),
    print: (r) => `Created project ${r.id}; the idea is now ${r.item}${r.created.length ? `, plus ${r.created.length} starting item(s)` : ''}`,
  }),
  'project release': write<ReleaseResult & { out: string | undefined }>({
    usage: 'project release <id> <version> [--exclude <item>]… [--out <file>] [--dry-run]',
    summary: 'Mark the done items as released in a version and print the release notes',
    args: ['id', 'version'],
    options: { exclude: { type: 'string', multiple: true }, out: { type: 'string' }, 'dry-run': { type: 'boolean', default: false } },
    run: runRelease,
    print: (r) => `${r.dryRun ? 'Would release' : 'Released'} ${r.released.join(', ')} in ${r.version}${r.out ? `; notes written to ${r.out}` : `\n\n${r.notes}`}`,
  }),
  'project set': write({
    usage: `project set <id> ${PROJECT_SETTABLE.map((f) => `[--${f} <value>]`).join(' ')}`,
    summary: 'Change a project: its state (idea, planning, design, active, paused, done, cancelled), name, summary, kind or Notion link',
    args: ['id'],
    options: Object.fromEntries(PROJECT_SETTABLE.map((field) => [field, { type: 'string' }])) as ParseArgsOptionsConfig,
    run: ({ ctx, values, args }) => setProject(ctx, arg(args, 'id'), Object.fromEntries(PROJECT_SETTABLE.map((field) => [field, str(values, field)])) as ProjectChanges),
  }),
  'project link': write({
    usage: 'project link [--id <id>] [--prefix <XX> --kind <kind> --release <versioned|none>] [--name] [--state]',
    summary: 'Register the project of the current git repository, or add the repository to it',
    options: { ...PROJECT_OPTIONS, id: { type: 'string' }, state: { type: 'string' } },
    run: ({ ctx, values, io }) => linkProject(ctx, io.cwd, {
      id: str(values, 'id'), prefix: str(values, 'prefix'), name: str(values, 'name'), kind: str(values, 'kind'),
      release: str(values, 'release'), state: str(values, 'state'),
    }),
  }),
  'item create': write({
    usage: 'item create <project> --kind <kind> --title "…" [--status] [--parent] [--priority] [--labels a,b] [--body "…"] [--step "…"]…',
    summary: 'Create an item; prints its id',
    args: ['project'],
    options: {
      kind: { type: 'string' }, title: { type: 'string' }, status: { type: 'string' }, parent: { type: 'string' },
      priority: { type: 'string' }, labels: { type: 'string' }, body: { type: 'string' }, step: { type: 'string', multiple: true },
    },
    run: ({ ctx, values, args, now }) => {
      const kind = str(values, 'kind');
      const title = str(values, 'title');
      if (!kind) throw new UsageError('item create needs --kind');
      if (!title) throw new UsageError('item create needs --title');
      return createItem(ctx, {
        project: arg(args, 'project'), kind, title, status: str(values, 'status'), parent: str(values, 'parent'),
        priority: str(values, 'priority'), labels: str(values, 'labels'), body: str(values, 'body'), steps: list(values, 'step'),
      }, now);
    },
    print: (r) => `Created ${r.id} (${r.file})`,
  }),
  'item show': {
    kind: 'read',
    usage: 'item show <id>',
    summary: 'Show an item, its steps and its child tasks',
    args: ['id'],
    run: runShow,
  },
  'item list': {
    kind: 'read',
    usage: 'item list [--project <id>] [--status <status>]… [--kind <kind>] [--label <label>] [--all]',
    summary: 'List items; cancelled and archived ones only with --all',
    options: {
      project: { type: 'string' }, status: { type: 'string', multiple: true }, kind: { type: 'string' },
      label: { type: 'string' }, all: { type: 'boolean', default: false },
    },
    run: runList,
  },
  'item status': write({
    usage: 'item status <id> <status> [--reason "…"] [--evidence "…"] [--release <version>]',
    summary: 'Change the status, applying the closing rules',
    args: ['id', 'status'],
    options: { reason: { type: 'string' }, evidence: { type: 'string' }, release: { type: 'string' } },
    run: ({ ctx, values, args, now }) => setStatus(ctx, arg(args, 'id'), arg(args, 'status'), {
      reason: str(values, 'reason'), evidence: str(values, 'evidence'), release: str(values, 'release'),
    }, now),
  }),
  'item set': write({
    usage: `item set <id> ${SETTABLE_FIELDS.map((f) => `[--${f} <value>]`).join(' ')}`,
    summary: 'Change fields; an empty value removes the field, lists are comma-separated',
    args: ['id'],
    options: Object.fromEntries(SETTABLE_FIELDS.map((field) => [field, { type: 'string' }])) as ParseArgsOptionsConfig,
    run: ({ ctx, values, args }) => setFields(ctx, arg(args, 'id'),
      Object.fromEntries(SETTABLE_FIELDS.flatMap((field) => { const value = str(values, field); return value === undefined ? [] : [[field, value]]; }))),
  }),
  'item move': write({
    usage: 'item move <id> <project>',
    summary: 'Move an item, and its child tasks, to another project',
    args: ['id', 'project'],
    run: ({ ctx, args }) => moveItem(ctx, arg(args, 'id'), arg(args, 'project')),
    print: (r) => `Moved ${r.moved.map(([from, to]) => `${from} → ${to}`).join(', ')}`,
  }),
  'step add': write({
    usage: 'step add <id> "<text>"',
    summary: 'Add an unchecked step',
    args: ['id', 'text'],
    run: ({ ctx, args }) => addStep(ctx, arg(args, 'id'), arg(args, 'text')),
  }),
  'step check': write({
    usage: 'step check <id> <n>',
    summary: 'Check step n',
    args: ['id', 'n'],
    run: ({ ctx, args }) => changeStep(ctx, arg(args, 'id'), stepNumber(arg(args, 'n')), 'check'),
  }),
  'step uncheck': write({
    usage: 'step uncheck <id> <n>',
    summary: 'Uncheck step n (a skipped step gets its plain text back)',
    args: ['id', 'n'],
    run: ({ ctx, args }) => changeStep(ctx, arg(args, 'id'), stepNumber(arg(args, 'n')), 'uncheck'),
  }),
  'step skip': write({
    usage: 'step skip <id> <n> --reason "…"',
    summary: 'Strike out step n as no longer needed',
    args: ['id', 'n'],
    options: { reason: { type: 'string' } },
    run: ({ ctx, values, args }) => changeStep(ctx, arg(args, 'id'), stepNumber(arg(args, 'n')), 'skip', str(values, 'reason')),
  }),
  'journal add': write({
    usage: 'journal add <project> "<text>"',
    summary: "Append a timestamped entry to today's note",
    args: ['project', 'text'],
    run: ({ ctx, args, now }) => addJournal(ctx, arg(args, 'project'), arg(args, 'text'), now),
  }),
  'journal list': {
    kind: 'read',
    usage: 'journal list <project>',
    summary: 'List the notes of a project, newest first',
    args: ['project'],
    run: ({ ctx, values, args, io }) => {
      const notes = listJournal(ctx, arg(args, 'project'));
      io.stdout.write(bool(values, 'json') ? `${JSON.stringify(notes, null, 2)}\n` : notes.map((n) => `${n.date}  ${n.file}\n`).join(''));
      return 0;
    },
  },
};

/** Runs the CLI with `argv` (without node and script) and returns the exit code. */
export async function main(argv: string[], options: Partial<Io> = {}): Promise<number> {
  const io: Io = { stdout: process.stdout, stderr: process.stderr, env: process.env, cwd: process.cwd(), now: () => new Date(), ...options };
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

async function dispatch(argv: string[], io: Io): Promise<number> {
  // A lenient first pass finds the command, so global options may come before it.
  const words = parseArgs({ args: argv, options: GLOBAL_OPTIONS, allowPositionals: true, strict: false }).positionals;
  const name = [`${words[0]} ${words[1]}`, words[0]].find((candidate) => candidate !== undefined && Object.hasOwn(COMMANDS, candidate));
  const command = name ? COMMANDS[name] : undefined;

  let values: Values;
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({ args: argv, options: { ...GLOBAL_OPTIONS, ...command?.options }, allowPositionals: true, strict: true }));
  } catch (error) {
    throw new UsageError((error as Error).message);
  }

  if (bool(values, 'version')) {
    io.stdout.write(`${readVersion()}\n`);
    return 0;
  }
  if (!command || !name) {
    if (bool(values, 'help')) {
      io.stdout.write(usage());
      return 0;
    }
    io.stderr.write(words.length ? `anvil: unknown command "${words.slice(0, 2).join(' ')}"\n\n${usage()}` : usage());
    return 2;
  }
  if (bool(values, 'help')) {
    io.stdout.write(`Usage: anvil ${command.usage}\n\n${command.summary}\n`);
    return 0;
  }
  const args = bindArgs(command, positionals.slice(name.split(' ').length));

  if (command.kind === 'standalone') return command.run({ values, args, io });
  const { dir } = resolveDataDir({ flag: str(values, 'data'), env: io.env, cwd: io.cwd });
  const ctx = openSpace(dir);
  if (command.kind === 'read') return command.run({ ctx, values, args, io });

  const result = command.run({ ctx, values, args, io, now: io.now() });
  const commit = result.paths.length ? commitPaths(dir, result.paths, result.message) : null;
  if (bool(values, 'json')) {
    io.stdout.write(`${JSON.stringify({ ...result, commit }, null, 2)}\n`);
    return 0;
  }
  io.stdout.write(`${command.print ? command.print(result) : result.message}\n`);
  if (commit) io.stdout.write(commit.committed ? `Committed ${commit.hash}\n` : `Not committed: ${commit.reason}\n`);
  if (result.hint) io.stdout.write(`Hint: ${result.hint}\n`);
  return 0;
}

function bindArgs(command: Command, given: string[]): Args {
  const expected = command.args ?? [];
  const required = expected.filter((a) => !a.endsWith('?')).length;
  if (given.length < required || given.length > expected.length) {
    const shown = expected.length ? expected.map((a) => (a.endsWith('?') ? `[<${a.slice(0, -1)}>]` : `<${a}>`)).join(' ') : 'no arguments';
    throw new UsageError(`expected ${shown}\nUsage: anvil ${command.usage}`);
  }
  return Object.fromEntries(expected.map((a, i) => [a.replace(/\?$/, ''), given[i]]));
}

function runInit({ values, args, io }: Invocation): number {
  const result = initSpace(resolve(io.cwd, args.path ?? '.'), {
    demo: bool(values, 'demo'), setDefault: bool(values, 'default'), gitEmail: str(values, 'git-email'), gitName: str(values, 'git-name'), env: io.env,
  });
  if (bool(values, 'json')) {
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

function runValidate({ values, io }: Invocation): number {
  const { dir } = resolveDataDir({ flag: str(values, 'data'), env: io.env, cwd: io.cwd });
  const { errors, stats } = validateSpace(dir);
  if (bool(values, 'json')) {
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

function runDoctor({ values, io }: Invocation): number {
  const { dir } = resolveDataDir({ flag: str(values, 'data'), env: io.env, cwd: io.cwd });
  const results = doctor(dir);
  if (bool(values, 'json')) {
    io.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
  } else {
    const marks = { ok: 'ok  ', warn: 'warn', fail: 'FAIL' };
    for (const r of results) io.stdout.write(`${marks[r.status]}  ${r.check.padEnd(11)} ${r.detail}\n`);
  }
  return results.some((r) => r.status === 'fail') ? 1 : 0;
}

/** Starts the server and returns; the open server keeps the process running until Ctrl+C. */
async function runServe({ values, io }: Invocation): Promise<number> {
  const { dir } = resolveDataDir({ flag: str(values, 'data'), env: io.env, cwd: io.cwd });
  const server = await startServer({ dir, logError: (error) => io.stderr.write(`anvil serve: ${(error as Error).stack ?? String(error)}\n`) });
  if (bool(values, 'json')) {
    io.stdout.write(`${JSON.stringify({ url: server.url, port: server.port, dir }, null, 2)}\n`);
    return 0;
  }
  io.stdout.write(`anvil board for ${dir}\n\n  ${server.url}\n\n`);
  io.stdout.write('Open that URL in your browser. It carries a private token: do not share it. Press Ctrl+C to stop.\n');
  return 0;
}

/** Never fails: a session hook must not break a session. Problems go to stderr only. */
function runBriefing({ values, io }: Invocation): number {
  try {
    const { dir } = resolveDataDir({ flag: str(values, 'data'), env: io.env, cwd: io.cwd });
    const ctx = openSpace(dir);
    const projectId = str(values, 'project');
    const project = projectId ? getProject(ctx, projectId) : detectProject(ctx, io.cwd);
    if (project) io.stdout.write(briefing(ctx, project));
  } catch (error) {
    io.stderr.write(`anvil briefing: ${(error as Error).message}\n`);
  }
  return 0;
}

function runAudit({ ctx, values, io }: Invocation & { ctx: Context }): number {
  const project = str(values, 'project');
  if (project) getProject(ctx, project);
  const findings = audit(ctx, io.now(), { project });
  if (bool(values, 'json')) {
    io.stdout.write(`${JSON.stringify(findings, null, 2)}\n`);
    return 0;
  }
  if (!findings.length) {
    io.stdout.write('Nothing to point out.\n');
    return 0;
  }
  for (const f of findings) io.stdout.write(`${f.project}  ${f.id ?? '-'}  ${f.message}\n    ${f.hint}\n`);
  io.stdout.write(`\n${findings.length} finding(s)\n`);
  return 0;
}

function runSearch({ ctx, values, args, io }: Invocation & { ctx: Context }): number {
  const project = str(values, 'project');
  if (project) getProject(ctx, project);
  const { items, journal } = search(ctx, arg(args, 'text'), { project, includeArchive: bool(values, 'all') });
  if (bool(values, 'json')) {
    io.stdout.write(`${JSON.stringify({ items, journal }, null, 2)}\n`);
    return 0;
  }
  if (!items.length && !journal.length) io.stdout.write('No matches.\n');
  for (const r of items) io.stdout.write(`${r.id}  ${r.status.padEnd(9)} ${r.title}${r.archived ? ' (archived)' : ''}\n`);
  for (const hit of journal) io.stdout.write(`${hit.file}:${hit.line}  ${hit.text}\n`);
  return 0;
}

function runRelease({ ctx, values, args, now }: Invocation & { ctx: Context; now: Date }): ReleaseResult & { out: string | undefined } {
  const outOption = str(values, 'out');
  const out = outOption ? resolve(outOption) : undefined;
  if (out && existsSync(out)) throw new AnvilError(`${out} already exists; anvil does not overwrite it (print the notes and paste them instead)`);
  const dryRun = bool(values, 'dry-run');
  const result = releaseProject(ctx, arg(args, 'id'), arg(args, 'version'), { exclude: list(values, 'exclude'), dryRun }, now);
  if (out && !dryRun) writeFileSync(out, `${result.notes}\n`, { flag: 'wx' });
  return { ...result, out: dryRun ? undefined : out };
}

function runShow({ ctx, values, args, io }: Invocation & { ctx: Context }): number {
  const entry = getItem(ctx, arg(args, 'id'));
  const children = childrenOf(entry, ctx.space.items, ctx.byId).map((child) => ({
    id: child.item.fields.id, status: child.item.fields.status, title: child.item.fields.title,
  }));
  if (bool(values, 'json')) {
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

function runList({ ctx, values, io }: Invocation & { ctx: Context }): number {
  const project = str(values, 'project');
  const statuses = list(values, 'status');
  const kind = str(values, 'kind');
  const label = str(values, 'label');
  const all = bool(values, 'all');
  if (project && !ctx.projects.has(project)) throw new AnvilError(`unknown project "${project}"`);
  const rows = ctx.space.items
    .filter((entry) => {
      const { fields } = entry.item;
      if (!all && (entry.archived || fields.status === 'cancelled')) return false;
      if (project && entry.project !== project) return false;
      if (statuses.length && !statuses.includes(fields.status)) return false;
      if (kind && fields.kind !== kind) return false;
      return !label || (fields.labels ?? []).includes(label);
    })
    .map((entry) => {
      const { fields, steps } = entry.item;
      const done = steps.filter((s) => s.checked).length;
      return { id: fields.id, project: entry.project, status: fields.status, kind: fields.kind, title: fields.title, steps: steps.length ? `${done}/${steps.length}` : '', archived: entry.archived };
    })
    .sort((a, b) => a.project.localeCompare(b.project)
      || STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)
      || idNumber(a.id) - idNumber(b.id));

  if (bool(values, 'json')) {
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

function usage(): string {
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

function str(values: Values, key: string): string | undefined {
  const value = values[key];
  return typeof value === 'string' ? value : undefined;
}

function bool(values: Values, key: string): boolean {
  return values[key] === true;
}

function list(values: Values, key: string): string[] {
  const value = values[key];
  return Array.isArray(value) ? value : [];
}

/** A required positional argument; bindArgs has already checked it is there. */
function arg(args: Args, key: string): string {
  return args[key] ?? '';
}

function stepNumber(text: string): number {
  if (!/^[1-9][0-9]*$/.test(text)) throw new UsageError(`"${text}" is not a step number`);
  return Number(text);
}

function idNumber(id: string): number {
  return Number(id.split('-')[1]);
}

function readVersion(): string {
  return (JSON.parse(readFileSync(join(TOOL_ROOT, 'package.json'), 'utf8')) as { version: string }).version;
}
