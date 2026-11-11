// The read side of the board's JSON API. Each request reads the data space afresh with the same
// functions the CLI uses, so the board always shows what is on disk. Responses never include
// anything outside the data space.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mtimeOf } from '../fsutil.ts';
import { fileHistory, isRepository, oldestUnpushedDate, uncommittedChanges, unpushedCount } from '../git.ts';
import { descriptionOf } from '../item.ts';
import { search } from '../maintenance.ts';
import { RESERVED_AREAS } from '../rules.ts';
import { listJournal, openSpace } from '../store.ts';
import type { Context, FileProblem, ItemEntry, Step } from '../types.ts';
import { childrenOf, validateSpace } from '../validate.ts';

export interface ApiResponse {
  status: number;
  body: unknown;
  /** Version of the resource, for If-None-Match now and If-Match on writes. */
  etag?: string;
}

export interface ApiState {
  dir: string;
  /** Whether the change feed is watching; when false the board polls `stamp`. */
  watching: boolean;
}

const MAX_QUERY = 200;
/** The board warns that the backup is behind from this many unpushed commits… */
export const STALE_COMMITS = 10;
/** …or when the oldest unpushed commit is this old. */
export const STALE_MS = 2 * 24 * 60 * 60 * 1000;
const MAX_PROBLEMS = 100;
const RESERVED_IDS: ReadonlySet<string> = new Set(RESERVED_AREAS.map((area) => area.id));

/** The ETag of a file: its modification time, which every write changes. */
export function etagOf(mtimeMs: number): string {
  return `"${mtimeMs}"`;
}

/** Routes a GET request under /api. Returns null when no route matches. */
export function readRoute(state: ApiState, pathname: string, query: URLSearchParams, now: Date): ApiResponse | null {
  if (pathname === '/api/space') return space(state);
  if (pathname === '/api/git') return gitStatus(state.dir, now);
  if (pathname === '/api/items') return items(openSpace(state.dir), query);
  if (pathname === '/api/search') return searchRoute(openSpace(state.dir), query);
  let match = /^\/api\/items\/([^/]+)$/.exec(pathname);
  if (match) return itemDetail(openSpace(state.dir), decode(match[1]));
  match = /^\/api\/items\/([^/]+)\/history$/.exec(pathname);
  if (match) return history(openSpace(state.dir), decode(match[1]));
  match = /^\/api\/projects\/([^/]+)\/journal$/.exec(pathname);
  if (match) return journalList(openSpace(state.dir), decode(match[1]));
  match = /^\/api\/projects\/([^/]+)\/journal\/([^/]+)$/.exec(pathname);
  if (match) return journalNote(openSpace(state.dir), decode(match[1]), decode(match[2]));
  return null;
}

/**
 * The overview the board starts from: projects with their counts per status, whether the space
 * is valid (the board is read-only when it is not), and a stamp that changes with any file.
 */
function space(state: ApiState): ApiResponse {
  const ctx = openSpace(state.dir);
  const { errors } = validateSpace(state.dir);
  const counts = new Map<string, Record<string, number>>();
  for (const entry of ctx.space.items) {
    if (entry.archived) continue;
    const byStatus = counts.get(entry.project) ?? {};
    byStatus[entry.item.fields.status] = (byStatus[entry.item.fields.status] ?? 0) + 1;
    counts.set(entry.project, byStatus);
  }
  const projects = [...ctx.projects.values()].map((project) => ({
    ...project, reserved: RESERVED_IDS.has(project.id), counts: counts.get(project.id) ?? {},
  }));
  return {
    status: 200,
    body: {
      dir: state.dir,
      schemaVersion: ctx.space.registry.schemaVersion,
      projects,
      readOnly: errors.length > 0,
      problems: errors.slice(0, MAX_PROBLEMS) satisfies FileProblem[],
      problemCount: errors.length,
      watching: state.watching,
      stamp: stamp(ctx),
    },
  };
}

/** Changes whenever any item, journal note or the registry changes, is added or is removed. */
function stamp(ctx: Context): string {
  const hash = createHash('sha256');
  hash.update(`projects.json ${ctx.registryMtimeMs}\n`);
  for (const entry of ctx.space.items) hash.update(`${entry.file} ${entry.mtimeMs}\n`);
  for (const note of ctx.space.journals) hash.update(`${note.file} ${mtimeOf(join(ctx.dir, note.file))}\n`);
  for (const problem of ctx.space.unreadable) hash.update(`${problem.file} unreadable\n`);
  return hash.digest('base64url').slice(0, 16);
}

