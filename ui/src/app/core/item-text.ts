// An item's body as the detail panel shows it: paragraphs and bullet lists, with mentions of
// other items (like AB-12) turned into links. Steps are shown apart, so their lines are left out.
// Plain data, rendered by the template: never HTML.

import type { ItemDetail } from './models';

export type Inline = { text: string } | { id: string };

export type Block = { type: 'p'; parts: Inline[] } | { type: 'ul'; items: Inline[][] };

const STEP = /^\s*- \[[ xX]\] /;
const BULLET = /^\s*[-*] /;
const MENTION = /\b[A-Z]{2,4}-[1-9][0-9]*\b/g;

/** Splits `text` into plain text and mentions of ids that `known` accepts. */
export function mentions(text: string, known: (id: string) => boolean): Inline[] {
  const parts: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(MENTION)) {
    const id = match[0];
    if (!known(id)) continue;
    if (match.index > last) parts.push({ text: text.slice(last, match.index) });
    parts.push({ id });
    last = match.index + id.length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

export function bodyBlocks(body: string, known: (id: string) => boolean): Block[] {
  const lines = body.replaceAll('\r\n', '\n').split('\n').filter((line) => !STEP.test(line));
  const paragraphs: string[][] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (line.trim() === '') {
      if (current.length) paragraphs.push(current);
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.length) paragraphs.push(current);

  return paragraphs.map((paragraph): Block => {
    if (paragraph.every((line) => BULLET.test(line))) {
      return { type: 'ul', items: paragraph.map((line) => mentions(line.replace(BULLET, '').trim(), known)) };
    }
    return { type: 'p', parts: mentions(paragraph.map((line) => line.trim()).join(' '), known) };
  });
}

/**
 * What changed between the item the board had and the one on disk, as diff lines (`- old`,
 * `+ new`): header fields, then steps. For the "changed on disk" dialog.
 */
export function itemDiff(before: Pick<ItemDetail, 'fields' | 'steps'>, after: Pick<ItemDetail, 'fields' | 'steps'>): string[] {
  const lines: string[] = [];
  const show = (value: unknown) => (Array.isArray(value) ? `[${value.join(', ')}]` : String(value));
  const keys = [...new Set([...Object.keys(before.fields), ...Object.keys(after.fields)])];
  for (const key of keys) {
    const old = (before.fields as unknown as Record<string, unknown>)[key];
    const now = (after.fields as unknown as Record<string, unknown>)[key];
    if (JSON.stringify(old) === JSON.stringify(now)) continue;
    if (old !== undefined) lines.push(`- ${key}: ${show(old)}`);
    if (now !== undefined) lines.push(`+ ${key}: ${show(now)}`);
  }
  const step = (s: { checked: boolean; text: string }) => `- [${s.checked ? 'x' : ' '}] ${s.text}`;
  const count = Math.max(before.steps.length, after.steps.length);
  for (let i = 0; i < count; i++) {
    const old = before.steps[i];
    const now = after.steps[i];
    if (old && now && step(old) === step(now)) continue;
    if (old) lines.push(`- ${step(old)}`);
    if (now) lines.push(`+ ${step(now)}`);
  }
  return lines;
}
