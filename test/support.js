// Helpers shared by the tests. Every data space is made up and written to a fresh temp folder.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export const REGISTRY = {
  schemaVersion: 1,
  projects: [
    { id: 'alpha', prefix: 'AL', name: 'Alpha', state: 'active', kind: 'web', release: 'versioned' },
    { id: 'beta', prefix: 'BE', name: 'Beta', state: 'active', kind: 'server', release: 'none' },
  ],
};

/** Writes `files` ({ relativePath: text or object }) into a new temp folder and returns it. */
export function makeSpace(t, files) {
  const dir = mkdtempSync(join(tmpdir(), 'anvil-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const all = { 'projects.json': REGISTRY, ...files };
  for (const [path, content] of Object.entries(all)) {
    if (content === undefined) continue;
    const file = join(dir, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  }
  return dir;
}

/** Builds item text from header fields and an optional body. */
export function itemText(fields, body = '') {
  const header = Object.entries(fields).map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.join(', ')}]` : v}`);
  return ['---', ...header, '---', body].join('\n');
}

/** A minimal valid item header, overridable field by field. */
export function fields(id, overrides = {}) {
  return { id, title: `Item ${id}`, kind: 'task', status: 'todo', since: '2026-01-02', created: '2026-01-01', ...overrides };
}

/** Collects what a CLI run writes, for main({ stdout, stderr }). */
export function captureIo() {
  const out = { stdout: '', stderr: '' };
  return {
    out,
    stdout: { write: (s) => { out.stdout += s; } },
    stderr: { write: (s) => { out.stderr += s; } },
  };
}
