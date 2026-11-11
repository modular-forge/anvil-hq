import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { SpaceStore } from '../../core/space-store';

/** Problems listed on the board; `anvil validate` has the rest. */
export const SHOWN_PROBLEMS = 5;

/**
 * What stops the board from working normally, above every page: the server is not answering,
 * or the data space breaks the format and the board is read-only. Each says what happened and
 * the one command to run.
 */
@Component({
  selector: 'anv-status-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './status-banner.html',
  styleUrl: './status-banner.scss',
})
export class StatusBanner {
  protected readonly store = inject(SpaceStore);

  protected readonly offline = computed(() => this.store.state() === 'offline');
  protected readonly readOnly = computed(() => this.store.state() === 'ready' && !!this.store.space()?.readOnly);
  protected readonly problems = computed(() => (this.store.space()?.problems ?? []).slice(0, SHOWN_PROBLEMS));
  protected readonly count = computed(() => this.store.space()?.problemCount ?? 0);
}
