// `anvil validate`: checks a whole data space against the schemas and the rules in
// docs/format.md. Returns every problem found instead of stopping at the first one.
// itemProblems and referenceProblems are also used by the commands that write, so a write can
// never produce an item that validate would reject.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateSchema } from './json-schema.js';
import { CONTAINER_KINDS, RESERVED_AREAS, closeBlockers, statusProblems } from './rules.js';
import { TOOL_ROOT } from './data-dir.js';
import { indexItems, projectMap, readSpace } from './space.js';

const projectsSchema = loadSchema('projects.schema.json');
const itemSchema = loadSchema('item.schema.json');

function loadSchema(name) {
  return JSON.parse(readFileSync(join(TOOL_ROOT, 'schema', name), 'utf8'));
}

/** Problems of an item's header on its own and within its project. */
export function itemProblems(fields, project) {
  const problems = validateSchema(itemSchema, fields).map(({ path, message }) => `${path || 'header'} ${message}`);
  if (typeof fields.id === 'string' && project && !fields.id.startsWith(`${project.prefix}-`)) {
    problems.push(`id must start with the prefix of "${project.id}" (${project.prefix}-)`);
  }
  if (fields.since && fields.created && fields.since < fields.created) problems.push('"since" is earlier than "created"');
  problems.push(...statusProblems(fields, fields.status, project));
  if (fields.supersededBy && fields.kind !== 'decision') problems.push('only a decision can be superseded');
  return problems;
}

/** Problems of the fields that point to other items. `byId` maps ids and aliases to entries. */
export function referenceProblems(fields, projectId, byId) {
  const problems = [];
  if (fields.parent) {
    const parent = byId.get(fields.parent);
    if (!parent) problems.push(`parent "${fields.parent}" does not exist`);
    else if (fields.kind !== 'task') problems.push('only a task can have a parent');
    else if (!CONTAINER_KINDS.has(parent.item.fields.kind)) problems.push(`parent "${fields.parent}" is not a feature or a bug`);
    else if (parent.project !== projectId) problems.push(`parent "${fields.parent}" belongs to another project`);
  }
  for (const id of fields.related ?? []) {
    if (!byId.has(id)) problems.push(`related item "${id}" does not exist`);
  }
  if (fields.supersededBy) {
    const next = byId.get(fields.supersededBy);
    if (!next) problems.push(`supersededBy "${fields.supersededBy}" does not exist`);
    else if (next.item.fields.kind !== 'decision') problems.push(`supersededBy "${fields.supersededBy}" is not a decision`);
  }
  return problems;
}

/** Entries whose valid parent is `parent`. */
export function childrenOf(parent, items, byId) {
  return items.filter((entry) => {
    const { fields } = entry.item;
    return fields.parent && fields.kind === 'task' && byId.get(fields.parent) === parent && entry.project === parent.project;
  });
}

/** Returns { errors: [{ file, message }], stats: { projects, items } }. */
export function validateSpace(dir) {
  const errors = [];
  const report = (file, message) => errors.push({ file, message });
  const space = readSpace(dir);

  const projects = checkRegistry(space, report);
  const byId = indexItems(space.items, (entry, id, other, what) => report(entry.file, `${what} "${id}" is also used by ${other.file}`));
  for (const entry of space.items) checkItem(entry, projects, byId, space.items, report);
  for (const { file, message } of space.unreadable) report(file, message);
  for (const { file, name } of space.journals) {
    if (!/^\d{4}-\d{2}-\d{2}\.md$/.test(name)) report(file, 'journal files are named YYYY-MM-DD.md');
  }

  return { errors, stats: { projects: projects.size - RESERVED_AREAS.length, items: space.items.length } };
}

/** Problems of a projects.json registry: its schema, and ids and prefixes that clash. */
export function registryProblems(registry) {
  const problems = validateSchema(projectsSchema, registry).map(({ path, message }) => `${path || 'root'} ${message}`);
  if (!Array.isArray(registry?.projects)) return problems;
  const ids = new Set(RESERVED_AREAS.map((area) => area.id));
  const prefixes = new Map(RESERVED_AREAS.map((area) => [area.prefix, area.id]));
  for (const project of registry.projects) {
    if (!project || typeof project.id !== 'string') continue;
    if (ids.has(project.id)) {
      problems.push(`project id "${project.id}" is ${RESERVED_AREAS.some((a) => a.id === project.id) ? 'reserved' : 'repeated'}`);
      continue;
    }
    if (prefixes.has(project.prefix)) {
      problems.push(`prefix "${project.prefix}" of "${project.id}" is already used by "${prefixes.get(project.prefix)}"`);
    }
    ids.add(project.id);
    prefixes.set(project.prefix, project.id);
  }
  return problems;
}

/** Validates projects.json and returns a Map of project id → project, reserved areas included. */
function checkRegistry(space, report) {
  if (space.registryError) {
    report('projects.json', `cannot read: ${space.registryError}`);
    return projectMap(null);
  }
  for (const problem of registryProblems(space.registry)) report('projects.json', problem);
  const projects = projectMap(space.registry);
  for (const folder of space.folders) {
    if (!projects.has(folder)) report(`projects/${folder}`, `folder of an unknown project "${folder}"`);
  }
  return projects;
}

function checkItem(entry, projects, byId, items, report) {
  const { file, item } = entry;
  const { fields } = item;
  for (const problem of itemProblems(fields, projects.get(entry.project))) report(file, problem);
  if (typeof fields.id !== 'string') return;

  const fileName = file.slice(file.lastIndexOf('/') + 1);
  if (fileName !== `${fields.id}.md`) report(file, `file name must be ${fields.id}.md`);
  if (entry.archived && !/^\d{4}$/.test(entry.year)) report(file, 'archive folders are named after a year (YYYY)');
  for (const problem of referenceProblems(fields, entry.project, byId)) report(file, problem);
  const children = childrenOf(entry, items, byId).map((child) => child.item);
  for (const blocker of closeBlockers(item, fields.status, children)) report(file, `status "${fields.status}" with ${blocker}`);
}
