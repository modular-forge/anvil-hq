// Made-up data for the unit tests.

import type { GitStatus, Project, Space } from './core/models';

export function project(overrides: Partial<Project> & Pick<Project, 'id'>): Project {
  return { prefix: 'AL', name: overrides.id, release: 'none', state: 'active', reserved: false, counts: {}, ...overrides };
}

export function space(overrides: Partial<Space> = {}): Space {
  return {
    dir: '/data/demo',
    schemaVersion: 1,
    projects: [
      project({ id: 'inbox', prefix: 'IN', name: 'Inbox', reserved: true, counts: { backlog: 2, done: 1 } }),
      project({ id: 'general', prefix: 'GN', name: 'General', reserved: true }),
      project({ id: 'alpha', prefix: 'AL', name: 'Alpha', counts: { doing: 1, todo: 2 } }),
      project({ id: 'beta', prefix: 'BE', name: 'Beta', state: 'paused' }),
      project({ id: 'gamma', prefix: 'GA', name: 'Gamma', state: 'done' }),
    ],
    readOnly: false,
    problems: [],
    problemCount: 0,
    watching: true,
    stamp: 'one',
    ...overrides,
  };
}

export function git(overrides: Partial<GitStatus> = {}): GitStatus {
  return { repository: true, upstream: true, unpushed: 0, oldestUnpushed: null, uncommitted: [], stale: false, ...overrides };
}
