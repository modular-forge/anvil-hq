import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, type TestContext } from 'node:test';
import type { ServerOptions } from '../src/server/server.ts';
import { BOARD_EVIDENCE } from '../src/server/writes.ts';
import { startTestServer } from './server-support.ts';
import { NOW, fields, initRepo, item, itemText, makeSpace, type SpaceFiles } from './support.ts';

const FILES: SpaceFiles = {
  ...item('alpha', 'AL-1', { kind: 'feature', status: 'doing' }, 'Some notes.\n\n- [ ] One\n- [ ] Two\n'),
  ...item('alpha', 'AL-2', { parent: 'AL-1' }),
  ...item('alpha', 'AL-7', { status: 'done', evidence: 'PR 7' }),
  ...item('beta', 'BE-1'),
  ...item('inbox', 'IN-1', { kind: 'idea', status: 'backlog', title: 'A cookbook app' }),
};

/** A server over a git repository holding FILES, with a fixed clock. */
async function serve(t: TestContext, files: SpaceFiles = FILES, options: Partial<ServerOptions> = {}) {
  const dir = makeSpace(t, files);
  const git = initRepo(dir);
  const server = await startTestServer(t, {}, { dir, watch: false, now: () => NOW, ...options });
  /** The current ETag of an item, as the board would have it. */
  const etag = async (id: string) => String((await server.call(`/api/items/${id}`)).headers.etag);
  const lastCommit = () => git('log', '-1', '--format=%s').trim();
  return { ...server, git, etag, lastCommit };
}

const read = (dir: string, file: string) => readFileSync(join(dir, file), 'utf8');

describe('server writes: items', () => {
  it('creates an item, commits it and returns it with its ETag', async (t) => {
    const { call, dir, lastCommit } = await serve(t);
    const reply = await call('/api/items', { method: 'POST', json: { project: 'alpha', kind: 'task', title: 'Write the docs', parent: 'AL-1', labels: ['docs'], steps: ['Outline'] } });
    assert.equal(reply.status, 201);
    const result = reply.json();
    assert.equal(result.id, 'AL-8');
    assert.equal(result.commit.committed, true);
    assert.equal(result.item.fields.created, '2026-11-10');
    assert.equal(result.item.steps.length, 1);
    assert.equal(reply.headers.etag, result.item.etag);
    assert.match(read(dir, 'projects/alpha/items/AL-8.md'), /labels: \[docs\]/);
    assert.match(lastCommit(), /AL-8/);
  });

  it('reports bad bodies as 400 and broken rules as 422, writing nothing', async (t) => {
    const { call, dir } = await serve(t);
    const post = (json: unknown) => call('/api/items', { method: 'POST', json });
    assert.equal((await post({ project: 'alpha', kind: 'task' })).status, 400);
    assert.equal((await post({ project: 'alpha', kind: 'task', title: 'X', colour: 'red' })).status, 400);
    assert.equal((await post({ project: 'alpha', kind: 'task', title: 7 })).status, 400);
    assert.equal((await post({ project: 'alpha', kind: 'task', title: 'X', labels: 'a,b' })).status, 400);
    assert.equal((await post([1, 2])).status, 400);
    assert.equal((await call('/api/items', { method: 'POST', body: '{ nope', headers: { 'content-type': 'application/json' } })).status, 400);
    const rule = await post({ project: 'alpha', kind: 'chore', title: 'X' });
    assert.equal(rule.status, 422);
    assert.match(rule.json().error, /kind/);
    assert.equal(existsSync(join(dir, 'projects/alpha/items/AL-8.md')), false);
  });

  it('refuses bodies over the size limit', async (t) => {
    const { call } = await serve(t);
    const reply = await call('/api/items', { method: 'POST', json: { project: 'alpha', kind: 'task', title: 'X', body: 'x'.repeat(300 * 1024) } });
    assert.equal(reply.status, 413);
  });

  it('changes fields with PATCH: lists as arrays, null removes', async (t) => {
    const { call, dir, etag } = await serve(t);
    const reply = await call('/api/items/AL-2', { method: 'PATCH', headers: { 'if-match': await etag('AL-2') }, json: { title: 'Renamed', labels: ['ui', 'forms'], parent: null } });
    assert.equal(reply.status, 200);
    const text = read(dir, 'projects/alpha/items/AL-2.md');
    assert.match(text, /title: Renamed/);
    assert.match(text, /labels: \[ui, forms\]/);
    assert.doesNotMatch(text, /parent:/);
    const commas = await call('/api/items/AL-2', { method: 'PATCH', headers: { 'if-match': reply.json().item.etag }, json: { labels: ['a,b'] } });
    assert.equal(commas.status, 400);
    assert.equal((await call('/api/items/AL-2', { method: 'PATCH', headers: { 'if-match': reply.json().item.etag }, json: { status: 'done' } })).status, 400);
  });
});

