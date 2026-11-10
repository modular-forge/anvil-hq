// Made-up data for the unit tests.

import type { GitStatus, ItemDetail, ItemFields, ItemSummary, Project, Space, Step } from './core/models';

/** An item as the list API returns it. Steps progress from `steps`, when given. */
export function summary(id: string, fields: Partial<ItemFields> = {}, steps: Step[] = []): ItemSummary {
  return {
    id,
    project: 'alpha',
    file: `projects/alpha/items/${id}.md`,
    archived: false,
    etag: `"${id}-1"`,
    fields: { id, title: `Item ${id}`, kind: 'task', status: 'todo', since: '2026-11-01', created: '2026-11-01', ...fields },
    progress: {
      total: steps.length,
      done: steps.filter((s) => s.checked && !s.skipped).length,
      skipped: steps.filter((s) => s.skipped).length,
    },
  };
}

export function step(index: number, text: string, checked = false): Step {
  return { index, line: index - 1, checked, skipped: false, text };
}

/** An item as the detail API returns it. */
export function detail(id: string, fields: Partial<ItemFields> = {}, steps: Step[] = [], children: ItemSummary[] = []): ItemDetail {
  return { ...summary(id, fields, steps), body: '', steps, children };
}

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
