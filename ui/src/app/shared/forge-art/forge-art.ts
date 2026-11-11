import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The anvil and its hammer, drawn for empty states and celebrations. Decorative: whatever sits
 * next to it says what happened. `tap` taps the anvil slowly, forever (empty states); `strike`
 * strikes once and makes sparks rain (a feature forged). With reduced motion it stays still.
 */
@Component({
  selector: 'anv-forge-art',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg [attr.width]="size()" [attr.height]="size() * 0.75" viewBox="0 0 200 150" aria-hidden="true" [class]="motion()">
      @if (flame()) {
        <path class="flame" d="M112 60C84 52 76 32 90 12C90 28 98 32 102 36C96 18 106 4 120 0C114 14 126 22 124 38C130 32 136 26 134 14C150 32 144 52 118 60Z" />
      }
      <path
        class="body"
        d="M8 63C22 58 34 57 46 57L172 57L172 74L160 76C150 77 142 82 138 90C134 100 134 110 142 118L158 126L158 138L126 138C122 130 98 130 94 138L62 138L62 126L78 118C86 110 86 100 82 90C78 82 70 77 58 76C40 75 22 70 8 63Z"
      />
      <path class="edge" d="M50 58.5H170" />
      @if (motion() !== 'still') {
        <g class="hammer">
          <g transform="rotate(-32 124 44)">
            <rect class="head" x="109" y="36" width="28" height="16" rx="2.5" />
            <rect class="handle" x="136" y="40.5" width="56" height="7" rx="3.5" />
          </g>
        </g>
      }
      @if (motion() === 'strike') {
        <path class="spark" d="M104 52l-3-2" style="--dx: -48px; --dy: -34px" />
        <path class="spark" d="M108 50l-1-3" style="--dx: -10px; --dy: -52px" />
        <path class="spark" d="M112 52l2-2" style="--dx: 40px; --dy: -38px" />
        <path class="spark" d="M106 53l-3 0" style="--dx: -62px; --dy: -8px" />
        <path class="spark" d="M114 53l3 0" style="--dx: 58px; --dy: -12px" />
      }
    </svg>
  `,
  styleUrl: './forge-art.scss',
})
export class ForgeArt {
  readonly motion = input<'still' | 'tap' | 'strike'>('still');
  readonly flame = input(false);
  readonly size = input(150);
}