describe('server writes: If-Match and conflicts', () => {
  it('needs If-Match to change an item', async (t) => {
    const { call } = await serve(t);
    const reply = await call('/api/items/AL-2/status', { method: 'POST', json: { status: 'doing' } });
    assert.equal(reply.status, 428);
    assert.equal((await call('/api/items/AL-99/status', { method: 'POST', headers: { 'if-match': '"1"' }, json: { status: 'doing' } })).status, 404);
  });

  it('answers 409 with the current item when the file changed on disk, and writes nothing', async (t) => {
    const { call, dir, etag } = await serve(t);
    const seen = await etag('AL-2');
    // Another writer (a Claude session, an editor) changes the file after the board loaded it.
    const file = join(dir, 'projects/alpha/items/AL-2.md');
    writeFileSync(file, itemText(fields('AL-2', { parent: 'AL-1', title: 'Edited elsewhere' })));
    utimesSync(file, new Date(), new Date(Date.now() + 5000));

    const reply = await call('/api/items/AL-2/status', { method: 'POST', headers: { 'if-match': seen }, json: { status: 'doing' } });
    assert.equal(reply.status, 409);
    const { current, error } = reply.json();
    assert.match(error, /changed on disk/);
    assert.equal(current.fields.title, 'Edited elsewhere');
    assert.equal(current.fields.status, 'todo');
    assert.equal(reply.headers.etag, current.etag);

    const retry = await call('/api/items/AL-2/status', { method: 'POST', headers: { 'if-match': current.etag }, json: { status: 'doing' } });
    assert.equal(retry.status, 200);
  });
});

describe('server writes: status', () => {
  it('moves an item, commits it and returns the new ETag', async (t) => {
    const { call, etag, lastCommit } = await serve(t);
    const before = await etag('AL-2');
    const reply = await call('/api/items/AL-2/status', { method: 'POST', headers: { 'if-match': before }, json: { status: 'doing' } });
    assert.equal(reply.status, 200);
    assert.equal(reply.json().item.fields.status, 'doing');
    assert.notEqual(reply.headers.etag, before);
    assert.equal(lastCommit(), 'AL-2: todo → doing');
  });

  it('saves the board evidence when done comes without one, and keeps a given one', async (t) => {
    const { call, etag, dir } = await serve(t);
    let reply = await call('/api/items/AL-2/status', { method: 'POST', headers: { 'if-match': await etag('AL-2') }, json: { status: 'done' } });
    assert.equal(reply.status, 200);
    assert.equal(reply.json().item.fields.evidence, BOARD_EVIDENCE);
    assert.match(reply.json().hint, /every task of AL-1 is closed/);

    reply = await call('/api/items/BE-1/status', { method: 'POST', headers: { 'if-match': await etag('BE-1') }, json: { status: 'done', evidence: ' https://example.com/pull/3 ' } });
    assert.equal(reply.json().item.fields.evidence, 'https://example.com/pull/3');
    assert.match(read(dir, 'projects/beta/items/BE-1.md'), /evidence: https:\/\/example.com\/pull\/3/);
  });

  it('applies the closing rules: reasons, open child tasks', async (t) => {
    const { call, etag } = await serve(t);
    const blocked = await call('/api/items/AL-2/status', { method: 'POST', headers: { 'if-match': await etag('AL-2') }, json: { status: 'blocked' } });
    assert.equal(blocked.status, 422);
    assert.match(blocked.json().error, /reason/);
    const parent = await call('/api/items/AL-1/status', { method: 'POST', headers: { 'if-match': await etag('AL-1') }, json: { status: 'done' } });
    assert.equal(parent.status, 422);
    assert.match(parent.json().error, /AL-2/);
  });
});

