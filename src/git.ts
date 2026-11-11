// Git in the data space and in project repositories. git runs without a shell, with fixed
// arguments, and commits only ever stage the paths an operation touched.

import { execFile, execFileSync } from 'node:child_process';
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

/**
 * Whether `dir` is the top folder of a git repository, not a folder inside one. Asks git instead
 * of comparing paths, which differ in form on Windows (8.3 short names, slashes, case).
 */
export function isRepositoryRoot(dir: string): boolean {
  try {
    return git(dir, ['rev-parse', '--show-prefix']).trim() === '';
  } catch {
    return false;
  }
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

export interface HistoryEntry {
  hash: string;
  /** Commit date, ISO 8601. */
  date: string;
  subject: string;
}

/**
 * Commits that changed `file` (relative to `dir`), newest first, following renames: a moved or
 * archived item keeps its history. Empty outside a repository.
 */
export function fileHistory(dir: string, file: string, limit = 50): HistoryEntry[] {
  let out: string;
  try {
    out = git(dir, ['log', '--follow', `--max-count=${limit}`, '--format=%h%x1f%cI%x1f%s', '--', file]);
  } catch {
    return [];
  }
  return out.split('\n').filter(Boolean).map((line) => {
    const [hash = '', date = '', subject = ''] = line.split('\x1f');
    return { hash, date, subject };
  });
}

/** Longest a push may take before it is given up, so a stuck network never holds the board. */
export const PUSH_TIMEOUT_MS = 60_000;

/** Why a push did not happen: no upstream, the remote moved on, or git failed (network, auth). */
export type PushFailure = 'no-upstream' | 'rejected' | 'failed';

export type PushResult = { pushed: true; commits: number } | { pushed: false; failure: PushFailure; message: string };

/**
 * Pushes the current branch to its upstream, the only thing it ever pushes: never with force,
 * never tags or other branches, and only when there is something to push. The remote and the
 * branch come from the branch's own git config, and are passed as fixed arguments without a
 * shell. Asynchronous, so the server keeps answering while the network works.
 */
export async function pushToUpstream(dir: string, timeout = PUSH_TIMEOUT_MS): Promise<PushResult> {
  const branch = currentBranch(dir);
  const remote = branch && configValue(dir, `branch.${branch}.remote`);
  const merge = branch && configValue(dir, `branch.${branch}.merge`);
  const commits = unpushedCount(dir);
  if (!branch || !remote || !merge || commits === null || !SAFE_REMOTE.test(remote) || !merge.startsWith('refs/heads/')) {
    return { pushed: false, failure: 'no-upstream', message: 'the branch has no upstream to push to; set one up with `git push -u origin main` first' };
  }
  if (commits === 0) return { pushed: true, commits: 0 };
  try {
    await run(dir, ['push', '--quiet', '--no-follow-tags', remote, `HEAD:${merge}`], timeout);
    return { pushed: true, commits };
  } catch (error) {
    const failure = error as ExecError & { killed?: boolean };
    const detail = String(failure.stderr || failure.message).trim();
    if (/\[rejected\]|non-fast-forward|fetch first/.test(detail)) {
      return { pushed: false, failure: 'rejected', message: 'the remote has commits this copy does not have; pull them in a terminal (`git pull --rebase`), then push again' };
    }
    const reason = failure.killed ? `no answer from the remote in ${Math.round(timeout / 1000)} s` : (detail.split('\n').filter(Boolean).at(-1) ?? 'unknown error');
    return { pushed: false, failure: 'failed', message: `git could not push: ${reason}` };
  }
}

/** A remote name git would accept and that cannot be taken for an option. */
const SAFE_REMOTE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function currentBranch(dir: string): string | null {
  try {
    return git(dir, ['symbolic-ref', '--quiet', '--short', 'HEAD']).trim() || null;
  } catch {
    return null;
  }
}

function run(dir: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', ['-C', dir, ...args], { encoding: 'utf8', timeout, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (error, stdout, stderr) => {
      if (error) reject(Object.assign(error, { stderr }));
      else resolve(stdout);
    });
  });
}

/** Commit date (ISO 8601) of the oldest commit the upstream does not have, or null. */
export function oldestUnpushedDate(dir: string): string | null {
  try {
    const dates = git(dir, ['log', '--format=%cI', '@{upstream}..HEAD']).split('\n').filter(Boolean);
    return dates.at(-1) ?? null;
  } catch {
    return null;
  }
}
