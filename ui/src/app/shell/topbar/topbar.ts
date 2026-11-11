import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
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

/**
 * Where the board is, from the URL path and the project names. An item page sits under its
 * project, found from the id's prefix.
 */
export function crumbsFor(path: string, projectName: (id: string) => string | null, prefixName: (prefix: string) => string | null = () => null): Crumbs {
  const clean = path.split(/[?#]/)[0] ?? '';
  if (clean === '/inbox') return { parent: null, here: 'Inbox' };
  if (clean === '/general') return { parent: null, here: 'General' };
  const item = /^\/items\/([^/]+)/.exec(clean)?.[1];
  if (item) {
    const id = decodeURIComponent(item);
    return { parent: prefixName(id.split('-')[0] ?? '') ?? 'Items', here: id };
  }
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

/** What the open backup warning says: how far behind the only copy is. */
export function backupDetails(git: GitStatus): { title: string; text: string } {
  if (!git.repository) return { title: 'Not a git repository', text: 'The data space is not under git, so nothing keeps its history or a copy. Run git init in it, then add a private remote.' };
  if (!git.upstream) return { title: 'No remote', text: 'The data space has no remote to push to, so its only copy is on this machine. Add a private remote and push.' };
  const count = git.unpushed ?? 0;
  const since = git.oldestUnpushed ? `; the oldest is from ${git.oldestUnpushed.slice(0, 10)}` : '';
  return {
    title: `${count} ${count === 1 ? 'commit' : 'commits'} not pushed`,
    text: `Their only copy is on this machine${since}. Push the data space to back it up.`,
  };
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

  protected readonly crumbs = computed(() =>
    crumbsFor(
      this.#url(),
      (id) => this.store.project(id)?.name ?? null,
      (prefix) => this.store.projects().find((p) => p.prefix === prefix)?.name ?? null,
    ),
  );
  protected readonly backup = computed(() => backupLabel(this.store.git()));
  protected readonly backupOpen = signal(false);
  readonly #details = computed(() => {
    const git = this.store.git();
    return git ? backupDetails(git) : { title: '', text: '' };
  });
  protected readonly backupTitle = computed(() => this.#details().title);
  protected readonly backupText = computed(() => this.#details().text);

  protected closeBackup(event: Event): void {
    if (!this.backupOpen()) return;
    event.stopPropagation();
    this.backupOpen.set(false);
  }
}
