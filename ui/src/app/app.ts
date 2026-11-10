import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SpaceStore } from './core/space-store';
import { DialogHost } from './shared/dialogs/dialog-host';
import { NewItemDialog } from './shared/new-item/new-item';
import { Composer } from './shared/new-item/composer';
import { NoticesHost } from './shared/notices/notices';
import { Palette, PaletteService } from './shared/palette/palette';
import { Locked } from './shell/locked/locked';
import { Sidebar } from './shell/sidebar/sidebar';
import { Topbar } from './shell/topbar/topbar';

@Component({
  selector: 'anv-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, Sidebar, Topbar, Locked, DialogHost, NoticesHost, Palette, NewItemDialog],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  host: { '(document:keydown)': 'shortcut($event)' },
})
export class App {
  protected readonly store = inject(SpaceStore);

  readonly #palette = inject(PaletteService);
  readonly #composer = inject(Composer);

  constructor() {
    void this.store.start();
  }

  /** Ctrl K opens the palette; N opens "New item" when no field has the keyboard. */
  protected shortcut(event: KeyboardEvent): void {
    if (this.store.state() === 'unauthorized' || document.querySelector('dialog[open]')) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.#palette.open();
      return;
    }
    const target = event.target as HTMLElement | null;
    const typing = !!target?.closest('input, textarea, select, [contenteditable]');
    if (!typing && !event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === 'n') {
      event.preventDefault();
      this.#composer.open();
    }
  }
}
