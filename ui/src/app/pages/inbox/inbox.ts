import { Markdown } from '../../shared/markdown/markdown';
import { Empty } from '../../shared/empty/empty';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Api, WriteError } from '../../core/api';
import { bodyBlocks } from '../../core/item-text';
import { OPEN_STATUSES, type ItemSummary, type NewProject } from '../../core/models';
import { SpaceStore } from '../../core/space-store';
import { Dialogs } from '../../shared/dialogs/dialogs';
import { Notices } from '../../shared/notices/notices';

export type InboxFilter = 'all' | 'problems' | 'ideas';

/** A problem is labelled "problem" or is a bug; anything else waiting here is an idea. */
export function isProblem(item: Pick<ItemSummary, 'fields'>): boolean {
  return item.fields.kind === 'bug' || (item.fields.labels ?? []).includes('problem');
}

/** "today", "1 day", "5 days", "3 weeks", "4 months" since a YYYY-MM-DD date. */
export function age(date: string, now: Date): string {
  const days = Math.max(0, Math.floor((now.getTime() - new Date(`${date}T00:00:00`).getTime()) / 86_400_000));
  if (Number.isNaN(days)) return date;
  if (days === 0) return 'today';
  if (days < 14) return days === 1 ? '1 day' : `${days} days`;
  if (days < 60) return `${Math.floor(days / 7)} weeks`;
  return `${Math.floor(days / 30)} months`;
}

/**
 * The inbox: ideas and problems with no project yet. Each one can move to a project, become a
 * project of its own, or be let go (cancelled, with a reason).
 */
@Component({
  selector: 'anv-inbox',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Markdown, Empty, RouterLink],
  templateUrl: './inbox.html',
  styleUrl: './inbox.scss',
})
export class InboxPage {
  readonly #api = inject(Api);
  readonly #dialogs = inject(Dialogs);
  readonly #notices = inject(Notices);
  readonly #router = inject(Router);
  protected readonly store = inject(SpaceStore);

  readonly #items = signal<ItemSummary[]>([]);
  readonly #bodies = signal<Record<string, string>>({});
  protected readonly filter = signal<InboxFilter>('all');
  protected readonly open = signal<string | null>(null);
  /** The item whose "Move to…" chooser is showing, and the project picked in it. */
  protected readonly moving = signal<string | null>(null);
  protected readonly target = signal('');

  protected readonly waiting = computed(() =>
    this.#items()
      .filter((i) => !i.archived && OPEN_STATUSES.includes(i.fields.status))
      .sort((a, b) => b.fields.created.localeCompare(a.fields.created)),
  );
  protected readonly shown = computed(() => {
    const filter = this.filter();
    return this.waiting().filter((i) => filter === 'all' || (filter === 'problems') === isProblem(i));
  });
  protected readonly tabs = computed(() => [
    { key: 'all' as const, label: 'All', count: this.waiting().length },
    { key: 'problems' as const, label: 'Problems', count: this.waiting().filter(isProblem).length },
    { key: 'ideas' as const, label: 'Ideas', count: this.waiting().filter((i) => !isProblem(i)).length },
  ]);
  /** Where an item can go: every registered project. */
  protected readonly targets = computed(() => this.store.projects().filter((p) => !p.reserved));
  protected readonly readOnly = computed(() => this.store.space()?.readOnly ?? true);
  protected readonly isProblem = isProblem;
  readonly #now = new Date();

  constructor() {
    effect(() => {
      this.store.space();
      untracked(() => void this.#load());
    });
  }

  protected age(item: ItemSummary): string {
    return age(item.fields.created, this.#now);
  }

  protected blocks(id: string) {
    return bodyBlocks(this.#bodies()[id] ?? '', () => false);
  }

  protected async toggle(item: ItemSummary): Promise<void> {
    if (this.open() === item.id) {
      this.open.set(null);
      return;
    }
    this.open.set(item.id);
    this.moving.set(null);
    if (this.#bodies()[item.id] === undefined) {
      try {
        const detail = await this.#api.item(item.id);
        this.#bodies.update((bodies) => ({ ...bodies, [item.id]: detail.body }));
      } catch {
        // The row still shows its title.
      }
    }
  }

  protected startMove(item: ItemSummary): void {
    this.moving.set(item.id);
    this.target.set(this.targets()[0]?.id ?? '');
  }

  protected async move(item: ItemSummary): Promise<void> {
    const target = this.target();
    if (!target) return;
    try {
      const result = await this.#api.move(item, target);
      this.#notices.say(`${item.id} moved to ${this.store.project(target)?.name ?? target} as ${result.id ?? ''}`);
      this.moving.set(null);
      this.open.set(null);
      await this.#load();
    } catch (error) {
      this.#fail(error);
    }
  }

  protected async promote(item: ItemSummary): Promise<void> {
    const answer = await this.#dialogs.open({ kind: 'promote', item: { id: item.id, title: item.fields.title, kind: item.fields.kind } });
    if (!answer) return;
    try {
      const project = JSON.parse(answer.value) as NewProject;
      const result = await this.#api.promote(item, project);
      this.#notices.say(`Created project ${result.id}`);
      await this.store.refresh();
      await this.#router.navigate(['/projects', result.id]);
    } catch (error) {
      this.#fail(error);
    }
  }

  protected async letGo(item: ItemSummary): Promise<void> {
    const answer = await this.#dialogs.open({ kind: 'reason', status: 'cancelled', item: { id: item.id, title: item.fields.title, kind: item.fields.kind } });
    if (!answer) return;
    try {
      await this.#api.setStatus(item, { status: 'cancelled', reason: answer.value });
      this.#notices.say(`${item.id} let go`);
      this.open.set(null);
      await this.#load();
    } catch (error) {
      this.#fail(error);
    }
  }

  async #load(): Promise<void> {
    try {
      this.#items.set(await this.#api.items('inbox'));
    } catch {
      // The store reports the server as offline.
    }
  }

  #fail(error: unknown): void {
    this.#notices.fail(error instanceof WriteError ? error.message : 'Something went wrong; see the browser console.');
    void this.#load();
  }
}
