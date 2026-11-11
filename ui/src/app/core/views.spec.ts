import { decisionState } from '../pages/general/general';
import { nowItems, safeLink } from '../pages/home/home';
import { age, isProblem } from '../pages/inbox/inbox';
import { dayLabel, localDate, parseNote } from '../pages/project/journal/journal-notes';
import { releasable } from '../pages/release/release';
import { suggestProject } from '../shared/dialogs/dialog-host';
import { projectInUrl } from '../shared/new-item/composer';
import { splitLabels, splitSteps } from '../shared/new-item/new-item';
import { matchProjects, projectOfFile } from '../shared/palette/palette';
import { detail, project, summary } from '../testing';
import { compareVersions, lastRelease, suggestVersions } from './versions';

describe('versions', () => {
  it('compares number by number', () => {
    expect(compareVersions('1.10', '1.9')).toBeGreaterThan(0);
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('2.0', '10.0')).toBeLessThan(0);
  });

  it('finds the last release of a project', () => {
    const items = [
      summary('AB-1', { status: 'released', release: '1.9' }),
      summary('AB-2', { status: 'released', release: '1.10' }),
      { ...summary('CD-1', { status: 'released', release: '3.0' }), project: 'other' },
    ];
    expect(lastRelease(items, 'alpha')).toBe('1.10');
    expect(lastRelease([], 'alpha')).toBeNull();
  });

  it('suggests patch, minor and major, or 0.1 to start', () => {
    expect(suggestVersions('1.10').map((s) => s.version)).toEqual(['1.10.1', '1.11', '2.0']);
    expect(suggestVersions(null)).toEqual([{ kind: 'minor', version: '0.1' }]);
    expect(suggestVersions('beta')).toEqual([{ kind: 'minor', version: '0.1' }]);
  });
});

describe('journal notes', () => {
  it('splits a note into timed entries, newest first', () => {
    expect(parseNote('Before\n\n## 09:05\n\nFirst.\nSecond line.\n\n## 17:30\n\nLater.\n')).toEqual([
      { time: '17:30', text: 'Later.' },
      { time: '09:05', text: 'First.\nSecond line.' },
      { time: '', text: 'Before' },
    ]);
    expect(parseNote('')).toEqual([]);
  });

  it('names recent days and keeps older dates', () => {
    const now = new Date(2026, 10, 10, 12);
    expect(dayLabel('2026-11-10', now)).toBe('Today');
    expect(dayLabel('2026-11-09', now)).toBe('Yesterday');
    expect(dayLabel('2026-11-08', now)).toBe('Sunday');
    expect(dayLabel('2026-09-14', now)).toBe('2026-09-14');
    expect(localDate(now)).toBe('2026-11-10');
  });
});

describe('inbox', () => {
  it('tells problems from ideas', () => {
    expect(isProblem(summary('IN-1', { kind: 'idea', labels: ['problem'] }))).toBe(true);
    expect(isProblem(summary('IN-2', { kind: 'bug' }))).toBe(true);
    expect(isProblem(summary('IN-3', { kind: 'idea' }))).toBe(false);
  });

  it('says how long an item has waited', () => {
    const now = new Date(2026, 10, 10, 12);
    expect(age('2026-11-10', now)).toBe('today');
    expect(age('2026-11-09', now)).toBe('1 day');
    expect(age('2026-11-05', now)).toBe('5 days');
    expect(age('2026-10-20', now)).toBe('3 weeks');
    expect(age('2026-06-01', now)).toBe('5 months');
  });
});

describe('general', () => {
  it('derives where a decision stands', () => {
    expect(decisionState(detail('GN-1', { kind: 'decision', status: 'done', supersededBy: 'GN-2' }).fields)).toBe('Superseded');
    expect(decisionState(detail('GN-2', { kind: 'decision', status: 'done' }).fields)).toBe('In force');
    expect(decisionState(detail('GN-3', { kind: 'decision', status: 'doing' }).fields)).toBe('Discussing');
    expect(decisionState(detail('GN-4', { kind: 'decision', status: 'cancelled' }).fields)).toBe('Cancelled');
  });
});

describe('home', () => {
  it('lists doing before blocked, and nothing else', () => {
    const items = [
      summary('AB-3', { status: 'blocked', reason: 'x' }),
      summary('AB-2', { status: 'doing' }),
      summary('AB-1', { status: 'todo' }),
      { ...summary('AB-4', { status: 'doing' }), archived: true },
    ];
    expect(nowItems(items).map((i) => i.id)).toEqual(['AB-2', 'AB-3']);
  });

  it('only links to https', () => {
    expect(safeLink('https://example.com/x')).toBe('https://example.com/x');
    expect(safeLink('javascript:alert(1)')).toBeNull();
    expect(safeLink('http://example.com')).toBeNull();
    expect(safeLink(undefined)).toBeNull();
  });
});

describe('release', () => {
  it('offers done tasks, features and bugs only', () => {
    const items = [
      summary('AB-1', { status: 'done', evidence: 'x' }),
      summary('AB-2', { status: 'done', kind: 'decision' }),
      summary('AB-3', { status: 'doing' }),
      { ...summary('AB-4', { status: 'done', evidence: 'x' }), archived: true },
    ];
    expect(releasable(items).map((i) => i.id)).toEqual(['AB-1']);
  });
});

describe('new item and palette helpers', () => {
  it('splits labels and steps', () => {
    expect(splitLabels(' ui, forms ,, ui')).toEqual(['ui', 'forms']);
    expect(splitSteps('One\n\n  Two  \r\nThree')).toEqual(['One', 'Two', 'Three']);
  });

  it('reads the project of a board URL and of a file', () => {
    expect(projectInUrl('/projects/alpha?item=AB-1')).toBe('alpha');
    expect(projectInUrl('/projects/alpha/release')).toBe('alpha');
    expect(projectInUrl('/inbox')).toBeNull();
    expect(projectOfFile('projects/alpha/items/AB-1.md')).toBe('alpha');
  });

  it('matches projects by name, id or prefix', () => {
    const projects = [project({ id: 'alpha', prefix: 'AL', name: 'Alpha site' }), project({ id: 'beta', prefix: 'BE', name: 'Beta' })];
    expect(matchProjects(projects, 'site').map((p) => p.id)).toEqual(['alpha']);
    expect(matchProjects(projects, 'be').map((p) => p.id)).toEqual(['beta']);
    expect(matchProjects(projects, '')).toHaveLength(2);
  });

  it('suggests a project id and prefix from an idea', () => {
    expect(suggestProject('Track which recipes we cook')).toEqual({ id: 'track-which-recipes', prefix: 'TW' });
    expect(suggestProject('Cookbook!')).toEqual({ id: 'cookbook', prefix: 'CO' });
  });
});
