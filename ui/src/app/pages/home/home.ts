import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SpaceStore } from '../../core/space-store';
import { StatusCounts } from '../../shared/status-counts/status-counts';

/** Home: for now, every registered project with its counts. */
@Component({
  selector: 'anv-home',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, StatusCounts],
  template: `
    <h1 class="display">Home</h1>
    <ul class="cards">
      @for (project of projects(); track project.id) {
        <li>
          <a class="card" [routerLink]="['/projects', project.id]">
            <span class="card-title">{{ project.name }} <span class="mono">{{ project.prefix }} · {{ project.state }}</span></span>
            <anv-status-counts [counts]="project.counts" />
          </a>
        </li>
      }
    </ul>
    <p class="pending">Focus, recent activity and the backup status arrive with the next views.</p>
  `,
  styleUrl: '../page.scss',
})
export class HomePage {
  readonly #store = inject(SpaceStore);
  protected readonly projects = computed(() => this.#store.projects().filter((p) => !p.reserved));
}
