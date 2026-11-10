import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * The anvil mark of the sidebar: the flame always flickers; the hammer strikes and sparks fly
 * while the link around it is hovered or focused (the link carries the `logo-link` class).
 */
@Component({
  selector: 'anv-logo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './logo.html',
  styleUrl: './logo.scss',
})
export class Logo {}
