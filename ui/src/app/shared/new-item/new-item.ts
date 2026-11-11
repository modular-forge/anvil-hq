import { ChangeDetectionStrategy, Component, type ElementRef, Injector, afterNextRender, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Api, WriteError } from '../../core/api';
import type { ItemSummary } from '../../core/models';
import { SpaceStore } from '../../core/space-store';
import { CLOSED, KIND_ICONS, isContainer } from '../../core/statuses';
import { Notices } from '../notices/notices';
import { Composer } from './composer';

export const KINDS = ['task', 'feature', 'bug', 'decision', 'idea'] as const;
export const STARTS = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'todo', label: 'Todo' },
  { value: 'doing', label: 'Doing' },
] as const;
export const PRIORITIES = [
  { value: '', label: '—' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Med' },
  { value: 'high', label: 'High' },
] as const;

/** "a, b , ,c" → ["a", "b", "c"]. */
export function splitLabels(text: string): string[] {
  return [...new Set(text.split(',').map((label) => label.trim()).filter(Boolean))];
}

/** One step per non-empty line. */
export function splitSteps(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

/** The "New item" dialog: everything `anvil item create` takes, in one commit. */
@Component({
  selector: 'anv-new-item',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  templateUrl: './new-item.html',
  styleUrl: './new-item.scss',
})
export class NewItemDialog {
  readonly #api = inject(Api);
  readonly #router = inject(Router);
  readonly #notices = inject(Notices);
  protected readonly store = inject(SpaceStore);
  protected readonly composer = inject(Composer);

  protected readonly kinds = KINDS;
  protected readonly starts = STARTS;
  protected readonly priorities = PRIORITIES;
  protected readonly kindIcons = KIND_ICONS;

  protected readonly project = signal('inbox');
  protected readonly kind = signal('task');
  protected readonly status = signal('todo');
  protected readonly priority = signal('');
  protected readonly parent = signal('');
  protected readonly labels = signal('');
  protected readonly title = signal('');
  protected readonly steps = signal('');
  protected readonly saving = signal(false);
  /** Open features and bugs of the chosen project: the parents a task can have. */
  protected readonly parents = signal<ItemSummary[]>([]);

  protected readonly prefix = computed(() => this.store.project(this.project())?.prefix ?? '');
  protected readonly canCreate = computed(() => !!this.title().trim() && !this.saving() && !this.store.space()?.readOnly);

  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('dialog');
  private readonly titleInput = viewChild<ElementRef<HTMLInputElement>>('titleInput');
  readonly #injector = inject(Injector);

  constructor() {
    effect(() => {
      const request = this.composer.request();
      const dialog = this.dialog()?.nativeElement;
      if (!dialog) return;
      if (request && !dialog.open) {
        untracked(() => this.#reset(request.project ?? 'inbox', request.kind ?? 'task', request.status ?? 'todo'));
        dialog.showModal();
        // Start in the title: the form appears with the open state.
        afterNextRender(() => this.titleInput()?.nativeElement.focus(), { injector: this.#injector });
      } else if (!request && dialog.open) {
        dialog.close();
      }
    });
    effect(() => {
      const project = this.project();
      if (this.composer.request()) untracked(() => void this.#loadParents(project));
    });
  }

  protected cancel(): void {
    this.composer.close();
  }

  protected keydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void this.create();
    }
  }

  async create(): Promise<void> {
    if (!this.canCreate()) return;
    this.saving.set(true);
    const project = this.project();
    try {
      const result = await this.#api.createItem({
        project,
        kind: this.kind(),
        title: this.title().trim(),
        status: this.status(),
        ...(this.priority() ? { priority: this.priority() } : {}),
        ...(this.kind() === 'task' && this.parent() ? { parent: this.parent() } : {}),
        labels: splitLabels(this.labels()),
        steps: splitSteps(this.steps()),
      });
      this.composer.close();
      this.#notices.say(`Created ${result.id}`);
      await this.#router.navigate(['/projects', project], { queryParams: { item: result.id } });
    } catch (error) {
      this.#notices.fail(error instanceof WriteError ? error.message : 'The item could not be created.');
    } finally {
      this.saving.set(false);
    }
  }

  #reset(project: string, kind: string, status: string): void {
    this.project.set(project);
    this.kind.set(kind);
    this.status.set(status);
    this.priority.set('');
    this.parent.set('');
    this.labels.set('');
    this.title.set('');
    this.steps.set('');
  }

  async #loadParents(project: string): Promise<void> {
    this.parents.set([]);
    this.parent.set('');
    try {
      const items = await this.#api.items(project);
      if (project !== this.project()) return;
      this.parents.set(items.filter((i) => !i.archived && isContainer(i.fields.kind) && !CLOSED.includes(i.fields.status)));
    } catch {
      // No parents offered; the item can still be created.
    }
  }
}
