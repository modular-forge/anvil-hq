import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../../core/api';
import type { ItemSummary, Project } from '../../core/models';
import { SpaceStore } from '../../core/space-store';
import { STATUSES } from '../../core/statuses';
import { lastRelease } from '../../core/versions';
import { segments } from '../project/card/card-info';
import { STATE_GROUPS, groupProjects } from '../../shell/sidebar/sidebar';

const STATE_NAMES = new Map(STATE_GROUPS.map((g) => [g.state, g.label]));

/** Doing first, then blocked; each by project and id. */
export function nowItems(items: readonly ItemSummary[]): ItemSummary[] {
  const rank = (i: ItemSummary) => (i.fields.status === 'doing' ? 0 : 1);
  return items
    .filter((i) => !i.archived && (i.fields.status === 'doing' || i.fields.status === 'blocked'))
    .sort((a, b) => rank(a) - rank(b) || a.project.localeCompare(b.project) || Number(a.id.split('-')[1]) - Number(b.id.split('-')[1]));
}

/** Only https links leave the board. */
export function safeLink(url: string | undefined): string | null {
  return url && /^https:\/\//.test(url) ? url : null;
}

/** Home: what is in the fire across every project, the inbox, and every project by state. */
@Component({
  selector: 'anv-home',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class HomePage {
  readonly #api = inject(Api);
  protected readonly store = inject(SpaceStore);
  protected readonly statuses = STATUSES;
  protected readonly segments = segments;
  protected readonly safeLink = safeLink;

  readonly #items = signal<ItemSummary[]>([]);
  protected readonly showFinished = signal(false);

  protected readonly today = new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  protected readonly projects = computed(() => this.store.projects().filter((p) => !p.reserved));
  protected readonly now = computed(() => nowItems(this.#items()));
  protected readonly groups = computed(() => {
    const groups = groupProjects(this.projects());
    if (!this.showFinished()) return groups;
    const finished = (state: string, label: string) => ({ label, projects: this.projects().filter((p) => p.state === state) });
    return [...groups, finished('done', 'Done'), finished('cancelled', 'Cancelled')].filter((g) => g.projects.length > 0);
  });
  protected readonly finishedCounts = computed(() => ({
    done: this.projects().filter((p) => p.state === 'done').length,
    cancelled: this.projects().filter((p) => p.state === 'cancelled').length,
  }));

  constructor() {
    // Reload on every change on disk: the space's stamp changes with any file.
    effect(() => {
      this.store.space();
      untracked(() => void this.#load());
    });
  }

  protected projectOf(item: ItemSummary): Project | null {
    return this.store.project(item.project);
  }

  protected stateName(state: string | undefined): string {
    return STATE_NAMES.get(state ?? '') ?? state ?? '';
  }

  protected last(project: Project): string | null {
    return lastRelease(this.#items(), project.id);
  }

  async #load(): Promise<void> {
    try {
      this.#items.set(await this.#api.allItems());
    } catch {
      // The store reports the server as offline.
    }
  }
}
