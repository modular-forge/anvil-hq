import { ChangeDetectionStrategy, Component, type ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Dialogs } from './dialogs';

/**
 * Shows the open dialog in a native modal <dialog>: the browser traps focus, makes the page
 * behind it inert and closes it with Escape. Each dialog says what will happen and what it needs.
 */
@Component({
  selector: 'anv-dialog-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  templateUrl: './dialog-host.html',
  styleUrl: './dialog-host.scss',
})
export class DialogHost {
  protected readonly dialogs = inject(Dialogs);
  protected readonly request = computed(() => this.dialogs.current()?.request ?? null);
  /** The text field of the dialogs that have one. */
  protected readonly text = signal('');
  protected readonly project = signal('');

  private readonly element = viewChild<ElementRef<HTMLDialogElement>>('dialog');

  constructor() {
    effect(() => {
      const request = this.request();
      const dialog = this.element()?.nativeElement;
      if (!dialog) return;
      if (request && !dialog.open) {
        this.text.set('');
        this.project.set(request.kind === 'move' ? (request.projects[0]?.id ?? '') : '');
        dialog.showModal();
      } else if (!request && dialog.open) {
        dialog.close();
      }
    });
  }

  protected answer(value: string): void {
    this.dialogs.close({ value });
  }

  /** Escape, or a Cancel button. */
  protected dismiss(): void {
    if (this.request()) this.dialogs.close(null);
  }
}
