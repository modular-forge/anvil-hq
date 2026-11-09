import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { validateSchema } from '../src/json-schema.js';

const schema = {
  type: 'object',
  required: ['id'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', pattern: '^[A-Z]+-[0-9]+$' },
    when: { type: 'string', format: 'date' },
    link: { type: 'string', format: 'uri' },
    tags: { type: 'array', uniqueItems: true, items: { type: 'string', minLength: 1 } },
    level: { enum: ['high', 'low'] },
    days: { type: 'integer', minimum: 1 },
    version: { const: 1 },
  },
};

describe('validateSchema', () => {
  it('accepts a matching value', () => {
    const value = { id: 'AL-1', when: '2024-02-29', link: 'https://x.test/a', tags: ['a'], level: 'high', days: 3, version: 1 };
    assert.deepEqual(validateSchema(schema, value), []);
  });

  it('reports each problem with its path', () => {
    const value = { id: 'al-1', when: '2026-02-30', link: 'not a url', tags: ['a', 'a', ''], level: 'mid', days: 0, version: 2, extra: true };
    const errors = validateSchema(schema, value).map((e) => `${e.path} ${e.message}`);
    assert.deepEqual(errors.sort(), [
      'days must be 1 or more',
      'extra is not an allowed field',
      'id does not match ^[A-Z]+-[0-9]+$',
      'level must be one of high, low',
      'link must be a URL',
      'tags must not repeat items',
      'tags[2] must have at least 1 character(s)',
      'version must be 1',
      'when must be a date (YYYY-MM-DD)',
    ]);
  });

  it('reports missing required fields and wrong types without going deeper', () => {
    assert.deepEqual(validateSchema(schema, {}), [{ path: '', message: 'missing "id"' }]);
    assert.deepEqual(validateSchema(schema, []), [{ path: '', message: 'must be object' }]);
    assert.deepEqual(validateSchema(schema, { id: 'AL-1', tags: 'a' }), [{ path: 'tags', message: 'must be array' }]);
  });

  it('throws on keywords it does not support, instead of skipping them', () => {
    assert.throws(() => validateSchema({ oneOf: [] }, 1), /unsupported JSON Schema keyword "oneOf"/);
    assert.throws(() => validateSchema({ format: 'email' }, 'a'), /unsupported format/);
  });

  it('supports every keyword used by the published schemas', () => {
    for (const name of ['projects.schema.json', 'item.schema.json']) {
      const published = JSON.parse(readFileSync(new URL(`../schema/${name}`, import.meta.url), 'utf8'));
      assert.doesNotThrow(() => validateSchema(published, {}), name);
    }
  });
});
