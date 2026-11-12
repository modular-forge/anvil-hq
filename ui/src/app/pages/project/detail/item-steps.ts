import { ChangeDetectionStrategy, Component, computed, input, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { ItemDetail, Step } from '../../../core/models';
import { CLOSED } from '../../../core/statuses';
import { segments } from '../card/card-info';
import { ProjectBoard } from '../project-board';

/** An item's steps: check, skip and add. Shared by the detail panel and the item page. */
@Component({
  selector: 'anv-item-steps',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  templateUrl: './item-steps.html',
  styleUrl: './item-steps.scss',
})
export class ItemSteps {
  /** Heading level of the section title: 3 inside the detail panel, 2 on the item page. */
  readonly headingLevel = input<2 | 3>(3);
  protected readonly board = inject(ProjectBoard);
  readonly item = input.required<ItemDetail>();

  protected readonly newStep = signal('');
  /** The step just checked, for its pop: steps already checked when the item opens stay still. */
  protected readonly popped = signal<number | null>(null);
  protected readonly segments = computed(() => segments(this.item().progress));
  protected readonly closed = computed(() => CLOSED.includes(this.item().fields.status));

  protected toggle(step: Step): void {
    this.popped.set(step.checked ? null : step.index);
    void this.board.toggleStep(this.item(), step);
  }

  protected async add(): Promise<void> {
    if (await this.board.addStep(this.item(), this.newStep())) this.newStep.set('');
  }
}
