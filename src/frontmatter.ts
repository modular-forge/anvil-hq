// Header of an item file: a flat `key: value` subset of YAML between two `---` lines.
// Every value is read as text. Lists use the YAML flow style: `labels: [a, b]`.
// When writing, any value a YAML parser could misread (`1.10`, `no`, `null`…) is quoted,
// so the files stay valid YAML with the same meaning for other tools.

import type { Header, HeaderValue } from './types.ts';

const KEY = /^[A-Za-z][A-Za-z0-9]*$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class FormatError extends Error {
  readonly line: number | undefined;

  constructor(message: string, line?: number) {
    super(line ? `line ${line}: ${message}` : message);
    this.name = 'FormatError';
    this.line = line;
  }
}

/** Splits a document into its header lines and its body. Accepts CRLF and a leading BOM. */
export function splitDocument(text: string): { headerLines: string[]; body: string } {
  const lines = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  if (lines[0] !== '---') throw new FormatError('the file must start with a --- line', 1);
  const end = lines.indexOf('---', 1);
  if (end === -1) throw new FormatError('the header is not closed with a --- line');
  return { headerLines: lines.slice(1, end), body: lines.slice(end + 1).join('\n') };
}

/** Parses header lines into an object of strings and string arrays. */
export function parseHeader(headerLines: string[]): Header {
  const fields: Header = {};
  headerLines.forEach((raw, i) => {
    const line = i + 2; // line 1 is the opening ---
    if (raw.trim() === '') return;
    const match = /^([^:\s]+):(?:[ \t]+(.*))?$/.exec(raw);
    const key = match?.[1];
    if (!match || !key || !KEY.test(key)) {
      throw new FormatError(`expected "key: value", found ${JSON.stringify(raw)}`, line);
    }
    if (Object.hasOwn(fields, key)) throw new FormatError(`duplicate key "${key}"`, line);
    fields[key] = parseValue((match[2] ?? '').trim(), line);
  });
  return fields;
}

function parseValue(value: string, line: number): HeaderValue {
  if (!value.startsWith('[')) return parseScalar(value, line);
  if (!value.endsWith(']')) throw new FormatError('unclosed list', line);
  return splitList(value.slice(1, -1), line).map((item) => parseScalar(item, line));
}

function splitList(inner: string, line: number): string[] {
  if (inner.trim() === '') return [];
  const items: string[] = [];
  let current = '';
  let quote: string | null = null;
  for (let i = 0; i < inner.length; i++) {
    const c = inner.charAt(i);
    current += c;
    if (quote === '"' && c === '\\') {
      current += inner.charAt(++i);
    } else if (quote === "'" && c === "'" && inner[i + 1] === "'") {
      current += inner.charAt(++i);
    } else if (quote && c === quote) {
      quote = null;
    } else if (!quote && (c === '"' || c === "'")) {
      quote = c;
    } else if (!quote && c === ',') {
      items.push(current.slice(0, -1).trim());
      current = '';
    } else if (!quote && '[]{}'.includes(c)) {
      throw new FormatError('nested lists and maps are not supported', line);
    }
  }
  if (quote) throw new FormatError('unclosed quote in a list', line);
  items.push(current.trim());
  if (items.includes('')) throw new FormatError('empty list item', line);
  return items;
}

function parseScalar(value: string, line: number): string {
  if (value.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed === 'string') return parsed;
    } catch {
      // reported below
    }
    throw new FormatError(`invalid double-quoted value ${value}`, line);
  }
  if (value.startsWith("'")) {
    const inner = value.slice(1, -1);
    if (value.length < 2 || !value.endsWith("'") || inner.replaceAll("''", '').includes("'")) {
      throw new FormatError(`invalid single-quoted value ${value}`, line);
    }
    return inner.replaceAll("''", "'");
  }
  return value;
}

interface QuoteOptions {
  /** Leave ISO dates unquoted, for fields that hold dates. */
  allowDate?: boolean;
  /** The value is a list item, where commas and brackets are syntax. */
  inList?: boolean;
}

/** Whether a plain YAML scalar would be read as something other than this exact string. */
export function needsQuotes(value: string, { allowDate = false, inList = false }: QuoteOptions = {}): boolean {
  if (value === '' || value !== value.trim()) return true;
  if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(value)) return true;
  if (/: |:$| #|\t/.test(value)) return true;
  if (inList && /[,[\]{}]/.test(value)) return true;
  if (/^(true|false|yes|no|on|off|y|n|null|~)$/i.test(value)) return true;
  if (/^[-+]?(\.\d+|\d[\d_]*(\.[\d_]*)?)([eE][-+]?\d+)?$/.test(value)) return true;
  if (/^[-+]?(0x[\da-f_]+|0o[0-7_]+|0b[01_]+)$/i.test(value)) return true;
  if (/^[-+]?\.(inf|nan)$/i.test(value)) return true;
  if (/^[-+]?\d[\d_]*(:[0-5]?\d)+(\.\d*)?$/.test(value)) return true; // YAML 1.1 base 60
  if (/^\d{4}-\d\d?-\d\d?([Tt ]|$)/.test(value)) return !(allowDate && ISO_DATE.test(value));
  return false;
}

function formatScalar(value: unknown, options: QuoteOptions): string {
  if (typeof value !== 'string') throw new FormatError(`values must be strings, found ${typeof value}`);
  if (/[\n\r]/.test(value)) throw new FormatError('values must fit on one line');
  return needsQuotes(value, options) ? JSON.stringify(value) : value;
}

export interface SerializeOptions {
  /** Keys written first, in this order; any other key follows in its original order. */
  order?: readonly string[];
  dateKeys?: ReadonlySet<string>;
}

/** Serializes fields into header lines. */
export function serializeHeader(fields: Record<string, unknown>, { order = [], dateKeys = new Set() }: SerializeOptions = {}): string[] {
  const keys = [...order.filter((k) => Object.hasOwn(fields, k)), ...Object.keys(fields).filter((k) => !order.includes(k))];
  return keys
    .filter((key) => fields[key] !== undefined)
    .map((key) => {
      if (!KEY.test(key)) throw new FormatError(`invalid key "${key}"`);
      const value = fields[key];
      const text = Array.isArray(value)
        ? `[${value.map((v: unknown) => formatScalar(v, { inList: true })).join(', ')}]`
        : formatScalar(value, { allowDate: dateKeys.has(key) });
      return `${key}: ${text}`;
    });
}

/** Builds a whole document: header between --- lines, then the body, ending with a newline. */
export function serializeDocument(fields: Record<string, unknown>, body: string, options?: SerializeOptions): string {
  const text = ['---', ...serializeHeader(fields, options), '---', body].join('\n');
  return text.endsWith('\n') ? text : `${text}\n`;
}
