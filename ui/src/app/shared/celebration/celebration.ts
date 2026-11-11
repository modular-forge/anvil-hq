import { ChangeDetectionStrategy, Component, Injectable, inject, signal } from '@angular/core';
import { prefersReducedMotion } from '../../core/motion';
import { ForgeArt } from '../forge-art/forge-art';

/** Celebrations last at most this long, and never block anything. */
export const CELEBRATION_MS = 1200;

export type Celebration =
  /** A feature or bug closed with all its tasks: the hammer strikes the anvil. */
  | { kind: 'forge'; label: string }
  /** A release published: an ingot is stamped with its version. */
  | { kind: 'stamp'; version: string };

/**
 * Plays the storyboard's two big moments over the page. Decorative only: the notice that goes
 * with each change already tells screen readers what happened. With reduced motion, nothing plays.
 */
@Injectable({ providedIn: 'root' })
export class Celebrations {
  readonly #current = signal<(Celebration & { at: number }) | null>(null);
  readonly current = this.#current.asReadonly();
  #timer: ReturnType<typeof setTimeout> | undefined;

  play(celebration: Celebration): void {
    if (prefersReducedMotion()) return;
    clearTimeout(this.#timer);
    this.#current.set({ ...celebration, at: Date.now() });
    this.#timer = setTimeout(() => this.#current.set(null), CELEBRATION_MS);
  }
}

@Component({
  selector: 'anv-celebration',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ForgeArt],
  template: `
    @if (celebrations.current(); as current) {
      @for (shown of [current.at]; track shown) {
        <div class="stage" aria-hidden="true">
          @if (current.kind === 'forge') {
            <div class="forge">
              <anv-forge-art motion="strike" [flame]="true" [size]="200" />
              <span class="caption mono">{{ current.label }}</span>
            </div>
          } @else {
            <div class="ingot">
              <span class="gather"><span></span><span></span><span></span></span>
              <svg width="230" height="106" viewBox="0 0 260 120">
                <path class="bar" d="M30 34h200l26 70H4z" />
                <text class="stamp mono" x="130" y="86" text-anchor="middle">v{{ current.version }}</text>
              </svg>
              <span class="sparks"><span></span><span></span><span></span><span></span></span>
            </div>
          }
        </div>
      }
    }
  `,
  styleUrl: './celebration.scss',
})
export class CelebrationHost {
  protected readonly celebrations = inject(Celebrations);
}
