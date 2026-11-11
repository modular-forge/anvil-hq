import { Skeleton } from '../../shared/skeleton/skeleton';
import { ChangeDetectionStrategy, Component, ElementRef, Injector, afterNextRender, computed, effect, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { Motion } from '../../core/motion';
import { Dialogs } from '../../shared/dialogs/dialogs';
import { SpaceStore } from '../../core/space-store';
import { RouterLink } from '@angular/router';
import { Board } from './board/board';
import { Journal } from './journal/journal';
import { DetailPanel } from './detail/detail-panel';
import { ProjectBoard, type Filters } from './project-board';

const PRIORITIES: readonly { value: string; name: string }[] = [
  { value: 'high', name: 'High' },
  { value: 'medium', name: 'Medium' },
  { value: 'low', name: 'Low' },
  { value: 'none', name: 'No priority' },
];

const STATE_NAMES: Readonly<Record<string, string>> = {
  idea: 'Idea', planning: 'Planning', design: 'Design', active: 'Active', paused: 'Paused', done: 'Done', cancelled: 'Cancelled',
};

/** A project: its board, and the selected item (?item=AB-1) in a panel beside it. */
@Component({
  selector: 'anv-project',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, Board, DetailPanel, Journal, RouterLink],
  providers: [ProjectBoard],
  templateUrl: './project.html',
  styleUrl: './project.scss',
  host: { '(document:keydown.escape)': 'escape()', '(document:keydown)': 'shortcut($event)' },
})
export class ProjectPage {
  protected readonly store = inject(SpaceStore);
  protected readonly board = inject(ProjectBoard);
  readonly #router = inject(Router);
  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly #injector = inject(Injector);
  readonly #dialogs = inject(Dialogs);
  readonly #motion = inject(Motion);

  /** From the route parameter. */
  readonly id = input.required<string>();
  /** From the ?item= query parameter. */
  readonly item = input<string | undefined>();
  /** From the ?view= query parameter: the board, or the journal. */
  readonly view = input<string | undefined>();
  /** From the ?kind=, ?label= and ?priority= query parameters: the board's filters. */
  readonly kind = input<string | undefined>();
  readonly label = input<string | undefined>();
  readonly priority = input<string | undefined>();

  protected readonly priorities = PRIORITIES;

  protected readonly project = computed(() => this.store.project(this.id()));
  protected readonly stateName = computed(() => STATE_NAMES[this.project()?.state ?? ''] ?? this.project()?.state ?? '');

  constructor() {
    effect(() => this.board.projectId.set(this.id()));
    effect(() => this.board.selectedId.set(this.item() ?? null));
    effect(() => this.board.filters.set({ kind: this.kind() || null, label: this.label() || null, priority: this.priority() || null }));
    // Opening an item always shows it on the board.
    this.board.onSelect = (id) =>
      this.#router.navigate([], { queryParams: { item: id, ...(id ? { view: null } : {}) }, queryParamsHandling: 'merge' });
  }

  /** Filters live in the URL, so a filtered board can be bookmarked and Back undoes a change. */
  protected filter(key: keyof Filters, value: string): void {
    void this.#router.navigate([], { queryParams: { [key]: value || null }, queryParamsHandling: 'merge' });
  }

  protected clearFilters(): void {
    void this.#router.navigate([], { queryParams: { kind: null, label: null, priority: null }, queryParamsHandling: 'merge' });
  }

  /**
   * From anywhere on the page: J or K starts on the first card (inside the board, the board
   * walks the cards itself), and E opens the selected item on its own page to edit it.
   */
  protected shortcut(event: KeyboardEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || this.#dialogs.current() || document.querySelector('dialog[open]')) return;
    if (target?.closest('input, textarea, select, [contenteditable], anv-board')) return;
    const key = event.key.toLowerCase();
    if ((key === 'j' || key === 'k') && this.view() !== 'journal') {
      const first = this.#host.nativeElement.querySelector<HTMLElement>('[data-id]');
      if (first) {
        event.preventDefault();
        first.focus();
      }
    } else if (key === 'e' && this.board.selectedId()) {
      event.preventDefault();
      void this.#router.navigate(['/items', this.board.selectedId()]);
    }
  }

  /** Escape closes the panel, unless a dialog is open: then it closes the dialog only. */
  protected escape(): void {
    if (this.board.selectedId() && !this.#dialogs.current()) this.close();
  }

  protected close(): void {
    const id = this.board.selectedId();
    void this.#motion.transition(() => this.board.onSelect(null));
    // Back to the card the panel was opened from.
    afterNextRender(() => this.#host.nativeElement.querySelector<HTMLElement>(`[data-id="${id}"]`)?.focus(), { injector: this.#injector });
  }
}
