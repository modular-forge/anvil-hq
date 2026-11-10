// `anvil init`: creates a data space, makes it a git repository and records it in the user
// configuration of this machine.

import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { TOOL_ROOT, assertOutsideTool, userConfigPath } from './data-dir.js';
import { AnvilError } from './errors.js';
import { writeAtomic } from './fsutil.js';
import { commitPaths, initRepository, isRepository, setConfig } from './git.js';
import { formatJson } from './registry.js';

/**
 * Creates the data space at `target`. Never overwrites: refuses if a projects.json is already
 * there. Returns { dir, files, demo, config, commit }.
 */
export function initSpace(target, { demo = false, setDefault = false, gitEmail, gitName, env = process.env, toolRoot = TOOL_ROOT } = {}) {
  const dir = resolve(target);
  assertOutsideTool(nearestExisting(dir), toolRoot);
  if (existsSync(join(dir, 'projects.json'))) throw new AnvilError(`${dir} already has a projects.json; nothing was changed`);
  mkdirSync(dir, { recursive: true });

  const schema = relative(dir, join(toolRoot, 'schema', 'projects.schema.json')).replaceAll('\\', '/');
  const registry = { $schema: schema, schemaVersion: 1, archiveAfterDays: 60, projects: [] };
  const files = ['projects.json'];
  if (demo) {
    const examples = join(toolRoot, 'examples');
    registry.projects = JSON.parse(readFileSync(join(examples, 'projects.json'), 'utf8')).projects;
    cpSync(join(examples, 'projects'), join(dir, 'projects'), { recursive: true, errorOnExist: true, force: false });
    files.push('projects');
  }
  writeAtomic(join(dir, 'projects.json'), `${formatJson(registry)}\n`);
  if (!existsSync(join(dir, '.gitattributes'))) {
    writeFileSync(join(dir, '.gitattributes'), '* text=auto eol=lf\n');
    files.unshift('.gitattributes');
  }

  if (!isRepository(dir)) initRepository(dir);
  if (gitEmail) setConfig(dir, 'user.email', gitEmail);
  if (gitName) setConfig(dir, 'user.name', gitName);
  let commit;
  try {
    commit = commitPaths(dir, files, 'chore: create anvil data space');
  } catch (error) {
    commit = { committed: false, reason: error.message };
  }

  return { dir, files, demo, config: recordDefault(dir, env, setDefault), commit };
}

/** Writes the user configuration when there is none, or when asked to replace it. */
function recordDefault(dir, env, setDefault) {
  const file = userConfigPath(env);
  let current = null;
  if (existsSync(file)) {
    try {
      current = JSON.parse(readFileSync(file, 'utf8')).data ?? null;
    } catch {
      current = null;
    }
  }
  if (current && !setDefault) return { file, written: false, data: current };
  mkdirSync(dirname(file), { recursive: true });
  writeAtomic(file, `${JSON.stringify({ data: dir }, null, 2)}\n`);
  return { file, written: true, data: dir };
}

/** The real path of `dir`, resolving the deepest part of it that exists. */
function nearestExisting(dir) {
  let existing = dir;
  const rest = [];
  while (!existsSync(existing)) {
    rest.unshift(basename(existing));
    existing = dirname(existing);
  }
  return join(realpathSync(existing), ...rest);
}
