// `anvil audit`: inconsistencies that are not format errors. `anvil validate` refuses data that
// breaks the rules; the audit points at data that follows them but has probably fallen behind
// reality, such as a feature still open after its last task closed. Read-only, and every finding
// says what to run. The Claude Code auditor (plugin/agents/auditor.md) starts from it.

import { CLOSED_STATUSES, CONTAINER_KINDS, OPEN_STATUSES } from './rules.ts';
import type { Context, ItemEntry } from './types.ts';
import { childrenOf } from './validate.ts';

/** How long something may sit before the audit mentions it, in days. */
export const AUDIT_DAYS = {
  doing: 14,
  blocked: 30,
  unreleased: 30,
  inbox: 30,
} as const;

export type AuditCheck =
  | 'parent-ready'
  | 'steps-resolved'
  | 'stale-doing'
  | 'stale-blocked'
  | 'unreleased'
  | 'old-inbox'
  | 'inactive-project-work'
  | 'active-without-work';

export interface AuditFinding {
  check: AuditCheck;
  project: string;
  /** The item the finding is about; none for project-wide findings. */
  id?: string;
  message: string;
  /** The command that resolves it, or where to look. */
  hint: string;
}

const DAY_MS = 86_400_000;
const INACTIVE_STATES: ReadonlySet<string> = new Set(['paused', 'done', 'cancelled']);

/** Whole days from the `YYYY-MM-DD` date `iso` to today's local date; null when it cannot be read. */
export function daysSince(iso: string, now: Date): number | null {
  const time = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(time)) return null;
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.floor((today - time) / DAY_MS);
}

/** Every finding in the data space, or in one project, in a stable order. */
export function audit(ctx: Context, now: Date, { project }: { project?: string } = {}): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const live = ctx.space.items.filter((entry) => !entry.archived && (!project || entry.project === project));
  const add = (finding: AuditFinding) => findings.push(finding);
  const isOpen = (entry: ItemEntry) => OPEN_STATUSES.includes(entry.item.fields.status);

  for (const entry of live) {
    const { fields, steps } = entry.item;
    const age = daysSince(fields.since, now);

    if (isOpen(entry) && CONTAINER_KINDS.has(fields.kind)) {
      const tasks = childrenOf(entry, ctx.space.items, ctx.byId).filter((child) => !child.archived);
      const working = tasks.filter((task) => task.item.fields.status !== 'cancelled');
      if (working.length && working.every((task) => CLOSED_STATUSES.includes(task.item.fields.status))) {
        add({
          check: 'parent-ready',
          project: entry.project,
          id: fields.id,
          message: `every task of ${fields.id} is closed, but the ${fields.kind} is still ${fields.status}`,
          hint: `anvil item status ${fields.id} done --evidence "…"`,
        });
      }
    }

    if (isOpen(entry) && steps.length && steps.every((step) => step.checked || step.skipped)) {
      add({
        check: 'steps-resolved',
        project: entry.project,
        id: fields.id,
        message: `all ${steps.length} step(s) of ${fields.id} are resolved, but it is still ${fields.status}`,
        hint: `anvil item status ${fields.id} done --evidence "…", or add the step that is missing`,
      });
    }

    if (fields.status === 'doing' && age !== null && age > AUDIT_DAYS.doing) {
      add({
        check: 'stale-doing',
        project: entry.project,
        id: fields.id,
        message: `${fields.id} has been in doing for ${age} days`,
        hint: `still being worked on? If not: anvil item status ${fields.id} todo (or blocked --reason "…")`,
      });
    }

    if (fields.status === 'blocked' && age !== null && age > AUDIT_DAYS.blocked) {
      add({
        check: 'stale-blocked',
        project: entry.project,
        id: fields.id,
        message: `${fields.id} has been blocked for ${age} days: ${fields.reason ?? 'no reason given'}`,
        hint: `is "${fields.reason ?? ''}" still true? Unblock it, or cancel it with a reason`,
      });
    }

    const home = ctx.projects.get(entry.project);
    if (fields.status === 'done' && home?.release === 'versioned' && age !== null && age > AUDIT_DAYS.unreleased) {
      add({
        check: 'unreleased',
        project: entry.project,
        id: fields.id,
        message: `${fields.id} has been done for ${age} days and is in no release`,
        hint: `anvil project release ${entry.project} <version> --dry-run`,
      });
    }

    const created = daysSince(fields.created, now);
    if (entry.project === 'inbox' && isOpen(entry) && created !== null && created > AUDIT_DAYS.inbox) {
      add({
        check: 'old-inbox',
        project: entry.project,
        id: fields.id,
        message: `${fields.id} has waited in the inbox for ${created} days`,
        hint: `anvil item move ${fields.id} <project>, or anvil item status ${fields.id} cancelled --reason "…"`,
      });
    }

    if (fields.status === 'doing' && home?.state && INACTIVE_STATES.has(home.state)) {
      add({
        check: 'inactive-project-work',
        project: entry.project,
        id: fields.id,
        message: `${fields.id} is in doing, but its project ${entry.project} is ${home.state}`,
        hint: `anvil item status ${fields.id} todo, or anvil project set ${entry.project} --state active`,
      });
    }
  }

  for (const target of ctx.projects.values()) {
    if (project && target.id !== project) continue;
    if (target.state !== 'active') continue;
    const open = ctx.space.items.some((entry) => entry.project === target.id && !entry.archived && isOpen(entry));
    if (!open) {
      add({
        check: 'active-without-work',
        project: target.id,
        message: `${target.id} is active but has no open items`,
        hint: `add what comes next (anvil item create ${target.id} …), or anvil project set ${target.id} --state paused`,
      });
    }
  }

  return findings.sort((a, b) => a.project.localeCompare(b.project) || (a.id ?? '').localeCompare(b.id ?? '', 'en', { numeric: true }) || a.check.localeCompare(b.check));
}
