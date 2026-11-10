import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { DataDirError, TOOL_ROOT, assertOutsideTool, resolveDataDir, userConfigPath } from '../src/data-dir.ts';
import { makeSpace, shortPath } from './support.ts';

const NO_CONFIG = join(TOOL_ROOT, 'test', 'no-such-config.json');

describe('resolveDataDir', () => {
  it('prefers --data over ANVIL_DATA', (t) => {
    const a = makeSpace(t, {});
    const b = makeSpace(t, {});
    const found = resolveDataDir({ flag: a, env: { ANVIL_DATA: b }, configFile: NO_CONFIG });
    assert.deepEqual(found, { dir: a, source: '--data' });
  });

  it('uses ANVIL_DATA, then the user config file', (t) => {
    const a = makeSpace(t, {});
    assert.equal(resolveDataDir({ env: { ANVIL_DATA: a }, configFile: NO_CONFIG }).source, 'ANVIL_DATA');

    const configDir = makeSpace(t, { 'anvil/config.json': { data: a } });
    const configFile = join(configDir, 'anvil', 'config.json');
    assert.deepEqual(resolveDataDir({ env: {}, configFile }), { dir: a, source: configFile });
  });

  it('searches upwards from the current folder', (t) => {
    const space = makeSpace(t, {});
    const deep = join(space, 'projects', 'alpha', 'items');
    mkdirSync(deep, { recursive: true });
    assert.deepEqual(resolveDataDir({ env: {}, cwd: deep, configFile: NO_CONFIG }), { dir: space, source: 'current folder' });
  });

  it('rejects an explicit location that is not a data space', (t) => {
    const notSpace = makeSpace(t, { 'projects.json': { name: 'something else' } });
    assert.throws(() => resolveDataDir({ flag: notSpace, env: {}, configFile: NO_CONFIG }), /not a data space/);
  });

  it('rejects a config file without a data path', (t) => {
    const configDir = makeSpace(t, { 'config.json': { theme: 'dark' } });
    assert.throws(() => resolveDataDir({ env: {}, configFile: join(configDir, 'config.json') }), /no "data" path/);
  });

  it('refuses a data space inside the tool repository, except examples/', (t) => {
    const toolRoot = makeSpace(t, { 'package.json': {} });
    const inside = join(toolRoot, 'my-data');
    mkdirSync(inside);
    writeFileSync(join(inside, 'projects.json'), JSON.stringify({ schemaVersion: 1, projects: [] }));
    assert.throws(() => resolveDataDir({ flag: inside, env: {}, configFile: NO_CONFIG, toolRoot }), DataDirError);
    assert.throws(() => assertOutsideTool(toolRoot, toolRoot), /public/);

    const examples = join(toolRoot, 'examples');
    mkdirSync(examples);
    writeFileSync(join(examples, 'projects.json'), JSON.stringify({ schemaVersion: 1, projects: [] }));
    assert.equal(resolveDataDir({ flag: examples, env: {}, configFile: NO_CONFIG, toolRoot }).dir, examples);
  });

  it('refuses it even when one path is a Windows 8.3 short path and the other is not', (t) => {
    const toolRoot = makeSpace(t, { 'package.json': {} });
    const inside = join(toolRoot, 'my-data');
    mkdirSync(inside);
    const short = shortPath(toolRoot);
    if (!short) return t.skip('no 8.3 short names here');
    assert.throws(() => assertOutsideTool(inside, short), /public/);
    assert.throws(() => assertOutsideTool(join(short, 'my-data'), toolRoot), /public/);
  });
});

describe('userConfigPath', () => {
  it('uses APPDATA on Windows and XDG_CONFIG_HOME elsewhere', () => {
    assert.equal(userConfigPath({ APPDATA: 'C:\\Users\\u\\AppData\\Roaming' }, 'win32'), join('C:\\Users\\u\\AppData\\Roaming', 'anvil', 'config.json'));
    assert.equal(userConfigPath({ XDG_CONFIG_HOME: '/cfg' }, 'linux'), join('/cfg', 'anvil', 'config.json'));
  });
});
