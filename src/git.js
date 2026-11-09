// Commits in the data space. git runs without a shell, with fixed arguments, and only ever stages
// the paths an operation touched.

import { execFileSync } from 'node:child_process';
import { AnvilError } from './errors.js';
import { retry } from './fsutil.js';

function git(dir, args) {
  return execFileSync('git', ['-C', dir, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
}

/** Retries while another git process holds the index lock. */
function gitWithRetry(dir, args) {
  return retry(() => git(dir, args), { attempts: 8, delay: 100, when: (error) => /index\.lock/.test(String(error.stderr)) });
}

export function isRepository(dir) {
  try {
    return git(dir, ['rev-parse', '--is-inside-work-tree']).trim() === 'true';
  } catch {
    return false;
  }
}

/**
 * Stages and commits exactly `paths` (relative to `dir`, deletions included) with `message`.
 * Returns { committed: true, hash } or { committed: false, reason }.
 */
export function commitPaths(dir, paths, message) {
  if (!isRepository(dir)) return { committed: false, reason: 'the data space is not a git repository' };
  try {
    gitWithRetry(dir, ['add', '--all', '--', ...paths]);
    if (!hasStagedChanges(dir, paths)) return { committed: false, reason: 'nothing changed' };
    gitWithRetry(dir, ['commit', '--quiet', '--message', message, '--', ...paths]);
    return { committed: true, hash: git(dir, ['rev-parse', '--short', 'HEAD']).trim() };
  } catch (error) {
    const detail = String(error.stderr || error.message).trim().split('\n').at(-1);
    throw new AnvilError(`the files were written but git could not commit them: ${detail}`);
  }
}

function hasStagedChanges(dir, paths) {
  try {
    git(dir, ['diff', '--cached', '--quiet', '--', ...paths]);
    return false;
  } catch (error) {
    if (error.status === 1) return true;
    throw error;
  }
}
