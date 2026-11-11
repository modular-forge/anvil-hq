import { ChangeDetectionStrategy, Component, DestroyRef, inject, input, signal } from '@angular/core';

/** Most loads come straight from local files: placeholders only appear after this long. */
export const SKELETON_DELAY_MS = 300;

/**
 * Placeholder shapes while something loads: board columns or text lines. Screen readers hear
 * the label once, and nothing at all when the load is quick.
 */
@Component({
  selector: 'anv-skeleton',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (shown()) {
      <div role="status" class="frame" [class.board]="shape() === 'board'">
        <span class="sr-only">{{ label() }}</span>
        @if (shape() === 'board') {
          @for (column of columns; track $index) {
            <div class="column" aria-hidden="true">
              <span class="sk head"></span>
              @for (height of column; track $index) {
                <span class="sk" [style.height.px]="height"></span>
              }
            </div>
          }
        } @else {
          <span class="sk line wide" aria-hidden="true"></span>
          <span class="sk line" aria-hidden="true"></span>
          <span class="sk line short" aria-hidden="true"></span>
        }
      </div>
    }
  `,
  styleUrl: './skeleton.scss',
})
export class Skeleton {
  readonly shape = input<'board' | 'lines'>('lines');
  readonly label = input('Loading…');

  protected readonly columns = [[70, 56], [88], [56, 70], [64], [80, 56]];
  protected readonly shown = signal(false);

  constructor() {
    const timer = setTimeout(() => this.shown.set(true), SKELETON_DELAY_MS);
    inject(DestroyRef).onDestroy(() => clearTimeout(timer));
  }
}
