import { detail, step, summary } from '../testing';
import { adjacentStatus, closeBlockers, statusName } from './statuses';
import { ago } from './time';

describe('adjacentStatus', () => {
  it('steps through the working columns and stops at the edges', () => {
    expect(adjacentStatus('todo', 1)).toBe('doing');
    expect(adjacentStatus('todo', -1)).toBe('backlog');
    expect(adjacentStatus('blocked', 1)).toBe('done');
    expect(adjacentStatus('backlog', -1)).toBeNull();
    expect(adjacentStatus('done', 1)).toBeNull();
    expect(adjacentStatus('released', -1)).toBeNull();
  });
});

describe('closeBlockers', () => {
  it('lists unchecked steps and open tasks', () => {
    const item = detail('AB-1', { kind: 'feature' }, [step(1, 'One', true), step(2, 'Two')]);
    const children = [summary('AB-2', { status: 'done' }), summary('AB-3', { status: 'doing' })];
    const blockers = closeBlockers(item, children);
    expect(blockers.steps).toEqual(['Two']);
    expect(blockers.children.map((c) => c.id)).toEqual(['AB-3']);
  });
});

describe('statusName', () => {
  it('names known statuses and passes others through', () => {
    expect(statusName('doing')).toBe('Doing');
    expect(statusName('odd')).toBe('odd');
  });
});

describe('ago', () => {
  const now = new Date('2026-11-10T12:00:00Z');
  it('says how long ago, briefly', () => {
    expect(ago('2026-11-10T11:59:30Z', now)).toBe('now');
    expect(ago('2026-11-10T11:55:00Z', now)).toBe('5 min');
    expect(ago('2026-11-10T09:00:00Z', now)).toBe('3 h');
    expect(ago('2026-11-08T12:00:00Z', now)).toBe('2 d');
    expect(ago('2026-09-01T12:00:00Z', now)).toBe('2026-09-01');
    expect(ago('not a date', now)).toBe('not a date');
  });
});
