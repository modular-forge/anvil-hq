import { Skeleton } from '../../../shared/skeleton/skeleton';
import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { ItemDetail } from '../../../core/models';
import { KIND_ICONS, MOVABLE, STATUSES, statusName } from '../../../core/statuses';
import { ProjectBoard } from '../project-board';
import { ItemBody } from './item-body';
import { ItemHistory } from './item-history';
import { ItemSteps } from './item-steps';
import { ItemTasks } from './item-tasks';

/** The selected item beside the board: status, fields, steps, description, tasks and history. */
@Component({
  selector: 'anv-detail-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, RouterLink, ItemSteps, ItemBody, ItemTasks, ItemHistory],
  templateUrl: './detail-panel.html',
  styleUrl: './detail-panel.scss',
  host: { '(keydown)': 'keydown($event)' },
})
export class DetailPanel {
  protected readonly board = inject(ProjectBoard);
  readonly closed = output();

  protected readonly item = this.board.detail;
  protected readonly statuses = STATUSES;
  protected readonly kindIcons = KIND_ICONS;
  protected readonly statusName = statusName;

  /** Statuses offered in the status menu: the movable ones, plus the current one. */
  protected readonly statusOptions = computed(() => {
    const current = this.item()?.fields.status ?? '';
    return MOVABLE.includes(current) ? MOVABLE : [current, ...MOVABLE];
  });

  protected async changeStatus(item: ItemDetail, select: HTMLSelectElement): Promise<void> {
    const target = select.value;
    // The menu shows the stored status until the server says otherwise.
    select.value = item.fields.status;
    await this.board.move(item, target);
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
