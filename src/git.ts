// Git in the data space and in project repositories. git runs without a shell, with fixed
// arguments, and commits only ever stage the paths an operation touched.

import { execFileSync } from 'node:child_process';
import { AnvilError } from './errors.ts';
import { retry } from './fsutil.ts';
import type { CommitResult } from './types.ts';

/** What execFileSync attaches to the error of a failed command. */
interface ExecError extends Error {
  status?: number | null;
  stderr?: string | Buffer;
}

function git(dir: string, args: string[]): string {
  return execFileSync('git', ['-C', dir, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
}

/** Retries while another git process holds the index lock. */
function gitWithRetry(dir: string, args: string[]): string {
  return retry(() => git(dir, args), { attempts: 8, delay: 100, when: (error) => /index\.lock/.test(String((error as ExecError).stderr)) });
}

/** Top folder of the git repository that contains `dir`, or null. */
export function repositoryRoot(dir: string): string | null {
  try {
    return git(dir, ['rev-parse', '--show-toplevel']).trim();
  } catch {
    return null;
  }
}

/** URL of the `origin` remote, or null. */
export function originUrl(dir: string): string | null {
  try {
    return git(dir, ['remote', 'get-url', 'origin']).trim() || null;
  } catch {
    return null;
  }
}

/** `owner/name` from a GitHub-style remote URL (https or ssh), or null. */
export function repoSlug(url: string | null | undefined): string | null {
  const match = /^(?:https?:\/\/[^/]+\/|ssh:\/\/[^/]+\/|[^@\s]+@[^:\s]+:)([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(url ?? '');
  return match ? `${match[1]}/${match[2]}` : null;
}

/** Commits on the current branch that its upstream does not have, or null without an upstream. */
export function unpushedCount(dir: string): number | null {
  try {
    return Number(git(dir, ['rev-list', '--count', '@{upstream}..HEAD']).trim());
  } catch {
    return null;
  }
}

/** Paths with uncommitted changes, as `git status --porcelain` lines. */
export function uncommittedChanges(dir: string): string[] {
  return git(dir, ['status', '--porcelain']).split('\n').filter(Boolean);
}

/** A git config value of the repository, or null. */
export function configValue(dir: string, key: string): string | null {
  try {
    return git(dir, ['config', '--get', key]).trim() || null;
  } catch {
    return null;
  }
}

/** Creates a repository with `main` as its first branch. */
export function initRepository(dir: string): void {
  git(dir, ['init', '--quiet', '--initial-branch=main']);
}

export function setConfig(dir: string, key: string, value: string): void {
  git(dir, ['config', key, value]);
}

export function isRepository(dir: string): boolean {
  try {
    return git(dir, ['rev-parse', '--is-inside-work-tree']).trim() === 'true';
  } catch {
    return false;
  }
}

/** Stages and commits exactly `paths` (relative to `dir`, deletions included) with `message`. */
export function commitPaths(dir: string, paths: string[], message: string): CommitResult {
  if (!isRepository(dir)) return { committed: false, reason: 'the data space is not a git repository' };
  try {
    gitWithRetry(dir, ['add', '--all', '--', ...paths]);
    if (!hasStagedChanges(dir, paths)) return { committed: false, reason: 'nothing changed' };
    gitWithRetry(dir, ['commit', '--quiet', '--message', message, '--', ...paths]);
    return { committed: true, hash: git(dir, ['rev-parse', '--short', 'HEAD']).trim() };
  } catch (error) {
    const failure = error as ExecError;
    const detail = String(failure.stderr || failure.message).trim().split('\n').at(-1);
    throw new AnvilError(`the files were written but git could not commit them: ${detail}`);
  }
}

function hasStagedChanges(dir: string, paths: string[]): boolean {
  try {
    git(dir, ['diff', '--cached', '--quiet', '--', ...paths]);
    return false;
  } catch (error) {
    if ((error as ExecError).status === 1) return true;
    throw error;
  }
}
