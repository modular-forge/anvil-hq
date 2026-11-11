import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { ForgeArt } from '../forge-art/forge-art';

/** An empty state: what is (not) here, and the one next step, projected as content. */
@Component({
  selector: 'anv-empty',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ForgeArt],
  template: `
    @if (art()) {
      <anv-forge-art [motion]="art() === 'tap' ? 'tap' : 'still'" [size]="120" />
    }
    <h2 class="display">{{ heading() }}</h2>
    <div class="text"><ng-content /></div>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      padding: 32px 16px;
      border: 1px dashed var(--line2);
      border-radius: var(--radius-l);
      color: var(--tx2);
      text-align: center;
    }

    h2 {
      margin: 0;
      color: var(--tx);
      font-size: 18px;
      font-weight: 700;
    }

    .text {
      max-width: 30rem;
      font-size: 14px;
      line-height: 1.5;
    }
  `,
})
export class Empty {
  readonly heading = input.required<string>();
  /** The anvil above the heading: still, or with its hammer tapping. */
  readonly art = input<'still' | 'tap' | null>(null);
}
