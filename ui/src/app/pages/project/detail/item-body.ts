import { ChangeDetectionStrategy, Component, ElementRef, Injector, afterNextRender, computed, inject, input, signal } from '@angular/core';
import { bodyBlocks } from '../../../core/item-text';
import type { ItemDetail } from '../../../core/models';
import { Markdown } from '../../../shared/markdown/markdown';
import { ProjectBoard } from '../project-board';

/**
 * An item's description: Markdown rendered as data, never HTML, with mentions of other items as
 * links. It can be edited in place; the steps are not part of it and stay as they are.
 */
@Component({
  selector: 'anv-item-body',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Markdown],
  templateUrl: './item-body.html',
  styleUrl: './item-body.scss',
})
export class ItemBody {
  /** Heading level of the section title: 3 inside the detail panel, 2 on the item page. */
  readonly headingLevel = input<2 | 3>(3);
  protected readonly board = inject(ProjectBoard);
  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly #injector = inject(Injector);

  readonly item = input.required<ItemDetail>();
  /** The item page shows the description as the article's text, with its heading for screen readers only. */
  readonly hideHeading = input(false);

  protected readonly blocks = computed(() => bodyBlocks(this.item().body, (id) => this.board.byId().has(id)));
  protected readonly editing = signal(false);
  protected readonly draft = signal('');
  protected readonly saving = signal(false);
  /** The editor fits the text, between 8 and 24 lines, so it opens without scrolling. */
  protected readonly rows = computed(() => Math.min(24, Math.max(8, this.draft().split('\n').length + 1)));

  protected edit(): void {
    this.draft.set(this.item().description);
    this.editing.set(true);
    afterNextRender(() => this.#host.nativeElement.querySelector<HTMLTextAreaElement>('textarea')?.focus(), { injector: this.#injector });
  }

  protected async save(): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true);
    const saved = await this.board.setDescription(this.item(), this.draft());
    this.saving.set(false);
    if (saved) this.#close();
  }

  protected cancel(): void {
    this.#close();
  }

  /** Ctrl Enter saves; Escape cancels the edit only, not the panel around it. */
  protected keydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void this.save();
    } else if (event.key === 'Escape') {
      event.stopPropagation();
      this.cancel();
    }
  }

  #close(): void {
    this.editing.set(false);
    afterNextRender(() => this.#host.nativeElement.querySelector<HTMLElement>('.edit')?.focus(), { injector: this.#injector });
  }
}
