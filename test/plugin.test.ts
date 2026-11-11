// The Claude Code plugin in plugin/ and its marketplace in .claude-plugin/: the files fit
// together, the hook never fails, and no command lets Claude change data without asking.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { TOOL_ROOT } from '../src/data-dir.ts';
import { hookOutput } from '../plugin/scripts/briefing.ts';

const PLUGIN = join(TOOL_ROOT, 'plugin');

function json(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

/** The frontmatter of a Markdown file as key → raw value (one line each). */
function frontmatter(path: string): Record<string, string> {
  const text = readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  assert.ok(match, `${path} starts with frontmatter`);
  const entries = (match[1] ?? '').split('\n').map((line) => /^([a-z-]+):\s*(.*)$/.exec(line)).filter((m) => m !== null);
  return Object.fromEntries(entries.map((m) => [m[1] ?? '', m[2] ?? '']));
}

const skills = readdirSync(join(PLUGIN, 'skills')).map((name) => ({ name, file: join(PLUGIN, 'skills', name, 'SKILL.md') }));

/** Every Bash command pattern a skill pre-approves, e.g. "anvil item list *". */
function approvedCommands(file: string): string[] {
  const tools = frontmatter(file)['allowed-tools'] ?? '';
  return [...tools.matchAll(/Bash\(([^)]*)\)/g)].map((m) => m[1] ?? '');
}

describe('plugin manifests', () => {
  it('lists the plugin in the marketplace under its own name and folder', () => {
    const marketplace = json(join(TOOL_ROOT, '.claude-plugin', 'marketplace.json'));
    const plugin = json(join(PLUGIN, '.claude-plugin', 'plugin.json'));
    const entries = marketplace['plugins'] as { name: string; source: string }[];
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.name, plugin['name']);
    assert.equal(entries[0]?.source, './plugin');
    assert.equal(plugin['name'], 'anvil');
    assert.match(String(plugin['version']), /^\d+\.\d+\.\d+$/);
  });

  it('starts sessions with a hook whose script exists, run by node', () => {
    const hooks = json(join(PLUGIN, 'hooks', 'hooks.json'))['hooks'] as Record<string, { hooks: { command: string; args: string[] }[] }[]>;
    const start = hooks['SessionStart']?.[0]?.hooks[0];
    assert.equal(start?.command, 'node');
    const script = start?.args[0]?.replace('${CLAUDE_PLUGIN_ROOT}', PLUGIN) ?? '';
    assert.ok(existsSync(script), script);
  });

  it('names each skill after its folder and describes it', () => {
    assert.deepEqual(skills.map((s) => s.name).sort(), ['review', 'status', 'wrap-up']);
    for (const { name, file } of skills) {
      const meta = frontmatter(file);
      assert.equal(meta['name'], name);
      assert.ok((meta['description'] ?? '').length > 40, `${name} has a description`);
    }
  });

  it('keeps the commands that change things for the user to call', () => {
    assert.equal(frontmatter(join(PLUGIN, 'skills', 'wrap-up', 'SKILL.md'))['disable-model-invocation'], 'true');
    assert.equal(frontmatter(join(PLUGIN, 'skills', 'review', 'SKILL.md'))['disable-model-invocation'], 'true');
  });

  it('runs the review as the auditor, which exists', () => {
    const review = frontmatter(join(PLUGIN, 'skills', 'review', 'SKILL.md'));
    assert.equal(review['context'], 'fork');
    assert.equal(review['agent'], 'anvil:auditor');
    assert.equal(frontmatter(join(PLUGIN, 'agents', 'auditor.md'))['name'], 'auditor');
  });
});

describe('what the plugin lets Claude run without asking', () => {
  // Read-only commands: anything else (writes, commits, pushes) must go through the user.
  const READ_ONLY = [
    /^anvil (briefing|validate|audit|item list|item show|search|journal list)( \*)?$/,
    /^git (log|show|status)( \*)?$/,
    /^gh (pr list|pr view|issue view)( \*)?$/,
  ];

  it('pre-approves only commands that read', () => {
    for (const { name, file } of skills) {
      const commands = approvedCommands(file);
      assert.ok(commands.length > 0, `${name} pre-approves its reads`);
      for (const command of commands) {
        assert.ok(READ_ONLY.some((pattern) => pattern.test(command)), `${name} pre-approves "${command}", which is not read-only`);
      }
    }
  });
});

describe('the session start hook', () => {
  it('passes on what anvil briefing printed, and nothing when it failed or had nothing to say', () => {
    assert.equal(hookOutput({ status: 0, stdout: '# anvil: Alpha\n' }), '# anvil: Alpha\n');
    assert.equal(hookOutput({ status: 0, stdout: '  \n' }), '');
    assert.equal(hookOutput({ status: 1, stdout: 'Error: …' }), '');
    assert.equal(hookOutput({ status: null, stdout: '' }), '', 'timed out or not found');
  });

  it('never fails a session, even without the anvil CLI', () => {
    const out = execFileSync(process.execPath, [join(PLUGIN, 'scripts', 'briefing.ts')], {
      encoding: 'utf8',
      env: { ...process.env, PATH: '', Path: '' },
      cwd: TOOL_ROOT,
    });
    assert.equal(out, '');
  });
});