describe('server writes: steps, move, promote', () => {
  it('adds, checks and skips steps', async (t) => {
    const { call, etag, dir } = await serve(t);
    let reply = await call('/api/items/AL-1/steps', { method: 'POST', headers: { 'if-match': await etag('AL-1') }, json: { text: 'Three' } });
    assert.equal(reply.status, 200);
    assert.equal(reply.json().step, 3);
    reply = await call('/api/items/AL-1/steps/1', { method: 'POST', headers: { 'if-match': reply.json().item.etag }, json: { action: 'check' } });
    assert.equal(reply.status, 200);
    reply = await call('/api/items/AL-1/steps/2', { method: 'POST', headers: { 'if-match': reply.json().item.etag }, json: { action: 'skip', reason: 'Not needed' } });
    assert.equal(reply.status, 200);
    assert.match(read(dir, 'projects/alpha/items/AL-1.md'), /- \[x\] One\n- \[x\] ~~Two~~ \(skipped: Not needed\)\n- \[ \] Three/);

    const tag = reply.json().item.etag;
    assert.equal((await call('/api/items/AL-1/steps/0', { method: 'POST', headers: { 'if-match': tag }, json: { action: 'check' } })).status, 400);
    assert.equal((await call('/api/items/AL-1/steps/3', { method: 'POST', headers: { 'if-match': tag }, json: { action: 'toggle' } })).status, 400);
    assert.equal((await call('/api/items/AL-1/steps/9', { method: 'POST', headers: { 'if-match': tag }, json: { action: 'check' } })).status, 422);
  });

  it('moves an item with its tasks and returns it under its new id', async (t) => {
    const { call, etag, dir } = await serve(t);
    const reply = await call('/api/items/AL-1/move', { method: 'POST', headers: { 'if-match': await etag('AL-1') }, json: { project: 'beta' } });
    assert.equal(reply.status, 200);
    const result = reply.json();
    assert.deepEqual(result.moved, [['AL-1', 'BE-2'], ['AL-2', 'BE-3']]);
    assert.equal(result.item.id, 'BE-2');
    assert.deepEqual(result.item.fields.aliases, ['AL-1']);
    assert.equal(existsSync(join(dir, 'projects/alpha/items/AL-1.md')), false);
    assert.equal(result.commit.committed, true);
  });

  it('promotes an idea to a new project', async (t) => {
    const { call, etag, dir } = await serve(t);
    const reply = await call('/api/items/IN-1/promote', { method: 'POST', headers: { 'if-match': await etag('IN-1') }, json: { id: 'cookbook', prefix: 'CB', kind: 'mobile', release: 'versioned' } });
    assert.equal(reply.status, 200);
    const result = reply.json();
    assert.equal(result.item.id, 'CB-1');
    assert.ok(result.created.length > 0);
    const registry = JSON.parse(read(dir, 'projects.json'));
    assert.equal(registry.projects.find((p: { id: string }) => p.id === 'cookbook').state, 'idea');
  });
});

describe('server writes: projects', () => {
  it('appends to the journal of the day', async (t) => {
    const { call, dir, lastCommit } = await serve(t);
    const reply = await call('/api/projects/alpha/journal', { method: 'POST', json: { text: 'Started on AL-2.' } });
    assert.equal(reply.status, 200);
    assert.equal(reply.json().file, 'projects/alpha/journal/2026-11-10.md');
    assert.equal(read(dir, 'projects/alpha/journal/2026-11-10.md'), '## 09:05\n\nStarted on AL-2.\n');
    assert.equal(lastCommit(), 'journal: alpha 2026-11-10');
    assert.equal((await call('/api/projects/nope/journal', { method: 'POST', json: { text: 'x' } })).status, 404);
    assert.equal((await call('/api/projects/alpha/journal', { method: 'POST', json: { text: '  ' } })).status, 400);
  });

  it('previews and publishes a release', async (t) => {
    const { call, dir } = await serve(t);
    const preview = await call('/api/projects/alpha/release', { method: 'POST', json: { version: '1.2.0', dryRun: true } });
    assert.equal(preview.status, 200);
    assert.deepEqual(preview.json().released, ['AL-7']);
    assert.equal(preview.json().commit, null);
    assert.match(read(dir, 'projects/alpha/items/AL-7.md'), /status: done/);

    const real = await call('/api/projects/alpha/release', { method: 'POST', json: { version: '1.2.0' } });
    assert.equal(real.status, 200);
    assert.match(real.json().notes, /1\.2\.0/);
    assert.match(read(dir, 'projects/alpha/items/AL-7.md'), /status: released/);
    assert.equal((await call('/api/projects/beta/release', { method: 'POST', json: { version: '1.0.0' } })).status, 422);
  });
});

