import { DOCUMENT, Injectable, computed, inject, signal } from '@angular/core';

export type Theme = 'dark' | 'light';

export const THEME_KEY = 'anvil.theme';

/**
 * Dark (Graphite) or light (Bone). Follows the system until the user picks one in the sidebar;
 * the choice is a per-browser convenience kept in localStorage.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly #document = inject(DOCUMENT);
  readonly #choice = signal<Theme | null>(this.#stored());
  readonly #systemLight = signal(this.#query()?.matches ?? false);

  /** The theme in use. */
  readonly theme = computed<Theme>(() => this.#choice() ?? (this.#systemLight() ? 'light' : 'dark'));

  constructor() {
    this.#query()?.addEventListener('change', (event) => this.#systemLight.set(event.matches));
    this.#apply(this.#choice());
  }

  set(theme: Theme): void {
    this.#choice.set(theme);
    try {
      this.#document.defaultView?.localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Storage blocked: the choice lasts until the page is closed.
    }
    this.#apply(theme);
  }

  #apply(theme: Theme | null): void {
    const root = this.#document.documentElement;
    if (theme) root.dataset['theme'] = theme;
    else delete root.dataset['theme'];
  }

  #stored(): Theme | null {
    try {
      const value = this.#document.defaultView?.localStorage.getItem(THEME_KEY);
      return value === 'dark' || value === 'light' ? value : null;
    } catch {
      return null;
    }
  }

  #query(): MediaQueryList | null {
    return this.#document.defaultView?.matchMedia?.('(prefers-color-scheme: light)') ?? null;
  }
}
