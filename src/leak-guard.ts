// Guards this public repository against personal data: anything that looks like a data space
// (an item file, a projects.json registry, or a file under a project's items, archive or journal
// folder) is only allowed inside examples/. Used by the pre-commit hook and by CI.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseHeader, splitDocument } from './frontmatter.ts';

const ALLOWED_PREFIX = 'examples/';
const ITEM_ID = /^[A-Z]{2,4}-[1-9][0-9]*$/;
const DATA_FOLDER = /(^|\/)projects\/[^/]+\/(items|archive|journal)\//;

export interface Leak {
  path: string;
  reason: string;
}

export interface CandidateFile {
  /** Repository-relative, with forward slashes. */
  path: string;
  read: () => string;
}

/** Whether `text` is an item file: a header with an item id, a kind and a status. */
export function looksLikeItem(text: string): boolean {
  try {
    const header = parseHeader(splitDocument(text).headerLines);
    return typeof header.id === 'string' && ITEM_ID.test(header.id) && typeof header.kind === 'string' && typeof header.status === 'string';
  } catch {
    return false;
  }
}

/** Whether `text` is a projects.json data registry. */
export function looksLikeRegistry(text: string): boolean {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null && 'schemaVersion' in value && Array.isArray((value as { projects?: unknown }).projects);
  } catch {
    return false;
  }
}

/** The files that look like personal data and lie outside examples/. */
export function findLeaks(files: CandidateFile[]): Leak[] {
  const leaks: Leak[] = [];
  for (const { path, read } of files) {
    if (path.startsWith(ALLOWED_PREFIX)) continue;
    if (DATA_FOLDER.test(path)) {
      leaks.push({ path, reason: 'is inside a data space folder (projects/<id>/items, archive or journal)' });
      continue;
    }
    const isMarkdown = path.endsWith('.md');
    const isRegistry = path === 'projects.json' || path.endsWith('/projects.json');
    if (!isMarkdown && !isRegistry) continue;
    const text = read();
    if (isMarkdown && looksLikeItem(text)) leaks.push({ path, reason: 'has an item header' });
    if (isRegistry && looksLikeRegistry(text)) leaks.push({ path, reason: 'is a projects.json data registry' });
  }
  return leaks;
}

function git(dir: string, args: string[]): string {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
}

/** Files staged for the next commit (added, copied, modified or renamed), read from the index. */
export function stagedFiles(dir: string): CandidateFile[] {
  return git(dir, ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'])
    .split('\0')
    .filter(Boolean)
    .map((path) => ({ path, read: () => git(dir, ['show', `:${path}`]) }));
}

/** Every tracked file, read from the working tree. */
export function trackedFiles(dir: string): CandidateFile[] {
  return git(dir, ['ls-files', '-z'])
    .split('\0')
    .filter(Boolean)
    .map((path) => ({ path, read: () => readFileSync(join(dir, path), 'utf8') }));
}
