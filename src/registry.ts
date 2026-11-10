// Writing projects.json. The file is rewritten in a stable style (objects on several lines,
// arrays of plain values on one) so that each change shows up in git as a small diff.

import { join } from 'node:path';
import { AnvilError } from './errors.ts';
import { mtimeOf, writeAtomic } from './fsutil.ts';
import type { Context, Project, Registry } from './types.ts';
import { registryProblems } from './validate.ts';

export const REGISTRY_FILE = 'projects.json';
const PROJECT_KEYS = ['id', 'prefix', 'name', 'summary', 'state', 'kind', 'release', 'repos', 'notion'];

/** JSON with two-space indentation, keeping arrays of plain values on one line. */
export function formatJson(value: unknown, indent = ''): string {
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.every((v) => v === null || typeof v !== 'object')) return `[${value.map((v) => JSON.stringify(v)).join(', ')}]`;
    return `[\n${value.map((v) => inner + formatJson(v, inner)).join(',\n')}\n${indent}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value);
    if (!entries.length) return '{}';
    return `{\n${entries.map(([key, v]) => `${inner}${JSON.stringify(key)}: ${formatJson(v, inner)}`).join(',\n')}\n${indent}}`;
  }
  return JSON.stringify(value);
}

/** Puts a project's fields in their canonical order and drops empty ones. */
export function normalizeProject(project: Partial<Project> & Record<string, unknown>): Project {
  const ordered: Record<string, unknown> = {};
  for (const key of [...PROJECT_KEYS, ...Object.keys(project).filter((k) => !PROJECT_KEYS.includes(k))]) {
    const value = project[key];
    if (value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) continue;
    ordered[key] = value;
  }
  return ordered as unknown as Project;
}

/**
 * Validates and writes `registry`. Refuses if projects.json changed on disk since `ctx` read it.
 * Returns the relative path written.
 */
export function writeRegistry(ctx: Pick<Context, 'dir' | 'registryMtimeMs'>, registry: Registry): string {
  const problems = registryProblems(registry);
  if (problems.length) throw new AnvilError(`projects.json would be invalid: ${problems.join('; ')}`);
  writeAtomic(join(ctx.dir, REGISTRY_FILE), `${formatJson(registry)}\n`, { expectMtimeMs: ctx.registryMtimeMs });
  return REGISTRY_FILE;
}

export function registryMtime(dir: string): number | null {
  return mtimeOf(join(dir, REGISTRY_FILE));
}
