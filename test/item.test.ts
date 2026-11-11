import assert from 'node:assert/strict';
import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { descriptionOf, parseItem, parseSteps, serializeItem, withDescription } from '../src/item.ts';
import type { ItemFields } from '../src/types.ts';

describe('parseSteps', () => {
  it('numbers the checkboxes of the body from 1', () => {
    const steps = parseSteps('Intro\n\n- [x] First\n- [ ] Second\n* [X] Third\n');
    assert.deepEqual(steps.map((s) => [s.index, s.checked, s.text]), [
      [1, true, 'First'],
      [2, false, 'Second'],
      [3, true, 'Third'],
    ]);
  });

  it('recognises skipped steps', () => {
    const [skipped, plain] = parseSteps('- [x] ~~Drag and drop~~ (skipped: moved to AL-20)\n- [x] ~~Struck~~ but not skipped\n');
    assert.equal(skipped?.skipped, true);
    assert.equal(plain?.skipped, false);
  });

  it('ignores checkboxes inside fenced code blocks', () => {
    const body = '- [ ] Real\n```markdown\n- [ ] Example only\n```\n~~~\n- [ ] Also an example\n~~~\n- [x] Real too\n';
    assert.deepEqual(parseSteps(body).map((s) => s.text), ['Real', 'Real too']);
  });

  it('ignores lines that only look like checkboxes', () => {
    assert.deepEqual(parseSteps('- [] no space\n-[ ] no gap\n- [y] other mark\n- [ ]\n'), []);
  });
});

describe('descriptionOf and withDescription', () => {
  const body = 'Why it matters.\n\n## Steps\n- [x] First\n- [x] ~~Second~~ (skipped: not needed)\n- [ ] Third\n\nA note after the steps.\n';

  it('reads the body without its steps, text after them included', () => {
    assert.equal(descriptionOf(body), 'Why it matters.\n\n## Steps\n\nA note after the steps.');
    assert.equal(descriptionOf('- [ ] Only a step\n'), '');
    assert.equal(descriptionOf('```\n- [ ] code, not a step\n```\n'), '```\n- [ ] code, not a step\n```');
  });

  it('puts a new description before the steps, which keep their state and order', () => {
    const next = withDescription(body, '  New text.\r\n\r\n- a bullet  ');
    assert.equal(next, 'New text.\n\n- a bullet\n\n- [x] First\n- [x] ~~Second~~ (skipped: not needed)\n- [ ] Third\n');
    assert.deepEqual(parseSteps(next ?? '').map((s) => [s.text, s.checked]), parseSteps(body).map((s) => [s.text, s.checked]));
    assert.equal(descriptionOf(next ?? ''), 'New text.\n\n- a bullet');
  });

  it('removes the description when it is empty, and refuses checkboxes that would become steps', () => {
    assert.equal(withDescription(body, '  '), '- [x] First\n- [x] ~~Second~~ (skipped: not needed)\n- [ ] Third\n');
    assert.equal(withDescription('Old text\n', ''), '');
    assert.equal(withDescription(body, 'Text\n- [ ] a new step'), null);
    assert.equal(withDescription(body, '```\n- [ ] in code\n```'), '```\n- [ ] in code\n```\n\n- [x] First\n- [x] ~~Second~~ (skipped: not needed)\n- [ ] Third\n');
  });
});

describe('parseItem and serializeItem', () => {
  const text = [
    '---',
    'title: Order form',
    'id: AL-3',
    'status: doing',
    'kind: task',
    'created: 2026-01-01',
    'since: 2026-01-02',
    'release: "1.10"',
    'labels: [ui]',
    '---',
    '- [ ] Fields',
    '',
  ].join('\n');

  it('parses header, body and steps', () => {
    const item = parseItem(text);
    assert.equal(item.fields.id, 'AL-3');
    assert.equal(item.fields.release, '1.10');
    assert.deepEqual(item.fields.labels, ['ui']);
    assert.equal(item.body, '- [ ] Fields\n');
    assert.equal(item.steps.length, 1);
  });

  it('writes the fields in canonical order and keeps the body', () => {
    const out = serializeItem(parseItem(text));
    assert.equal(out, [
      '---',
      'id: AL-3',
      'title: Order form',
      'kind: task',
      'status: doing',
      'since: 2026-01-02',
      'created: 2026-01-01',
      'release: "1.10"',
      'labels: [ui]',
      '---',
      '- [ ] Fields',
      '',
    ].join('\n'));
  });

  it('is stable: serializing a serialized item changes nothing', () => {
    const once = serializeItem(parseItem(text));
    assert.equal(serializeItem(parseItem(once)), once);
  });

  it('keeps every example item byte for byte, so rewrites only change what they touch', () => {
    const root = fileURLToPath(new URL('../examples/', import.meta.url));
    const files = globSync('projects/*/{items,archive/*}/*.md', { cwd: root });
    assert.ok(files.length > 10);
    for (const file of files) {
      const text = readFileSync(join(root, file), 'utf8');
      assert.equal(serializeItem(parseItem(text)), text, file);
    }
  });

  it('ends an item with an empty body right after the closing --- line', () => {
    assert.equal(serializeItem({ fields: { id: 'AL-1' } as ItemFields, body: '' }), '---\nid: AL-1\n---\n');
  });
});
