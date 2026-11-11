// SessionStart hook of the anvil plugin. Runs `anvil briefing` in the session's folder and prints
// what it prints: Claude Code adds a SessionStart hook's output to the context. It never fails
// and never blocks a session: without the CLI, outside a known project, or on any error, it prints
// nothing. Read-only, like `anvil briefing` itself.
//
// Node runs this file directly (it strips the types), so it only uses node: modules.

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
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

/** What the hook prints for a run: its output when it succeeded and said something, else nothing. */
export function hookOutput(run: BriefingRun): string {
  return run.status === 0 && run.stdout.trim() ? run.stdout : '';
}

// Run as the hook, not when a test imports it.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(hookOutput(runAnvilBriefing(process.env['CLAUDE_PROJECT_DIR'] || process.cwd())));
  } catch {
    // Nothing to add to the session.
  }
  process.exitCode = 0;
}
