import { ChangeDetectionStrategy, Component, Injectable, inject, signal } from '@angular/core';

const ERROR_MS = 8000;

/**
 * What the board tells the user outside the page flow: short confirmations for screen readers
 * ("PB-8 moved to Doing") and visible error messages from the server.
 */
@Injectable({ providedIn: 'root' })
export class Notices {
  readonly #message = signal('');
  readonly #error = signal('');
  readonly message = this.#message.asReadonly();
  readonly error = this.#error.asReadonly();
  #timer: ReturnType<typeof setTimeout> | undefined;

  /** Announced to screen readers only. */
  say(text: string): void {
    // A repeated text is announced again only if the region changes first.
    this.#message.set('');
    queueMicrotask(() => this.#message.set(text));
  }

  /** Shown until dismissed or for a few seconds, and announced. */
  fail(text: string): void {
    clearTimeout(this.#timer);
    this.#error.set(text);
    this.#timer = setTimeout(() => this.#error.set(''), ERROR_MS);
  }

  dismiss(): void {
    clearTimeout(this.#timer);
    this.#error.set('');
  }
}

@Component({
  selector: 'anv-notices',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="sr-only" aria-live="polite">{{ notices.message() }}</p>
    <div class="errors" role="alert">
      @if (notices.error(); as error) {
        <p class="error">
          <span>{{ error }}</span>
          <button type="button" (click)="notices.dismiss()" aria-label="Dismiss">✕</button>
        </p>
      }
    </div>
  `,
  styles: `
    .errors {
      position: fixed;
      right: 16px;
      bottom: 16px;
      left: 16px;
      z-index: 20;
      display: flex;
      justify-content: center;
      pointer-events: none;
    }

    .error {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      max-width: 560px;
      margin: 0;
      padding: 12px 14px;
      border: 1px solid color-mix(in srgb, var(--st-blocked) 60%, var(--line2));
      border-radius: var(--radius-l);
      background: var(--s1);
      box-shadow: 0 12px 30px rgb(0 0 0 / 35%);
      color: var(--tx);
      pointer-events: auto;
    }

    button {
      flex: none;
      border: 0;
      background: transparent;
      color: var(--tx2);
      cursor: pointer;
    }
  `,
})
export class NoticesHost {
  protected readonly notices = inject(Notices);
}
