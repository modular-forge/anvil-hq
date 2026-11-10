// The write side of the board's JSON API. Every route calls the same operation as the matching
// CLI command, so the board can never write what `anvil validate` would reject, and commits the
// touched paths the same way. On top of that:
// - Changing an existing item needs If-Match with the ETag the board last saw. If the file
//   changed since (a Claude session, the CLI, an editor), the answer is 409 with the current
//   item, and nothing is written.
// - While the data space does not validate, the board is read-only (423).

import { AnvilError, ConflictError } from '../errors.ts';
import { commitPaths } from '../git.ts';
import { promoteIdea, releaseProject } from '../projects.ts';
import { SETTABLE_FIELDS, addJournal, addStep, changeStep, createItem, moveItem, openSpace, setFields, setStatus, type StepAction } from '../store.ts';
import type { Change, CommitResult, Context, ItemEntry } from '../types.ts';
import { validateSpace } from '../validate.ts';
import { badRequest, decode, detail, etagOf, notFound, type ApiResponse } from './api.ts';

/** Evidence saved when an item is moved to done on the board without one: the click is the proof. */
export const BOARD_EVIDENCE = 'confirmed by user (board)';

/** A request body that is not what the route expects. */
export class BadRequest extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BadRequest';
  }
}

export type Body = Record<string, unknown>;

export interface WriteRequest {
  dir: string;
  method: string;
  /** Raw path; segments are decoded by the route. */
  pathname: string;
  body: Body;
  ifMatch: string | undefined;
  now: Date;
}

type Result = Change & { id?: string; item?: string };

interface Route {
  method: 'POST' | 'PATCH';
  pattern: RegExp;
  /** What the first path segment names: an item (then If-Match applies) or a project. */
  target?: 'item' | 'project';
  /** Body keys the route accepts; anything else is a mistake worth reporting. */
  keys: readonly string[];
  created?: boolean;
  run: (call: { ctx: Context; dir: string; params: string[]; body: Body; now: Date }) => Result;
}

const ROUTES: Route[] = [
  {
    method: 'POST', pattern: /^\/api\/items$/, created: true,
    keys: ['project', 'kind', 'title', 'status', 'parent', 'priority', 'labels', 'body', 'steps'],
    run: ({ ctx, body, now }) => createItem(ctx, {
      project: required(body, 'project'), kind: required(body, 'kind'), title: required(body, 'title'),
      status: text(body, 'status'), parent: text(body, 'parent'), priority: text(body, 'priority'),
      labels: list(body, 'labels'), body: text(body, 'body'), steps: list(body, 'steps'),
    }, now),
  },
  {
    method: 'PATCH', pattern: /^\/api\/items\/([^/]+)$/, target: 'item', keys: SETTABLE_FIELDS,
    run: ({ ctx, params, body }) => setFields(ctx, param(params, 0), fieldChanges(body)),
  },
  {
    method: 'POST', pattern: /^\/api\/items\/([^/]+)\/status$/, target: 'item', keys: ['status', 'reason', 'evidence', 'release'],
    run: ({ ctx, params, body, now }) => {
      const status = required(body, 'status');
      const evidence = text(body, 'evidence')?.trim() || (status === 'done' ? BOARD_EVIDENCE : undefined);
      return setStatus(ctx, param(params, 0), status, { reason: text(body, 'reason')?.trim(), evidence, release: text(body, 'release') }, now);
    },
  },
  {
    method: 'POST', pattern: /^\/api\/items\/([^/]+)\/move$/, target: 'item', keys: ['project'],
    run: ({ ctx, params, body }) => moveItem(ctx, param(params, 0), required(body, 'project')),
  },
  {
    method: 'POST', pattern: /^\/api\/items\/([^/]+)\/promote$/, target: 'item', keys: ['id', 'prefix', 'name', 'kind', 'release'],
    run: ({ dir, params, body, now }) => promoteIdea(dir, param(params, 0), {
      id: required(body, 'id'), prefix: required(body, 'prefix'), name: text(body, 'name'), kind: required(body, 'kind'), release: required(body, 'release'),
    }, now),
  },
  {
    method: 'POST', pattern: /^\/api\/items\/([^/]+)\/steps$/, target: 'item', keys: ['text'],
    run: ({ ctx, params, body }) => addStep(ctx, param(params, 0), required(body, 'text')),
  },
  {
    method: 'POST', pattern: /^\/api\/items\/([^/]+)\/steps\/([^/]+)$/, target: 'item', keys: ['action', 'reason'],
    run: ({ ctx, params, body }) => {
      const n = param(params, 1);
      if (!/^[1-9][0-9]*$/.test(n)) throw new BadRequest(`"${n}" is not a step number`);
      const action = required(body, 'action');
      if (action !== 'check' && action !== 'uncheck' && action !== 'skip') throw new BadRequest('action must be check, uncheck or skip');
      return changeStep(ctx, param(params, 0), Number(n), action satisfies StepAction, text(body, 'reason')?.trim());
    },
  },
  {
    method: 'POST', pattern: /^\/api\/projects\/([^/]+)\/journal$/, target: 'project', keys: ['text'],
    run: ({ ctx, params, body, now }) => addJournal(ctx, param(params, 0), required(body, 'text'), now),
  },
  {
    method: 'POST', pattern: /^\/api\/projects\/([^/]+)\/release$/, target: 'project', keys: ['version', 'exclude', 'dryRun'],
    run: ({ ctx, params, body, now }) => releaseProject(ctx, param(params, 0), required(body, 'version'), {
      exclude: list(body, 'exclude'), dryRun: flag(body, 'dryRun'),
    }, now),
  },
];

