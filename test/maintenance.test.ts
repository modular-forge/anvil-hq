import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, type TestContext } from 'node:test';
import { briefing, detectProject } from '../src/briefing.ts';
import { doctor, type CheckResult } from '../src/doctor.ts';
import { initSpace } from '../src/init.ts';
import { archiveItems, isFinal, search } from '../src/maintenance.ts';
import { CURRENT_VERSION, migrate } from '../src/migrate.ts';
import { openSpace } from '../src/store.ts';
import { validateSpace } from '../src/validate.ts';
import { NOW, fields, initRepo, itemText, makeSpace, item } from './support.ts';

const versioned = { release: 'versioned' };
const unversioned = { release: 'none' };

describe('isFinal', () => {
  it('follows the final status of each kind and project', () => {
    assert.equal(isFinal({ kind: 'task', status: 'released' }, versioned), true);
    assert.equal(isFinal({ kind: 'task', status: 'done' }, versioned), false, 'done but not yet released');
    assert.equal(isFinal({ kind: 'task', status: 'done' }, unversioned), true);
    assert.equal(isFinal({ kind: 'idea', status: 'done' }, versioned), true);
    assert.equal(isFinal({ kind: 'decision', status: 'done' }, unversioned), false, 'a decision in force');
    assert.equal(isFinal({ kind: 'decision', status: 'done', supersededBy: 'X-1' }, unversioned), true);
    assert.equal(isFinal({ kind: 'decision', status: 'cancelled' }, unversioned), true);
    assert.equal(isFinal({ kind: 'task', status: 'doing' }, unversioned), false);
  });
});

describe('archiveItems', () => {
  it('moves items in their final status for archiveAfterDays to archive/<year>/', (t) => {
    const dir = makeSpace(t, {
      ...item('beta', 'BE-1', { status: 'done', since: '2026-09-11', evidence: 'x' }), // exactly 60 days
      ...item('beta', 'BE-2', { status: 'done', since: '2026-09-12', evidence: 'x' }), // 59 days
      ...item('alpha', 'AL-1', { status: 'done', created: '2025-11-01', since: '2025-12-01', evidence: 'x' }), // versioned, not released
      ...item('alpha', 'AL-2', { status: 'cancelled', created: '2025-11-01', since: '2025-12-01', reason: 'x' }),
      ...item('general', 'GN-1', { kind: 'decision', status: 'done', created: '2025-01-05', since: '2025-01-05' }),
    });
    const preview = archiveItems(openSpace(dir), NOW, { dryRun: true });
    assert.deepEqual(preview.archived.map((a) => a.id), ['AL-2', 'BE-1']);
    assert.deepEqual(preview.paths, []);

    const result = archiveItems(openSpace(dir), NOW);
    assert.deepEqual(result.archived.map((a) => a.to), ['projects/alpha/archive/2025/AL-2.md', 'projects/beta/archive/2026/BE-1.md']);
    assert.ok(!existsSync(join(dir, 'projects/beta/items/BE-1.md')));
    assert.ok(existsSync(join(dir, 'projects/beta/archive/2026/BE-1.md')));
    assert.deepEqual(validateSpace(dir).errors, []);
  });

  it('uses archiveAfterDays from projects.json', (t) => {
    const dir = makeSpace(t, {
      'projects.json': { schemaVersion: 1, archiveAfterDays: 7, projects: [{ id: 'beta', prefix: 'BE', name: 'Beta', state: 'active', kind: 'server', release: 'none' }] },
      ...item('beta', 'BE-1', { status: 'done', since: '2026-11-03', evidence: 'x' }),
    });
    assert.deepEqual(archiveItems(openSpace(dir), NOW, { dryRun: true }).archived.map((a) => a.id), ['BE-1']);
  });
});

