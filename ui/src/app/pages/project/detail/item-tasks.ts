import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { ItemDetail } from '../../../core/models';
import { CLOSED, STATUSES, isContainer, statusName } from '../../../core/statuses';
import { ProjectBoard } from '../project-board';

/** The tasks of a feature or bug, with their status; the item page can add one. */
@Component({
  selector: 'anv-item-tasks',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  templateUrl: './item-tasks.html',
  styleUrl: './item-tasks.scss',
})
export class ItemTasks {
  /** Heading level of the section title: 3 inside the detail panel, 2 on the item page. */
  readonly headingLevel = input<2 | 3>(3);
  protected readonly board = inject(ProjectBoard);
  readonly item = input.required<ItemDetail>();
  /** Offer "+ Add task" (the item page). */
  readonly adding = input(false);

  protected readonly statuses = STATUSES;
  protected readonly statusName = statusName;
  protected readonly draft = signal('');
  protected readonly open = signal(false);

  protected readonly closedCount = computed(() => this.item().children.filter((c) => CLOSED.includes(c.fields.status)).length);
  protected readonly canAdd = computed(
    () => this.adding() && !this.board.readOnly() && isContainer(this.item().fields.kind) && !CLOSED.includes(this.item().fields.status),
  );

  protected async add(): Promise<void> {
    if (await this.board.addTask(this.item(), this.draft())) this.draft.set('');
  }

  protected cancel(event: Event): void {
    // Escape closes the form only, not the page or panel around it.
    event.stopPropagation();
    this.open.set(false);
  }
}
