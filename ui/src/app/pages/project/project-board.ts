import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { Api, WriteError, type StatusChange } from '../../core/api';
import { itemDiff } from '../../core/item-text';
import type { HistoryEntry, ItemDetail, ItemSummary, Step, WriteResult } from '../../core/models';
import { SpaceStore } from '../../core/space-store';
import { CLOSED, COLUMNS, MOVABLE, adjacentStatus, closeBlockers, isContainer, statusName } from '../../core/statuses';
import { Dialogs, type DialogItem } from '../../shared/dialogs/dialogs';
import { Notices } from '../../shared/notices/notices';

export interface Column {
  status: string;
  items: ItemSummary[];
}

const PRIORITY: Readonly<Record<string, number>> = { high: 0, medium: 1, low: 2 };

/** Cards of a column: high priority first, then by id number. */
export function sortCards(items: readonly ItemSummary[]): ItemSummary[] {
  const rank = (item: ItemSummary) => PRIORITY[item.fields.priority ?? ''] ?? 1;
  const number = (item: ItemSummary) => Number(item.id.split('-')[1]);
  return [...items].sort((a, b) => rank(a) - rank(b) || number(a) - number(b));
}

/** The board's columns for `items`; cancelled ones only with `showCancelled`. Archived left out. */
export function buildColumns(items: readonly ItemSummary[], showCancelled: boolean): Column[] {
  const statuses = showCancelled ? [...COLUMNS, 'cancelled'] : COLUMNS;
  const live = items.filter((item) => !item.archived);
  return statuses.map((status) => ({ status, items: sortCards(live.filter((item) => item.fields.status === status)) }));
}

/**
 * One project's board: its items, the selected item's detail and history, and every change the
 * board makes, with the dialogs each one needs. Provided by the project page.
 */
@Injectable()
export class ProjectBoard {
  readonly #api = inject(Api);
  readonly #store = inject(SpaceStore);
  readonly #dialogs = inject(Dialogs);
  readonly #notices = inject(Notices);

  readonly projectId = signal('');
  readonly selectedId = signal<string | null>(null);
  readonly showCancelled = signal(false);

  readonly #items = signal<ItemSummary[]>([]);
  readonly #loaded = signal(false);
  readonly #detail = signal<ItemDetail | null>(null);
  readonly #history = signal<HistoryEntry[]>([]);
  /** Changes run one after another: each waits for the previous one's dialog, write and reload. */
  #queue: Promise<unknown> = Promise.resolve();

