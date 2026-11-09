import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FormatError, needsQuotes, parseHeader, serializeHeader, splitDocument } from '../src/frontmatter.js';

describe('splitDocument', () => {
  it('separates the header from the body', () => {
    const { headerLines, body } = splitDocument('---\nid: AL-1\n---\nBody text\n');
    assert.deepEqual(headerLines, ['id: AL-1']);
    assert.equal(body, 'Body text\n');
  });

  it('accepts CRLF line endings and a BOM', () => {
    const { headerLines, body } = splitDocument('﻿---\r\nid: AL-1\r\n---\r\nBody\r\n');
    assert.deepEqual(headerLines, ['id: AL-1']);
    assert.equal(body, 'Body\n');
  });

  it('rejects a file without an opening or closing --- line', () => {
    assert.throws(() => splitDocument('id: AL-1\n'), FormatError);
    assert.throws(() => splitDocument('---\nid: AL-1\n'), /not closed/);
  });
});

describe('parseHeader', () => {
  it('reads every value as text', () => {
    const fields = parseHeader(['release: 1.10', 'flag: no', 'since: 2026-11-09', 'empty:']);
    assert.deepEqual(fields, { release: '1.10', flag: 'no', since: '2026-11-09', empty: '' });
  });

  it('reads double- and single-quoted values', () => {
    const fields = parseHeader(['a: "1.10"', 'b: "say \\"hi\\": now"', "c: 'it''s'"]);
    assert.deepEqual(fields, { a: '1.10', b: 'say "hi": now', c: "it's" });
  });

  it('keeps colons inside plain values, such as URLs', () => {
    assert.deepEqual(parseHeader(['link: https://example.com/a']), { link: 'https://example.com/a' });
  });

  it('reads flow lists, with quoted items and commas inside quotes', () => {
    const fields = parseHeader(['labels: [a, b]', 'none: []', 'q: ["x, y", \'z\']']);
    assert.deepEqual(fields, { labels: ['a', 'b'], none: [], q: ['x, y', 'z'] });
  });

  it('skips blank lines', () => {
    assert.deepEqual(parseHeader(['a: 1', '', 'b: 2']), { a: '1', b: '2' });
  });

  it('rejects malformed lines with their line number', () => {
    assert.throws(() => parseHeader(['id: AL-1', 'no colon here']), /line 3/);
    assert.throws(() => parseHeader(['key:value']), FormatError);
    assert.throws(() => parseHeader(['bad key: x']), FormatError);
  });

  it('rejects duplicate keys, nested structures and broken quotes', () => {
    assert.throws(() => parseHeader(['a: 1', 'a: 2']), /duplicate key "a"/);
    assert.throws(() => parseHeader(['a: [b, [c]]']), /nested/);
    assert.throws(() => parseHeader(['a: [b, c']), /unclosed list/);
    assert.throws(() => parseHeader(['a: [b, , c]']), /empty list item/);
    assert.throws(() => parseHeader(['a: "unterminated']), /double-quoted/);
    assert.throws(() => parseHeader(["a: 'it's'"]), /single-quoted/);
  });
});

describe('needsQuotes', () => {
  it('quotes what YAML would read as a number, boolean, null or date', () => {
    for (const value of ['1.10', '42', '1e3', '0x1F', '.inf', 'no', 'Yes', 'off', 'null', '~', '12:30', '2026-11-09']) {
      assert.equal(needsQuotes(value), true, value);
    }
  });

  it('quotes what YAML would parse as syntax', () => {
    for (const value of ['', ' padded', 'a: b', 'ends with:', 'a #comment', '- item', '[x]', '{x}', '"q"', "'q'", '*ref', '&anchor', '!tag', '@at', '%p', '`b']) {
      assert.equal(needsQuotes(value), true, JSON.stringify(value));
    }
  });

  it('leaves ordinary text unquoted', () => {
    for (const value of ['AL-12', 'Render project cards', 'v1.10', '1.2.3', 'https://example.com/x?a=1#top', "it's fine"]) {
      assert.equal(needsQuotes(value), false, value);
    }
  });

  it('leaves dates unquoted only where dates are expected', () => {
    assert.equal(needsQuotes('2026-11-09', { allowDate: true }), false);
    assert.equal(needsQuotes('2026-11-09T10:00', { allowDate: true }), true);
  });

  it('quotes list items that contain list syntax', () => {
    assert.equal(needsQuotes('a, b', { inList: true }), true);
    assert.equal(needsQuotes('a, b'), false);
  });
});

describe('serializeHeader', () => {
  it('writes keys in the given order, then the rest', () => {
    const lines = serializeHeader({ b: 'second', extra: 'x', a: 'first' }, { order: ['a', 'b'] });
    assert.deepEqual(lines, ['a: first', 'b: second', 'extra: x']);
  });

  it('quotes ambiguous values and leaves date fields plain', () => {
    const lines = serializeHeader(
      { since: '2026-11-09', release: '1.10', title: '2026-11-09', labels: ['a', 'b, c'], none: [] },
      { dateKeys: new Set(['since']) },
    );
    assert.deepEqual(lines, ['since: 2026-11-09', 'release: "1.10"', 'title: "2026-11-09"', 'labels: [a, "b, c"]', 'none: []']);
  });

  it('round-trips through parseHeader', () => {
    const original = { title: 'Say "hi": now', release: '1.10', note: "it's", labels: ['x, y', 'z'] };
    assert.deepEqual(parseHeader(serializeHeader(original)), original);
  });

  it('rejects values that cannot be written on one line, and non-strings', () => {
    assert.throws(() => serializeHeader({ title: 'two\nlines' }), /one line/);
    assert.throws(() => serializeHeader({ count: 3 }), /strings/);
  });

  it('skips undefined fields', () => {
    assert.deepEqual(serializeHeader({ a: 'x', b: undefined }), ['a: x']);
  });
});
