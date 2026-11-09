import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseSteps } from '../src/item.js';
import { closeBlockers, statusProblems } from '../src/rules.js';

const versioned = { id: 'alpha', release: 'versioned' };
const unversioned = { id: 'beta', release: 'none' };

describe('statusProblems', () => {
  it('requires a reason for blocked and cancelled', () => {
    assert.deepEqual(statusProblems({ kind: 'task' }, 'blocked', versioned), ['status "blocked" needs a reason']);
    assert.deepEqual(statusProblems({ kind: 'task', reason: 'x' }, 'cancelled', versioned), []);
  });

  it('allows released only with a version, in versioned projects, and not for decisions or ideas', () => {
    assert.deepEqual(statusProblems({ kind: 'task', release: '1.0' }, 'released', versioned), []);
    assert.match(statusProblems({ kind: 'task' }, 'released', versioned).join(), /needs a release version/);
    assert.match(statusProblems({ kind: 'task', release: '1.0' }, 'released', unversioned).join(), /not versioned/);
    assert.match(statusProblems({ kind: 'idea', release: '1.0' }, 'released', versioned).join(), /idea cannot be released/);
  });

  it('rejects a release version on an item that is not released', () => {
    assert.match(statusProblems({ kind: 'task', release: '1.0' }, 'done', versioned).join(), /"release" is set/);
  });
});

describe('closeBlockers', () => {
  const item = (body, status = 'doing') => ({ fields: { status }, steps: parseSteps(body) });

  it('blocks done and released while steps are unchecked, and says which', () => {
    const open = item('- [x] One\n- [ ] Two\n');
    assert.deepEqual(closeBlockers(open, 'done'), ['1 unchecked step(s): #2 Two']);
    assert.equal(closeBlockers(open, 'released').length, 1);
  });

  it('counts skipped steps as resolved', () => {
    assert.deepEqual(closeBlockers(item('- [x] ~~Two~~ (skipped: not needed)\n'), 'done'), []);
  });

  it('blocks a parent with open children', () => {
    const child = (id, status) => ({ fields: { id, status } });
    const blockers = closeBlockers(item(''), 'done', [child('AL-2', 'done'), child('AL-3', 'blocked'), child('AL-4', 'cancelled')]);
    assert.deepEqual(blockers, ['open child item(s): AL-3']);
  });

  it('never blocks cancelling or other moves', () => {
    const open = item('- [ ] Two\n');
    assert.deepEqual(closeBlockers(open, 'cancelled', [{ fields: { id: 'AL-2', status: 'todo' } }]), []);
    assert.deepEqual(closeBlockers(open, 'blocked'), []);
  });
});
