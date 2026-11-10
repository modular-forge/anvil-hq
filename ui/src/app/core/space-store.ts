import { HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { Api } from './api';
import { ChangeFeed, type FeedEvent } from './change-feed';
import { openCount, type GitStatus, type Project, type Space } from './models';
import { readToken, sessionStore } from './token';

/** How often the board polls when the server cannot watch the data space. */
export const POLL_MS = 5000;

export type LoadState = 'loading' | 'ready' | 'unauthorized' | 'offline';

/**
 * The data space as the board sees it: the overview from /api/space and the git status, kept
 * fresh from the server's change feed, or by polling when the feed says it cannot watch.
 */
@Injectable({ providedIn: 'root' })
export class SpaceStore {
  readonly #api = inject(Api);
  readonly #feed = inject(ChangeFeed);

  readonly #space = signal<Space | null>(null, { equal: (a, b) => a?.stamp === b?.stamp });
  readonly #git = signal<GitStatus | null>(null);
  readonly #state = signal<LoadState>('loading');
  readonly #watching = signal(true);

  readonly space = this.#space.asReadonly();
  readonly git = this.#git.asReadonly();
  readonly state = this.#state.asReadonly();
  /** False while the board polls instead of receiving changes. */
  readonly watching = this.#watching.asReadonly();

  readonly projects = computed(() => this.#space()?.projects ?? []);
  readonly inbox = computed(() => this.projects().find((p) => p.id === 'inbox') ?? null);
  readonly general = computed(() => this.projects().find((p) => p.id === 'general') ?? null);
  readonly inboxOpen = computed(() => {
    const inbox = this.inbox();
    return inbox ? openCount(inbox) : 0;
  });

  #stopFeed: (() => void) | null = null;
  #poll: ReturnType<typeof setInterval> | undefined;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  project(id: string): Project | null {
    return this.projects().find((p) => p.id === id) ?? null;
  }

  /** Loads the space and starts following changes. Without a token, the board is locked. */
  async start(): Promise<void> {
    const token = readToken(sessionStore());
    if (!token) {
      this.#state.set('unauthorized');
      return;
    }
    await this.refresh();
    if (this.#state() === 'unauthorized') return;
    this.#stopFeed = this.#feed.connect(token, {
      onEvent: (event) => this.#onEvent(event),
      onDown: (status) => {
        if (status === 401) this.#state.set('unauthorized');
        else this.#setWatching(false);
      },
    });
  }

  stop(): void {
    this.#stopFeed?.();
    this.#stopFeed = null;
    clearInterval(this.#poll);
    this.#poll = undefined;
  }

  /** Reads the space and the git status again. */
  async refresh(): Promise<void> {
    try {
      const [space, git] = await Promise.all([this.#api.space(), this.#api.git()]);
      this.#space.set(space);
      this.#git.set(git);
      this.#state.set('ready');
    } catch (error) {
      this.#state.set(error instanceof HttpErrorResponse && error.status === 401 ? 'unauthorized' : 'offline');
    }
  }

  #onEvent(event: FeedEvent): void {
    if (event.type === 'change') {
      void this.refresh();
      return;
    }
    this.#setWatching(event.watching);
    // A reconnect may have missed changes.
    if (event.type === 'hello') void this.refresh();
  }

  #setWatching(watching: boolean): void {
    this.#watching.set(watching);
    if (watching) {
      clearInterval(this.#poll);
      this.#poll = undefined;
    } else if (this.#poll === undefined) {
      this.#poll = setInterval(() => void this.refresh(), POLL_MS);
    }
  }
}
