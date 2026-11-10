// `anvil doctor`: checks that the data space is healthy and stays private.

import { execFileSync } from 'node:child_process';
import { configValue, isRepository, originUrl, repoSlug, uncommittedChanges, unpushedCount } from './git.js';
import { validateSpace } from './validate.js';

/** Returns a list of { check, status: 'ok' | 'warn' | 'fail', detail }. */
export function doctor(dir, { gh = ghVisibility } = {}) {
  const results = [];
  const add = (check, status, detail) => results.push({ check, status, detail });

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
  if (visibility.error) add('private', 'warn', `cannot check the remote's visibility: ${visibility.error}`);
  else if (visibility.value === 'PRIVATE') add('private', 'ok', `${slug} is private`);
  else add('private', 'fail', `${slug} is ${visibility.value.toLowerCase()}: make it private, your data is exposed`);
  return results;
}

/** Visibility of a GitHub repository through the gh CLI. */
export function ghVisibility(slug) {
  try {
    const value = execFileSync('gh', ['repo', 'view', slug, '--json', 'visibility', '--jq', '.visibility'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    return { value };
  } catch (error) {
    if (error.code === 'ENOENT') return { error: 'gh is not installed' };
    return { error: String(error.stderr || error.message).trim().split('\n')[0] };
  }
}
