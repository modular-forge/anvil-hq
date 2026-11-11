import { ChangeDetectionStrategy, Component, type ElementRef, Injectable, effect, inject, signal, viewChild } from '@angular/core';

/** Every keyboard shortcut of the board, as the `?` dialog lists them. */
export const SHORTCUTS: readonly { group: string; keys: { keys: string[]; what: string }[] }[] = [
  {
    group: 'Anywhere',
    keys: [
      { keys: ['Ctrl', 'K'], what: 'Search or run a command' },
      { keys: ['N'], what: 'New item' },
      { keys: ['G', 'H'], what: 'Go to Home' },
      { keys: ['G', 'I'], what: 'Go to the Inbox' },
      { keys: ['?'], what: 'Show these shortcuts' },
      { keys: ['Esc'], what: 'Close a dialog or the detail panel' },
    ],
  },
  {
    group: 'Board',
    keys: [
      { keys: ['J'], what: 'Next card' },
      { keys: ['K'], what: 'Previous card' },
      { keys: ['Enter'], what: 'Open the card' },
      { keys: ['Shift', '←'], what: 'Move it one column left' },
      { keys: ['Shift', '→'], what: 'Move it one column right' },
    ],
  },
  {
    group: 'An item',
    keys: [
      { keys: ['E'], what: 'Edit the title (opens the full page from the panel)' },
      { keys: ['Space'], what: 'Check or uncheck the focused step' },
    ],
  },
];

@Injectable({ providedIn: 'root' })
export class ShortcutsService {
  readonly #open = signal(false);
  readonly isOpen = this.#open.asReadonly();

  open(): void {
    this.#open.set(true);
  }

  close(): void {
    this.#open.set(false);
  }
}

/** The list of keyboard shortcuts, opened with `?`. */
@Component({
  selector: 'anv-shortcuts',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dialog aria-labelledby="shortcuts-title" (close)="service.close()">
      <div class="head">
        <h2 id="shortcuts-title" class="display">Keyboard shortcuts</h2>
        <button type="button" class="close" (click)="service.close()">Close</button>
      </div>
      @for (group of shortcuts; track group.group) {
        <section [attr.aria-label]="group.group">
          <h3>{{ group.group }}</h3>
          <dl>
            @for (entry of group.keys; track entry.what) {
              <dt>
                @for (key of entry.keys; track $index) {
                  <kbd class="mono">{{ key }}</kbd>
                }
              </dt>
              <dd>{{ entry.what }}</dd>
            }
          </dl>
        </section>
      }
    </dialog>
  `,
  styleUrl: './shortcuts.scss',
})
export class Shortcuts {
  protected readonly service = inject(ShortcutsService);
  protected readonly shortcuts = SHORTCUTS;
  protected readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('dialog');

  constructor() {
    effect(() => {
      const open = this.service.isOpen();
      const dialog = this.dialog()?.nativeElement;
      if (!dialog) return;
      if (open && !dialog.open) dialog.showModal();
      else if (!open && dialog.open) dialog.close();
    });
  }
}
