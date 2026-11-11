// Operations that change a data space. Each one validates the result with the same checks as
// `anvil validate` before writing anything, writes atomically, and returns the relative paths it
// touched and a commit message. Committing is left to the caller.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AnvilError } from './errors.ts';
import { assertInside, createExclusive, errorCode, removeFile, writeAtomic } from './fsutil.ts';
import { parseSteps, serializeItem, withDescription } from './item.ts';
import { registryMtime } from './registry.ts';
import { CLOSED_STATUSES, CONTAINER_KINDS, OPEN_STATUSES, closeBlockers } from './rules.ts';
import { indexItems, projectMap, readSpace } from './space.ts';
import type { Change, Context, Item, ItemEntry, ItemFields, Project } from './types.ts';
import { childrenOf, itemProblems, referenceProblems } from './validate.ts';

const ID = /^[A-Z]{2,4}-[1-9][0-9]*$/;
const MAX_ID_ATTEMPTS = 50;
export const CREATE_STATUSES: readonly string[] = ['backlog', 'todo', 'doing'];
export const SETTABLE_FIELDS = ['title', 'kind', 'priority', 'parent', 'related', 'labels', 'links', 'supersededBy'] as const;
export type SettableField = (typeof SETTABLE_FIELDS)[number];
const LIST_FIELDS: ReadonlySet<string> = new Set(['related', 'labels', 'links']);

/** Reads the data space once for an operation. */
export function openSpace(dir: string): Context {
  const space = readSpace(dir);
  if (space.registryError || !space.registry) throw new AnvilError(`cannot read projects.json: ${space.registryError}`);
  return { dir, space: { ...space, registry: space.registry }, registryMtimeMs: registryMtime(dir), projects: projectMap(space.registry), byId: indexItems(space.items) };
}

export function getProject(ctx: Context, id: string): Project {
  const project = ctx.projects.get(id);
  if (!project) throw new AnvilError(`unknown project "${id}"; known: ${[...ctx.projects.keys()].join(', ')}`);
  return project;
}

/** Finds an item by id or former id (alias). */
export function getItem(ctx: Context, id: string): ItemEntry {
  if (!ID.test(id)) throw new AnvilError(`"${id}" is not an item id (like AB-12)`);
  const entry = ctx.byId.get(id);
  if (!entry) throw new AnvilError(`item ${id} not found`);
  return entry;
}

export function today(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export interface NewItem {
  project: string;
  kind: string;
  title: string;
  status?: string;
  parent?: string;
  priority?: string;
  labels?: string | string[];
  body?: string;
  steps?: string[];
}

/** Creates an item. */
export function createItem(ctx: Context, { project: projectId, kind, title, status = 'backlog', parent, priority, labels, body, steps = [] }: NewItem, now: Date): Change & { id: string; file: string } {
  const project = getProject(ctx, projectId);
  if (!CREATE_STATUSES.includes(status)) {
    throw new AnvilError(`new items start as ${CREATE_STATUSES.join(', ')}; use \`item status\` afterwards`);
  }
  const date = today(now);
  const fields = clean({
    id: `${project.prefix}-1`, title, kind, status, since: date, created: date, priority, parent,
    labels: typeof labels === 'string' ? splitList(labels) : labels,
  });
  const text = composeBody(body, steps);
  assertValid(fields, project, ctx);

  let number = nextNumber(ctx, project.prefix);
  for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt++, number++) {
    const id = `${project.prefix}-${number}`;
    const file = itemPath(project.id, id);
    try {
      createExclusive(absolute(ctx, file), serializeItem({ fields: { ...fields, id }, body: text }));
      return { id, file, paths: [file], message: `${id}: create ${kind} "${title}"` };
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error; // another writer took this id: try the next one
    }
  }
  throw new AnvilError(`could not find a free id for ${project.prefix} after ${MAX_ID_ATTEMPTS} attempts`);
}

export interface StatusOptions {
  reason?: string | undefined;
  evidence?: string | undefined;
  release?: string | undefined;
}

