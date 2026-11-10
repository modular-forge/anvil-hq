// Statuses and kinds as the board shows them, with the design's icons (24×24 stroke paths), and
// the rules the board checks before asking the server (the server checks them again).

import type { ItemDetail, ItemSummary } from './models';

const CIRCLE = 'M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16';

export interface StatusInfo {
  key: string;
  name: string;
  icon: string;
  /** Dashed outline for backlog. */
  dash: string;
}

export const STATUSES: Readonly<Record<string, StatusInfo>> = {
  backlog: { key: 'backlog', name: 'Backlog', icon: CIRCLE, dash: '2.5 3' },
  todo: { key: 'todo', name: 'Todo', icon: CIRCLE, dash: '' },
  doing: { key: 'doing', name: 'Doing', icon: `${CIRCLE}M12 8a4 4 0 0 1 0 8`, dash: '' },
  blocked: { key: 'blocked', name: 'Blocked', icon: `${CIRCLE}M6.5 6.5l11 11`, dash: '' },
  done: { key: 'done', name: 'Done', icon: `${CIRCLE}M8.5 12.5l2.5 2.5 4.5-5`, dash: '' },
  released: { key: 'released', name: 'Released', icon: 'M4 15l3-7h10l3 7zM4 15h16v3H4z', dash: '' },
  cancelled: { key: 'cancelled', name: 'Cancelled', icon: `${CIRCLE}M9 9l6 6M15 9l-6 6`, dash: '' },
};

export const KIND_ICONS: Readonly<Record<string, string>> = {
  task: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M8 12.5l2.8 2.8L16.5 9.5',
  feature: 'M12 3l8 5-8 5-8-5 8-5zM4 13l8 5 8-5',
  bug: 'M9 9a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0zM9 12H5M19 12h-4M9 16l-3 2M15 16l3 2M9 8L6 6M15 8l3-2',
  decision: 'M12 4v16M7 20h10M5 8h14M5 8l-3 6h6zM19 8l-3 6h6z',
  idea: 'M12 3c1 3 4 5 4 9a4 4 0 0 1-8 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 0-8z',
};

/** Board columns, left to right. Cancelled only when shown. */
export const COLUMNS: readonly string[] = ['backlog', 'todo', 'doing', 'blocked', 'done', 'released'];

/** Statuses a card can be moved to on the board: released only comes from publishing a release. */
export const MOVABLE: readonly string[] = ['backlog', 'todo', 'doing', 'blocked', 'done', 'cancelled'];

/** Order for Shift ← →: the working columns. */
const STEPPING: readonly string[] = ['backlog', 'todo', 'doing', 'blocked', 'done'];

export const CLOSED: readonly string[] = ['done', 'released', 'cancelled'];
const CONTAINERS: ReadonlySet<string> = new Set(['feature', 'bug']);

export function statusName(status: string): string {
  return STATUSES[status]?.name ?? status;
}

/** The column next to `status` in direction `delta` (-1 left, +1 right), or null at the edges. */
export function adjacentStatus(status: string, delta: -1 | 1): string | null {
  const index = STEPPING.indexOf(status);
  if (index === -1) return null;
  return STEPPING[index + delta] ?? null;
}

/** Why `item` cannot be closed as done yet: unchecked steps and open child tasks. */
export interface CloseBlockers {
  steps: string[];
  children: ItemSummary[];
}

export function closeBlockers(item: Pick<ItemDetail, 'steps'>, children: readonly ItemSummary[]): CloseBlockers {
  return {
    steps: item.steps.filter((step) => !step.checked).map((step) => step.text),
    children: children.filter((child) => !CLOSED.includes(child.fields.status)),
  };
}

export function isContainer(kind: string): boolean {
  return CONTAINERS.has(kind);
}
