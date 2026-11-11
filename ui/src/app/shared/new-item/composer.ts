import { Injectable, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter, map } from 'rxjs';

export interface ComposerDefaults {
  project?: string;
  kind?: string;
  status?: string;
}

/** The project a board URL shows (/projects/<id>…), or null elsewhere. */
export function projectInUrl(url: string): string | null {
  const id = /^\/projects\/([^/?#]+)/.exec(url)?.[1];
  return id ? decodeURIComponent(id) : null;
}

/**
 * Opens the "New item" dialog. Without a project it suggests the one on screen, or the inbox.
 */
@Injectable({ providedIn: 'root' })
export class Composer {
  readonly #router = inject(Router);
  readonly #request = signal<ComposerDefaults | null>(null);
  readonly request = this.#request.asReadonly();

  readonly #url = toSignal(
    this.#router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
    ),
    { initialValue: this.#router.url },
  );

  /** The project of the page on screen, if it is a board. */
  currentProject(): string | null {
    return projectInUrl(this.#url());
  }

  open(defaults: ComposerDefaults = {}): void {
    this.#request.set({ project: defaults.project ?? this.currentProject() ?? 'inbox', ...defaults });
  }

  close(): void {
    this.#request.set(null);
  }
}
