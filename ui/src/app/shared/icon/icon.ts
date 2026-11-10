import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Stroke icons of the design (24×24 grid). Decorative: the control around them carries the name. */
export const ICONS = {
  home: 'M4 11l8-7 8 7v9h-5v-6H9v6H4z',
  inbox: 'M4 13l2-8h12l2 8M4 13v6h16v-6M4 13h5l1 2h4l1-2h5',
  general: 'M12 4v16M7 20h10M5 8h14M5 8l-3 6h6zM19 8l-3 6h6z',
  search: 'M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14M20 20l-4-4',
  plus: 'M12 5v14M5 12h14',
  push: 'M12 3v12M7 10l5 5 5-5M5 20h14',
  alert: 'M12 4l9 16H3zM12 10v4M12 17v.5',
} as const;

export type IconName = keyof typeof ICONS;

@Component({
  selector: 'anv-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      [attr.width]="size()"
      [attr.height]="size()"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      [attr.stroke-width]="strokeWidth()"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path [attr.d]="path()" />
    </svg>
  `,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
    }
  `,
})
export class Icon {
  readonly name = input.required<IconName>();
  readonly size = input(16);
  readonly strokeWidth = input(2);
  protected readonly path = computed(() => ICONS[this.name()]);
}
