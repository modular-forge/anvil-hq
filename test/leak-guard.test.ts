import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { findLeaks, looksLikeItem, looksLikeRegistry, stagedFiles, trackedFiles, type CandidateFile } from '../src/leak-guard.ts';
import { REGISTRY, fields, initRepo, itemText, makeSpace } from './support.ts';

const file = (path: string, text: string): CandidateFile => ({ path, read: () => text });
const ITEM = itemText(fields('AL-1'));

describe('looksLikeItem and looksLikeRegistry', () => {
  it('recognises item headers and data registries', () => {
    assert.equal(looksLikeItem(ITEM), true);
    assert.equal(looksLikeItem('---\ntitle: A blog post\ndate: 2026-01-01\n---\nText'), false, 'front matter without an item id');
    assert.equal(looksLikeItem('---\nid: not-an-id\nkind: task\nstatus: todo\n---\n'), false);
    assert.equal(looksLikeItem('# Just Markdown'), false);
    assert.equal(looksLikeRegistry(JSON.stringify(REGISTRY)), true);
    assert.equal(looksLikeRegistry('{"name": "anvil-hq", "version": "1.0.0"}'), false);
    assert.equal(looksLikeRegistry('{ broken'), false);
  });
});

describe('findLeaks', () => {
  it('flags data outside examples/ and allows it inside', () => {
    const leaks = findLeaks([
      file('notes/AL-1.md', ITEM),
      file('projects.json', JSON.stringify(REGISTRY)),
      file('backup/projects/alpha/journal/2026-01-01.md', '## 10:00\n\nNo header here'),
      file('examples/projects/alpha/items/AL-1.md', ITEM),
      file('examples/projects.json', JSON.stringify(REGISTRY)),
      file('docs/format.md', '# Data format\n\n```markdown\n---\nid: AL-1\n---\n```\n'),
      file('package.json', '{"name": "x"}'),
    ]);
    assert.deepEqual(leaks, [
      { path: 'notes/AL-1.md', reason: 'has an item header' },
      { path: 'projects.json', reason: 'is a projects.json data registry' },
      { path: 'backup/projects/alpha/journal/2026-01-01.md', reason: 'is inside a data space folder (projects/<id>/items, archive or journal)' },
    ]);
  });

  it('never reads files it does not need to', () => {
    const untouchable = (path: string): CandidateFile => ({ path, read: () => { throw new Error(`read ${path}`); } });
    assert.deepEqual(findLeaks([untouchable('src/cli.ts'), untouchable('examples/projects/x/items/X-1.md'), untouchable('logo.png')]), []);
  });

  it('finds nothing in this repository', () => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    assert.deepEqual(findLeaks(trackedFiles(root)), []);
  });
});

describe('stagedFiles', () => {
  it('reads what is staged, not what is in the working tree', (t) => {
    const repo = makeSpace(t, { 'projects.json': undefined, 'README.md': '# Hello\n' });
    const git = initRepo(repo);
    writeFileSync(join(repo, 'notes.md'), ITEM);
    git('add', 'notes.md');
    writeFileSync(join(repo, 'notes.md'), '# Rewritten after staging\n');
    const staged = stagedFiles(repo);
    assert.deepEqual(staged.map((f) => f.path), ['notes.md']);
    assert.deepEqual(findLeaks(staged), [{ path: 'notes.md', reason: 'has an item header' }]);
  });

  it('makes the pre-commit hook block the commit', (t) => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const repo = makeSpace(t, { 'projects.json': undefined, 'README.md': '# Hello\n' });
    const git = initRepo(repo);
    writeFileSync(join(repo, 'AL-1.md'), ITEM);
    git('add', 'AL-1.md');
    const script = join(root, 'scripts', 'check-leaks.ts');
    assert.throws(
      () => execFileSync(process.execPath, [script, '--staged'], { cwd: repo, encoding: 'utf8', stdio: 'pipe' }),
      (error: Error & { status?: number; stderr?: string }) => error.status === 1 && /AL-1\.md: has an item header/.test(error.stderr ?? ''),
    );
    git('rm', '--cached', '--quiet', 'AL-1.md');
    assert.match(execFileSync(process.execPath, [script, '--staged'], { cwd: repo, encoding: 'utf8' }), /No personal data found/);
  });
});
