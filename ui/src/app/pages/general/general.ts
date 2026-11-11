import { Markdown } from '../../shared/markdown/markdown';
import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../../core/api';
import { bodyBlocks, type Block } from '../../core/item-text';
import type { ItemDetail } from '../../core/models';
import { SpaceStore } from '../../core/space-store';
import { STATUSES } from '../../core/statuses';
import { Composer } from '../../shared/new-item/composer';

export type DecisionState = 'Discussing' | 'In force' | 'Superseded' | 'Cancelled';

/** Where a decision stands: replaced by a newer one, taken (done), dropped, or still open. */
export function decisionState(fields: ItemDetail['fields']): DecisionState {
  if (fields.supersededBy) return 'Superseded';
  if (fields.status === 'done' || fields.status === 'released') return 'In force';
  if (fields.status === 'cancelled') return 'Cancelled';
  return 'Discussing';
}

interface Decision {
  item: ItemDetail;
  state: DecisionState;
  blocks: Block[];
}

/** General: decisions that apply to every project, newest first, and anything else kept here. */
@Component({
  selector: 'anv-general',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Markdown, RouterLink],
  templateUrl: './general.html',
  styleUrl: './general.scss',
})
export class GeneralPage {
  readonly #api = inject(Api);
  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly store = inject(SpaceStore);
  protected readonly composer = inject(Composer);
  protected readonly statuses = STATUSES;

  readonly #items = signal<ItemDetail[]>([]);

  protected readonly decisions = computed<Decision[]>(() => {
    const ids = new Set(this.#items().map((i) => i.id));
    return this.#items()
      .filter((i) => i.fields.kind === 'decision')
      .sort((a, b) => b.fields.created.localeCompare(a.fields.created) || b.id.localeCompare(a.id))
      .map((item) => ({ item, state: decisionState(item.fields), blocks: bodyBlocks(item.body, (id) => ids.has(id)) }));
  });
  protected readonly others = computed(() =>
    this.#items().filter((i) => i.fields.kind !== 'decision' && i.fields.status !== 'cancelled'),
  );

  constructor() {
    effect(() => {
      this.store.space();
      untracked(() => void this.#load());
    });
  }

  protected newDecision(): void {
    this.composer.open({ project: 'general', kind: 'decision', status: 'doing' });
  }

  /** Brings a decision into view and gives it the keyboard focus. */
  protected show(id: string): void {
    const target = this.#host.nativeElement.querySelector<HTMLElement>(`[data-decision="${id}"]`);
    target?.scrollIntoView({ block: 'center' });
    target?.focus();
  }

  async #load(): Promise<void> {
    try {
      const summaries = (await this.#api.items('general')).filter((i) => !i.archived);
      this.#items.set(await Promise.all(summaries.map((s) => this.#api.item(s.id))));
    } catch {
      // The store reports the server as offline.
    }
  }
}
