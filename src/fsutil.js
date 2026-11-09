// File writes for the data space: atomic replacement, exclusive creation and retries for the
// transient locks that Windows editors and antivirus software hold on files.

import { randomBytes } from 'node:crypto';
import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, statSync, unlinkSync, writeSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import { ConflictError } from './errors.js';

const TRANSIENT = new Set(['EPERM', 'EBUSY', 'EACCES']);

export function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Calls `fn` until it succeeds, retrying with a growing delay while `when(error)` is true. */
export function retry(fn, { attempts = 6, delay = 50, when }) {
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
export function mtimeOf(file) {
  try {
    return statSync(file).mtimeMs;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Replaces `file` with `text` through a temp file and a rename, so readers never see half a file.
 * With `expectMtimeMs`, refuses to write if the file changed since it was read (null: it must not
 * exist yet).
 */
export function writeAtomic(file, text, { expectMtimeMs } = {}) {
  mkdirSync(dirname(file), { recursive: true });
  const temp = join(dirname(file), `.${basename(file)}.${randomBytes(4).toString('hex')}.tmp`);
  writeNew(temp, text);
  try {
    if (expectMtimeMs !== undefined && mtimeOf(file) !== expectMtimeMs) throw new ConflictError(file);
    retry(() => renameSync(temp, file), { when: (error) => TRANSIENT.has(error.code) });
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
export function createExclusive(file, text) {
  mkdirSync(dirname(file), { recursive: true });
  writeNew(file, text);
}

export function removeFile(file) {
  retry(() => unlinkSync(file), { when: (error) => TRANSIENT.has(error.code) });
}

/** Throws unless `file` lies inside `dir`: anvil never writes outside the data space. */
export function assertInside(dir, file) {
  const rel = relative(dir, file);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`refusing to write ${file}: it is outside the data space ${dir}`);
  }
}

function writeNew(file, text) {
  const fd = openSync(file, 'wx');
  try {
    writeSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
