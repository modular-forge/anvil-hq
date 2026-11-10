// Minimal JSON Schema validator for the subset the schemas in schema/ use. It throws on any
// keyword it does not know, so a schema can never ask for a check that is silently skipped.

export interface Schema {
  type?: string;
  const?: unknown;
  enum?: unknown[];
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  format?: string;
  uniqueItems?: boolean;
  required?: string[];
  properties?: Record<string, Schema>;
  additionalProperties?: boolean | Schema;
  items?: Schema;
  [keyword: string]: unknown;
}

export interface SchemaError {
  path: string;
  message: string;
}

const ANNOTATIONS = new Set(['$schema', '$id', '$comment', 'title', 'description', 'examples', 'default']);
const NESTED = new Set(['properties', 'additionalProperties', 'items']);

type Check = (schema: Schema, value: unknown) => string | null;

const CHECKS: Record<string, Check> = {
  type(schema, value) {
    return matchesType(value, schema.type ?? '') ? null : `must be ${schema.type}`;
  },
  const(schema, value) {
    return Object.is(value, schema.const) ? null : `must be ${JSON.stringify(schema.const)}`;
  },
  enum(schema, value) {
    return schema.enum?.includes(value) ? null : `must be one of ${schema.enum?.join(', ')}`;
  },
  pattern(schema, value) {
    return typeof value !== 'string' || new RegExp(schema.pattern ?? '', 'u').test(value) ? null : `does not match ${schema.pattern}`;
  },
  minLength(schema, value) {
    return typeof value !== 'string' || [...value].length >= (schema.minLength ?? 0) ? null : `must have at least ${schema.minLength} character(s)`;
  },
  maxLength(schema, value) {
    return typeof value !== 'string' || [...value].length <= (schema.maxLength ?? Infinity) ? null : `must have at most ${schema.maxLength} characters`;
  },
  minimum(schema, value) {
    return typeof value !== 'number' || value >= (schema.minimum ?? -Infinity) ? null : `must be ${schema.minimum} or more`;
  },
  format(schema, value) {
    if (typeof value !== 'string') return null;
    if (schema.format === 'date') return isDate(value) ? null : 'must be a date (YYYY-MM-DD)';
    if (schema.format === 'uri') return URL.canParse(value) ? null : 'must be a URL';
    throw new Error(`unsupported format "${schema.format}"`);
  },
  uniqueItems(schema, value) {
    if (!schema.uniqueItems || !Array.isArray(value)) return null;
    const seen = value.map((v) => JSON.stringify(v));
    return new Set(seen).size === seen.length ? null : 'must not repeat items';
  },
  required(schema, value) {
    if (!isObject(value)) return null;
    const missing = (schema.required ?? []).filter((key) => !Object.hasOwn(value, key));
    return missing.length ? `missing ${missing.map((k) => `"${k}"`).join(', ')}` : null;
  },
};

/** Returns a list of { path, message } errors; empty when `value` matches `schema`. */
export function validateSchema(schema: Schema, value: unknown, path = ''): SchemaError[] {
  const errors: SchemaError[] = [];
  for (const keyword of Object.keys(schema)) {
    if (ANNOTATIONS.has(keyword) || NESTED.has(keyword)) continue;
    const check = CHECKS[keyword];
    if (!check) throw new Error(`unsupported JSON Schema keyword "${keyword}"`);
    const message = check(schema, value);
    if (message) errors.push({ path, message });
  }
  if (schema.type && !matchesType(value, schema.type)) return errors;

  if (isObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      const childSchema = schema.properties?.[key];
      if (childSchema) {
        errors.push(...validateSchema(childSchema, child, join(path, key)));
      } else if (schema.additionalProperties === false) {
        errors.push({ path: join(path, key), message: 'is not an allowed field' });
      } else if (isObject(schema.additionalProperties)) {
        errors.push(...validateSchema(schema.additionalProperties, child, join(path, key)));
      }
    }
  }
  const { items } = schema;
  if (Array.isArray(value) && items) {
    value.forEach((child: unknown, i) => errors.push(...validateSchema(items, child, `${path}[${i}]`)));
  }
  return errors;
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case 'object': return isObject(value);
    case 'array': return Array.isArray(value);
    case 'string': return typeof value === 'string';
    case 'integer': return Number.isInteger(value);
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'boolean': return typeof value === 'boolean';
    default: throw new Error(`unsupported type "${type}"`);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [y, m, d] = match.slice(1).map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function join(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}
