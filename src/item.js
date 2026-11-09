// Item files: projects/<project>/items/<id>.md. A header (see frontmatter.js), then a Markdown
// body whose task-list checkboxes are the item's steps.

import { parseHeader, serializeDocument, splitDocument } from './frontmatter.js';

export const FIELD_ORDER = [
  'id', 'title', 'kind', 'status', 'since', 'created', 'priority', 'reason', 'evidence',
  'release', 'parent', 'related', 'labels', 'links', 'aliases', 'supersededBy',
];
export const DATE_FIELDS = new Set(['since', 'created']);

const STEP = /^\s*[-*+] \[([ xX])\] (.*)$/;
const SKIPPED = /^~~.+~~ \(skipped: .+\)$/;
const FENCE = /^\s*(```|~~~)/;

/** Parses an item file into { fields, body, steps }. Throws FormatError on a malformed header. */
export function parseItem(text) {
  const { headerLines, body } = splitDocument(text);
  return { fields: parseHeader(headerLines), body, steps: parseSteps(body) };
}

/** Serializes an item back to text, with the fields in their canonical order. */
export function serializeItem({ fields, body }) {
  return serializeDocument(fields, body, { order: FIELD_ORDER, dateKeys: DATE_FIELDS });
}

/**
 * Steps are the task-list checkboxes of the body, numbered from 1, outside fenced code blocks.
 * A skipped step is checked and written as `- [x] ~~text~~ (skipped: reason)`.
 */
export function parseSteps(body) {
  const steps = [];
  let inFence = false;
  body.split('\n').forEach((text, line) => {
    if (FENCE.test(text)) inFence = !inFence;
    const match = !inFence && STEP.exec(text);
    if (!match) return;
    const checked = match[1] !== ' ';
    steps.push({
      index: steps.length + 1,
      line,
      checked,
      skipped: checked && SKIPPED.test(match[2]),
      text: match[2],
    });
  });
  return steps;
}
