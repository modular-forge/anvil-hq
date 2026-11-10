// Fails when files that look like personal data are about to enter (--staged, from the
// pre-commit hook) or are already in (--all, from CI) this public repository.

import { findLeaks, stagedFiles, trackedFiles } from '../src/leak-guard.ts';

const mode = process.argv[2];
if (mode !== '--staged' && mode !== '--all') {
  process.stderr.write('Usage: node scripts/check-leaks.ts --staged | --all\n');
  process.exit(2);
}

const root = process.cwd();
const leaks = findLeaks(mode === '--staged' ? stagedFiles(root) : trackedFiles(root));
if (leaks.length) {
  process.stderr.write('Personal data must never enter this public repository. These files look like a data space:\n');
  for (const { path, reason } of leaks) process.stderr.write(`  ${path}: ${reason}\n`);
  process.stderr.write('Keep your data in its own private repository. Made-up example data belongs in examples/.\n');
  process.exit(1);
}
process.stdout.write(`No personal data found in ${mode === '--staged' ? 'the staged files' : 'the tracked files'}.\n`);
