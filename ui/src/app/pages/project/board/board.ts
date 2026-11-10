import { FormsModule } from '@angular/forms';
import { ChangeDetectionStrategy, Component, ElementRef, Injector, afterNextRender, computed, inject, signal } from '@angular/core';
import type { ItemSummary } from '../../../core/models';
import { MOVABLE, STATUSES } from '../../../core/statuses';
import { Card } from '../card/card';
import type { TaskCount } from '../card/card-info';
import { ProjectBoard } from '../project-board';

/** The columns of a project. Cards move by dragging, or with Shift ← → from the keyboard. */
@Component({
  selector: 'anv-board',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Card, FormsModule],
  templateUrl: './board.html',
  styleUrl: './board.scss',
})
export class Board {
  protected readonly board = inject(ProjectBoard);
  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly #injector = inject(Injector);

  protected readonly statuses = STATUSES;
  /** The card being dragged, and the column under it. */
  protected readonly dragging = signal<ItemSummary | null>(null);
  protected readonly over = signal<string | null>(null);
  /** The column whose quick add is open, and what is typed in it. */
  protected readonly adding = signal<string | null>(null);
  protected readonly draft = signal('');

  /** Closed and total tasks of each feature or bug, by id. */
  protected readonly tasks = computed(() => {
    const counts = new Map<string, TaskCount>();
    for (const item of this.board.items()) {
      const parent = item.fields.parent;
      if (!parent || item.archived) continue;
      const count = counts.get(parent) ?? { closed: 0, total: 0 };
      count.total++;
      if (['done', 'released', 'cancelled'].includes(item.fields.status)) count.closed++;
      counts.set(parent, count);
    }
    return counts;
  });

  protected openAdd(status: string): void {
    this.adding.set(status);
    this.draft.set('');
    afterNextRender(() => this.#host.nativeElement.querySelector<HTMLInputElement>(`#add-${status}`)?.focus(), { injector: this.#injector });
  }

  protected async add(status: string): Promise<void> {
    if (await this.board.quickAdd(status, this.draft())) this.draft.set('');
  }

  protected addKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.stopPropagation();
      this.adding.set(null);
    }
  }

  protected parentTitle(item: ItemSummary): string | null {
    return item.fields.parent ? (this.board.byId().get(item.fields.parent)?.fields.title ?? null) : null;
  }

  protected accepts(status: string): boolean {
    const card = this.dragging();
    return !!card && card.fields.status !== status && MOVABLE.includes(status);
  }

  protected dragover(event: DragEvent, status: string): void {
    if (!this.accepts(status)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    this.over.set(status);
  }

  protected dragleave(event: DragEvent, status: string): void {
    const to = event.relatedTarget;
    if (to instanceof Node && (event.currentTarget as HTMLElement).contains(to)) return;
    if (this.over() === status) this.over.set(null);
  }

  protected async drop(event: DragEvent, status: string): Promise<void> {
    event.preventDefault();
    const card = this.dragging();
    this.endDrag();
    if (card) await this.#move(card, status);
  }

  protected endDrag(): void {
    this.dragging.set(null);
    this.over.set(null);
  }

  protected async step(card: ItemSummary, delta: -1 | 1): Promise<void> {
    if (await this.board.stepBy(card, delta)) this.#refocus(card.id);
  }

  async #move(card: ItemSummary, status: string): Promise<void> {
    if (await this.board.move(card, status)) this.#refocus(card.id);
  }

  /** Keeps the keyboard where the card is now. */
  #refocus(id: string): void {
    afterNextRender(() => this.#host.nativeElement.querySelector<HTMLElement>(`[data-id="${id}"]`)?.focus(), { injector: this.#injector });
  }
}
