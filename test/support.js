// Helpers shared by the tests. Every data space is made up and written to a fresh temp folder.

import { execFileSync } from 'node:child_process';
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

/** Turns `dir` into a git repository with a made-up identity and commits everything in it. */
export function initRepo(dir) {
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  git('init', '--quiet', '--initial-branch=main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('config', 'core.autocrlf', 'false');
  git('add', '--all');
  git('commit', '--quiet', '--allow-empty', '-m', 'initial');
  return git;
}

/** A fixed local time for the tests: 10 November 2026, 09:05. */
export const NOW = new Date(2026, 10, 10, 9, 5);

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