/** Items of one project or all; archived and cancelled ones only with all=1. */
function items(ctx: Context, query: URLSearchParams): ApiResponse {
  const project = query.get('project');
  const all = query.get('all') === '1';
  if (project !== null && !ctx.projects.has(project)) return notFound(`unknown project "${project}"`);
  const rows = ctx.space.items
    .filter((entry) => (project === null || entry.project === project)
      && (all || (!entry.archived && entry.item.fields.status !== 'cancelled')))
    .map(summary);
  return { status: 200, body: rows };
}

/** One item by id or alias, with its body, steps and child tasks. */
function itemDetail(ctx: Context, id: string): ApiResponse {
  const entry = ctx.byId.get(id);
  if (!entry) return notFound(`item ${id} not found`);
  return { status: 200, etag: etagOf(entry.mtimeMs), body: detail(ctx, entry) };
}

/** Everything the detail panel shows of an item. */
export function detail(ctx: Context, entry: ItemEntry) {
  const children = childrenOf(entry, ctx.space.items, ctx.byId).map(summary);
  return { ...summary(entry), body: entry.item.body, description: descriptionOf(entry.item.body), steps: entry.item.steps, children };
}

/** The commits that changed an item's file, through moves and archiving. */
function history(ctx: Context, id: string): ApiResponse {
  const entry = ctx.byId.get(id);
  if (!entry) return notFound(`item ${id} not found`);
  return { status: 200, body: fileHistory(ctx.dir, entry.file) };
}

/**
 * Whether the data space is backed up: unpushed commits, uncommitted files, and `stale` when
 * the backup is far enough behind for the board to warn.
 */
function gitStatus(dir: string, now: Date): ApiResponse {
  if (!isRepository(dir)) {
    return { status: 200, body: { repository: false, upstream: false, unpushed: null, oldestUnpushed: null, uncommitted: [], stale: true } };
  }
  const unpushed = unpushedCount(dir);
  const oldestUnpushed = unpushed ? oldestUnpushedDate(dir) : null;
  const age = oldestUnpushed ? now.getTime() - Date.parse(oldestUnpushed) : 0;
  return {
    status: 200,
    body: {
      repository: true,
      upstream: unpushed !== null,
      unpushed,
      oldestUnpushed,
      uncommitted: uncommittedChanges(dir).map((line) => line.slice(3)),
      stale: unpushed === null || unpushed >= STALE_COMMITS || age >= STALE_MS,
    },
  };
}

function journalList(ctx: Context, projectId: string): ApiResponse {
  if (!ctx.projects.has(projectId)) return notFound(`unknown project "${projectId}"`);
  return { status: 200, body: listJournal(ctx, projectId) };
}

/** One journal note; only files the space listed, so the path cannot be steered. */
function journalNote(ctx: Context, projectId: string, date: string): ApiResponse {
  if (!ctx.projects.has(projectId)) return notFound(`unknown project "${projectId}"`);
  const note = ctx.space.journals.find((n) => n.project === projectId && n.name === `${date}.md`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !note) return notFound(`no journal note for ${date}`);
  return { status: 200, body: { date, file: note.file, text: readFileSync(join(ctx.dir, note.file), 'utf8') } };
}

function searchRoute(ctx: Context, query: URLSearchParams): ApiResponse {
  const text = query.get('q')?.trim() ?? '';
  if (!text) return badRequest('q is required');
  if (text.length > MAX_QUERY) return badRequest(`q is longer than ${MAX_QUERY} characters`);
  const project = query.get('project') ?? undefined;
  if (project !== undefined && !ctx.projects.has(project)) return notFound(`unknown project "${project}"`);
  return { status: 200, body: search(ctx, text, { project, includeArchive: query.get('all') === '1' }) };
}

/** What a card needs: header fields and step progress, without the body. */
export function summary(entry: ItemEntry) {
  return {
    id: entry.item.fields.id,
    project: entry.project,
    file: entry.file,
    archived: entry.archived,
    etag: etagOf(entry.mtimeMs),
    fields: entry.item.fields,
    progress: progress(entry.item.steps),
  };
}

function progress(steps: Step[]): { total: number; done: number; skipped: number } {
  return {
    total: steps.length,
    done: steps.filter((s) => s.checked && !s.skipped).length,
    skipped: steps.filter((s) => s.skipped).length,
  };
}

export function decode(segment: string | undefined): string {
  try {
    return decodeURIComponent(segment ?? '');
  } catch {
    return '';
  }
}

export function notFound(message: string): ApiResponse {
  return { status: 404, body: { error: message } };
}

export function badRequest(message: string): ApiResponse {
  return { status: 400, body: { error: message } };
}