describe('search', () => {
  it('finds text in ids, titles, labels, bodies and journal notes, case-insensitively', (t) => {
    const dir = makeSpace(t, {
      ...item('alpha', 'AL-1', { title: 'Payment form' }),
      ...item('alpha', 'AL-2', { labels: ['payments'] }),
      ...item('beta', 'BE-1', {}, 'Talk to the PAYMENT provider\n'),
      'projects/alpha/archive/2025/AL-3.md': itemText(fields('AL-3', { title: 'Old payment page', status: 'cancelled', reason: 'x' })),
      'projects/beta/journal/2026-11-09.md': '## 10:00\n\nCalled about payment limits\n',
    });
    const ctx = openSpace(dir);
    const result = search(ctx, 'payment');
    assert.deepEqual(result.items.map((r) => r.id), ['AL-1', 'AL-2', 'BE-1']);
    assert.deepEqual(result.journal, [{ file: 'projects/beta/journal/2026-11-09.md', line: 3, text: 'Called about payment limits' }]);
    assert.deepEqual(search(ctx, 'payment', { includeArchive: true }).items.map((r) => r.id), ['AL-1', 'AL-2', 'AL-3', 'BE-1']);
    assert.deepEqual(search(ctx, 'payment', { project: 'beta' }).items.map((r) => r.id), ['BE-1']);
  });
});

describe('initSpace', () => {
  const config = (t: TestContext) => {
    const home = makeSpace(t, { 'projects.json': undefined });
    return { env: { APPDATA: home, XDG_CONFIG_HOME: home }, home };
  };

  it('creates an empty data space, a git repository and the user configuration', (t) => {
    const { env } = config(t);
    const parent = makeSpace(t, { 'projects.json': undefined });
    const dir = join(parent, 'my-data');
    const result = initSpace(dir, { env, gitEmail: 'me@example.com', gitName: 'Me' });
    assert.equal(result.commit.committed, true);
    assert.equal(result.config.written, true);
    assert.deepEqual(JSON.parse(readFileSync(result.config.file, 'utf8')), { data: dir });
    const registry = JSON.parse(readFileSync(join(dir, 'projects.json'), 'utf8'));
    assert.deepEqual({ ...registry, $schema: undefined }, { $schema: undefined, schemaVersion: 1, archiveAfterDays: 60, projects: [] });
    assert.match(registry.$schema, /schema\/projects\.schema\.json$/);
    assert.equal(readFileSync(join(dir, '.gitattributes'), 'utf8'), '* text=auto eol=lf\n');
    assert.deepEqual(validateSpace(dir).errors, []);
  });

  it('keeps an existing default unless asked, and can add the demo projects', (t) => {
    const { env } = config(t);
    const first = makeSpace(t, { 'projects.json': undefined });
    const second = makeSpace(t, { 'projects.json': undefined });
    initSpace(first, { env, gitEmail: 'me@example.com', gitName: 'Me' });
    const result = initSpace(second, { env, demo: true, gitEmail: 'me@example.com', gitName: 'Me' });
    assert.equal(result.config.written, false);
    assert.equal(result.config.data, first);
    assert.equal(JSON.parse(readFileSync(join(second, 'projects.json'), 'utf8')).projects.length, 3);
    assert.deepEqual(validateSpace(second).errors, []);
    assert.equal(initSpace(makeSpace(t, { 'projects.json': undefined }), { env, setDefault: true }).config.written, true);
  });

  it('never overwrites a data space and refuses one inside the tool repository', (t) => {
    const { env } = config(t);
    const existing = makeSpace(t, {});
    assert.throws(() => initSpace(existing, { env }), /already has a projects.json/);
    const toolRoot = makeSpace(t, { 'projects.json': undefined, 'package.json': {} });
    assert.throws(() => initSpace(join(toolRoot, 'data'), { env, toolRoot }), /inside the anvil-hq repository/);
  });
});

