// Header of an item file: a flat `key: value` subset of YAML between two `---` lines.
// Every value is read as text. Lists use the YAML flow style: `labels: [a, b]`.
// When writing, any value a YAML parser could misread (`1.10`, `no`, `null`…) is quoted,
// so the files stay valid YAML with the same meaning for other tools.

const KEY = /^[A-Za-z][A-Za-z0-9]*$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class FormatError extends Error {
  constructor(message, line) {
    super(line ? `line ${line}: ${message}` : message);
    this.name = 'FormatError';
    this.line = line;
  }
}

/** Splits a document into its header lines and its body. Accepts CRLF and a leading BOM. */
export function splitDocument(text) {
  const lines = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  if (lines[0] !== '---') throw new FormatError('the file must start with a --- line', 1);
  const end = lines.indexOf('---', 1);
  if (end === -1) throw new FormatError('the header is not closed with a --- line');
  return { headerLines: lines.slice(1, end), body: lines.slice(end + 1).join('\n') };
}

/** Parses header lines into an object of strings and string arrays. */
export function parseHeader(headerLines) {
  const fields = {};
  headerLines.forEach((raw, i) => {
    const line = i + 2; // line 1 is the opening ---
    if (raw.trim() === '') return;
    const match = /^([^:\s]+):(?:[ \t]+(.*))?$/.exec(raw);
    if (!match || !KEY.test(match[1])) {
      throw new FormatError(`expected "key: value", found ${JSON.stringify(raw)}`, line);
    }
    const key = match[1];
    if (Object.hasOwn(fields, key)) throw new FormatError(`duplicate key "${key}"`, line);
    fields[key] = parseValue((match[2] ?? '').trim(), line);
  });
  return fields;
}

function parseValue(value, line) {
  if (!value.startsWith('[')) return parseScalar(value, line);
  if (!value.endsWith(']')) throw new FormatError('unclosed list', line);
  return splitList(value.slice(1, -1), line).map((item) => parseScalar(item, line));
}

function splitList(inner, line) {
  if (inner.trim() === '') return [];
  const items = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    current += c;
    if (quote === '"' && c === '\\') {
      current += inner[++i] ?? '';
    } else if (quote === "'" && c === "'" && inner[i + 1] === "'") {
      current += inner[++i];
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

function parseScalar(value, line) {
  if (value.startsWith('"')) {
    try {
      const parsed = JSON.parse(value);
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

/**
 * Whether a plain YAML scalar would be read as something other than this exact string.
 * `allowDate` leaves ISO dates unquoted, for fields that hold dates.
 */
export function needsQuotes(value, { allowDate = false, inList = false } = {}) {
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

function formatScalar(value, options) {
  if (typeof value !== 'string') throw new FormatError(`values must be strings, found ${typeof value}`);
  if (/[\n\r]/.test(value)) throw new FormatError('values must fit on one line');
  return needsQuotes(value, options) ? JSON.stringify(value) : value;
}

/**
 * Serializes fields into header lines. Keys in `order` come first, in that order; any other
 * key follows in its original order.
 */
export function serializeHeader(fields, { order = [], dateKeys = new Set() } = {}) {
  const keys = [...order.filter((k) => Object.hasOwn(fields, k)), ...Object.keys(fields).filter((k) => !order.includes(k))];
  return keys
    .filter((key) => fields[key] !== undefined)
    .map((key) => {
      if (!KEY.test(key)) throw new FormatError(`invalid key "${key}"`);
      const value = fields[key];
      const text = Array.isArray(value)
        ? `[${value.map((v) => formatScalar(v, { inList: true })).join(', ')}]`
        : formatScalar(value, { allowDate: dateKeys.has(key) });
      return `${key}: ${text}`;
    });
}

/** Builds a whole document: header between --- lines, then the body, ending with a newline. */
export function serializeDocument(fields, body, options) {
  const text = ['---', ...serializeHeader(fields, options), '---', body].join('\n');
  return text.endsWith('\n') ? text : `${text}\n`;
}
