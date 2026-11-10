import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { parseItem } from '../src/item.js';
import { createProject, linkProject, loadTemplate, promoteIdea, releaseNotes, releaseProject, scaffoldProject } from '../src/projects.js';
import { openSpace } from '../src/store.js';
import { validateSpace } from '../src/validate.js';
import { NOW, REGISTRY, fields, initRepo, itemText, makeSpace } from './support.js';

const item = (project, id, overrides, body) => ({ [`projects/${project}/items/${id}.md`]: itemText(fields(id, overrides), body) });
const registry = (dir) => JSON.parse(readFileSync(join(dir, 'projects.json'), 'utf8'));
const fieldsOf = (dir, project, id) => parseItem(readFileSync(join(dir, `projects/${project}/items/${id}.md`), 'utf8')).fields;
const assertValidSpace = (dir) => assert.deepEqual(validateSpace(dir).errors, []);

describe('createProject', () => {
  it('adds a normalized project and keeps the file style', (t) => {
    const dir = makeSpace(t, {});
    const result = createProject(openSpace(dir), { id: 'gamma', prefix: 'GA', kind: 'tooling', release: 'versioned', repos: ['example-org/gamma'], summary: '' });
    assert.deepEqual(result.paths, ['projects.json']);
    assert.deepEqual(registry(dir).projects.at(-1), { id: 'gamma', prefix: 'GA', name: 'gamma', state: 'idea', kind: 'tooling', release: 'versioned', repos: ['example-org/gamma'] });
    assert.match(readFileSync(join(dir, 'projects.json'), 'utf8'), /"repos": \["example-org\/gamma"\]/);
  });

  it('refuses clashing ids and prefixes, invalid values and missing options', (t) => {
    const dir = makeSpace(t, {});
    const ctx = openSpace(dir);
    const base = { id: 'gamma', prefix: 'GA', kind: 'web', release: 'none' };
    assert.throws(() => createProject(ctx, { ...base, id: 'alpha' }), /"alpha" is repeated/);
    assert.throws(() => createProject(ctx, { ...base, prefix: 'IN' }), /already used by "inbox"/);
    assert.throws(() => createProject(ctx, { ...base, kind: 'desktop' }), /kind must be one of/);
    assert.throws(() => createProject(ctx, { ...base, prefix: undefined }), /needs --prefix/);
    assert.deepEqual(registry(dir), REGISTRY, 'nothing was written');
  });
});

describe('scaffoldProject', () => {
  it('creates the built-in starting items once', (t) => {
    const dir = makeSpace(t, {});
    const first = scaffoldProject(openSpace(dir), 'beta', NOW);
    assert.equal(first.template, 'built-in');
    assert.ok(first.created.length >= 3);
    assert.equal(fieldsOf(dir, 'beta', 'BE-1').title, loadTemplate(dir, 'server').items[0].title);
    const second = scaffoldProject(openSpace(dir), 'beta', NOW);
    assert.deepEqual(second.created, []);
    assert.equal(second.skipped.length, first.created.length);
    assertValidSpace(dir);
  });

  it("prefers the data space's own template and validates it", (t) => {
    const dir = makeSpace(t, { 'templates/web.json': { items: [{ kind: 'task', title: 'Our own first task', steps: ['A'] }] } });
    assert.deepEqual(scaffoldProject(openSpace(dir), 'alpha', NOW).created, ['AL-1']);
    assert.equal(fieldsOf(dir, 'alpha', 'AL-1').title, 'Our own first task');

    const broken = makeSpace(t, { 'templates/web.json': { items: [{ title: 'No kind' }] } });
    assert.throws(() => scaffoldProject(openSpace(broken), 'alpha', NOW), /not a valid template: items\[0\] missing "kind"/);
  });

  it('ships a valid template for every project kind', () => {
    for (const kind of ['web', 'mobile', 'server', 'tooling']) assert.ok(loadTemplate('/nonexistent', kind).items.length > 0, kind);
  });
});

describe('promoteIdea', () => {
  it('creates a project in state idea with the idea as its first item and the starting items', (t) => {
    const dir = makeSpace(t, item('inbox', 'IN-2', { kind: 'idea', title: 'Recipe box' }));
    const result = promoteIdea(dir, 'IN-2', { id: 'recipes', prefix: 'RB', kind: 'mobile', release: 'versioned' }, NOW);
    assert.equal(result.item, 'RB-1');
    assert.deepEqual(registry(dir).projects.at(-1), { id: 'recipes', prefix: 'RB', name: 'Recipe box', state: 'idea', kind: 'mobile', release: 'versioned' });
    assert.deepEqual(fieldsOf(dir, 'recipes', 'RB-1').aliases, ['IN-2']);
    assert.ok(result.created.length > 0);
    assertValidSpace(dir);
  });

  it('only promotes ideas', (t) => {
    const dir = makeSpace(t, item('alpha', 'AL-1'));
    assert.throws(() => promoteIdea(dir, 'AL-1', { id: 'x', prefix: 'XX', kind: 'web', release: 'none' }, NOW), /is a task, not an idea/);
  });
});

