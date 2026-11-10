import type { ItemSummary, Progress } from '../../../core/models';

export interface TaskCount {
  closed: number;
  total: number;
}

export interface Extra {
  text: string;
  /** Status whose colour the line takes, or null for the default text colour. */
  tone: string | null;
}

/** The line under a card's title: what matters about the item in its status. */
export function cardExtra(item: Pick<ItemSummary, 'fields'>, tasks: TaskCount | null): Extra | null {
  const { status, reason, evidence, release } = item.fields;
  if (status === 'blocked' && reason) return { text: reason, tone: 'blocked' };
  if (status === 'cancelled' && reason) return { text: reason, tone: null };
  if (status === 'done' && evidence) return { text: `Evidence · ${shortEvidence(evidence)}`, tone: 'done' };
  if (status === 'released' && release) return { text: /^\d/.test(release) ? `v${release}` : release, tone: 'released' };
  if (tasks && tasks.total > 0) return { text: `${tasks.closed} of ${tasks.total} tasks closed`, tone: null };
  return null;
}

/** "PR #45" for a pull request URL, the host and path for other URLs, the text otherwise. */
export function shortEvidence(evidence: string): string {
  const pull = /\/pull\/(\d+)/.exec(evidence);
  if (pull) return `PR #${pull[1]}`;
  try {
    const url = new URL(evidence);
    return `${url.host}${url.pathname === '/' ? '' : url.pathname}`;
  } catch {
    return evidence;
  }
}

/** One segment per step for the progress bar: done, skipped or open. */
export function segments(progress: Progress): ('done' | 'skipped' | 'open')[] {
  return [
    ...Array<'done'>(progress.done).fill('done'),
    ...Array<'skipped'>(progress.skipped).fill('skipped'),
    ...Array<'open'>(Math.max(0, progress.total - progress.done - progress.skipped)).fill('open'),
  ];
}