  readonly items = this.#items.asReadonly();
  readonly loaded = this.#loaded.asReadonly();
  readonly detail = this.#detail.asReadonly();
  readonly history = this.#history.asReadonly();
  /** Nothing can change while the data space does not validate. */
  readonly readOnly = computed(() => this.#store.space()?.readOnly ?? true);

  readonly columns = computed(() => buildColumns(this.#items(), this.showCancelled()));
  readonly cancelledCount = computed(() => this.#items().filter((i) => !i.archived && i.fields.status === 'cancelled').length);
  /** Items by id and former id. */
  readonly byId = computed(() => {
    const map = new Map<string, ItemSummary>();
    for (const item of this.#items()) {
      map.set(item.id, item);
      for (const alias of item.fields.aliases ?? []) map.set(alias, item);
    }
    return map;
  });

  /** Called after a move that a dialog sent elsewhere: open that item. */
  onSelect: (id: string | null) => void = (id) => this.selectedId.set(id);

  constructor() {
    // Reload whenever the project changes or anything changes on disk (the space's stamp).
    effect(() => {
      const project = this.projectId();
      this.#store.space();
      if (project) untracked(() => void this.load());
    });
    effect(() => {
      const id = this.selectedId();
      this.#store.space();
      untracked(() => void this.loadDetail(id));
    });
  }

  async load(): Promise<void> {
    const project = this.projectId();
    try {
      const items = await this.#api.items(project);
      if (project === this.projectId()) {
        this.#items.set(items);
        this.#loaded.set(true);
      }
    } catch {
      // The store reports the server as offline; keep what is shown.
    }
  }

  async loadDetail(id: string | null): Promise<void> {
    if (!id) {
      this.#detail.set(null);
      this.#history.set([]);
      return;
    }
    try {
      const [detail, history] = await Promise.all([this.#api.item(id), this.#api.history(id)]);
      if (id === this.selectedId()) {
        this.#detail.set(detail);
        this.#history.set(history);
      }
    } catch {
      if (id === this.selectedId()) this.#detail.set(null);
    }
  }

  /**
   * Moves `item` to `target`, asking first for what the move needs: a reason for blocked and
   * cancelled, evidence (optional) for done. Done is refused here when steps or tasks are still
   * open, with the list. Returns whether the item moved.
   */
  move(item: ItemSummary, target: string): Promise<boolean> {
    return this.#serial(() => this.#move(this.#fresh(item), target));
  }

  /** Moves `item` one column left (-1) or right (+1) from where it is when its turn comes. */
  stepBy(item: ItemSummary, delta: -1 | 1): Promise<boolean> {
    return this.#serial(() => {
      const fresh = this.#fresh(item);
      const target = adjacentStatus(fresh.fields.status, delta);
      return target ? this.#move(fresh, target) : Promise.resolve(false);
    });
  }

  async #move(item: ItemSummary, target: string): Promise<boolean> {
    if (this.readOnly()) return this.#refuse('The data space has problems, so the board is read-only. Run anvil validate.');
    if (item.fields.status === target) return false;
    if (!MOVABLE.includes(target)) return this.#refuse('Items reach Released by publishing a release.');

    const change: StatusChange = { status: target };
    let current: Pick<ItemSummary, 'id' | 'etag'> = item;
    if (target === 'blocked' || target === 'cancelled') {
      const answer = await this.#dialogs.open({ kind: 'reason', status: target, item: dialogItem(item) });
      if (!answer) return false;
      change.reason = answer.value;
    }
    if (target === 'done') {
      const detail = await this.#api.item(item.id);
      current = detail;
      const blockers = closeBlockers(detail, detail.children);
      if (blockers.steps.length || blockers.children.length) {
        const answer = await this.#dialogs.open({ kind: 'refused', item: dialogItem(item), ...blockers });
        if (answer) this.onSelect(answer.value);
        return false;
      }
      const answer = await this.#dialogs.open({ kind: 'done', item: dialogItem(item) });
      if (!answer) return false;
      if (answer.value) change.evidence = answer.value;
    }

    const result = await this.#write(item.id, () => this.#api.setStatus(current, change));
    if (!result) return false;
    this.#notices.say(`${item.id} moved to ${statusName(target)}`);
    if (result.hint && item.fields.parent && CLOSED.includes(target)) await this.#offerParent(item.fields.parent);
    return true;
  }

  toggleStep(detail: ItemDetail, step: Step): Promise<void> {
    return this.#serial(() => {
      const fresh = this.#freshDetail(detail);
      return this.#toggleStep(fresh, fresh.steps.find((s) => s.index === step.index) ?? step);
    });
  }

  async #toggleStep(detail: ItemDetail, step: Step): Promise<void> {
    if (this.readOnly() || (step.skipped && !step.checked)) return;
    const action = step.checked ? 'uncheck' : 'check';
    if (await this.#write(detail.id, () => this.#api.changeStep(detail, step.index, action))) {
      this.#notices.say(`Step ${step.index} ${action === 'check' ? 'checked' : 'unchecked'}`);
    }
  }

  skipStep(detail: ItemDetail, step: Step): Promise<void> {
    return this.#serial(() => this.#skipStep(this.#freshDetail(detail), step));
  }

