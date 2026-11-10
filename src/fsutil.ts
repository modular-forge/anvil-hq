// File writes for the data space: atomic replacement, exclusive creation and retries for the
// transient locks that Windows editors and antivirus software hold on files.

import { randomBytes } from 'node:crypto';
import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, statSync, unlinkSync, writeSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import { ConflictError } from './errors.ts';

const TRANSIENT = new Set(['EPERM', 'EBUSY', 'EACCES']);

/** The `code` of a Node system error, if any. */
export function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | null)?.code;
}

export function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

interface RetryOptions {
  attempts?: number;
  delay?: number;
  when: (error: unknown) => boolean;
}

/** Calls `fn` until it succeeds, retrying with a growing delay while `when(error)` is true. */
export function retry<T>(fn: () => T, { attempts = 6, delay = 50, when }: RetryOptions): T {
  for (let attempt = 1; ; attempt++) {
    try {
      return fn();
    } catch (error) {
      if (attempt >= attempts || !when(error)) throw error;
      sleep(delay * attempt);
    }
  }
}

/** Modification time in ms, or null when the file does not exist. */
export function mtimeOf(file: string): number | null {
  try {
    return statSync(file).mtimeMs;
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Replaces `file` with `text` through a temp file and a rename, so readers never see half a file.
 * With `expectMtimeMs`, refuses to write if the file changed since it was read (null: it must not
 * exist yet).
 */
export function writeAtomic(file: string, text: string, { expectMtimeMs }: { expectMtimeMs?: number | null } = {}): void {
  mkdirSync(dirname(file), { recursive: true });
  const temp = join(dirname(file), `.${basename(file)}.${randomBytes(4).toString('hex')}.tmp`);
  writeNew(temp, text);
  try {
    if (expectMtimeMs !== undefined && mtimeOf(file) !== expectMtimeMs) throw new ConflictError(file);
    retry(() => renameSync(temp, file), { when: (error) => TRANSIENT.has(errorCode(error) ?? '') });
  } catch (error) {
    try {
      unlinkSync(temp);
    } catch {
      // the temp file is already gone
    }
    throw error;
  }
}

/** Creates `file` with `text`; throws an EEXIST error if it already exists. */
export function createExclusive(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeNew(file, text);
}

export function removeFile(file: string): void {
  retry(() => unlinkSync(file), { when: (error) => TRANSIENT.has(errorCode(error) ?? '') });
}

/** Throws unless `file` lies inside `dir`: anvil never writes outside the data space. */
export function assertInside(dir: string, file: string): void {
  const rel = relative(dir, file);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`refusing to write ${file}: it is outside the data space ${dir}`);
  }
}

function writeNew(file: string, text: string): void {
  const fd = openSync(file, 'wx');
  try {
    writeSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
