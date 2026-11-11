import { Skeleton } from '../../shared/skeleton/skeleton';
import { ChangeDetectionStrategy, Component, ElementRef, Injector, afterNextRender, computed, effect, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import type { ItemDetail } from '../../core/models';
import { SpaceStore } from '../../core/space-store';
import { CLOSED, KIND_ICONS, MOVABLE, STATUSES, closeBlockers, isContainer, statusName } from '../../core/statuses';
import { ItemBody } from '../project/detail/item-body';
import { ItemHistory } from '../project/detail/item-history';
import { ItemSteps } from '../project/detail/item-steps';
import { ItemTasks } from '../project/detail/item-tasks';
import { ProjectBoard } from '../project/project-board';

export const KINDS: readonly string[] = ['task', 'feature', 'bug', 'decision', 'idea'];
export const PRIORITY_CHOICES: readonly { value: string; name: string }[] = [
  { value: '', name: 'None' },
  { value: 'high', name: 'High' },
  { value: 'medium', name: 'Medium' },
  { value: 'low', name: 'Low' },
];

/** Labels typed as "a, b c": split on commas and spaces, blanks and repeats dropped. */
export function parseLabels(text: string): string[] {
  return [...new Set(text.split(/[\s,]+/).map((label) => label.trim()).filter(Boolean))];
}

/** Only web links become anchors: a link field is text from a file, so anything else stays text. */
export function isWebLink(link: string): boolean {
  return /^https?:\/\/[^\s]+$/i.test(link);
}

/**
 * An item on a page of its own: the description, steps, tasks and history as an article, and
 * its properties and actions beside it. Fields are edited in place.
 */
@Component({
  selector: 'anv-item-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, RouterLink, ItemBody, ItemSteps, ItemTasks, ItemHistory],
  providers: [ProjectBoard],
  templateUrl: './item.html',
  styleUrl: './item.scss',
  host: { '(document:keydown)': 'shortcut($event)' },
})
export class ItemPage {
  protected readonly board = inject(ProjectBoard);
  protected readonly store = inject(SpaceStore);
  readonly #router = inject(Router);
  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly #injector = inject(Injector);

  /** From the route parameter. */
  readonly id = input.required<string>();

  protected readonly item = this.board.detail;
  protected readonly statuses = STATUSES;
  protected readonly kindIcons = KIND_ICONS;
  protected readonly kinds = KINDS;
  protected readonly priorities = PRIORITY_CHOICES;
  protected readonly statusName = statusName;
  protected readonly isWebLink = isWebLink;
  protected readonly editingTitle = signal(false);

  protected readonly project = computed(() => {
    const item = this.item();
    return item ? this.store.project(item.project) : null;
  });

  protected readonly statusOptions = computed(() => {
    const current = this.item()?.fields.status ?? '';
    return MOVABLE.includes(current) ? MOVABLE : [current, ...MOVABLE];
  });

  /** Why the item cannot be closed yet, shown before anyone tries. */
  protected readonly blockers = computed(() => {
    const item = this.item();
    if (!item || CLOSED.includes(item.fields.status)) return null;
    const blockers = closeBlockers(item, item.children);
    return blockers.steps.length || blockers.children.length ? blockers : null;
  });

  protected readonly container = computed(() => isContainer(this.item()?.fields.kind ?? ''));

  constructor() {
    effect(() => this.board.selectedId.set(this.id()));
    // The board's items (for parents, mentions and related titles) come from the item's project.
    effect(() => {
      const project = this.item()?.project;
      if (project) this.board.projectId.set(project);
    });
    this.board.onSelect = (id) => {
      if (id) void this.#router.navigate(['/items', id]);
      else void this.#router.navigate(this.board.projectId() ? ['/projects', this.board.projectId()] : ['/']);
    };
  }

  protected async changeStatus(item: ItemDetail, select: HTMLSelectElement): Promise<void> {
    const target = select.value;
    select.value = item.fields.status;
    await this.board.move(item, target);
  }

  protected editTitle(): void {
    if (this.board.readOnly()) return;
    this.editingTitle.set(true);
    afterNextRender(() => this.#host.nativeElement.querySelector<HTMLInputElement>('#item-title')?.select(), { injector: this.#injector });
  }

  protected async saveTitle(item: ItemDetail, value: string): Promise<void> {
    if (!this.editingTitle()) return;
    this.editingTitle.set(false);
    const title = value.trim();
    if (title && title !== item.fields.title) await this.board.setFields(item, { title }, `${item.id} renamed`);
    this.#focus('#title-button');
  }

  protected cancelTitle(event: Event): void {
    event.stopPropagation();
    this.editingTitle.set(false);
    this.#focus('#title-button');
  }

  protected async setPriority(item: ItemDetail, select: HTMLSelectElement): Promise<void> {
    const priority = select.value;
    select.value = item.fields.priority ?? '';
    if (priority === (item.fields.priority ?? '')) return;
    await this.board.setFields(item, { priority: priority || null }, priority ? `Priority set to ${priority}` : 'Priority removed');
  }

  protected async setKind(item: ItemDetail, select: HTMLSelectElement): Promise<void> {
    const kind = select.value;
    select.value = item.fields.kind;
    if (kind !== item.fields.kind) await this.board.setFields(item, { kind }, `${item.id} is now a ${kind}`);
  }

  protected async setLabels(item: ItemDetail, input: HTMLInputElement): Promise<void> {
    const labels = parseLabels(input.value);
    const before = item.fields.labels ?? [];
    if (labels.join(',') === before.join(',')) {
      input.value = before.join(', ');
      return;
    }
    if (!(await this.board.setFields(item, { labels: labels.length ? labels : null }, 'Labels saved'))) input.value = before.join(', ');
  }

  protected relatedTitle(id: string): string {
    return this.board.byId().get(id)?.fields.title ?? '';
  }

  /** E edits the title, Shift ← → moves the item, as on the board. Never while typing or in a dialog. */
  protected shortcut(event: KeyboardEvent): void {
    const item = this.item();
    const target = event.target instanceof Element ? event.target : null;
    if (!item || this.board.readOnly() || document.querySelector('dialog[open]')) return;
    if (target?.closest('input, textarea, select, [contenteditable]') || event.ctrlKey || event.metaKey || event.altKey) return;
    if (!event.shiftKey && event.key.toLowerCase() === 'e') {
      event.preventDefault();
      this.editTitle();
    } else if (event.shiftKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault();
      void this.board.stepBy(item, event.key === 'ArrowLeft' ? -1 : 1);
    }
  }

  #focus(selector: string): void {
    afterNextRender(() => this.#host.nativeElement.querySelector<HTMLElement>(selector)?.focus(), { injector: this.#injector });
  }
}
