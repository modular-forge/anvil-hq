import type { ItemFields, Step } from './models';
import { bodyBlocks, inline, itemDiff, mentions } from './item-text';

const known = (id: string) => ['AB-1', 'AB-12'].includes(id);

describe('mentions', () => {
  it('links known ids only, keeping the text around them', () => {
    expect(mentions('See AB-12 and ZZ-9, then AB-1.', known)).toEqual([
      { text: 'See ' },
      { id: 'AB-12' },
      { text: ' and ZZ-9, then ' },
      { id: 'AB-1' },
      { text: '.' },
    ]);
    expect(mentions('nothing here', known)).toEqual([{ text: 'nothing here' }]);
  });
});

describe('bodyBlocks', () => {
  it('makes paragraphs and lists, and leaves the steps out', () => {
    const body = 'First line\ncontinues here.\n\n- one\n- two with AB-1\n\n- [ ] a step\n- [x] another\n\nLast.\n';
    expect(bodyBlocks(body, known)).toEqual([
      { type: 'p', parts: [{ text: 'First line continues here.' }] },
      { type: 'ul', items: [[{ text: 'one' }], [{ text: 'two with ' }, { id: 'AB-1' }]] },
      { type: 'p', parts: [{ text: 'Last.' }] },
    ]);
  });

  it('is empty for an empty body or one with only steps', () => {
    expect(bodyBlocks('', known)).toEqual([]);
    expect(bodyBlocks('- [ ] only a step\n', known)).toEqual([]);
  });
});

describe('inline', () => {
  it('reads code, http(s) links, bold and italics, and finds mentions in plain text only', () => {
    expect(inline('Use `AB-1` with **care**, *really* or _maybe_; see [the docs](https://example.com/a) and AB-12.', known)).toEqual([
      { text: 'Use ' },
      { code: 'AB-1' },
      { text: ' with ' },
      { strong: 'care' },
      { text: ', ' },
      { em: 'really' },
      { text: ' or ' },
      { em: 'maybe' },
      { text: '; see ' },
      { link: 'the docs', href: 'https://example.com/a' },
      { text: ' and ' },
      { id: 'AB-12' },
      { text: '.' },
    ]);
  });

  it('keeps anything that is not a safe link as text', () => {
    expect(inline('[click](javascript:alert(1))', known)).toEqual([{ text: '[click](javascript:alert(1))' }]);
    expect(inline('a snake_case_name and 2 * 3 * 4', known)).toEqual([{ text: 'a snake_case_name and 2 * 3 * 4' }]);
  });
});

describe('bodyBlocks with Markdown', () => {
  it('reads headings, numbered lists, continued list items and code blocks', () => {
    const body = '## Why\nBecause.\n1. first\n2. second\n   goes on\n\n```\n- [ ] code, not a step\n<b>raw</b>\n```\n\n- [ ] a real step\n';
    expect(bodyBlocks(body, known)).toEqual([
      { type: 'h', level: 2, parts: [{ text: 'Why' }] },
      { type: 'p', parts: [{ text: 'Because.' }] },
      { type: 'ol', items: [[{ text: 'first' }], [{ text: 'second goes on' }]] },
      { type: 'code', text: '- [ ] code, not a step\n<b>raw</b>' },
    ]);
  });
});

describe('itemDiff', () => {
  const fields = (overrides: Partial<ItemFields>): ItemFields => ({
    id: 'AB-1', title: 'T', kind: 'task', status: 'todo', since: '2026-01-01', created: '2026-01-01', ...overrides,
  });
  const step = (index: number, text: string, checked = false): Step => ({ index, line: index, checked, skipped: false, text });

  it('lists changed fields and steps as removed and added lines', () => {
    const before = { fields: fields({ labels: ['a'] }), steps: [step(1, 'One'), step(2, 'Two')] };
    const after = { fields: fields({ status: 'doing', labels: ['a', 'b'] }), steps: [step(1, 'One', true), step(2, 'Two')] };
    expect(itemDiff(before, after)).toEqual([
      '- status: todo',
      '+ status: doing',
      '- labels: [a]',
      '+ labels: [a, b]',
      '- - [ ] One',
      '+ - [x] One',
    ]);
  });

  it('is empty when nothing changed', () => {
    const same = { fields: fields({}), steps: [step(1, 'One')] };
    expect(itemDiff(same, same)).toEqual([]);
  });
});
