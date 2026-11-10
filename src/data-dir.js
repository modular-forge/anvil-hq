// Finding the data space: --data, then ANVIL_DATA, then the user configuration file, then the
// nearest folder upwards from the current one that holds a projects.json registry.

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TOOL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export class DataDirError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DataDirError';
  }
}

export function userConfigPath(env = process.env, platform = process.platform) {
  if (platform === 'win32' && env.APPDATA) return join(env.APPDATA, 'anvil', 'config.json');
  return join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'anvil', 'config.json');
}

/** True when `dir` holds a projects.json that looks like an anvil registry. */
export function isDataSpace(dir) {
  const file = join(dir, 'projects.json');
  if (!existsSync(file)) return false;
  try {
    const registry = JSON.parse(readFileSync(file, 'utf8'));
    return Object.hasOwn(registry, 'schemaVersion') && Array.isArray(registry.projects);
  } catch {
    return false;
  }
}

/**
 * Resolves the data space and returns { dir, source }. Throws DataDirError when none is found,
 * when an explicit location is not a data space, or when it lies inside this tool's repository.
 */
export function resolveDataDir({
  flag,
  env = process.env,
  cwd = process.cwd(),
  configFile = userConfigPath(env),
  toolRoot = TOOL_ROOT,
} = {}) {
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

function explicitLocation(flag, env, configFile, cwd) {
  if (flag) return { dir: resolve(cwd, flag), source: '--data' };
  if (env.ANVIL_DATA) return { dir: resolve(cwd, env.ANVIL_DATA), source: 'ANVIL_DATA' };
  if (!existsSync(configFile)) return null;
  let config;
  try {
    config = JSON.parse(readFileSync(configFile, 'utf8'));
  } catch (error) {
    throw new DataDirError(`cannot read ${configFile}: ${error.message}`);
  }
  if (typeof config.data !== 'string' || !config.data) {
    throw new DataDirError(`${configFile} has no "data" path`);
  }
  return { dir: resolve(dirname(configFile), config.data), source: configFile };
}

function searchUpwards(start) {
  for (let dir = resolve(start); ; dir = dirname(dir)) {
    if (isDataSpace(dir)) return { dir, source: 'current folder' };
    if (dirname(dir) === dir) return null;
  }
}

/**
 * Refuses a data space inside the tool's own repository, where it could be committed to a public
 * repository. The made-up data space in examples/ is the only exception.
 */
export function assertOutsideTool(dir, toolRoot = TOOL_ROOT) {
  const real = existsSync(dir) ? realpathSync(dir) : resolve(dir);
  const root = realpathSync(toolRoot);
  if (!isInside(real, root)) return;
  if (isInside(real, join(root, 'examples'))) return;
  throw new DataDirError(`refusing to use ${dir}: it is inside the anvil-hq repository, which is public. Keep your data in a separate private repository.`);
}

function isInside(child, parent) {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}
