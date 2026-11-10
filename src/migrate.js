// `anvil migrate`: upgrades a data space to the current format version, one version at a time.

import { AnvilError } from './errors.js';

export const CURRENT_VERSION = 1;

/**
 * MIGRATIONS[n] upgrades a data space from version n to n + 1: it receives the operation context,
 * changes files, and returns the relative paths it touched. It must also set the new
 * schemaVersion in projects.json. There are none yet: version 1 is the first.
 */
export const MIGRATIONS = {};

/** Returns { from, to, paths }. Refuses data written by a newer anvil. */
export function migrate(ctx, migrations = MIGRATIONS, current = CURRENT_VERSION) {
  const from = ctx.space.registry.schemaVersion;
  if (!Number.isInteger(from)) throw new AnvilError('projects.json has no valid schemaVersion');
  if (from > current) throw new AnvilError(`the data is version ${from} but this anvil only knows up to ${current}: update anvil`);
  const paths = [];
  for (let version = from; version < current; version++) {
    const step = migrations[version];
    if (!step) throw new AnvilError(`no migration from version ${version} to ${version + 1}`);
    paths.push(...step(ctx));
  }
  return { from, to: current, paths: [...new Set(paths)], message: `migrate: format version ${from} → ${current}` };
}
