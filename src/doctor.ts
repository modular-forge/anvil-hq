// `anvil doctor`: checks that the data space is healthy and stays private.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { TOOL_ROOT } from './data-dir.ts';
import { errorCode } from './fsutil.ts';
import { configValue, isRepository, originUrl, repoSlug, repositoryRoot, uncommittedChanges, unpushedCount } from './git.ts';
import { validateSpace } from './validate.ts';

export type CheckStatus = 'ok' | 'warn' | 'fail';

export interface CheckResult {
  check: string;
  status: CheckStatus;
  detail: string;
}

export type VisibilityLookup = (slug: string) => { value: string; error?: undefined } | { value?: undefined; error: string };

export interface DoctorOptions {
  gh?: VisibilityLookup;
  /** The anvil-hq clone whose pre-commit hook is checked. */
  toolRoot?: string;
}

export function doctor(dir: string, { gh = ghVisibility, toolRoot = TOOL_ROOT }: DoctorOptions = {}): CheckResult[] {
  const results: CheckResult[] = [];
  const add = (check: string, status: CheckStatus, detail: string) => results.push({ check, status, detail });

  const hook = hookCheck(toolRoot);
  if (hook) add('hook', hook.status, hook.detail);

  const { errors, stats } = validateSpace(dir);
  if (errors.length) add('format', 'fail', `${errors.length} problem(s); run \`anvil validate\``);
  else add('format', 'ok', `${stats.projects} project(s), ${stats.items} item(s)`);

  if (!isRepository(dir)) {
    add('git', 'fail', 'the data space is not a git repository, so changes have no history or backup');
    return results;
  }
  const email = configValue(dir, 'user.email');
  add('identity', email ? 'ok' : 'fail', email ? `commits as ${email}` : 'no user.email: set one (a noreply address keeps yours private)');

  const changes = uncommittedChanges(dir);
  add('uncommitted', changes.length ? 'warn' : 'ok', changes.length ? `${changes.length} uncommitted change(s)` : 'nothing uncommitted');

  const url = originUrl(dir);
  if (!url) {
    add('remote', 'warn', 'no origin remote: there is no backup outside this machine');
    return results;
  }
  const unpushed = unpushedCount(dir);
  if (unpushed === null) add('push', 'warn', 'the branch has no upstream; push it with `git push -u origin main`');
  else add('push', unpushed ? 'warn' : 'ok', unpushed ? `${unpushed} commit(s) not pushed` : 'everything pushed');

  const slug = repoSlug(url);
  const visibility = slug ? gh(slug) : { error: `cannot read owner/name from ${url}` };
  if (visibility.error !== undefined) add('private', 'warn', `cannot check the remote's visibility: ${visibility.error}`);
  else if (visibility.value === 'PRIVATE') add('private', 'ok', `${slug} is private`);
  else add('private', 'fail', `${slug} is ${visibility.value?.toLowerCase()}: make it private, your data is exposed`);
  return results;
}

/**
 * Whether the pre-commit hook that keeps personal data out of the public anvil-hq repository is
 * active in this clone. Null when anvil is not running from a git clone (nothing to protect).
 */
export function hookCheck(toolRoot: string): Omit<CheckResult, 'check'> | null {
  const root = repositoryRoot(toolRoot);
  if (!root || relative(root, toolRoot) !== '') return null;
  const hooksPath = configValue(toolRoot, 'core.hooksPath');
  if (hooksPath === '.githooks' && existsSync(join(toolRoot, '.githooks', 'pre-commit'))) {
    return { status: 'ok', detail: 'the anvil-hq pre-commit hook is active' };
  }
  return { status: 'warn', detail: 'the anvil-hq pre-commit hook is not active; run `npm run hooks` in the anvil-hq folder' };
}

/** Visibility of a GitHub repository through the gh CLI. */
export function ghVisibility(slug: string): ReturnType<VisibilityLookup> {
  try {
    const value = execFileSync('gh', ['repo', 'view', slug, '--json', 'visibility', '--jq', '.visibility'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    return { value };
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return { error: 'gh is not installed' };
    const failure = error as Error & { stderr?: string };
    return { error: String(failure.stderr || failure.message).trim().split('\n')[0] ?? 'unknown error' };
  }
}
