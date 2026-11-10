import { ChangeDetectionStrategy, Component, ElementRef, Injector, afterNextRender, computed, effect, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { Dialogs } from '../../shared/dialogs/dialogs';
import { SpaceStore } from '../../core/space-store';
import { Board } from './board/board';
import { DetailPanel } from './detail/detail-panel';
import { ProjectBoard } from './project-board';

const STATE_NAMES: Readonly<Record<string, string>> = {
  idea: 'Idea', planning: 'Planning', design: 'Design', active: 'Active', paused: 'Paused', done: 'Done', cancelled: 'Cancelled',
};

/** A project: its board, and the selected item (?item=AB-1) in a panel beside it. */
@Component({
  selector: 'anv-project',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Board, DetailPanel],
  providers: [ProjectBoard],
  templateUrl: './project.html',
  styleUrl: './project.scss',
  host: { '(document:keydown.escape)': 'escape()' },
})
export class ProjectPage {
  protected readonly store = inject(SpaceStore);
  protected readonly board = inject(ProjectBoard);
  readonly #router = inject(Router);
  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly #injector = inject(Injector);
  readonly #dialogs = inject(Dialogs);

  /** From the route parameter. */
  readonly id = input.required<string>();
  /** From the ?item= query parameter. */
  readonly item = input<string | undefined>();

  protected readonly project = computed(() => this.store.project(this.id()));
  protected readonly stateName = computed(() => STATE_NAMES[this.project()?.state ?? ''] ?? this.project()?.state ?? '');

  constructor() {
    effect(() => this.board.projectId.set(this.id()));
    effect(() => this.board.selectedId.set(this.item() ?? null));
    this.board.onSelect = (id) => void this.#router.navigate([], { queryParams: { item: id }, queryParamsHandling: 'merge' });
  }

  /** Escape closes the panel, unless a dialog is open: then it closes the dialog only. */
  protected escape(): void {
    if (this.board.selectedId() && !this.#dialogs.current()) this.close();
  }

  protected close(): void {
    const id = this.board.selectedId();
    this.board.onSelect(null);
    // Back to the card the panel was opened from.
    afterNextRender(() => this.#host.nativeElement.querySelector<HTMLElement>(`[data-id="${id}"]`)?.focus(), { injector: this.#injector });
  }
}
