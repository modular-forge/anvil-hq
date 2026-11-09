// `anvil validate`: checks a whole data space against the schemas and the rules in
// docs/format.md. Returns every problem found instead of stopping at the first one.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateSchema } from './json-schema.js';
import { CONTAINER_KINDS, RESERVED_AREAS, closeBlockers, statusProblems } from './rules.js';
import { TOOL_ROOT } from './data-dir.js';
import { readSpace } from './space.js';

const projectsSchema = loadSchema('projects.schema.json');
const itemSchema = loadSchema('item.schema.json');

function loadSchema(name) {
  return JSON.parse(readFileSync(join(TOOL_ROOT, 'schema', name), 'utf8'));
}

/** Returns { errors: [{ file, message }], stats: { projects, items } }. */
export function validateSpace(dir) {
  const errors = [];
  const report = (file, message) => errors.push({ file, message });
  const space = readSpace(dir);

  const projects = checkRegistry(space, report);
  const byId = checkItems(space, projects, report);
  checkReferences(space, byId, report);
  for (const { file, message } of space.unreadable) report(file, message);
  for (const { file, name } of space.journals) {
    if (!/^\d{4}-\d{2}-\d{2}\.md$/.test(name)) report(file, 'journal files are named YYYY-MM-DD.md');
  }

  return { errors, stats: { projects: projects.size - RESERVED_AREAS.length, items: space.items.length } };
}

/** Validates projects.json and returns a Map of project id → project, reserved areas included. */
function checkRegistry(space, report) {
  const projects = new Map(RESERVED_AREAS.map((area) => [area.id, { ...area, release: 'none' }]));
  if (space.registryError) {
    report('projects.json', `cannot read: ${space.registryError}`);
    return projects;
  }
  const schemaErrors = validateSchema(projectsSchema, space.registry);
  for (const { path, message } of schemaErrors) report('projects.json', `${path || 'root'} ${message}`);
  if (!Array.isArray(space.registry?.projects)) return projects;

  const prefixes = new Map(RESERVED_AREAS.map((area) => [area.prefix, area.id]));
  for (const project of space.registry.projects) {
    if (!project || typeof project.id !== 'string') continue;
    if (projects.has(project.id)) {
      report('projects.json', `project id "${project.id}" is ${RESERVED_AREAS.some((a) => a.id === project.id) ? 'reserved' : 'repeated'}`);
      continue;
    }
    if (prefixes.has(project.prefix)) {
      report('projects.json', `prefix "${project.prefix}" of "${project.id}" is already used by "${prefixes.get(project.prefix)}"`);
    }
    prefixes.set(project.prefix, project.id);
    projects.set(project.id, project);
  }
  for (const folder of space.folders) {
    if (!projects.has(folder)) report(`projects/${folder}`, `folder of an unknown project "${folder}"`);
  }
  return projects;
}

/** Validates each item on its own and returns a Map of id (and alias) → entry. */
function checkItems(space, projects, report) {
  const byId = new Map();
  const claim = (id, entry, what) => {
    const other = byId.get(id);
    if (other) report(entry.file, `${what} "${id}" is also used by ${other.file}`);
    else byId.set(id, entry);
  };

  for (const entry of space.items) {
    const { file, item } = entry;
    const { fields } = item;
    const project = projects.get(entry.project);
    for (const { path, message } of validateSchema(itemSchema, fields)) report(file, `${path || 'header'} ${message}`);
    if (typeof fields.id !== 'string') continue;

    const fileName = file.slice(file.lastIndexOf('/') + 1);
    if (fileName !== `${fields.id}.md`) report(file, `file name must be ${fields.id}.md`);
    if (project && !fields.id.startsWith(`${project.prefix}-`)) {
      report(file, `id must start with the prefix of "${project.id}" (${project.prefix}-)`);
    }
    if (entry.archived && !/^\d{4}$/.test(entry.year)) report(file, 'archive folders are named after a year (YYYY)');
    if (fields.since && fields.created && fields.since < fields.created) report(file, '"since" is earlier than "created"');
    for (const problem of statusProblems(fields, fields.status, project)) report(file, problem);
    if (fields.supersededBy && fields.kind !== 'decision') report(file, 'only a decision can be superseded');

    claim(fields.id, entry, 'id');
    for (const alias of fields.aliases ?? []) claim(alias, entry, 'alias');
  }
  return byId;
}

/** Checks the fields that point to other items, and the closing rules that depend on them. */
function checkReferences(space, byId, report) {
  const children = new Map();
  for (const entry of space.items) {
    const { file, item: { fields } } = entry;
    if (fields.parent) {
      const parent = byId.get(fields.parent);
      if (!parent) report(file, `parent "${fields.parent}" does not exist`);
      else if (fields.kind !== 'task') report(file, 'only a task can have a parent');
      else if (!CONTAINER_KINDS.has(parent.item.fields.kind)) report(file, `parent "${fields.parent}" is not a feature or a bug`);
      else if (parent.project !== entry.project) report(file, `parent "${fields.parent}" belongs to another project`);
      else children.set(parent, [...(children.get(parent) ?? []), entry.item]);
    }
    for (const id of fields.related ?? []) {
      if (!byId.has(id)) report(file, `related item "${id}" does not exist`);
    }
    if (fields.supersededBy) {
      const next = byId.get(fields.supersededBy);
      if (!next) report(file, `supersededBy "${fields.supersededBy}" does not exist`);
      else if (next.item.fields.kind !== 'decision') report(file, `supersededBy "${fields.supersededBy}" is not a decision`);
    }
  }
  for (const entry of space.items) {
    for (const blocker of closeBlockers(entry.item, entry.item.fields.status, children.get(entry) ?? [])) {
      report(entry.file, `status "${entry.item.fields.status}" with ${blocker}`);
    }
  }
}
