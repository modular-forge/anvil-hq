import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { ItemSummary } from '../../../core/models';
import { KIND_ICONS } from '../../../core/statuses';
import { cardExtra, segments, type TaskCount } from './card-info';

/**
 * A card on the board. A button: Enter or a click opens the item, Shift ← → moves it to the next
 * column, and it can be dragged to another column.
 */
@Component({
  selector: 'anv-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './card.html',
  styleUrl: './card.scss',
})
export class Card {
  readonly item = input.required<ItemSummary>();
  readonly parentTitle = input<string | null>(null);
  readonly tasks = input<TaskCount | null>(null);
  readonly selected = input(false);
  readonly movable = input(true);

  readonly opened = output();
  /** Shift ← (-1) or Shift → (+1). */
  readonly step = output<-1 | 1>();
  readonly dragStarted = output();
  readonly dragEnded = output();

  protected readonly kindIcon = computed(() => KIND_ICONS[this.item().fields.kind] ?? KIND_ICONS['task']);
  protected readonly extra = computed(() => cardExtra(this.item(), this.tasks()));
  protected readonly segments = computed(() => segments(this.item().progress));
  protected readonly resolved = computed(() => this.item().progress.done + this.item().progress.skipped);

  protected keydown(event: KeyboardEvent): void {
    if (!event.shiftKey || !this.movable()) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      this.step.emit(event.key === 'ArrowLeft' ? -1 : 1);
    }
  }

  protected dragstart(event: DragEvent): void {
    event.dataTransfer?.setData('text/plain', this.item().id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    this.dragStarted.emit();
  }
}
