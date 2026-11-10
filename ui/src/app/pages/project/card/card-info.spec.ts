import { summary } from '../../../testing';
import { cardExtra, segments, shortEvidence } from './card-info';

describe('cardExtra', () => {
  it('shows what matters in each status', () => {
    expect(cardExtra(summary('AB-1', { status: 'blocked', reason: 'Waiting' }), null)).toEqual({ text: 'Waiting', tone: 'blocked' });
    expect(cardExtra(summary('AB-1', { status: 'cancelled', reason: 'Not needed' }), null)).toEqual({ text: 'Not needed', tone: null });
    expect(cardExtra(summary('AB-1', { status: 'done', evidence: 'https://github.com/o/r/pull/45' }), null)).toEqual({ text: 'Evidence · PR #45', tone: 'done' });
    expect(cardExtra(summary('AB-1', { status: 'released', release: '1.10' }), null)).toEqual({ text: 'v1.10', tone: 'released' });
    expect(cardExtra(summary('AB-1', { kind: 'feature' }), { closed: 1, total: 3 })).toEqual({ text: '1 of 3 tasks closed', tone: null });
    expect(cardExtra(summary('AB-1'), null)).toBeNull();
  });
});

describe('shortEvidence', () => {
  it('shortens pull requests and URLs, and keeps plain text', () => {
    expect(shortEvidence('https://example.com/runs/7')).toBe('example.com/runs/7');
    expect(shortEvidence('https://example.com/')).toBe('example.com');
    expect(shortEvidence('confirmed by user')).toBe('confirmed by user');
  });
});

describe('segments', () => {
  it('orders done, skipped and open steps', () => {
    expect(segments({ total: 4, done: 1, skipped: 1 })).toEqual(['done', 'skipped', 'open', 'open']);
    expect(segments({ total: 0, done: 0, skipped: 0 })).toEqual([]);
  });
});
