// SessionStart hook of the anvil plugin. Runs `anvil briefing` in the session's folder and prints
// what it prints, followed by the rules for working with anvil during the session
// (rules/session.md): Claude Code adds a SessionStart hook's output to the context. It never fails
// and never blocks a session: without the CLI, outside a known project, or on any error, it prints
// nothing. Read-only, like `anvil briefing` itself.
//
// Node runs this file directly (it strips the types), so it only uses node: modules.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The briefing never takes long; a stuck command must not hold the session. */
export const BRIEFING_TIMEOUT_MS = 10_000;

export interface BriefingRun {
  status: number | null;
  stdout: string;
}

/** Runs `anvil briefing`; `anvil` from npm is a .cmd shim on Windows, which needs a shell there. */
export function runAnvilBriefing(cwd: string): BriefingRun {
  // A fixed command line, nothing from outside: on Windows it goes to the shell whole.
  const windows = process.platform === 'win32';
  const result = spawnSync(windows ? 'anvil briefing' : 'anvil', windows ? [] : ['briefing'], {
    cwd,
    encoding: 'utf8',
    timeout: BRIEFING_TIMEOUT_MS,
    shell: windows,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return { status: result.status, stdout: typeof result.stdout === 'string' ? result.stdout : '' };
}

/** The rules for working with anvil during a session; nothing if the file cannot be read. */
export function sessionRules(): string {
  try {
    return readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'rules', 'session.md'), 'utf8').replaceAll('\r\n', '\n');
  } catch {
    return '';
  }
}

/**
 * What the hook prints for a run: its output when it succeeded and said something, followed by
 * `rules`; else nothing, because the rules only make sense in a project anvil knows.
 */
export function hookOutput(run: BriefingRun, rules = ''): string {
  if (run.status !== 0 || !run.stdout.trim()) return '';
  return rules.trim() ? `${run.stdout.trimEnd()}\n\n${rules.trim()}\n` : run.stdout;
}

// Run as the hook, not when a test imports it.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(hookOutput(runAnvilBriefing(process.env['CLAUDE_PROJECT_DIR'] || process.cwd()), sessionRules()));
  } catch {
    // Nothing to add to the session.
  }
  process.exitCode = 0;
}
