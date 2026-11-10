import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { AnvilError, ConflictError } from '../src/errors.ts';
import { parseItem } from '../src/item.ts';
import {
  addJournal, addStep, changeStep, createItem, listJournal, moveItem, nextNumber, openSpace, setFields, setStatus,
} from '../src/store.ts';
import { validateSpace } from '../src/validate.ts';
import { NOW, fields, itemText, makeSpace, item } from './support.ts';

const read = (dir: string, file: string) => parseItem(readFileSync(join(dir, file), 'utf8'));
const fieldsOf = (dir: string, project: string, id: string) => read(dir, `projects/${project}/items/${id}.md`).fields;
const assertValidSpace = (dir: string) => assert.deepEqual(validateSpace(dir).errors, []);

describe('createItem', () => {
  it('creates the next id with today as since and created, and steps in the body', (t) => {
    const dir = makeSpace(t, { ...item('alpha', 'AL-1', { kind: 'feature' }), 'projects/alpha/archive/2025/AL-7.md': itemText(fields('AL-7', { status: 'cancelled', reason: 'x' })) });
    const result = createItem(openSpace(dir), {
      project: 'alpha', kind: 'task', title: 'Write the form', parent: 'AL-1', labels: 'ui, forms', body: 'Context.', steps: ['One', 'Two'],
    }, NOW);
    assert.equal(result.id, 'AL-8');
    assert.deepEqual(result.paths, ['projects/alpha/items/AL-8.md']);
    assert.equal(readFileSync(join(dir, result.file), 'utf8'), [
      '---', 'id: AL-8', 'title: Write the form', 'kind: task', 'status: backlog', 'since: 2026-11-10', 'created: 2026-11-10',
      'parent: AL-1', 'labels: [ui, forms]', '---', 'Context.', '', '- [ ] One', '- [ ] Two', '',
    ].join('\n'));
    assertValidSpace(dir);
  });

  it('counts aliases, so a former id is never reused', (t) => {
    const dir = makeSpace(t, item('beta', 'BE-1', { aliases: ['AL-4'] }));
    assert.equal(nextNumber(openSpace(dir), 'AL'), 5);
  });

  it('skips an id another writer took after the space was read', (t) => {
    const dir = makeSpace(t, {});
    const ctx = openSpace(dir);
    mkdirSync(join(dir, 'projects/alpha/items'), { recursive: true });
    writeFileSync(join(dir, 'projects/alpha/items/AL-1.md'), itemText(fields('AL-1')));
    assert.equal(createItem(ctx, { project: 'alpha', kind: 'task', title: 'Late' }, NOW).id, 'AL-2');
  });

  it('works in the inbox and refuses unknown projects, bad references and non-open statuses', (t) => {
    const dir = makeSpace(t, item('alpha', 'AL-1'));
    const ctx = openSpace(dir);
    assert.equal(createItem(ctx, { project: 'inbox', kind: 'idea', title: 'Maybe' }, NOW).id, 'IN-1');
    assert.throws(() => createItem(ctx, { project: 'nope', kind: 'task', title: 'x' }, NOW), /unknown project "nope"/);
    assert.throws(() => createItem(ctx, { project: 'alpha', kind: 'task', title: 'x', parent: 'AL-1' }, NOW), /not a feature or a bug/);
    assert.throws(() => createItem(ctx, { project: 'alpha', kind: 'chore', title: 'x' }, NOW), /kind must be one of/);
    assert.throws(() => createItem(ctx, { project: 'alpha', kind: 'task', title: 'x', status: 'done' }, NOW), /start as backlog, todo, doing/);
    assert.throws(() => createItem(ctx, { project: 'alpha', kind: 'task', title: 'x', steps: ['two\nlines'] }, NOW), /one non-empty line/);
  });
});

