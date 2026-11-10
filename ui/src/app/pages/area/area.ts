import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { SpaceStore } from '../../core/space-store';
import { StatusCounts } from '../../shared/status-counts/status-counts';

const SUMMARIES: Readonly<Record<string, string>> = {
  inbox: 'Ideas and notes that do not belong to a project yet.',
  general: 'Work that spans projects: tooling, accounts, learning.',
};

/** Inbox or General, from the route data. */
@Component({
  selector: 'anv-area',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [StatusCounts],
  template: `
    @if (project(); as project) {
      <h1 class="display">{{ project.name }}</h1>
      <p class="summary">{{ summary() }}</p>
      <anv-status-counts [counts]="project.counts" />
      <p class="pending">The list of items arrives with the next views.</p>
    }
  `,
  styleUrl: '../page.scss',
})
export class AreaPage {
  readonly #store = inject(SpaceStore);
  /** From the route's data. */
  readonly area = input.required<string>();
  protected readonly project = computed(() => this.#store.project(this.area()));
  protected readonly summary = computed(() => SUMMARIES[this.area()] ?? '');
}
