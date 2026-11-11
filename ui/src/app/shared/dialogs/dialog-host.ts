import { ChangeDetectionStrategy, Component, type ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Dialogs } from './dialogs';

/** A project id and prefix from an idea's title: "Track which recipes we cook" → track-which-recipes, TW. */
export function suggestProject(title: string): { id: string; prefix: string } {
  const words = title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(Boolean);
  const id = words.slice(0, 3).join('-');
  const prefix = (words.length > 1 ? words.slice(0, 2).map((w) => w[0]).join('') : (words[0] ?? '').slice(0, 2)).toUpperCase();
  return { id, prefix: /^[A-Z]{2,4}$/.test(prefix) ? prefix : '' };
}

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
  /** The "Idea → project" fields. */
  protected readonly newProject = signal({ id: '', prefix: '', kind: 'web', release: 'none' });
  protected readonly projectKinds = ['web', 'mobile', 'server', 'tooling'];

  private readonly element = viewChild<ElementRef<HTMLDialogElement>>('dialog');

  constructor() {
    effect(() => {
      const request = this.request();
      const dialog = this.element()?.nativeElement;
      if (!dialog) return;
      if (request && !dialog.open) {
        this.text.set('');
        this.project.set(request.kind === 'move' ? (request.projects[0]?.id ?? '') : '');
        if (request.kind === 'promote') this.newProject.set({ ...suggestProject(request.item.title), kind: 'web', release: 'none' });
        dialog.showModal();
      } else if (!request && dialog.open) {
        dialog.close();
      }
    });
  }

  protected setProject(field: 'id' | 'prefix' | 'kind' | 'release', value: string): void {
    this.newProject.update((p) => ({ ...p, [field]: field === 'prefix' ? value.toUpperCase() : value }));
  }

  protected promoteReady(): boolean {
    const p = this.newProject();
    return /^[a-z0-9][a-z0-9-]*$/.test(p.id) && /^[A-Z]{2,4}$/.test(p.prefix);
  }

  protected answer(value: string): void {
    this.dialogs.close({ value });
  }

  protected stringify(value: unknown): string {
    return JSON.stringify(value);
  }

  /** Escape, or a Cancel button. */
  protected dismiss(): void {
    if (this.request()) this.dialogs.close(null);
  }
}