  async #skipStep(detail: ItemDetail, step: Step): Promise<void> {
    if (this.readOnly()) return;
    const answer = await this.#dialogs.open({ kind: 'skip', step: step.text });
    if (!answer) return;
    if (await this.#write(detail.id, () => this.#api.changeStep(detail, step.index, 'skip', answer.value))) {
      this.#notices.say(`Step ${step.index} skipped`);
    }
  }

  addStep(detail: ItemDetail, text: string): Promise<boolean> {
    if (this.readOnly() || !text.trim()) return Promise.resolve(false);
    return this.#serial(async () => {
      const fresh = this.#freshDetail(detail);
      return !!(await this.#write(fresh.id, () => this.#api.addStep(fresh, text.trim())));
    });
  }

  /** Creates a task straight into a column: the quick add at the foot of Backlog and Todo. */
  quickAdd(status: string, title: string): Promise<boolean> {
    if (this.readOnly() || !title.trim()) return Promise.resolve(false);
    return this.#serial(async () => {
      try {
        const result = await this.#api.createItem({ project: this.projectId(), kind: 'task', title: title.trim(), status });
        this.#notices.say(`Created ${result.id} in ${statusName(status)}`);
        await this.load();
        return true;
      } catch (error) {
        this.#notices.fail(error instanceof WriteError ? error.message : 'The item could not be created.');
        return false;
      }
    });
  }

  /** Moves the item, and its tasks, to another project chosen in a dialog. */
  moveToProject(detail: ItemDetail): Promise<void> {
    return this.#serial(() => this.#moveToProject(this.#freshDetail(detail)));
  }

  async #moveToProject(detail: ItemDetail): Promise<void> {
    if (this.readOnly()) return;
    const projects = this.#store.projects().filter((p) => p.id !== detail.project);
    const tasks = isContainer(detail.fields.kind) ? detail.children.length : 0;
    const answer = await this.#dialogs.open({ kind: 'move', item: dialogItem(detail), tasks, projects });
    if (!answer) return;
    const result = await this.#write(detail.id, () => this.#api.move(detail, answer.value));
    if (!result) return;
    const target = this.#store.project(answer.value)?.name ?? answer.value;
    this.#notices.say(`${detail.id} moved to ${target} as ${result.id ?? ''}`);
    this.onSelect(null);
  }

  async #offerParent(parentId: string): Promise<void> {
    const parent = this.byId().get(parentId);
    if (!parent || CLOSED.includes(parent.fields.status)) return;
    const answer = await this.#dialogs.open({ kind: 'close-parent', parent: dialogItem(parent) });
    if (!answer) return;
    // The click is the confirmation: the server saves the board's evidence.
    if (await this.#write(parent.id, () => this.#api.setStatus(parent, { status: 'done' }))) {
      this.#notices.say(`${parent.id} moved to Done`);
    }
  }

  /** Runs a write, then reloads. A conflict opens the "changed on disk" dialog; other refusals show the server's message. */
  async #write(id: string, run: () => Promise<WriteResult>): Promise<WriteResult | null> {
    try {
      const result = await run();
      // The server's copy carries the new ETag: use it before the reload, so the next change
      // never goes out with the old one.
      const changed = result.item;
      if (changed) {
        this.#items.update((items) => items.map((i) => (i.id === changed.id ? changed : i)));
        if (this.#detail()?.id === changed.id) this.#detail.set(changed);
      }
      await Promise.all([this.load(), this.loadDetail(this.selectedId())]);
      return result;
    } catch (error) {
      if (!(error instanceof WriteError)) throw error;
      if (error.status === 409) {
        const before = this.#detail()?.id === id ? this.#detail() : null;
        const lines = before && error.current ? itemDiff(before, error.current) : [];
        await this.#dialogs.open({ kind: 'conflict', id, lines });
        await Promise.all([this.load(), this.loadDetail(this.selectedId())]);
      } else {
        this.#notices.fail(error.message);
      }
      return null;
    }
  }

  /**
   * Queues `change` after the ones already asked for. A change that waited acts on the item as it
   * is by then (see #fresh), so a quick second click never sends the ETag the first one replaced.
   */
  #serial<T>(change: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(change, change);
    this.#queue = run.catch(() => undefined);
    return run;
  }

  /** The latest copy the board has of `item`. */
  #fresh(item: ItemSummary): ItemSummary {
    const detail = this.#detail();
    if (detail?.id === item.id) return detail;
    return this.#items().find((i) => i.id === item.id) ?? item;
  }

  #freshDetail(detail: ItemDetail): ItemDetail {
    const current = this.#detail();
    return current?.id === detail.id ? current : detail;
  }

  #refuse(message: string): false {
    this.#notices.fail(message);
    return false;
  }
}

function dialogItem(item: Pick<ItemSummary, 'id' | 'fields'>): DialogItem {
  return { id: item.id, title: item.fields.title, kind: item.fields.kind };
}