describe('briefing', () => {
  it('finds the project by remote and summarises its open items', (t) => {
    const data = makeSpace(t, {
      'projects.json': { schemaVersion: 1, projects: [{ id: 'alpha', prefix: 'AL', name: 'Alpha', summary: 'The alpha app', state: 'active', kind: 'web', release: 'versioned', repos: ['example-org/alpha'] }] },
      ...item('alpha', 'AL-1', { status: 'doing', title: 'Build it' }, '- [x] a\n- [ ] b\n'),
      ...item('alpha', 'AL-2', { status: 'blocked', reason: 'Waiting for design' }),
      ...item('alpha', 'AL-3', { status: 'backlog' }),
      ...item('alpha', 'AL-4', { status: 'done', evidence: 'x' }),
      ...item('inbox', 'IN-1', { kind: 'idea' }),
      'projects/alpha/journal/2026-11-09.md': '## 09:00\n\nFirst\n\n## 18:00\n\nStopped at the login screen\n',
    });
    const repo = makeSpace(t, { 'projects.json': undefined });
    const git = initRepo(repo);
    git('remote', 'add', 'origin', 'https://github.com/Example-Org/alpha.git');
    mkdirSync(join(repo, 'src'));

    const ctx = openSpace(data);
    const project = detectProject(ctx, join(repo, 'src'));
    assert.ok(project);
    assert.equal(project.id, 'alpha');
    const text = briefing(ctx, project);
    assert.match(text, /^# anvil: Alpha \(AL\), active\nThe alpha app\n/);
    assert.match(text, /## Doing\n- AL-1 Build it \[1\/2\]\n/);
    assert.match(text, /## Blocked\n- AL-2 Item AL-2 \(Waiting for design\)\n/);
    assert.match(text, /Backlog: 1 item\(s\)\. Inbox: 1 open item\(s\)\./);
    assert.match(text, /## Last journal note \(2026-11-09\)\n## 18:00\n\nStopped at the login screen\n/);
    assert.doesNotMatch(text, /AL-4/);
  });

  it('prefers the .anvil.json marker and finds nothing outside known repositories', (t) => {
    const data = makeSpace(t, {});
    const ctx = openSpace(data);
    const marked = makeSpace(t, { 'projects.json': undefined, '.anvil.json': { project: 'beta' } });
    initRepo(marked);
    assert.equal(detectProject(ctx, marked)?.id, 'beta');
    const unknown = makeSpace(t, { 'projects.json': undefined });
    initRepo(unknown);
    assert.equal(detectProject(ctx, unknown), null);
  });
});

describe('doctor', () => {
  const statuses = (results: CheckResult[]) => Object.fromEntries(results.map((r) => [r.check, r.status]));

  it('fails without git and passes a healthy private repository', (t) => {
    assert.equal(statuses(doctor(makeSpace(t, {}))).git, 'fail');

    const dir = makeSpace(t, {});
    const git = initRepo(dir);
    git('remote', 'add', 'origin', 'https://github.com/example-org/data.git');
    const results = doctor(dir, { gh: (slug) => (slug === 'example-org/data' ? { value: 'PRIVATE' } : { error: 'unexpected' }) });
    assert.deepEqual(statuses(results), { format: 'ok', identity: 'ok', uncommitted: 'ok', push: 'warn', private: 'ok' });
  });

  it('fails loudly when the data remote is public, and warns when it cannot check', (t) => {
    const dir = makeSpace(t, {});
    const git = initRepo(dir);
    git('remote', 'add', 'origin', 'git@github.com:example-org/data.git');
    writeFileSync(join(dir, 'stray.txt'), 'x');
    const results = statuses(doctor(dir, { gh: () => ({ value: 'PUBLIC' }) }));
    assert.equal(results.private, 'fail');
    assert.equal(results.uncommitted, 'warn');
    assert.equal(statuses(doctor(dir, { gh: () => ({ error: 'gh is not installed' }) })).private, 'warn');
  });
});

describe('migrate', () => {
  it('does nothing at the current version and refuses newer data', (t) => {
    const dir = makeSpace(t, {});
    assert.deepEqual(migrate(openSpace(dir)), { from: CURRENT_VERSION, to: CURRENT_VERSION, paths: [], message: `migrate: format version ${CURRENT_VERSION} → ${CURRENT_VERSION}` });
    const newer = makeSpace(t, { 'projects.json': { schemaVersion: CURRENT_VERSION + 1, projects: [] } });
    assert.throws(() => migrate(openSpace(newer)), /only knows up to/);
  });

  it('runs each migration in order', (t) => {
    const dir = makeSpace(t, { 'projects.json': { schemaVersion: 1, projects: [] } });
    const ran: number[] = [];
    const result = migrate(openSpace(dir), { 1: () => (ran.push(1), ['a']), 2: () => (ran.push(2), ['a', 'b']) }, 3);
    assert.deepEqual(ran, [1, 2]);
    assert.deepEqual(result.paths, ['a', 'b']);
    assert.throws(() => migrate(openSpace(dir), {}, 2), /no migration from version 1 to 2/);
  });
});
