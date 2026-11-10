import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { validateSpace } from '../src/validate.ts';
import { REGISTRY, fields, itemText, makeSpace, item } from './support.ts';

const messages = (dir: string) => validateSpace(dir).errors.map((e) => `${e.file}: ${e.message}`);

describe('validateSpace', () => {
  it('accepts the example data space', () => {
    const { errors, stats } = validateSpace(fileURLToPath(new URL('../examples', import.meta.url)));
    assert.deepEqual(errors, []);
    assert.ok(stats.items > 10);
  });

  it('accepts an empty data space', (t) => {
    assert.deepEqual(messages(makeSpace(t, {})), []);
  });

  it('reports registry problems: schema, repeated or reserved ids and prefixes, unknown folders', (t) => {
    const registry = {
      schemaVersion: 1,
      projects: [
        ...REGISTRY.projects,
        { ...REGISTRY.projects[0] },
        { id: 'inbox', prefix: 'XX', name: 'x', state: 'active', kind: 'web', release: 'none' },
        { id: 'gamma', prefix: 'IN', name: 'x', state: 'active', kind: 'desktop', release: 'none' },
      ],
    };
    const dir = makeSpace(t, { 'projects.json': registry, 'projects/ghost/items/.keep': '' });
    const found = messages(dir);
    assert.ok(found.includes('projects.json: projects[4].kind must be one of web, mobile, server, tooling'), found.join('\n'));
    assert.ok(found.includes('projects.json: project id "alpha" is repeated'));
    assert.ok(found.includes('projects.json: project id "inbox" is reserved'));
    assert.ok(found.includes('projects.json: prefix "IN" of "gamma" is already used by "inbox"'));
    assert.ok(found.includes('projects/ghost: folder of an unknown project "ghost"'));
  });

  it('reports an unreadable registry', (t) => {
    assert.match(messages(makeSpace(t, { 'projects.json': '{ broken' })).join(), /projects.json: cannot read/);
  });

  it('reports malformed and misplaced item files', (t) => {
    const dir = makeSpace(t, {
      'projects/alpha/items/AL-1.md': 'no header',
      'projects/alpha/items/AL-2.md': itemText(fields('AL-3')),
      'projects/alpha/items/BE-4.md': itemText(fields('BE-4')),
      'projects/alpha/items/notes.txt': 'x',
      'projects/alpha/archive/old/AL-5.md': itemText(fields('AL-5', { status: 'done' })),
      'projects/alpha/journal/today.md': 'x',
    });
    assert.deepEqual(messages(dir).sort(), [
      'projects/alpha/archive/old/AL-5.md: archive folders are named after a year (YYYY)',
      'projects/alpha/items/AL-1.md: line 1: the file must start with a --- line',
      'projects/alpha/items/AL-2.md: file name must be AL-3.md',
      'projects/alpha/items/BE-4.md: id must start with the prefix of "alpha" (AL-)',
      'projects/alpha/items/notes.txt: only .md item files belong here',
      'projects/alpha/journal/today.md: journal files are named YYYY-MM-DD.md',
    ]);
  });

  it('reports header fields that break the schema', (t) => {
    const dir = makeSpace(t, item('alpha', 'AL-1', { status: 'started', created: '2026-13-01', color: 'red', labels: ['Bad Label'] }));
    const found = messages(dir);
    assert.ok(found.includes('projects/alpha/items/AL-1.md: status must be one of backlog, todo, doing, blocked, done, released, cancelled'));
    assert.ok(found.includes('projects/alpha/items/AL-1.md: created must be a date (YYYY-MM-DD)'));
    assert.ok(found.includes('projects/alpha/items/AL-1.md: color is not an allowed field'));
    assert.ok(found.includes('projects/alpha/items/AL-1.md: labels[0] does not match ^[a-z0-9][a-z0-9-]*$'));
  });

  it('reports repeated ids and aliases across items and the archive', (t) => {
    const dir = makeSpace(t, {
      ...item('alpha', 'AL-1'),
      'projects/alpha/archive/2026/AL-1.md': itemText(fields('AL-1', { status: 'cancelled', reason: 'x' })),
      ...item('beta', 'BE-1', { aliases: ['AL-1'] }),
    });
    const found = messages(dir);
    assert.equal(found.filter((m) => /"AL-1" is also used by projects\/alpha\/items\/AL-1.md/.test(m)).length, 2, found.join('\n'));
  });

  it('applies the status rules', (t) => {
    const dir = makeSpace(t, {
      ...item('alpha', 'AL-1', { status: 'blocked' }),
      ...item('alpha', 'AL-2', { status: 'released' }),
      ...item('beta', 'BE-1', { status: 'released', release: '1.0' }),
      ...item('alpha', 'AL-3', { kind: 'idea', status: 'released', release: '1.0' }),
      ...item('alpha', 'AL-4', { since: '2025-12-31' }),
    });
    assert.deepEqual(messages(dir).sort(), [
      'projects/alpha/items/AL-1.md: status "blocked" needs a reason',
      'projects/alpha/items/AL-2.md: status "released" needs a release version',
      'projects/alpha/items/AL-3.md: a idea cannot be released',
      'projects/alpha/items/AL-4.md: "since" is earlier than "created"',
      'projects/beta/items/BE-1.md: project "beta" is not versioned, so nothing is released',
    ]);
  });

  it('applies the closing rules: steps and open children', (t) => {
    const dir = makeSpace(t, {
      ...item('alpha', 'AL-1', { kind: 'feature', status: 'done' }),
      ...item('alpha', 'AL-2', { parent: 'AL-1', status: 'doing' }),
      ...item('alpha', 'AL-3', { parent: 'AL-1', status: 'done' }, '- [x] One\n- [ ] Two\n'),
    });
    assert.deepEqual(messages(dir).sort(), [
      'projects/alpha/items/AL-1.md: status "done" with open child item(s): AL-2',
      'projects/alpha/items/AL-3.md: status "done" with 1 unchecked step(s): #2 Two',
    ]);
  });

  it('checks references: parent, related and supersededBy', (t) => {
    const dir = makeSpace(t, {
      ...item('alpha', 'AL-1', { kind: 'feature' }),
      ...item('alpha', 'AL-2', { parent: 'AL-9' }),
      ...item('alpha', 'AL-3', { parent: 'AL-4' }),
      ...item('alpha', 'AL-4'),
      ...item('beta', 'BE-1', { parent: 'AL-1' }),
      ...item('alpha', 'AL-5', { kind: 'bug', parent: 'AL-1' }),
      ...item('alpha', 'AL-6', { related: ['BE-1', 'BE-9'] }),
      ...item('alpha', 'AL-7', { kind: 'decision', supersededBy: 'AL-4' }),
      ...item('alpha', 'AL-8', { supersededBy: 'AL-7' }),
    });
    assert.deepEqual(messages(dir).sort(), [
      'projects/alpha/items/AL-2.md: parent "AL-9" does not exist',
      'projects/alpha/items/AL-3.md: parent "AL-4" is not a feature or a bug',
      'projects/alpha/items/AL-5.md: only a task can have a parent',
      'projects/alpha/items/AL-6.md: related item "BE-9" does not exist',
      'projects/alpha/items/AL-7.md: supersededBy "AL-4" is not a decision',
      'projects/alpha/items/AL-8.md: only a decision can be superseded',
      'projects/beta/items/BE-1.md: parent "AL-1" belongs to another project',
    ]);
  });

  it('accepts items in the reserved inbox and general areas', (t) => {
    const dir = makeSpace(t, {
      'projects/inbox/items/IN-1.md': itemText(fields('IN-1', { kind: 'idea', labels: ['problem'] })),
      'projects/general/items/GN-1.md': itemText(fields('GN-1', { kind: 'decision', status: 'done' })),
    });
    assert.deepEqual(messages(dir), []);
  });
});