/** Changes an item's status, applying the closing rules. */
export function setStatus(ctx: Context, id: string, status: string, { reason, evidence, release }: StatusOptions = {}, now: Date): Change & { id: string } {
  const entry = getEditable(ctx, id);
  const { fields } = entry.item;
  if (fields.status === status) throw new AnvilError(`${fields.id} is already ${status}`);

  const next: ItemFields = { ...fields, status, since: today(now) };
  if (status === 'blocked' || status === 'cancelled') {
    if (!reason) throw new AnvilError(`moving to ${status} needs --reason`);
    next.reason = reason;
  } else {
    delete next.reason;
  }
  if (OPEN_STATUSES.includes(status)) {
    delete next.evidence;
    delete next.release;
  }
  if (status === 'done') {
    if (!evidence) throw new AnvilError('moving to done needs --evidence: a URL (pull request, CI run) or text such as "confirmed by user"');
    next.evidence = evidence;
    delete next.release;
  }
  if (status === 'released') {
    if (!release) throw new AnvilError('moving to released needs --release <version>');
    next.release = release;
    if (evidence) next.evidence = evidence;
  }

  const children = childrenOf(entry, ctx.space.items, ctx.byId).map((child) => child.item);
  const blockers = closeBlockers(entry.item, status, children);
  if (blockers.length) throw new AnvilError(`${fields.id} cannot be ${status}: ${blockers.join('; ')}`);
  assertValid(next, ctx.projects.get(entry.project), ctx, entry);

  write(ctx, entry, { fields: next, body: entry.item.body });
  return { id: fields.id, paths: [entry.file], message: `${fields.id}: ${fields.status} → ${status}`, hint: parentHint(ctx, entry, status) };
}

/**
 * Replaces an item's description (its body without the steps); the steps stay as they are,
 * after it. An empty description removes it. Steps are added with addStep, never through here.
 */
export function setDescription(ctx: Context, id: string, description: string): Change & { id: string } {
  const entry = getEditable(ctx, id);
  const { fields, body } = entry.item;
  const next = withDescription(body, description);
  if (next === null) throw new AnvilError(`a description cannot hold checkboxes (- [ ] …): they would become steps; add steps with \`anvil step add ${fields.id} "…"\``);
  if (next === body) throw new AnvilError(`${fields.id} already has that description`);
  write(ctx, entry, { fields, body: next });
  return { id: fields.id, paths: [entry.file], message: `${fields.id}: ${description.trim() ? 'edit' : 'remove'} description` };
}

/** Changes header fields. An empty value removes the field; list fields are comma- or space-separated. */
export function setFields(ctx: Context, id: string, changes: Partial<Record<string, string>>): Change & { id: string } {
  const entry = getEditable(ctx, id);
  const { fields } = entry.item;
  const keys = Object.keys(changes);
  if (keys.length === 0) throw new AnvilError(`nothing to set; use one of ${SETTABLE_FIELDS.map((k) => `--${k}`).join(', ')}`);

  const next: ItemFields = { ...fields };
  for (const key of keys) {
    if (!(SETTABLE_FIELDS as readonly string[]).includes(key)) throw new AnvilError(`"${key}" cannot be set this way`);
    const raw = changes[key] ?? '';
    const value = LIST_FIELDS.has(key) ? splitList(raw) : raw;
    if (value === '' || (Array.isArray(value) && value.length === 0)) delete next[key];
    else next[key] = value;
  }
  if (JSON.stringify(next) === JSON.stringify(fields)) throw new AnvilError(`${fields.id} already has those values`);
  if (!CONTAINER_KINDS.has(next.kind) && childrenOf(entry, ctx.space.items, ctx.byId).length) {
    throw new AnvilError(`${fields.id} has child tasks, so it must stay a feature or a bug`);
  }
  assertValid(next, ctx.projects.get(entry.project), ctx, entry);

  write(ctx, entry, { fields: next, body: entry.item.body });
  return { id: fields.id, paths: [entry.file], message: `${fields.id}: set ${keys.join(', ')}` };
}

/**
 * Moves an item, and the child tasks of a feature or bug, to another project. Each gets a new id
 * and keeps the old one in `aliases`; references in open items are rewritten.
 */