describe('server writes: safety', () => {
  it('is read-only while the data space does not validate', async (t) => {
    const { call, dir } = await serve(t, { ...FILES, ...item('beta', 'BE-5', { kind: 'chore' }) });
    const reply = await call('/api/projects/alpha/journal', { method: 'POST', json: { text: 'x' } });
    assert.equal(reply.status, 423);
    assert.match(reply.json().error, /read-only/);
    assert.equal(existsSync(join(dir, 'projects/alpha/journal')), false);
  });

  it('still writes outside a git repository, and says it did not commit', async (t) => {
    const dir = makeSpace(t, FILES);
    const { call } = await startTestServer(t, {}, { dir, watch: false, now: () => NOW });
    const reply = await call('/api/projects/alpha/journal', { method: 'POST', json: { text: 'x' } });
    assert.equal(reply.status, 200);
    assert.deepEqual(reply.json().commit, { committed: false, reason: 'the data space is not a git repository' });
  });
});

describe('server history and git status', () => {
  it('lists the commits of an item, newest first, through a move', async (t) => {
    const { call, etag } = await serve(t);
    await call('/api/items/AL-2/status', { method: 'POST', headers: { 'if-match': await etag('AL-2') }, json: { status: 'doing' } });
    await call('/api/items/AL-1/move', { method: 'POST', headers: { 'if-match': await etag('AL-1') }, json: { project: 'beta' } });
    const history = (await call('/api/items/BE-3/history')).json();
    assert.deepEqual(history.map((h: { subject: string }) => h.subject), ['AL-1 → BE-2, AL-2 → BE-3: move to beta', 'AL-2: todo → doing', 'initial']);
    assert.match(history[0].date, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal((await call('/api/items/AL-99/history')).status, 404);
  });

  it('warns when there is no remote, too many unpushed commits or old ones', async (t) => {
    const { call, git, dir } = await serve(t);
    let status = (await call('/api/git')).json();
    assert.equal(status.repository, true);
    assert.equal(status.upstream, false);
    assert.equal(status.stale, true);

    const remote = mkdtempSync(join(tmpdir(), 'anvil-remote-'));
    t.after(() => rmSync(remote, { recursive: true, force: true }));
    execFileSync('git', ['init', '--quiet', '--bare', remote]);
    git('remote', 'add', 'origin', remote);
    git('push', '--quiet', '-u', 'origin', 'main');
    status = (await call('/api/git')).json();
    assert.deepEqual([status.upstream, status.unpushed, status.stale], [true, 0, false]);

    await call('/api/projects/alpha/journal', { method: 'POST', json: { text: 'x' } });
    writeFileSync(join(dir, 'notes.txt'), 'scratch');
    status = (await call('/api/git')).json();
    assert.deepEqual([status.unpushed, status.stale], [1, false]);
    assert.deepEqual(status.uncommitted, ['notes.txt']);

    for (let i = 0; i < 9; i++) git('commit', '--quiet', '--allow-empty', '-m', `empty ${i}`);
    status = (await call('/api/git')).json();
    assert.deepEqual([status.unpushed, status.stale], [10, true]);
  });

  it('warns when the oldest unpushed commit is two days old', async (t) => {
    const later = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const { call, git } = await serve(t, FILES, { now: () => later });
    const remote = mkdtempSync(join(tmpdir(), 'anvil-remote-'));
    t.after(() => rmSync(remote, { recursive: true, force: true }));
    execFileSync('git', ['init', '--quiet', '--bare', remote]);
    git('remote', 'add', 'origin', remote);
    git('push', '--quiet', '-u', 'origin', 'main');
    git('commit', '--quiet', '--allow-empty', '-m', 'one');
    const status = (await call('/api/git')).json();
    assert.deepEqual([status.unpushed, status.stale], [1, true]);
  });

  it('reports a data space outside git', async (t) => {
    const { call } = await startTestServer(t, FILES, { watch: false });
    assert.deepEqual((await call('/api/git')).json(), { repository: false, upstream: false, unpushed: null, oldestUnpushed: null, uncommitted: [], stale: true });
  });
});
