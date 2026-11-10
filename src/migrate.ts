// `anvil migrate`: upgrades a data space to the current format version, one version at a time.

import { AnvilError } from './errors.ts';
import type { Change, Context } from './types.ts';

export const CURRENT_VERSION = 1;

/**
 * A migration upgrades a data space from version n to n + 1: it changes files and returns the
 * relative paths it touched. It must also set the new schemaVersion in projects.json.
 */
export type Migration = (ctx: Context) => string[];

/** MIGRATIONS[n] upgrades from version n. There are none yet: version 1 is the first. */
export const MIGRATIONS: Record<number, Migration> = {};

/** Refuses data written by a newer anvil. */
export function migrate(ctx: Context, migrations: Record<number, Migration> = MIGRATIONS, current: number = CURRENT_VERSION): Change & { from: number; to: number } {
  const from = ctx.space.registry.schemaVersion;
  if (!Number.isInteger(from)) throw new AnvilError('projects.json has no valid schemaVersion');
  if (from > current) throw new AnvilError(`the data is version ${from} but this anvil only knows up to ${current}: update anvil`);
  const paths: string[] = [];
  for (let version = from; version < current; version++) {
    const step = migrations[version];
    if (!step) throw new AnvilError(`no migration from version ${version} to ${version + 1}`);
    paths.push(...step(ctx));
  }
  return { from, to: current, paths: [...new Set(paths)], message: `migrate: format version ${from} → ${current}` };
}