export function moveItem(ctx: Context, id: string, targetId: string): Change & { id: string; moved: [string, string][] } {
  const entry = getEditable(ctx, id);
  const target = getProject(ctx, targetId);
  const { fields } = entry.item;
  if (entry.project === target.id) throw new AnvilError(`${fields.id} is already in ${target.id}`);
  if (fields.parent) {
    throw new AnvilError(`${fields.id} belongs to ${fields.parent}: move ${fields.parent} instead, or clear the parent first (item set ${fields.id} --parent "")`);
  }
  const children = childrenOf(entry, ctx.space.items, ctx.byId);
  if (children.some((child) => child.archived)) throw new AnvilError(`${fields.id} has archived child tasks and cannot be moved`);

  const group = [entry, ...children];
  let number = nextNumber(ctx, target.prefix);
  const renames = new Map(group.map((member) => [member.item.fields.id, `${target.prefix}-${number++}`]));
  const rename = (value: string) => renames.get(value) ?? value;
  const remap = (f: ItemFields): ItemFields => clean({
    ...f,
    parent: f.parent && rename(f.parent),
    related: f.related?.map(rename),
    supersededBy: f.supersededBy && rename(f.supersededBy),
  });

  const moved = group.map((member) => {
    const old = member.item.fields;
    const next = remap({ ...old, id: rename(old.id), aliases: [...new Set([...(old.aliases ?? []), old.id])] });
    assertValid(next, target, ctx, member, { skipReferences: true });
    return { member, fields: next, file: itemPath(target.id, next.id) };
  });
  const rewritten = ctx.space.items
    .filter((other) => !other.archived && !group.includes(other))
    .map((other) => ({ other, fields: remap(other.item.fields) }))
    .filter(({ other, fields: next }) => JSON.stringify(next) !== JSON.stringify(other.item.fields));

  for (const { member, fields: next, file } of moved) {
    try {
      createExclusive(absolute(ctx, file), serializeItem({ fields: next, body: member.item.body }));
    } catch (error) {
      if (errorCode(error) === 'EEXIST') throw new AnvilError(`${next.id} was just created by another writer; run the move again`);
      throw error;
    }
  }
  for (const { member } of moved) removeFile(absolute(ctx, member.file));
  for (const { other, fields: next } of rewritten) write(ctx, other, { fields: next, body: other.item.body });

  const pairs = [...renames];
  return {
    id: rename(fields.id),
    moved: pairs,
    paths: [...moved.flatMap(({ member, file }) => [member.file, file]), ...rewritten.map(({ other }) => other.file)],
    message: `${pairs.map(([from, to]) => `${from} → ${to}`).join(', ')}: move to ${target.id}`,
  };
}

/** Adds an unchecked step after the last one, or at the end of the body. */
export function addStep(ctx: Context, id: string, text: string): Change & { id: string; step: number } {
  const entry = getEditable(ctx, id);
  assertOneLine(text, 'a step');
  const { steps, body } = entry.item;
  const lines = body.split('\n');
  const last = steps.at(-1);
  if (last) {
    lines.splice(last.line + 1, 0, `- [ ] ${text}`);
  } else {
    while (lines.length && lines.at(-1)?.trim() === '') lines.pop();
    if (lines.length) lines.push('');
    lines.push(`- [ ] ${text}`, '');
  }
  const next = lines.join('\n');
  write(ctx, entry, { fields: entry.item.fields, body: next });
  const index = parseSteps(next).length;
  return { id: entry.item.fields.id, step: index, paths: [entry.file], message: `${entry.item.fields.id}: add step ${index}` };
}

export type StepAction = 'check' | 'uncheck' | 'skip';

/** Checks, unchecks or skips step `n` (1-based). */
export function changeStep(ctx: Context, id: string, n: number, action: StepAction, reason?: string): Change & { id: string } {
  const entry = getEditable(ctx, id);
  const { fields, steps, body } = entry.item;
  const step = steps[n - 1];
  if (!Number.isInteger(n) || !step) throw new AnvilError(`${fields.id} has no step ${n}; it has ${steps.length}`);

  let mark: string;
  let text = step.text;
  if (action === 'check') {
    if (step.checked) throw new AnvilError(`step ${n} of ${fields.id} is already ${step.skipped ? 'skipped' : 'checked'}`);
    mark = 'x';
  } else if (action === 'uncheck') {
    if (!step.checked) throw new AnvilError(`step ${n} of ${fields.id} is not checked`);
    if (fields.status === 'done' || fields.status === 'released') {
      throw new AnvilError(`${fields.id} is ${fields.status}: move it back to doing before unchecking a step`);
    }
    mark = ' ';
    if (step.skipped) text = /^~~(.+)~~ \(skipped: .+\)$/.exec(text)?.[1] ?? text;
  } else {
    if (step.checked) throw new AnvilError(`step ${n} of ${fields.id} is already ${step.skipped ? 'skipped' : 'checked'}; uncheck it first`);
    if (!reason) throw new AnvilError('skipping a step needs --reason');
    assertOneLine(reason, 'a reason');
    mark = 'x';
    text = `~~${text}~~ (skipped: ${reason})`;
  }

  const lines = body.split('\n');
  lines[step.line] = (lines[step.line] ?? '').replace(/^(\s*[-*+] )\[[ xX]\] .*$/, (_, bullet: string) => `${bullet}[${mark}] ${text}`);
  write(ctx, entry, { fields, body: lines.join('\n') });
  return { id: fields.id, paths: [entry.file], message: `${fields.id}: ${action} step ${n}` };
}

