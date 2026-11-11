import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AUDIT_DAYS, audit, daysSince } from '../src/audit.ts';
import { main } from '../src/cli.ts';
import { openSpace } from '../src/store.ts';
import { validateSpace } from '../src/validate.ts';
import { NOW, REGISTRY, captureIo, item, makeSpace } from './support.ts';

const step = (done: boolean, text: string) => `- [${done ? 'x' : ' '}] ${text}`;

describe('daysSince', () => {
  it('counts whole days to the local date, and gives up on a date it cannot read', () => {
    assert.equal(daysSince('2026-11-10', NOW), 0);
    assert.equal(daysSince('2026-11-01', NOW), 9);
    assert.equal(daysSince('not a date', NOW), null);
  });
});

describe('audit', () => {
  it('finds what has fallen behind, in a valid data space, and nothing in a tidy one', (t) => {
    const dir = makeSpace(t, {
      'projects.json': {
        ...REGISTRY,
        projects: [...REGISTRY.projects, { id: 'gamma', prefix: 'GA', name: 'Gamma', state: 'paused', kind: 'tooling', release: 'none' }],
      },
      // A feature whose tasks are all closed (one cancelled), still open.
      ...item('alpha', 'AL-1', { kind: 'feature', status: 'doing', since: '2026-11-08' }),
      ...item('alpha', 'AL-2', { parent: 'AL-1', status: 'done', evidence: 'x', since: '2026-11-08' }),
      ...item('alpha', 'AL-3', { parent: 'AL-1', status: 'cancelled', reason: 'x' }),
      // Every step resolved, still open; and too long in doing.
      ...item('alpha', 'AL-4', { status: 'doing', since: '2026-10-01' }, [step(true, 'One'), '- [x] ~~Two~~ (skipped: not needed)'].join('\n')),
      // Blocked for long; done for long in a versioned project.
      ...item('alpha', 'AL-5', { status: 'blocked', reason: 'Waiting for the supplier', since: '2026-09-01' }),
      ...item('alpha', 'AL-6', { status: 'done', evidence: 'x', since: '2026-09-01' }),
      // Done for long in an unversioned project: that is simply finished.
      ...item('beta', 'BE-1', { status: 'done', evidence: 'x', since: '2026-09-01' }),
      // An old inbox item, and work in doing inside a paused project.
      ...item('inbox', 'IN-1', { kind: 'idea', status: 'backlog', created: '2026-09-01', since: '2026-09-01' }),
      ...item('gamma', 'GA-1', { status: 'doing', since: '2026-11-09' }),
    });
    assert.deepEqual(validateSpace(dir).errors, [], 'the audit works on data that follows the rules');

    const found = audit(openSpace(dir), NOW).map((f) => `${f.check} ${f.id ?? f.project}`);
    assert.deepEqual(found, [
      'parent-ready AL-1',
      'stale-doing AL-4',
      'steps-resolved AL-4',
      'stale-blocked AL-5',
      'unreleased AL-6',
      // beta is active but its only item is done.
      'active-without-work beta',
      'inactive-project-work GA-1',
      'old-inbox IN-1',
    ]);
    assert.deepEqual(audit(openSpace(dir), NOW, { project: 'gamma' }).map((f) => f.check), ['inactive-project-work']);
  });

  it('leaves alone what is within its time, and features with open tasks', (t) => {
    const recent = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString().slice(0, 10);
    const dir = makeSpace(t, {
      ...item('alpha', 'AL-1', { kind: 'feature', status: 'doing', since: recent(1) }),
      ...item('alpha', 'AL-2', { parent: 'AL-1', status: 'done', evidence: 'x', since: recent(2) }),
      ...item('alpha', 'AL-3', { parent: 'AL-1', status: 'todo' }),
      ...item('alpha', 'AL-4', { status: 'doing', since: recent(AUDIT_DAYS.doing) }),
      ...item('beta', 'BE-1', { status: 'todo' }, [step(true, 'Started'), step(false, 'Finish')].join('\n')),
    });
    assert.deepEqual(audit(openSpace(dir), NOW), []);
  });
});

describe('anvil audit', () => {
  it('prints each finding with the command that resolves it, or JSON', async (t) => {
    const dir = makeSpace(t, {
      ...item('alpha', 'AL-1', { status: 'blocked', reason: 'Waiting', since: '2026-01-02' }),
      ...item('beta', 'BE-1', { status: 'todo' }),
    });
    const run = async (...args: string[]) => {
      const io = captureIo();
      const code = await main([...args, '--data', dir], { stdout: io.stdout, stderr: io.stderr, env: {}, cwd: dir, now: () => NOW });
      return { code, out: io.out.stdout };
    };
    const text = await run('audit');
    assert.equal(text.code, 0, 'findings are advice, not failures');
    assert.match(text.out, /alpha {2}AL-1 {2}AL-1 has been blocked for \d+ days: Waiting/);
    assert.match(text.out, /1 finding\(s\)/);
    const json = JSON.parse((await run('audit', '--json')).out) as { check: string }[];
    assert.deepEqual(json.map((f) => f.check), ['stale-blocked']);
    assert.match((await run('audit', '--project', 'beta')).out, /Nothing to point out/);
  });
});
