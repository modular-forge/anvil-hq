import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { bodyBlocks } from '../../../core/item-text';
import type { ItemDetail, Step } from '../../../core/models';
import { CLOSED, KIND_ICONS, MOVABLE, STATUSES, statusName } from '../../../core/statuses';
import { ago } from '../../../core/time';
import { segments } from '../card/card-info';
import { ProjectBoard } from '../project-board';

/** The selected item beside the board: status, fields, steps, description, tasks and history. */
@Component({
  selector: 'anv-detail-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  templateUrl: './detail-panel.html',
  styleUrl: './detail-panel.scss',
  host: { '(keydown)': 'keydown($event)' },
})
export class DetailPanel {
  protected readonly board = inject(ProjectBoard);
  readonly closed = output();

  protected readonly item = this.board.detail;
  protected readonly newStep = signal('');
  protected readonly statuses = STATUSES;
  protected readonly kindIcons = KIND_ICONS;
  protected readonly statusName = statusName;

  /** Statuses offered in the status menu: the movable ones, plus the current one. */
  protected readonly statusOptions = computed(() => {
    const current = this.item()?.fields.status ?? '';
    return MOVABLE.includes(current) ? MOVABLE : [current, ...MOVABLE];
  });

  protected readonly blocks = computed(() => {
    const item = this.item();
    return item ? bodyBlocks(item.body, (id) => this.board.byId().has(id)) : [];
  });

  protected readonly segments = computed(() => {
    const item = this.item();
    return item ? segments(item.progress) : [];
  });

  protected readonly history = computed(() => {
    const now = new Date();
    return this.board.history().map((entry) => ({ ...entry, when: ago(entry.date, now) }));
  });

  protected readonly closedItem = computed(() => CLOSED.includes(this.item()?.fields.status ?? ''));

  protected async changeStatus(item: ItemDetail, select: HTMLSelectElement): Promise<void> {
    const target = select.value;
    // The menu shows the stored status until the server says otherwise.
    select.value = item.fields.status;
    await this.board.move(item, target);
  }

  protected toggle(item: ItemDetail, step: Step): void {
    void this.board.toggleStep(item, step);
  }

  protected async addStep(item: ItemDetail): Promise<void> {
    if (await this.board.addStep(item, this.newStep())) this.newStep.set('');
  }

  protected keydown(event: KeyboardEvent): void {
    const item = this.item();
    if (!item || !event.shiftKey || this.board.readOnly()) return;
    if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement)) {
      event.preventDefault();
      void this.board.stepBy(item, event.key === 'ArrowLeft' ? -1 : 1);
    }
  }
}
