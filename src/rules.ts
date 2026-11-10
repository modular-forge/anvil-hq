// Statuses, kinds and the rules that apply when an item changes status.

import type { Item, ItemFields, Project, Status } from './types.ts';

export const OPEN_STATUSES: readonly string[] = ['backlog', 'todo', 'doing', 'blocked'] satisfies Status[];
export const CLOSED_STATUSES: readonly string[] = ['done', 'released', 'cancelled'] satisfies Status[];
export const CONTAINER_KINDS: ReadonlySet<string> = new Set(['feature', 'bug']);
export const RESERVED_AREAS: readonly Project[] = [
  { id: 'inbox', prefix: 'IN', name: 'Inbox', release: 'none' },
  { id: 'general', prefix: 'GN', name: 'General', release: 'none' },
];

const NEEDS_REASON: ReadonlySet<string> = new Set(['blocked', 'cancelled']);
const COMPLETING: ReadonlySet<string> = new Set(['done', 'released']);

/**
 * Problems with an item being in `status`, from its own fields and its project:
 * a reason where one is required, and release rules.
 */
export function statusProblems(fields: Partial<ItemFields>, status: string | undefined, project: Project | undefined): string[] {
  const problems: string[] = [];
  if (status && NEEDS_REASON.has(status) && !fields.reason) problems.push(`status "${status}" needs a reason`);
  if (status === 'released') {
    if (fields.kind === 'decision' || fields.kind === 'idea') problems.push(`a ${fields.kind} cannot be released`);
    if (project && project.release !== 'versioned') problems.push(`project "${project.id}" is not versioned, so nothing is released`);
    if (!fields.release) problems.push('status "released" needs a release version');
  } else if (fields.release) {
    problems.push(`"release" is set but the status is "${status}", not "released"`);
  }
  return problems;
}

/**
 * What prevents an item from moving to `status`: unchecked steps and, for a feature or a bug,
 * child items that are still open. Cancelling is never blocked.
 */
export function closeBlockers(item: Pick<Item, 'steps'>, status: string, children: Pick<Item, 'fields'>[] = []): string[] {
  if (!COMPLETING.has(status)) return [];
  const blockers: string[] = [];
  const open = item.steps.filter((step) => !step.checked);
  if (open.length) {
    blockers.push(`${open.length} unchecked step(s): ${open.map((s) => `#${s.index} ${s.text}`).join('; ')}`);
  }
  const openChildren = children.filter((child) => !CLOSED_STATUSES.includes(child.fields.status));
  if (openChildren.length) {
    blockers.push(`open child item(s): ${openChildren.map((c) => c.fields.id).join(', ')}`);
  }
  return blockers;
}
