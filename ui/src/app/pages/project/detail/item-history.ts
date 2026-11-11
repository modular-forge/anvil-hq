import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ago } from '../../../core/time';
import { ProjectBoard } from '../project-board';

/** The commits that touched the item's file, newest first, from git. */
@Component({
  selector: 'anv-item-history',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './item-history.html',
  styleUrl: './item-history.scss',
})
export class ItemHistory {
  readonly #board = inject(ProjectBoard);

  protected readonly entries = computed(() => {
    const now = new Date();
    return this.#board.history().map((entry) => ({ ...entry, when: ago(entry.date, now) }));
  });
}
