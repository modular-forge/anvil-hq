import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter, map } from 'rxjs';
import type { GitStatus } from '../../core/models';
import { SpaceStore } from '../../core/space-store';
import { Icon } from '../../shared/icon/icon';
import { Composer } from '../../shared/new-item/composer';
import { PaletteService } from '../../shared/palette/palette';

export interface Crumbs {
  parent: string | null;
  here: string;
}

/** Where the board is, from the URL path and the project names. */
export function crumbsFor(path: string, projectName: (id: string) => string | null): Crumbs {
  const clean = path.split(/[?#]/)[0] ?? '';
  if (clean === '/inbox') return { parent: null, here: 'Inbox' };
  if (clean === '/general') return { parent: null, here: 'General' };
  const project = /^\/projects\/([^/]+)/.exec(clean)?.[1];
  if (project) {
    const id = decodeURIComponent(project);
    return { parent: 'Projects', here: projectName(id) ?? id };
  }
  return { parent: null, here: 'Home' };
}

/** The backup pill: unpushed commits, or a missing remote. Null when there is nothing to say. */
export function backupLabel(git: GitStatus | null): string | null {
  if (!git) return null;
  if (!git.repository) return 'Not a git repository';
  if (!git.upstream) return 'No remote';
  return git.unpushed ? `${git.unpushed} not pushed` : null;
}

@Component({
  selector: 'anv-topbar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  templateUrl: './topbar.html',
  styleUrl: './topbar.scss',
})
export class Topbar {
  readonly #router = inject(Router);
  protected readonly store = inject(SpaceStore);
  protected readonly palette = inject(PaletteService);
  protected readonly composer = inject(Composer);

  readonly #url = toSignal(
    this.#router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
    ),
    { initialValue: this.#router.url },
  );

  protected readonly crumbs = computed(() => crumbsFor(this.#url(), (id) => this.store.project(id)?.name ?? null));
  protected readonly backup = computed(() => backupLabel(this.store.git()));
}
