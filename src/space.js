// Reads a whole data space: the registry and every item and journal file. Problems reading a
// single file are collected instead of thrown, so one broken file never hides the rest.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseItem } from './item.js';
import { RESERVED_AREAS } from './rules.js';

/**
 * Returns { registry, registryError, folders, items, journals, unreadable }.
 * - folders: names of the folders under projects/.
 * - items: { file, project, archived, year, mtimeMs, item } for every parsed item file.
 * - journals: { file, project, name } for every file under a journal/ folder.
 * - unreadable: { file, message } for files that could not be read or parsed.
 * File paths are relative to the data space and use forward slashes.
 */
export function readSpace(dir) {
  const space = { registry: null, registryError: null, folders: [], items: [], journals: [], unreadable: [] };
  try {
    space.registry = JSON.parse(readFileSync(join(dir, 'projects.json'), 'utf8'));
  } catch (error) {
    space.registryError = error.message;
  }

  const projectsDir = join(dir, 'projects');
  space.folders = subfolders(projectsDir);
  for (const project of space.folders) {
    const base = `projects/${project}`;
    for (const name of entries(join(dir, base, 'items'))) {
      readItemFile(dir, space, { file: `${base}/items/${name}`, project, archived: false, year: null });
    }
    for (const year of subfolders(join(dir, base, 'archive'))) {
      for (const name of entries(join(dir, base, 'archive', year))) {
        readItemFile(dir, space, { file: `${base}/archive/${year}/${name}`, project, archived: true, year });
      }
    }
    for (const name of entries(join(dir, base, 'journal'))) {
      space.journals.push({ file: `${base}/journal/${name}`, project, name });
    }
  }
  return space;
}

/** Map of project id → project, the reserved inbox and general areas included. First one wins. */
export function projectMap(registry) {
  const projects = new Map(RESERVED_AREAS.map((area) => [area.id, { ...area, release: 'none' }]));
  for (const project of Array.isArray(registry?.projects) ? registry.projects : []) {
    if (project && typeof project.id === 'string' && !projects.has(project.id)) projects.set(project.id, project);
  }
  return projects;
}

/**
 * Map of id and alias → item entry. When two entries claim the same id, the first one keeps it
 * and `onDuplicate(entry, id, other, what)` is called for the second.
 */
export function indexItems(items, onDuplicate = () => {}) {
  const byId = new Map();
  const claim = (entry, id, what) => {
    const other = byId.get(id);
    if (other) onDuplicate(entry, id, other, what);
    else byId.set(id, entry);
  };
  for (const entry of items) {
    if (typeof entry.item.fields.id !== 'string') continue;
    claim(entry, entry.item.fields.id, 'id');
    for (const alias of entry.item.fields.aliases ?? []) claim(entry, alias, 'alias');
  }
  return byId;
}

function readItemFile(dir, space, entry) {
  if (!entry.file.endsWith('.md')) {
    space.unreadable.push({ file: entry.file, message: 'only .md item files belong here' });
    return;
  }
  try {
    const path = join(dir, entry.file);
    const mtimeMs = statSync(path).mtimeMs;
    const item = parseItem(readFileSync(path, 'utf8'));
    space.items.push({ ...entry, mtimeMs, item });
  } catch (error) {
    space.unreadable.push({ file: entry.file, message: error.message });
  }
}

function subfolders(path) {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

function entries(path) {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name).sort();
}