/** Appends a timestamped entry to the project's journal note of the day. */
export function addJournal(ctx: Context, projectId: string, text: string, now: Date): Change & { file: string } {
  const project = getProject(ctx, projectId);
  if (!text.trim()) throw new AnvilError('the journal entry is empty');
  const file = `projects/${project.id}/journal/${today(now)}.md`;
  const path = absolute(ctx, file);
  const pad = (n: number) => String(n).padStart(2, '0');
  const entryText = `## ${pad(now.getHours())}:${pad(now.getMinutes())}\n\n${text.trim()}\n`;
  let existing = '';
  try {
    existing = readFileSync(path, 'utf8');
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error;
  }
  writeAtomic(path, existing.trim() ? `${existing.trimEnd()}\n\n${entryText}` : entryText);
  return { file, paths: [file], message: `journal: ${project.id} ${today(now)}` };
}

/** Lists the project's journal notes, newest first. */
export function listJournal(ctx: Context, projectId: string): { date: string; file: string }[] {
  const project = getProject(ctx, projectId);
  return ctx.space.journals
    .filter((note) => note.project === project.id)
    .map((note) => ({ date: note.name.replace(/\.md$/, ''), file: note.file }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** The next free number for `prefix`: one more than any id or alias in use, archive included. */
export function nextNumber(ctx: Context, prefix: string): number {
  const used = [...ctx.byId.keys(), ...ctx.space.unreadable.map((u) => (u.file.split('/').at(-1) ?? '').replace(/\.md$/, ''))]
    .filter((id) => id.startsWith(`${prefix}-`))
    .map((id) => Number(id.slice(prefix.length + 1)))
    .filter(Number.isInteger);
  return Math.max(0, ...used) + 1;
}

export function absolute(ctx: Pick<Context, 'dir'>, file: string): string {
  const path = join(ctx.dir, file);
  assertInside(ctx.dir, path);
  return path;
}

export function itemPath(projectId: string, id: string): string {
  return `projects/${projectId}/items/${id}.md`;
}

function getEditable(ctx: Context, id: string): ItemEntry {
  const entry = getItem(ctx, id);
  if (entry.archived) throw new AnvilError(`${entry.item.fields.id} is archived and read-only`);
  return entry;
}

function assertValid(fields: ItemFields, project: Project | undefined, ctx: Context, entry?: ItemEntry, { skipReferences = false } = {}): void {
  const problems = itemProblems(fields, project);
  if (!skipReferences) problems.push(...referenceProblems(fields, project?.id ?? '', ctx.byId));
  if (problems.length) throw new AnvilError(`${entry?.item.fields.id ?? 'the item'} would be invalid: ${problems.join('; ')}`);
}

function parentHint(ctx: Context, entry: ItemEntry, status: string): string | null {
  const parentId = entry.item.fields.parent;
  if (!CLOSED_STATUSES.includes(status) || !parentId) return null;
  const parent = ctx.byId.get(parentId);
  if (!parent || CLOSED_STATUSES.includes(parent.item.fields.status)) return null;
  const siblings = childrenOf(parent, ctx.space.items, ctx.byId).filter((child) => child !== entry);
  if (siblings.some((child) => !CLOSED_STATUSES.includes(child.item.fields.status))) return null;
  return `every task of ${parent.item.fields.id} is closed; close it too with: anvil item status ${parent.item.fields.id} done --evidence "…"`;
}

function write(ctx: Context, entry: ItemEntry, item: Pick<Item, 'fields' | 'body'>): void {
  writeAtomic(absolute(ctx, entry.file), serializeItem(item), { expectMtimeMs: entry.mtimeMs });
}

function composeBody(body: string | undefined, steps: string[]): string {
  for (const step of steps) assertOneLine(step, 'a step');
  const parts: string[] = [];
  if (body?.trim()) parts.push(body.trimEnd());
  if (steps.length) parts.push(steps.map((step) => `- [ ] ${step}`).join('\n'));
  return parts.length ? `${parts.join('\n\n')}\n` : '';
}

/**
 * A list given as one argument: separated by commas, spaces or both, without repeats. No list
 * value can hold a space, and PowerShell turns an unquoted `a,b` into `a b` when npm's `anvil.ps1`
 * shim passes it on.
 */
function splitList(value: string): string[] {
  return [...new Set(value.split(/[\s,]+/).filter(Boolean))];
}

function assertOneLine(text: string, what: string): void {
  if (!text.trim() || /[\r\n]/.test(text)) throw new AnvilError(`${what} must be one non-empty line`);
}

/** Drops undefined, empty-string and empty-list fields. */
function clean<T extends Record<string, unknown>>(fields: T): ItemFields {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined && value !== '' && !(Array.isArray(value) && value.length === 0))) as ItemFields;
}
