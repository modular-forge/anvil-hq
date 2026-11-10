// Reads a whole data space: the registry and every item and journal file. Problems reading a
// single file are collected instead of thrown, so one broken file never hides the rest.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseItem } from './item.ts';
import { RESERVED_AREAS } from './rules.ts';
import type { ItemEntry, Project, Registry, Space } from './types.ts';

/**
 * Reads the registry and every item and journal file. File paths are relative to the data space
 * and use forward slashes.
 */
export function readSpace(dir: string): Space {
  const space: Space = { registry: null, registryError: null, folders: [], items: [], journals: [], unreadable: [] };
  try {
    space.registry = JSON.parse(readFileSync(join(dir, 'projects.json'), 'utf8')) as Registry;
  } catch (error) {
    space.registryError = (error as Error).message;
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
export function projectMap(registry: Registry | null | undefined): Map<string, Project> {
  const projects = new Map<string, Project>(RESERVED_AREAS.map((area) => [area.id, { ...area }]));
  for (const project of Array.isArray(registry?.projects) ? registry.projects : []) {
    if (project && typeof project.id === 'string' && !projects.has(project.id)) projects.set(project.id, project);
  }
  return projects;
}

type OnDuplicate = (entry: ItemEntry, id: string, other: ItemEntry, what: 'id' | 'alias') => void;

/**
 * Map of id and alias → item entry. When two entries claim the same id, the first one keeps it
 * and `onDuplicate` is called for the second.
 */
export function indexItems(items: ItemEntry[], onDuplicate: OnDuplicate = () => {}): Map<string, ItemEntry> {
  const byId = new Map<string, ItemEntry>();
  const claim = (entry: ItemEntry, id: string, what: 'id' | 'alias') => {
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

function readItemFile(dir: string, space: Space, entry: Omit<ItemEntry, 'mtimeMs' | 'item'>): void {
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
    space.unreadable.push({ file: entry.file, message: (error as Error).message });
  }
}

function subfolders(path: string): string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

function entries(path: string): string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name).sort();
}
