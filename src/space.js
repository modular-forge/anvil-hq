// Reads a whole data space: the registry and every item and journal file. Problems reading a
// single file are collected instead of thrown, so one broken file never hides the rest.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseItem } from './item.js';

/**
 * Returns { registry, registryError, folders, items, journals, unreadable }.
 * - folders: names of the folders under projects/.
 * - items: { file, project, archived, year, item } for every parsed item file.
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

function readItemFile(dir, space, entry) {
  if (!entry.file.endsWith('.md')) {
    space.unreadable.push({ file: entry.file, message: 'only .md item files belong here' });
    return;
  }
  try {
    const item = parseItem(readFileSync(join(dir, entry.file), 'utf8'));
    space.items.push({ ...entry, item });
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
