import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { main } from '../src/cli.js';
import { captureIo, fields, itemText, makeSpace } from './support.js';

const EXAMPLES = fileURLToPath(new URL('../examples', import.meta.url));
const run = async (argv, options = {}) => {
  const io = captureIo();
  const code = await main(argv, { stdout: io.stdout, stderr: io.stderr, env: {}, ...options });
  return { code, ...io.out };
};

describe('anvil CLI', () => {
  it('prints help and the version', async () => {
    assert.match((await run(['--help'])).stdout, /Usage: anvil <command>/);
    const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    assert.equal((await run(['--version'])).stdout, `${version}\n`);
  });

  it('fails with usage when no command is given, and on unknown commands or options', async () => {
    const none = await run([]);
    assert.equal(none.code, 2);
    assert.match(none.stderr, /Usage/);
    assert.equal((await run(['frobnicate'])).code, 2);
    const badOption = await run(['validate', '--nope']);
    assert.equal(badOption.code, 2);
    assert.match(badOption.stderr, /--nope/);
  });

  it('validates the example data space, with options before or after the command', async () => {
    for (const argv of [['validate', '--data', EXAMPLES], ['--data', EXAMPLES, 'validate']]) {
      const { code, stdout } = await run(argv);
      assert.equal(code, 0);
      assert.match(stdout, /^OK: 3 project\(s\), \d+ item\(s\)/);
    }
  });

  it('lists problems and exits with 1 when the data is invalid', async (t) => {
    const dir = makeSpace(t, { 'projects/alpha/items/AL-1.md': itemText(fields('AL-1', { status: 'blocked' })) });
    const { code, stdout } = await run(['validate', '--data', dir]);
    assert.equal(code, 1);
    assert.match(stdout, /projects\/alpha\/items\/AL-1.md: status "blocked" needs a reason/);
    assert.match(stdout, /1 problem\(s\) in 1 file\(s\)/);
  });

  it('prints JSON with --json', async (t) => {
    const dir = makeSpace(t, {});
    const { code, stdout } = await run(['validate', '--data', dir, '--json']);
    assert.equal(code, 0);
    assert.deepEqual(JSON.parse(stdout), { ok: true, errors: [], stats: { projects: 2, items: 0 } });
  });

  it('explains when no data space is found', async (t) => {
    const empty = makeSpace(t, { 'projects.json': undefined, 'readme.txt': 'x' });
    const { code, stderr } = await run(['validate'], { cwd: empty, env: { APPDATA: empty, XDG_CONFIG_HOME: empty } });
    assert.equal(code, 2);
    assert.match(stderr, /no data space found/);
  });

  it('runs as a real process through bin/anvil.js', () => {
    const bin = fileURLToPath(new URL('../bin/anvil.js', import.meta.url));
    const out = execFileSync(process.execPath, [bin, 'validate', '--data', EXAMPLES], { encoding: 'utf8' });
    assert.match(out, /^OK:/);
  });
});
