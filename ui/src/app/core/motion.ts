import { ApplicationRef, Injectable, inject } from '@angular/core';

/** How long a shared transition waits for its target to render (an item loading from disk). */
export const TARGET_WAIT_MS = 400;

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => Promise<void>) => { finished: Promise<void>; updateCallbackDone: Promise<void> };
};

/** True when the person asked their system for less motion. */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Moves between two states of the page with the browser's View Transitions API: cards glide to
 * their new column, the detail grows out of its card. Where the API is missing, or with reduced
 * motion, the change simply happens. Never delays the change itself.
 */
@Injectable({ providedIn: 'root' })
export class Motion {
  readonly #app = inject(ApplicationRef);

  /** Applies `update` inside a view transition. Resolves once the new state is on screen. */
  async transition(update: () => unknown): Promise<void> {
    const doc = document as ViewTransitionDocument;
    if (!doc.startViewTransition || prefersReducedMotion()) {
      await update();
      return;
    }
    // Render what changed before the call (a name on the moving card), so the browser captures it.
    this.#app.tick();
    const transition = doc.startViewTransition(async () => {
      await update();
      // Zoneless: render now, so the browser captures the new state rather than the old one.
      this.#app.tick();
    });
    await transition.updateCallbackDone.catch(() => undefined);
  }

  /**
   * Opens something out of `from`: `from` is captured as the shared element, and whatever
   * matches `to` after `update` takes its place, so it seems to grow from it.
   */
  async share(from: HTMLElement | null, to: string, update: () => unknown): Promise<void> {
    const doc = document as ViewTransitionDocument;
    if (!from || !doc.startViewTransition || prefersReducedMotion()) {
      await update();
      return;
    }
    from.style.setProperty('view-transition-name', 'opening');
    let target: HTMLElement | null = null;
    const transition = doc.startViewTransition(async () => {
      from.style.removeProperty('view-transition-name');
      await update();
      target = await this.#rendered(to);
      target?.style.setProperty('view-transition-name', 'opening');
    });
    await transition.updateCallbackDone.catch(() => undefined);
    void transition.finished.catch(() => undefined).then(() => target?.style.removeProperty('view-transition-name'));
  }

  /** Renders until `selector` matches, for a short while: the page is frozen meanwhile. */
  async #rendered(selector: string): Promise<HTMLElement | null> {
    const until = Date.now() + TARGET_WAIT_MS;
    for (;;) {
      this.#app.tick();
      const found = document.querySelector<HTMLElement>(selector);
      if (found || Date.now() >= until) return found;
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
  }
}
