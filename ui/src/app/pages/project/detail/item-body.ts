import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { bodyBlocks } from '../../../core/item-text';
import type { ItemDetail } from '../../../core/models';
import { ProjectBoard } from '../project-board';

/** An item's description, with mentions of other items as links. Text only, never HTML. */
@Component({
  selector: 'anv-item-body',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './item-body.html',
  styleUrl: './item-body.scss',
})
export class ItemBody {
  protected readonly board = inject(ProjectBoard);
  readonly item = input.required<ItemDetail>();
  /** The item page shows the description as the article's text, with its heading for screen readers only. */
  readonly hideHeading = input(false);

  protected readonly blocks = computed(() => bodyBlocks(this.item().body, (id) => this.board.byId().has(id)));
}
