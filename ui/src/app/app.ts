import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { SpaceStore } from './core/space-store';
import { CelebrationHost } from './shared/celebration/celebration';
import { DialogHost } from './shared/dialogs/dialog-host';
import { NewItemDialog } from './shared/new-item/new-item';
import { Composer } from './shared/new-item/composer';
import { NoticesHost } from './shared/notices/notices';
import { Palette, PaletteService } from './shared/palette/palette';
import { Shortcuts, ShortcutsService } from './shared/shortcuts/shortcuts';
import { Locked } from './shell/locked/locked';
import { Sidebar } from './shell/sidebar/sidebar';
import { StatusBanner } from './shell/status-banner/status-banner';
import { Topbar } from './shell/topbar/topbar';

/** How long G waits for its second key. */
const G_WINDOW_MS = 1000;

@Component({
  selector: 'anv-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, StatusBanner, CelebrationHost, Sidebar, Topbar, Locked, DialogHost, NoticesHost, Palette, NewItemDialog, Shortcuts],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  host: { '(document:keydown)': 'shortcut($event)' },
})
export class App {
  protected readonly store = inject(SpaceStore);

  readonly #palette = inject(PaletteService);
  readonly #composer = inject(Composer);
  readonly #shortcuts = inject(ShortcutsService);
  readonly #router = inject(Router);
  /** When G was pressed: G then H or I, within a second, goes somewhere. */
  #g = 0;

  constructor() {
    void this.store.start();
  }

  /**
   * Ctrl K opens the palette. Without a field holding the keyboard: N opens "New item", G H goes
   * Home, G I to the Inbox and ? lists the shortcuts.
   */
  protected shortcut(event: KeyboardEvent): void {
    if (this.store.state() === 'unauthorized' || document.querySelector('dialog[open]')) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.#palette.open();
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    const typing = !!target?.closest('input, textarea, select, [contenteditable]');
    if (typing || event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key.toLowerCase();
    const afterG = Date.now() - this.#g < G_WINDOW_MS;
    this.#g = 0;
    if (afterG && (key === 'h' || key === 'i')) {
      event.preventDefault();
      void this.#router.navigate([key === 'h' ? '/' : '/inbox']);
    } else if (key === 'g') {
      this.#g = Date.now();
    } else if (key === 'n') {
      event.preventDefault();
      this.#composer.open();
    } else if (event.key === '?') {
      event.preventDefault();
      this.#shortcuts.open();
    }
  }
}
