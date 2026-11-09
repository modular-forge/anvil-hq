import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { main } from '../src/cli.js';
import { NOW, captureIo, fields, initRepo, itemText, makeSpace } from './support.js';

const run = async (dir, argv) => {
  const io = captureIo();
  const code = await main([...argv, '--data', dir], { stdout: io.stdout, stderr: io.stderr, env: {}, now: () => NOW });
  return { code, ...io.out };
};

describe('anvil write commands', () => {
  it('creates an item and commits only that file', async (t) => {
    const dir = makeSpace(t, {});
    const git = initRepo(dir);
    writeFileSync(join(dir, 'notes.txt'), 'unrelated work in progress');

    const { code, stdout } = await run(dir, ['item', 'create', 'alpha', '--kind', 'task', '--title', 'Write docs', '--step', 'Outline', '--step', 'Draft']);
    assert.equal(code, 0);
    assert.match(stdout, /^Created AL-1 \(projects\/alpha\/items\/AL-1.md\)\nCommitted [0-9a-f]+\n$/);
    assert.equal(git('log', '-1', '--format=%s'), 'AL-1: create task "Write docs"\n');
    assert.equal(git('show', '--name-only', '--format=', 'HEAD'), 'projects/alpha/items/AL-1.md\n');
    assert.equal(git('status', '--porcelain'), '?? notes.txt\n');
  });

  it('runs a whole flow: steps, status changes and a move, one commit each', async (t) => {
    const dir = makeSpace(t, { 'projects/alpha/items/AL-1.md': itemText(fields('AL-1', { kind: 'feature' })) });
    const git = initRepo(dir);
    const steps = [
      ['item', 'create', 'alpha', '--kind', 'task', '--title', 'Part', '--parent', 'AL-1', '--status', 'doing', '--step', 'Only step'],
      ['step', 'add', 'AL-2', 'Second step'],
      ['step', 'check', 'AL-2', '1'],
      ['step', 'skip', 'AL-2', '2', '--reason', 'covered by step 1'],
      ['item', 'status', 'AL-2', 'done', '--evidence', 'confirmed by user'],
      ['item', 'move', 'AL-1', 'beta'],
    ];
    for (const argv of steps) {
      const { code, stderr } = await run(dir, argv);
      assert.equal(code, 0, `${argv.join(' ')}: ${stderr}`);
    }
    assert.equal(git('log', '--format=%s', '-6'), [
      'AL-1 → BE-1, AL-2 → BE-2: move to beta',
      'AL-2: doing → done',
      'AL-2: skip step 2',
      'AL-2: check step 1',
      'AL-2: add step 2',
      'AL-2: create task "Part"',
      '',
    ].join('\n'));
    assert.equal(git('status', '--porcelain'), '', 'the move committed the deletions too');
    assert.equal((await run(dir, ['validate'])).code, 0);
  });

  it('prints the hint to close the parent when its last task closes', async (t) => {
    const dir = makeSpace(t, {
      'projects/alpha/items/AL-1.md': itemText(fields('AL-1', { kind: 'feature', status: 'doing' })),
      'projects/alpha/items/AL-2.md': itemText(fields('AL-2', { parent: 'AL-1', status: 'doing' })),
    });
    initRepo(dir);
    const { stdout } = await run(dir, ['item', 'status', 'AL-2', 'done', '--evidence', 'x']);
    assert.match(stdout, /Hint: every task of AL-1 is closed/);
  });

  it('reports rule violations with exit code 1 and writes nothing', async (t) => {
    const dir = makeSpace(t, { 'projects/alpha/items/AL-1.md': itemText(fields('AL-1'), '- [ ] Open\n') });
    const git = initRepo(dir);
    const before = readFileSync(join(dir, 'projects/alpha/items/AL-1.md'), 'utf8');
    const { code, stderr } = await run(dir, ['item', 'status', 'AL-1', 'done', '--evidence', 'x']);
    assert.equal(code, 1);
    assert.match(stderr, /^anvil: AL-1 cannot be done: 1 unchecked step\(s\): #1 Open\n$/);
    assert.equal(readFileSync(join(dir, 'projects/alpha/items/AL-1.md'), 'utf8'), before);
    assert.equal(git('status', '--porcelain'), '');
  });

  it('reports usage errors with exit code 2', async (t) => {
    const dir = makeSpace(t, {});
    assert.equal((await run(dir, ['item', 'create', 'alpha', '--kind', 'task'])).code, 2);
    assert.equal((await run(dir, ['item', 'status', 'AL-1'])).code, 2);
    assert.equal((await run(dir, ['step', 'check', 'AL-1', 'two'])).code, 2);
    assert.equal((await run(dir, ['item', 'frobnicate'])).code, 2);
  });

  it('writes but does not commit outside a git repository, and says so', async (t) => {
    const dir = makeSpace(t, {});
    const { code, stdout } = await run(dir, ['journal', 'add', 'alpha', 'Session notes']);
    assert.equal(code, 0);
    assert.match(stdout, /Not committed: the data space is not a git repository/);
    assert.equal(readFileSync(join(dir, 'projects/alpha/journal/2026-11-10.md'), 'utf8'), '## 09:05\n\nSession notes\n');
  });

  it('prints JSON with --json, commit included', async (t) => {
    const dir = makeSpace(t, {});
    initRepo(dir);
    const { stdout } = await run(dir, ['item', 'create', 'alpha', '--kind', 'idea', '--title', 'Maybe', '--json']);
    const result = JSON.parse(stdout);
    assert.equal(result.id, 'AL-1');
    assert.equal(result.commit.committed, true);
  });

  it('lists and shows items', async (t) => {
    const dir = makeSpace(t, {
      'projects/alpha/items/AL-1.md': itemText(fields('AL-1', { kind: 'feature', status: 'doing' })),
      'projects/alpha/items/AL-2.md': itemText(fields('AL-2', { parent: 'AL-1' }), '- [x] One\n- [ ] Two\n'),
      'projects/alpha/items/AL-3.md': itemText(fields('AL-3', { status: 'cancelled', reason: 'x' })),
      'projects/beta/items/BE-1.md': itemText(fields('BE-1', { labels: ['ops'] })),
    });
    assert.equal((await run(dir, ['item', 'list'])).stdout, [
      'AL-1  doing     feature  Item AL-1',
      'AL-2  todo      task     Item AL-2 [1/2]',
      'BE-1  todo      task     Item BE-1',
      '',
    ].join('\n'));
    assert.match((await run(dir, ['item', 'list', '--all'])).stdout, /AL-3  cancelled/);
    assert.deepEqual(JSON.parse((await run(dir, ['item', 'list', '--label', 'ops', '--json'])).stdout).map((r) => r.id), ['BE-1']);
    assert.deepEqual(JSON.parse((await run(dir, ['item', 'list', '--status', 'doing', '--status', 'todo', '--project', 'alpha', '--json'])).stdout).map((r) => r.id), ['AL-1', 'AL-2']);

    const shown = (await run(dir, ['item', 'show', 'AL-1'])).stdout;
    assert.match(shown, /^# projects\/alpha\/items\/AL-1.md\n---\nid: AL-1\n/);
    assert.match(shown, /Child tasks:\n {2}AL-2 {2}todo {6}Item AL-2\n$/);
    assert.deepEqual(JSON.parse((await run(dir, ['item', 'show', 'AL-2', '--json'])).stdout).steps.map((s) => s.checked), [true, false]);
  });

  it('waits for another git process to release the index lock', async (t) => {
    const dir = makeSpace(t, {});
    initRepo(dir);
    const lock = join(dir, '.git', 'index.lock');
    writeFileSync(lock, '');
    const releaser = spawn(process.execPath, ['-e', `setTimeout(() => require('node:fs').unlinkSync(${JSON.stringify(lock)}), 400)`]);
    const { code, stdout } = await run(dir, ['item', 'create', 'alpha', '--kind', 'task', '--title', 'Locked']);
    await new Promise((resolve) => releaser.on('exit', resolve));
    assert.equal(code, 0);
    assert.match(stdout, /Committed/);
  });
});