/** Routes a write request. Returns null when no route matches the method and path. */
export function writeRoute({ dir, method, pathname, body, ifMatch, now }: WriteRequest): ApiResponse | null {
  let route: Route | undefined;
  let params: string[] = [];
  for (const candidate of ROUTES) {
    const match = candidate.method === method ? candidate.pattern.exec(pathname) : null;
    if (match) {
      route = candidate;
      params = match.slice(1).map(decode);
      break;
    }
  }
  if (!route) {
    if (ROUTES.some((candidate) => candidate.pattern.test(pathname))) return { status: 405, body: { error: `${method} is not supported here` } };
    return null;
  }

  const unknown = Object.keys(body).filter((key) => !route.keys.includes(key));
  if (unknown.length) return badRequest(`unexpected field(s): ${unknown.join(', ')}`);

  const { errors } = validateSpace(dir);
  if (errors.length) {
    return { status: 423, body: { error: `the data space has ${errors.length} problem(s), so the board is read-only until \`anvil validate\` passes` } };
  }

  const ctx = openSpace(dir);
  const id = params[0] ?? '';
  let entry: ItemEntry | undefined;
  if (route.target === 'project' && !ctx.projects.has(id)) return notFound(`unknown project "${id}"`);
  if (route.target === 'item') {
    entry = ctx.byId.get(id);
    if (!entry) return notFound(`item ${id} not found`);
    if (!ifMatch) return { status: 428, body: { error: `send If-Match with the ETag of ${id}` } };
    if (ifMatch !== etagOf(entry.mtimeMs)) return conflict(ctx, entry);
  }

  let result: Result;
  try {
    result = route.run({ ctx, dir, params, body, now });
  } catch (error) {
    if (error instanceof BadRequest) return badRequest(error.message);
    if (error instanceof ConflictError) {
      // Changed between this request's read and its write.
      const fresh = openSpace(dir);
      const current = entry && fresh.byId.get(entry.item.fields.id);
      return current ? conflict(fresh, current) : { status: 409, body: { error: 'a file changed on disk while saving; nothing was written', current: null } };
    }
    if (error instanceof AnvilError) return { status: 422, body: { error: error.message } };
    throw error;
  }

  const commit = result.paths.length ? safeCommit(dir, result) : null;
  const after = openSpace(dir);
  const changed = after.byId.get(result.item ?? result.id ?? '');
  return {
    status: route.created ? 201 : 200,
    body: { ...result, commit, item: changed ? detail(after, changed) : null },
    ...(changed ? { etag: etagOf(changed.mtimeMs) } : {}),
  };
}

function conflict(ctx: Context, entry: ItemEntry): ApiResponse {
  return {
    status: 409,
    etag: etagOf(entry.mtimeMs),
    body: { error: `${entry.item.fields.id} changed on disk since the board loaded it; nothing was written`, current: detail(ctx, entry) },
  };
}

/** The files are already written: a failed commit is reported, not turned into an error. */
function safeCommit(dir: string, result: Result): CommitResult {
  try {
    return commitPaths(dir, result.paths, result.message);
  } catch (error) {
    if (error instanceof AnvilError) return { committed: false, reason: error.message };
    throw error;
  }
}

/** PATCH body → setFields changes: lists as arrays, null or "" removes a field. */
function fieldChanges(body: Body): Record<string, string> {
  return Object.fromEntries(Object.entries(body).map(([key, value]) => {
    if (value === null) return [key, ''];
    if (typeof value === 'string') return [key, value];
    if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
      if (value.some((v) => v.includes(','))) throw new BadRequest(`${key}: values cannot contain commas`);
      return [key, value.join(',')];
    }
    throw new BadRequest(`${key} must be a string, a list of strings or null`);
  }));
}

function text(body: Body, key: string): string | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new BadRequest(`${key} must be a string`);
  return value;
}

function required(body: Body, key: string): string {
  const value = text(body, key);
  if (!value?.trim()) throw new BadRequest(`${key} is required`);
  return value;
}

function list(body: Body, key: string): string[] {
  const value = body[key];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) throw new BadRequest(`${key} must be a list of strings`);
  return value;
}

function flag(body: Body, key: string): boolean {
  const value = body[key];
  if (value === undefined) return false;
  if (typeof value !== 'boolean') throw new BadRequest(`${key} must be true or false`);
  return value;
}

function param(params: string[], index: number): string {
  return params[index] ?? '';
}
