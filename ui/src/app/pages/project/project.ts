import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { SpaceStore } from '../../core/space-store';
import { StatusCounts } from '../../shared/status-counts/status-counts';

/** A project's page; the board itself arrives in the next step. */
@Component({
  selector: 'anv-project',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [StatusCounts],
  template: `
    @if (project(); as project) {
      <h1 class="display">{{ project.name }}</h1>
      @if (project.summary) {
        <p class="summary">{{ project.summary }}</p>
      }
      <anv-status-counts [counts]="project.counts" />
      <p class="pending">The board of {{ project.prefix }} items arrives in the next step.</p>
    } @else if (store.state() === 'ready') {
      <h1 class="display">Unknown project</h1>
      <p class="summary">There is no project "{{ id() }}" in this data space.</p>
    }
  `,
  styleUrl: '../page.scss',
})
export class ProjectPage {
  protected readonly store = inject(SpaceStore);
  /** From the route parameter. */
  readonly id = input.required<string>();
  protected readonly project = computed(() => this.store.project(this.id()));
}
