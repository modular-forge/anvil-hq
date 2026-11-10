import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import type { Project } from '../../core/models';
import { SpaceStore } from '../../core/space-store';
import { ThemeService } from '../../core/theme';
import { Icon } from '../../shared/icon/icon';
import { Logo } from '../../shared/logo/logo';

/** Sidebar groups, in this order. Done and cancelled projects stay off the sidebar. */
export const STATE_GROUPS: readonly { state: string; label: string }[] = [
  { state: 'active', label: 'Active' },
  { state: 'design', label: 'Design' },
  { state: 'planning', label: 'Planning' },
  { state: 'idea', label: 'Ideas' },
  { state: 'paused', label: 'Paused' },
];

export interface ProjectGroup {
  label: string;
  projects: Project[];
}

/** Registered projects grouped by state, by name within a group; empty groups left out. */
export function groupProjects(projects: readonly Project[]): ProjectGroup[] {
  return STATE_GROUPS.map(({ state, label }) => ({
    label,
    projects: projects.filter((p) => !p.reserved && p.state === state).sort((a, b) => a.name.localeCompare(b.name)),
  })).filter((group) => group.projects.length > 0);
}

@Component({
  selector: 'anv-sidebar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive, Icon, Logo],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.scss',
})
export class Sidebar {
  protected readonly store = inject(SpaceStore);
  protected readonly theme = inject(ThemeService);
  protected readonly groups = computed(() => groupProjects(this.store.projects()));

  protected doing(project: Project): boolean {
    return (project.counts['doing'] ?? 0) > 0;
  }
}