describe('releaseProject', () => {
  const space = (t) => makeSpace(t, {
    ...item('alpha', 'AL-1', { kind: 'feature', title: 'Export', status: 'done', evidence: 'x' }),
    ...item('alpha', 'AL-2', { parent: 'AL-1', title: 'CSV writer', status: 'done', evidence: 'x' }),
    ...item('alpha', 'AL-3', { kind: 'bug', title: 'Crash on start', status: 'done', evidence: 'x' }),
    ...item('alpha', 'AL-4', { title: 'Update dependencies', status: 'done', evidence: 'x' }),
    ...item('alpha', 'AL-5', { title: 'Not this time', status: 'done', evidence: 'x' }),
    ...item('alpha', 'AL-6', { kind: 'decision', status: 'done' }),
    ...item('alpha', 'AL-7', { status: 'doing' }),
  });

  it('releases the done items except the excluded ones and builds the notes', (t) => {
    const dir = space(t);
    const result = releaseProject(openSpace(dir), 'alpha', '1.10', { exclude: ['AL-5'] }, NOW);
    assert.deepEqual(result.released, ['AL-1', 'AL-2', 'AL-3', 'AL-4']);
    assert.deepEqual(fieldsOf(dir, 'alpha', 'AL-2'), { ...fields('AL-2'), parent: 'AL-1', title: 'CSV writer', status: 'released', since: '2026-11-10', evidence: 'x', release: '1.10' });
    assert.equal(fieldsOf(dir, 'alpha', 'AL-5').status, 'done');
    assert.equal(fieldsOf(dir, 'alpha', 'AL-6').status, 'done', 'decisions are never released');
    assert.equal(result.notes, [
      '## Alpha 1.10 (2026-11-10)', '',
      '### Features', '', '- Export (AL-1)', '  - CSV writer (AL-2)', '',
      '### Fixes', '', '- Crash on start (AL-3)', '',
      '### Other changes', '', '- Update dependencies (AL-4)', '',
    ].join('\n'));
    assertValidSpace(dir);
  });

  it('previews without writing with dryRun', (t) => {
    const dir = space(t);
    const result = releaseProject(openSpace(dir), 'alpha', '2.0', { dryRun: true }, NOW);
    assert.equal(result.released.length, 5);
    assert.deepEqual(result.paths, []);
    assert.equal(fieldsOf(dir, 'alpha', 'AL-1').status, 'done');
  });

  it('refuses unversioned projects, unknown exclusions and empty releases', (t) => {
    const dir = makeSpace(t, item('beta', 'BE-1', { status: 'done', evidence: 'x' }));
    assert.throws(() => releaseProject(openSpace(dir), 'beta', '1.0', {}, NOW), /not versioned/);
    assert.throws(() => releaseProject(openSpace(space(t)), 'alpha', '1.0', { exclude: ['AL-7'] }, NOW), /cannot exclude AL-7/);
    assert.throws(() => releaseProject(openSpace(makeSpace(t, {})), 'alpha', '1.0', {}, NOW), /no done items/);
  });

  it('labels notes with the project id when it has no name', () => {
    assert.match(releaseNotes({ id: 'x' }, '1.0', '2026-01-01', []), /^## x 1.0/);
  });
});

describe('linkProject', () => {
  const repo = (t, files, remote) => {
    const dir = makeSpace(t, { 'projects.json': undefined, ...files });
    const git = initRepo(dir);
    if (remote) git('remote', 'add', 'origin', remote);
    return dir;
  };

  it('adds the repository to the project named by its marker', (t) => {
    const data = makeSpace(t, {});
    const cwd = repo(t, { '.anvil.json': { project: 'alpha' } }, 'git@github.com:example-org/alpha-app.git');
    const result = linkProject(openSpace(data), cwd);
    assert.equal(result.message, 'alpha: link example-org/alpha-app');
    assert.deepEqual(registry(data).projects[0].repos, ['example-org/alpha-app']);
    assert.equal(linkProject(openSpace(data), cwd).linked, false, 'linking twice changes nothing');
  });

  it('creates the project from the remote when it is new', (t) => {
    const data = makeSpace(t, {});
    const cwd = repo(t, {}, 'https://github.com/example-org/Gamma.git');
    assert.throws(() => linkProject(openSpace(data), cwd), /"gamma" is not in this data space yet; to add it, pass --prefix/);
    linkProject(openSpace(data), cwd, { prefix: 'GA', kind: 'web', release: 'none' });
    assert.deepEqual(registry(data).projects.at(-1), { id: 'gamma', prefix: 'GA', name: 'gamma', state: 'active', kind: 'web', release: 'none', repos: ['example-org/Gamma'] });
  });

  it('refuses folders outside git and broken markers', (t) => {
    const data = makeSpace(t, {});
    assert.throws(() => linkProject(openSpace(data), repo(t, { '.anvil.json': '{ "project": 5 }' })), /must be \{ "project": "<id>" \}/);
  });
});
