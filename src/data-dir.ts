// Finding the data space: --data, then ANVIL_DATA, then the user configuration file, then the
// nearest folder upwards from the current one that holds a projects.json registry.

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TOOL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export type Env = Record<string, string | undefined>;

export class DataDirError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataDirError';
  }
}

export interface DataLocation {
  dir: string;
  /** Where the location came from: --data, ANVIL_DATA, a config file path or "current folder". */
  source: string;
}

export function userConfigPath(env: Env = process.env, platform: string = process.platform): string {
  if (platform === 'win32' && env.APPDATA) return join(env.APPDATA, 'anvil', 'config.json');
  return join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'anvil', 'config.json');
}

/** True when `dir` holds a projects.json that looks like an anvil registry. */
export function isDataSpace(dir: string): boolean {
  const file = join(dir, 'projects.json');
  if (!existsSync(file)) return false;
  try {
    const registry: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return typeof registry === 'object' && registry !== null
      && Object.hasOwn(registry, 'schemaVersion') && Array.isArray((registry as { projects?: unknown }).projects);
  } catch {
    return false;
  }
}

export interface ResolveOptions {
  flag?: string | undefined;
  env?: Env;
  cwd?: string;
  configFile?: string;
  toolRoot?: string;
}

/**
 * Resolves the data space. Throws DataDirError when none is found, when an explicit location is
 * not a data space, or when it lies inside this tool's repository.
 */
export function resolveDataDir({
  flag,
  env = process.env,
  cwd = process.cwd(),
  configFile = userConfigPath(env),
  toolRoot = TOOL_ROOT,
}: ResolveOptions = {}): DataLocation {
  const found = explicitLocation(flag, env, configFile, cwd) ?? searchUpwards(cwd);
  if (!found) {
    throw new DataDirError('no data space found: pass --data <path>, set ANVIL_DATA, or run `anvil init`');
  }
  if (!isDataSpace(found.dir)) {
    throw new DataDirError(`${found.dir} (from ${found.source}) is not a data space: it has no valid projects.json`);
  }
  assertOutsideTool(found.dir, toolRoot);
  return found;
}

function explicitLocation(flag: string | undefined, env: Env, configFile: string, cwd: string): DataLocation | null {
  if (flag) return { dir: resolve(cwd, flag), source: '--data' };
  if (env.ANVIL_DATA) return { dir: resolve(cwd, env.ANVIL_DATA), source: 'ANVIL_DATA' };
  if (!existsSync(configFile)) return null;
  let config: { data?: unknown };
  try {
    config = JSON.parse(readFileSync(configFile, 'utf8'));
  } catch (error) {
    throw new DataDirError(`cannot read ${configFile}: ${(error as Error).message}`);
  }
  if (typeof config.data !== 'string' || !config.data) {
    throw new DataDirError(`${configFile} has no "data" path`);
  }
  return { dir: resolve(dirname(configFile), config.data), source: configFile };
}

function searchUpwards(start: string): DataLocation | null {
  for (let dir = resolve(start); ; dir = dirname(dir)) {
    if (isDataSpace(dir)) return { dir, source: 'current folder' };
    if (dirname(dir) === dir) return null;
  }
}

/**
 * Refuses a data space inside the tool's own repository, where it could be committed to a public
 * repository. The made-up data space in examples/ is the only exception.
 */
export function assertOutsideTool(dir: string, toolRoot: string = TOOL_ROOT): void {
  // The native realpath also expands Windows 8.3 short names (C:\Users\RUNNER~1), so both sides
  // are compared in the same long form.
  const real = existsSync(dir) ? realpathSync.native(dir) : resolve(dir);
  const root = realpathSync.native(toolRoot);
  if (!isInside(real, root)) return;
  if (isInside(real, join(root, 'examples'))) return;
  throw new DataDirError(`refusing to use ${dir}: it is inside the anvil-hq repository, which is public. Keep your data in a separate private repository.`);
}

function isInside(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}
