// Operations that change a data space. Each one validates the result with the same checks as
// `anvil validate` before writing anything, writes atomically, and returns the relative paths it
// touched and a commit message. Committing is left to the caller.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AnvilError } from './errors.js';
import { assertInside, createExclusive, removeFile, writeAtomic } from './fsutil.js';
import { parseSteps, serializeItem } from './item.js';
import { registryMtime } from './registry.js';
import { CLOSED_STATUSES, CONTAINER_KINDS, OPEN_STATUSES, closeBlockers } from './rules.js';
import { indexItems, projectMap, readSpace } from './space.js';
import { childrenOf, itemProblems, referenceProblems } from './validate.js';

const ID = /^[A-Z]{2,4}-[1-9][0-9]*$/;
const MAX_ID_ATTEMPTS = 50;
export const CREATE_STATUSES = ['backlog', 'todo', 'doing'];
export const SETTABLE_FIELDS = ['title', 'kind', 'priority', 'parent', 'related', 'labels', 'links', 'supersededBy'];
const LIST_FIELDS = new Set(['related', 'labels', 'links']);

/** Reads the data space once for an operation. */
export function openSpace(dir) {
  const space = readSpace(dir);
  if (space.registryError) throw new AnvilError(`cannot read projects.json: ${space.registryError}`);
  return { dir, space, registryMtimeMs: registryMtime(dir), projects: projectMap(space.registry), byId: indexItems(space.items) };
}

export function getProject(ctx, id) {
  const project = ctx.projects.get(id);
  if (!project) throw new AnvilError(`unknown project "${id}"; known: ${[...ctx.projects.keys()].join(', ')}`);
  return project;
}

/** Finds an item by id or former id (alias). */
export function getItem(ctx, id) {
  if (!ID.test(id)) throw new AnvilError(`"${id}" is not an item id (like AB-12)`);
  const entry = ctx.byId.get(id);
  if (!entry) throw new AnvilError(`item ${id} not found`);
  return entry;
}

export function today(now) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Creates an item and returns { id, file, paths, message }. */
export function createItem(ctx, { project: projectId, kind, title, status = 'backlog', parent, priority, labels, body, steps = [] }, now) {
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
      if (error.code !== 'EEXIST') throw error; // another writer took this id: try the next one
    }
  }
  throw new AnvilError(`could not find a free id for ${project.prefix} after ${MAX_ID_ATTEMPTS} attempts`);
}

/** Changes an item's status, applying the closing rules. Returns { id, paths, message, hint }. */
export function setStatus(ctx, id, status, { reason, evidence, release } = {}, now) {
  const entry = getEditable(ctx, id);
  const { fields } = entry.item;
  if (fields.status === status) throw new AnvilError(`${fields.id} is already ${status}`);

  const next = { ...fields, status, since: today(now) };
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
  const blockers = closeBlockers({ ...entry.item, fields: next }, status, children);
  if (blockers.length) throw new AnvilError(`${fields.id} cannot be ${status}: ${blockers.join('; ')}`);
  assertValid(next, ctx.projects.get(entry.project), ctx, entry);

  write(ctx, entry, { fields: next, body: entry.item.body });
  return { id: fields.id, paths: [entry.file], message: `${fields.id}: ${fields.status} → ${status}`, hint: parentHint(ctx, entry, status) };
}

