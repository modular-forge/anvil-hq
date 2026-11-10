import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SpaceStore } from './core/space-store';
import { Locked } from './shell/locked/locked';
import { Sidebar } from './shell/sidebar/sidebar';
import { Topbar } from './shell/topbar/topbar';

@Component({
  selector: 'anv-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, Sidebar, Topbar, Locked],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly store = inject(SpaceStore);

  constructor() {
    void this.store.start();
  }
}
