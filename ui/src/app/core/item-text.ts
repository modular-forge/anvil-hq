// An item's body as the board shows it: a safe subset of Markdown (paragraphs, headings, bullet
// and numbered lists, code blocks; bold, italics, inline code and http(s) links), with mentions
// of other items (like AB-12) turned into links. Steps are shown apart, so their lines are left
// out. Plain data, rendered by the template: never HTML, so nothing in a body can run.

import type { ItemDetail } from './models';

/** Plain text, or a mention of an item: what journal notes show. */
export type Mention = { text: string } | { id: string };

export type Inline =
  | Mention
  | { code: string }
  | { strong: string }
  | { em: string }
  | { link: string; href: string };

export type Block =
  | { type: 'p'; parts: Inline[] }
  | { type: 'h'; level: 1 | 2 | 3; parts: Inline[] }
  | { type: 'ul'; items: Inline[][] }
  | { type: 'ol'; items: Inline[][] }
  | { type: 'code'; text: string };

const STEP = /^\s*[-*+] \[[ xX]\] /;
const BULLET = /^\s*[-*+] (.*)$/;
const NUMBERED = /^\s*\d+[.)] (.*)$/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)/;
const MENTION = /\b[A-Z]{2,4}-[1-9][0-9]*\b/g;
// Inline code, [text](http…), **bold**, *italics* or _italics_, in that order of precedence.
const INLINE = /`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*]+?)\*\*|(?<![\w*])\*([^*\s](?:[^*]*?[^*\s])?)\*(?![\w*])|(?<![\w_])_([^_\s](?:[^_]*?[^_\s])?)_(?![\w_])/g;

/** Splits `text` into plain text and mentions of ids that `known` accepts. */
export function mentions(text: string, known: (id: string) => boolean): Mention[] {
  const parts: Mention[] = [];
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

/** Inline Markdown of one line or paragraph; mentions are found in the plain text only. */
export function inline(text: string, known: (id: string) => boolean): Inline[] {
  const parts: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > last) parts.push(...mentions(text.slice(last, match.index), known));
    const [, code, label, href, strong, starEm, underEm] = match;
    if (code !== undefined) parts.push({ code });
    else if (label !== undefined && href !== undefined) parts.push({ link: label, href });
    else if (strong !== undefined) parts.push({ strong });
    else parts.push({ em: starEm ?? underEm ?? '' });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(...mentions(text.slice(last), known));
  return parts;
}

export function bodyBlocks(body: string, known: (id: string) => boolean): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { type: 'ul' | 'ol'; items: string[] } | null = null;
  let code: string[] | null = null;

  const flush = () => {
    if (paragraph.length) blocks.push({ type: 'p', parts: inline(paragraph.join(' '), known) });
    if (list) blocks.push({ type: list.type, items: list.items.map((item) => inline(item, known)) });
    paragraph = [];
    list = null;
  };

  for (const raw of body.replaceAll('\r\n', '\n').split('\n')) {
    if (code) {
      if (FENCE.test(raw)) {
        blocks.push({ type: 'code', text: code.join('\n') });
        code = null;
      } else {
        code.push(raw);
      }
      continue;
    }
    if (FENCE.test(raw)) {
      flush();
      code = [];
      continue;
    }
    if (STEP.test(raw)) continue;
    const line = raw.trim();
    const heading = HEADING.exec(line);
    const bullet = BULLET.exec(raw);
    const numbered = NUMBERED.exec(raw);
    if (!line) {
      flush();
    } else if (heading) {
      flush();
      const level = Math.min(3, heading[1]?.length ?? 1) as 1 | 2 | 3;
      blocks.push({ type: 'h', level, parts: inline(heading[2] ?? '', known) });
    } else if (bullet || numbered) {
      const type = bullet ? 'ul' : 'ol';
      if (paragraph.length || (list && list.type !== type)) flush();
      list ??= { type, items: [] };
      list.items.push((bullet?.[1] ?? numbered?.[1] ?? '').trim());
    } else if (list && /^\s+/.test(raw)) {
      // An indented line continues the list item above it.
      list.items[list.items.length - 1] += ` ${line}`;
    } else {
      if (list) flush();
      paragraph.push(line);
    }
  }
  if (code) blocks.push({ type: 'code', text: (code as string[]).join('\n') });
  flush();
  return blocks;
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