/** Changes header fields. An empty value removes the field. Returns { id, paths, message }. */
export function setFields(ctx, id, changes) {
  const entry = getEditable(ctx, id);
  const { fields } = entry.item;
  const keys = Object.keys(changes);
  if (keys.length === 0) throw new AnvilError(`nothing to set; use one of ${SETTABLE_FIELDS.map((k) => `--${k}`).join(', ')}`);

  const next = { ...fields };
  for (const key of keys) {
    if (!SETTABLE_FIELDS.includes(key)) throw new AnvilError(`"${key}" cannot be set this way`);
    const value = LIST_FIELDS.has(key) ? splitList(changes[key]) : changes[key];
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
 * Returns { id, moved: [[old, new]], paths, message }.
 */
export function moveItem(ctx, id, targetId) {
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
  const rename = (value) => renames.get(value) ?? value;
  const remap = (f) => clean({
    ...f,
    parent: f.parent && rename(f.parent),
    related: f.related?.map(rename),
    supersededBy: f.supersededBy && rename(f.supersededBy),
  });

  const moved = group.map((member) => {
    const old = member.item.fields;
    const next = remap({ ...old, id: renames.get(old.id), aliases: [...new Set([...(old.aliases ?? []), old.id])] });
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
      if (error.code === 'EEXIST') throw new AnvilError(`${next.id} was just created by another writer; run the move again`);
      throw error;
    }
  }
  for (const { member } of moved) removeFile(absolute(ctx, member.file));
  for (const { other, fields: next } of rewritten) write(ctx, other, { fields: next, body: other.item.body });

  const pairs = [...renames];
  return {
    id: renames.get(fields.id),
    moved: pairs,
    paths: [...moved.flatMap(({ member, file }) => [member.file, file]), ...rewritten.map(({ other }) => other.file)],
    message: `${pairs.map(([from, to]) => `${from} → ${to}`).join(', ')}: move to ${target.id}`,
  };
}

/** Adds an unchecked step after the last one, or at the end of the body. */
export function addStep(ctx, id, text) {
  const entry = getEditable(ctx, id);
  assertOneLine(text, 'a step');
  const { steps, body } = entry.item;
  const lines = body.split('\n');
  if (steps.length) {
    lines.splice(steps.at(-1).line + 1, 0, `- [ ] ${text}`);
  } else {
    while (lines.length && lines.at(-1).trim() === '') lines.pop();
    if (lines.length) lines.push('');
    lines.push(`- [ ] ${text}`, '');
  }
  const next = lines.join('\n');
  write(ctx, entry, { fields: entry.item.fields, body: next });
  const index = parseSteps(next).length;
  return { id: entry.item.fields.id, step: index, paths: [entry.file], message: `${entry.item.fields.id}: add step ${index}` };
}

/** Checks, unchecks or skips step `n` (1-based). */
export function changeStep(ctx, id, n, action, reason) {
  const entry = getEditable(ctx, id);
  const { fields, steps, body } = entry.item;
  const step = steps[n - 1];
  if (!Number.isInteger(n) || !step) throw new AnvilError(`${fields.id} has no step ${n}; it has ${steps.length}`);

  let mark;
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
    if (step.skipped) text = /^~~(.+)~~ \(skipped: .+\)$/.exec(text)[1];
  } else {
    if (step.checked) throw new AnvilError(`step ${n} of ${fields.id} is already ${step.skipped ? 'skipped' : 'checked'}; uncheck it first`);
    if (!reason) throw new AnvilError('skipping a step needs --reason');
    assertOneLine(reason, 'a reason');
    mark = 'x';
    text = `~~${text}~~ (skipped: ${reason})`;
  }

  const lines = body.split('\n');
  lines[step.line] = lines[step.line].replace(/^(\s*[-*+] )\[[ xX]\] .*$/, (_, bullet) => `${bullet}[${mark}] ${text}`);
  write(ctx, entry, { fields, body: lines.join('\n') });
  return { id: fields.id, paths: [entry.file], message: `${fields.id}: ${action} step ${n}` };
}

/** Appends a timestamped entry to the project's journal note of the day. */
export function addJournal(ctx, projectId, text, now) {
  const project = getProject(ctx, projectId);
  if (!text.trim()) throw new AnvilError('the journal entry is empty');
  const file = `projects/${project.id}/journal/${today(now)}.md`;
  const path = absolute(ctx, file);
  const pad = (n) => String(n).padStart(2, '0');
  const entryText = `## ${pad(now.getHours())}:${pad(now.getMinutes())}\n\n${text.trim()}\n`;
  let existing = '';
  try {
    existing = readFileSync(path, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  writeAtomic(path, existing.trim() ? `${existing.trimEnd()}\n\n${entryText}` : entryText);
  return { file, paths: [file], message: `journal: ${project.id} ${today(now)}` };
}

/** Lists the project's journal notes, newest first. */
export function listJournal(ctx, projectId) {
  const project = getProject(ctx, projectId);
  return ctx.space.journals
    .filter((note) => note.project === project.id)
    .map((note) => ({ date: note.name.replace(/\.md$/, ''), file: note.file }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** The next free number for `prefix`: one more than any id or alias in use, archive included. */
export function nextNumber(ctx, prefix) {
  const used = [...ctx.byId.keys(), ...ctx.space.unreadable.map((u) => u.file.split('/').at(-1).replace(/\.md$/, ''))]
    .filter((id) => id.startsWith(`${prefix}-`))
    .map((id) => Number(id.slice(prefix.length + 1)))
    .filter(Number.isInteger);
  return Math.max(0, ...used) + 1;
}

function getEditable(ctx, id) {
  const entry = getItem(ctx, id);
  if (entry.archived) throw new AnvilError(`${entry.item.fields.id} is archived and read-only`);
  return entry;
}

function assertValid(fields, project, ctx, entry, { skipReferences = false } = {}) {
  const problems = itemProblems(fields, project);
  if (!skipReferences) problems.push(...referenceProblems(fields, project.id, ctx.byId));
  if (problems.length) throw new AnvilError(`${entry?.item.fields.id ?? 'the item'} would be invalid: ${problems.join('; ')}`);
}

function parentHint(ctx, entry, status) {
  const parentId = entry.item.fields.parent;
  if (!CLOSED_STATUSES.includes(status) || !parentId) return null;
  const parent = ctx.byId.get(parentId);
  if (!parent || CLOSED_STATUSES.includes(parent.item.fields.status)) return null;
  const siblings = childrenOf(parent, ctx.space.items, ctx.byId).filter((child) => child !== entry);
  if (siblings.some((child) => !CLOSED_STATUSES.includes(child.item.fields.status))) return null;
  return `every task of ${parent.item.fields.id} is closed; close it too with: anvil item status ${parent.item.fields.id} done --evidence "…"`;
}

function write(ctx, entry, item) {
  writeAtomic(absolute(ctx, entry.file), serializeItem(item), { expectMtimeMs: entry.mtimeMs });
}

export function absolute(ctx, file) {
  const path = join(ctx.dir, file);
  assertInside(ctx.dir, path);
  return path;
}

export function itemPath(projectId, id) {
  return `projects/${projectId}/items/${id}.md`;
}

function composeBody(body, steps) {
  for (const step of steps) assertOneLine(step, 'a step');
  const parts = [];
  if (body?.trim()) parts.push(body.trimEnd());
  if (steps.length) parts.push(steps.map((step) => `- [ ] ${step}`).join('\n'));
  return parts.length ? `${parts.join('\n\n')}\n` : '';
}

function splitList(value) {
  return value.split(',').map((part) => part.trim()).filter(Boolean);
}

function assertOneLine(text, what) {
  if (!text.trim() || /[\r\n]/.test(text)) throw new AnvilError(`${what} must be one non-empty line`);
}

function clean(fields) {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined && value !== '' && !(Array.isArray(value) && value.length === 0)));
}