describe('setStatus', () => {
  it('moves an item and stamps since', (t) => {
    const dir = makeSpace(t, item('alpha', 'AL-1'));
    const result = setStatus(openSpace(dir), 'AL-1', 'doing', {}, NOW);
    assert.equal(result.message, 'AL-1: todo → doing');
    assert.deepEqual(fieldsOf(dir, 'alpha', 'AL-1'), { ...fields('AL-1'), status: 'doing', since: '2026-11-10' });
  });

  it('requires a reason for blocked and cancelled, and drops it when the item moves on', (t) => {
    const dir = makeSpace(t, item('alpha', 'AL-1'));
    assert.throws(() => setStatus(openSpace(dir), 'AL-1', 'blocked', {}, NOW), /needs --reason/);
    setStatus(openSpace(dir), 'AL-1', 'blocked', { reason: 'Waiting for the API' }, NOW);
    assert.equal(fieldsOf(dir, 'alpha', 'AL-1').reason, 'Waiting for the API');
    setStatus(openSpace(dir), 'AL-1', 'doing', {}, NOW);
    assert.equal(fieldsOf(dir, 'alpha', 'AL-1').reason, undefined);
  });

  it('requires evidence for done and refuses unchecked steps', (t) => {
    const dir = makeSpace(t, item('alpha', 'AL-1', {}, '- [x] One\n- [ ] Two\n'));
    assert.throws(() => setStatus(openSpace(dir), 'AL-1', 'done', {}, NOW), /needs --evidence/);
    assert.throws(() => setStatus(openSpace(dir), 'AL-1', 'done', { evidence: 'confirmed by user' }, NOW), /unchecked step\(s\): #2 Two/);
    changeStep(openSpace(dir), 'AL-1', 2, 'check');
    setStatus(openSpace(dir), 'AL-1', 'done', { evidence: 'https://example.com/pr/1' }, NOW);
    assert.equal(fieldsOf(dir, 'alpha', 'AL-1').evidence, 'https://example.com/pr/1');
    setStatus(openSpace(dir), 'AL-1', 'doing', {}, NOW);
    assert.equal(fieldsOf(dir, 'alpha', 'AL-1').evidence, undefined, 'reopening drops the evidence');
  });

  it('refuses to close a feature with open tasks, and hints when the last task closes', (t) => {
    const dir = makeSpace(t, {
      ...item('alpha', 'AL-1', { kind: 'feature', status: 'doing' }),
      ...item('alpha', 'AL-2', { parent: 'AL-1', status: 'done', evidence: 'x' }),
      ...item('alpha', 'AL-3', { parent: 'AL-1', status: 'doing' }),
    });
    assert.throws(() => setStatus(openSpace(dir), 'AL-1', 'done', { evidence: 'x' }, NOW), /open child item\(s\): AL-3/);
    const result = setStatus(openSpace(dir), 'AL-3', 'done', { evidence: 'x' }, NOW);
    assert.match(result.hint ?? '', /every task of AL-1 is closed/);
    assert.equal(setStatus(openSpace(dir), 'AL-1', 'done', { evidence: 'x' }, NOW).hint, null);
  });

  it('releases only in versioned projects, with a version', (t) => {
    const dir = makeSpace(t, { ...item('alpha', 'AL-1', { status: 'done', evidence: 'x' }), ...item('beta', 'BE-1', { status: 'done', evidence: 'x' }) });
    assert.throws(() => setStatus(openSpace(dir), 'AL-1', 'released', {}, NOW), /needs --release/);
    setStatus(openSpace(dir), 'AL-1', 'released', { release: '1.10' }, NOW);
    assert.match(readFileSync(join(dir, 'projects/alpha/items/AL-1.md'), 'utf8'), /release: "1.10"/);
    assert.throws(() => setStatus(openSpace(dir), 'BE-1', 'released', { release: '1.0' }, NOW), /not versioned/);
  });

  it('refuses archived items, unknown ids and no-op changes', (t) => {
    const dir = makeSpace(t, { ...item('alpha', 'AL-1'), 'projects/alpha/archive/2025/AL-2.md': itemText(fields('AL-2', { status: 'cancelled', reason: 'x' })) });
    assert.throws(() => setStatus(openSpace(dir), 'AL-2', 'todo', {}, NOW), /archived and read-only/);
    assert.throws(() => setStatus(openSpace(dir), 'AL-9', 'todo', {}, NOW), /AL-9 not found/);
    assert.throws(() => setStatus(openSpace(dir), '../x', 'todo', {}, NOW), /not an item id/);
    assert.throws(() => setStatus(openSpace(dir), 'AL-1', 'todo', {}, NOW), /already todo/);
    assert.throws(() => setStatus(openSpace(dir), 'AL-1', 'started', {}, NOW), /status must be one of/);
  });

  it('refuses to overwrite a file that changed on disk after it was read', (t) => {
    const dir = makeSpace(t, item('alpha', 'AL-1'));
    const ctx = openSpace(dir);
    const file = join(dir, 'projects/alpha/items/AL-1.md');
    writeFileSync(file, itemText(fields('AL-1', { title: 'Edited by hand' })));
    const entry = ctx.byId.get('AL-1');
    assert.ok(entry);
    entry.mtimeMs -= 1000; // make the change visible even on file systems with coarse timestamps
    assert.throws(() => setStatus(ctx, 'AL-1', 'doing', {}, NOW), ConflictError);
    assert.equal(fieldsOf(dir, 'alpha', 'AL-1').title, 'Edited by hand');
  });
});

describe('setFields', () => {
  it('sets, replaces and removes fields', (t) => {
    const dir = makeSpace(t, { ...item('alpha', 'AL-1', { priority: 'low', labels: ['a'] }), ...item('beta', 'BE-1') });
    const result = setFields(openSpace(dir), 'AL-1', { title: 'Renamed: now', priority: '', labels: 'x, y', related: 'BE-1' });
    assert.equal(result.message, 'AL-1: set title, priority, labels, related');
    const f = fieldsOf(dir, 'alpha', 'AL-1');
    assert.equal(f.title, 'Renamed: now');
    assert.equal(f.priority, undefined);
    assert.deepEqual(f.labels, ['x', 'y']);
    assert.deepEqual(f.related, ['BE-1']);
    assertValidSpace(dir);
  });

  it('turns an idea into a task, keeping its id', (t) => {
    const dir = makeSpace(t, item('inbox', 'IN-1', { kind: 'idea' }));
    setFields(openSpace(dir), 'IN-1', { kind: 'task' });
    assert.equal(fieldsOf(dir, 'inbox', 'IN-1').kind, 'task');
  });

  it('refuses invalid values, unknown references, no-op changes and orphaning child tasks', (t) => {
    const dir = makeSpace(t, { ...item('alpha', 'AL-1', { kind: 'feature' }), ...item('alpha', 'AL-2', { parent: 'AL-1' }) });
    const ctx = openSpace(dir);
    assert.throws(() => setFields(ctx, 'AL-2', { priority: 'urgent' }), /priority must be one of/);
    assert.throws(() => setFields(ctx, 'AL-2', { related: 'ZZ-1' }), /related item "ZZ-1" does not exist/);
    assert.throws(() => setFields(ctx, 'AL-2', { title: 'Item AL-2' }), /already has those values/);
    assert.throws(() => setFields(ctx, 'AL-1', { kind: 'task' }), /has child tasks/);
    assert.throws(() => setFields(ctx, 'AL-2', {}), /nothing to set/);
    assert.throws(() => setFields(ctx, 'AL-2', { status: 'done' }), AnvilError);
  });
});

describe('moveItem', () => {
  it('moves a feature with its tasks, keeps aliases and rewrites references', (t) => {
    const dir = makeSpace(t, {
      ...item('alpha', 'AL-1', { kind: 'feature' }),
      ...item('alpha', 'AL-2', { parent: 'AL-1' }),
      ...item('alpha', 'AL-3', { related: ['AL-1', 'AL-2'] }),
      ...item('beta', 'BE-4'),
    });
    const result = moveItem(openSpace(dir), 'AL-1', 'beta');
    assert.deepEqual(result.moved, [['AL-1', 'BE-5'], ['AL-2', 'BE-6']]);
    assert.ok(!existsSync(join(dir, 'projects/alpha/items/AL-1.md')));
    assert.deepEqual(fieldsOf(dir, 'beta', 'BE-5').aliases, ['AL-1']);
    assert.equal(fieldsOf(dir, 'beta', 'BE-6').parent, 'BE-5');
    assert.deepEqual(fieldsOf(dir, 'alpha', 'AL-3').related, ['BE-5', 'BE-6']);
    assert.deepEqual(result.paths.sort(), [
      'projects/alpha/items/AL-1.md', 'projects/alpha/items/AL-2.md', 'projects/alpha/items/AL-3.md',
      'projects/beta/items/BE-5.md', 'projects/beta/items/BE-6.md',
    ]);
    assertValidSpace(dir);
    assert.equal(openSpace(dir).byId.get('AL-1')?.item.fields.id, 'BE-5', 'the old id still finds the item');
  });

  it('moves an idea out of the inbox', (t) => {
    const dir = makeSpace(t, item('inbox', 'IN-3', { kind: 'idea' }));
    assert.equal(moveItem(openSpace(dir), 'IN-3', 'alpha').id, 'AL-1');
    assertValidSpace(dir);
  });

  it('refuses tasks with a parent, the same project and invalid results', (t) => {
    const dir = makeSpace(t, {
      ...item('alpha', 'AL-1', { kind: 'feature' }),
      ...item('alpha', 'AL-2', { parent: 'AL-1' }),
      ...item('alpha', 'AL-3', { status: 'released', release: '1.0', evidence: 'x' }),
    });
    const ctx = openSpace(dir);
    assert.throws(() => moveItem(ctx, 'AL-2', 'beta'), /belongs to AL-1/);
    assert.throws(() => moveItem(ctx, 'AL-1', 'alpha'), /already in alpha/);
    assert.throws(() => moveItem(ctx, 'AL-3', 'beta'), /not versioned/);
    assert.ok(existsSync(join(dir, 'projects/alpha/items/AL-3.md')), 'nothing is written when the move is refused');
  });
});

describe('steps', () => {
  it('adds steps after the last one, or at the end of the body', (t) => {
    const dir = makeSpace(t, { ...item('alpha', 'AL-1', {}, '- [ ] One\n\nNotes after the steps.\n'), ...item('alpha', 'AL-2', {}, 'Just text.\n') });
    assert.equal(addStep(openSpace(dir), 'AL-1', 'Two').step, 2);
    assert.equal(read(dir, 'projects/alpha/items/AL-1.md').body, '- [ ] One\n- [ ] Two\n\nNotes after the steps.\n');
    addStep(openSpace(dir), 'AL-2', 'First');
    assert.equal(read(dir, 'projects/alpha/items/AL-2.md').body, 'Just text.\n\n- [ ] First\n');
  });

  it('checks, skips and unchecks steps', (t) => {
    const dir = makeSpace(t, item('alpha', 'AL-1', {}, '- [ ] One\n  * [ ] Nested two\n'));
    changeStep(openSpace(dir), 'AL-1', 1, 'check');
    changeStep(openSpace(dir), 'AL-1', 2, 'skip', 'not needed');
    assert.equal(read(dir, 'projects/alpha/items/AL-1.md').body, '- [x] One\n  * [x] ~~Nested two~~ (skipped: not needed)\n');
    changeStep(openSpace(dir), 'AL-1', 2, 'uncheck');
    assert.equal(read(dir, 'projects/alpha/items/AL-1.md').body, '- [x] One\n  * [ ] Nested two\n');
  });

  it('refuses impossible step changes', (t) => {
    const dir = makeSpace(t, { ...item('alpha', 'AL-1', {}, '- [x] One\n- [ ] Two\n'), ...item('alpha', 'AL-2', { status: 'done', evidence: 'x' }, '- [x] One\n') });
    const ctx = openSpace(dir);
    assert.throws(() => changeStep(ctx, 'AL-1', 3, 'check'), /has no step 3; it has 2/);
    assert.throws(() => changeStep(ctx, 'AL-1', 1, 'check'), /already checked/);
    assert.throws(() => changeStep(ctx, 'AL-1', 2, 'uncheck'), /not checked/);
    assert.throws(() => changeStep(ctx, 'AL-1', 2, 'skip'), /needs --reason/);
    assert.throws(() => changeStep(ctx, 'AL-1', 1, 'skip', 'x'), /uncheck it first/);
    assert.throws(() => changeStep(ctx, 'AL-2', 1, 'uncheck'), /move it back to doing/);
  });
});

describe('journal', () => {
  it("appends timestamped entries to the day's note and lists notes newest first", (t) => {
    const dir = makeSpace(t, { 'projects/alpha/journal/2026-11-01.md': '## 10:00\n\nOld note\n' });
    addJournal(openSpace(dir), 'alpha', 'First entry', NOW);
    addJournal(openSpace(dir), 'alpha', '  Second entry\nwith two lines  ', new Date(2026, 10, 10, 17, 30));
    assert.equal(readFileSync(join(dir, 'projects/alpha/journal/2026-11-10.md'), 'utf8'), '## 09:05\n\nFirst entry\n\n## 17:30\n\nSecond entry\nwith two lines\n');
    assert.deepEqual(listJournal(openSpace(dir), 'alpha').map((n) => n.date), ['2026-11-10', '2026-11-01']);
    assert.throws(() => addJournal(openSpace(dir), 'alpha', '   ', NOW), /empty/);
    assertValidSpace(dir);
  });
});
