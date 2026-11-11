import { Celebrations } from '../../shared/celebration/celebration';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, WriteError } from '../../core/api';
import type { ItemSummary, ReleaseResult } from '../../core/models';
import { SpaceStore } from '../../core/space-store';
import { compareVersions, lastRelease, suggestVersions } from '../../core/versions';
import { shortEvidence } from '../project/card/card-info';
import { Notices } from '../../shared/notices/notices';

const RELEASABLE: ReadonlySet<string> = new Set(['task', 'feature', 'bug']);

/** Done tasks, features and bugs: what a release can include. Decisions and ideas never are. */
export function releasable(items: readonly ItemSummary[]): ItemSummary[] {
  return items.filter((i) => !i.archived && i.fields.status === 'done' && RELEASABLE.has(i.fields.kind));
}

/**
 * Publish a release in three steps: the version, the done items it includes, and the notes the
 * server builds. One commit moves the chosen items to released.
 */
@Component({
  selector: 'anv-release',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink],
  templateUrl: './release.html',
  styleUrl: './release.scss',
})
export class ReleasePage {
  readonly #api = inject(Api);
  readonly #notices = inject(Notices);
  readonly #celebrations = inject(Celebrations);
  protected readonly store = inject(SpaceStore);

  /** From the route parameter. */
  readonly id = input.required<string>();

  protected readonly step = signal<1 | 2 | 3>(1);
  protected readonly version = signal('');
  protected readonly excluded = signal<ReadonlySet<string>>(new Set());
  protected readonly preview = signal<ReleaseResult | null>(null);
  protected readonly published = signal<ReleaseResult | null>(null);
  protected readonly busy = signal(false);
  readonly #items = signal<ItemSummary[]>([]);

  protected readonly project = computed(() => this.store.project(this.id()));
  protected readonly last = computed(() => lastRelease(this.#items(), this.id()));
  protected readonly suggestions = computed(() => suggestVersions(this.last()));
  protected readonly candidates = computed(() => releasable(this.#items()));
  protected readonly chosen = computed(() => this.candidates().filter((i) => !this.excluded().has(i.id)));
  protected readonly used = computed(() => new Set(this.#items().map((i) => i.fields.release).filter((r): r is string => !!r)));
  protected readonly versionProblem = computed(() => {
    const version = this.version().trim();
    if (!version) return 'A release needs a version.';
    if (this.used().has(version)) return `${version} is already released.`;
    const last = this.last();
    if (last && compareVersions(version, last) <= 0) return `It should be later than the last release, ${last}.`;
    return null;
  });
  protected readonly steps = ['Version', 'Items', 'Notes'] as const;
  protected readonly shortEvidence = shortEvidence;

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => void this.#load(id));
    });
  }

  protected toggle(id: string): void {
    this.excluded.update((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  protected async next(): Promise<void> {
    if (this.step() === 1 && !this.versionProblem()) {
      this.step.set(2);
    } else if (this.step() === 2 && this.chosen().length) {
      this.busy.set(true);
      try {
        this.preview.set(await this.#api.release(this.id(), this.version().trim(), [...this.excluded()], true));
        this.step.set(3);
      } catch (error) {
        this.#fail(error);
      } finally {
        this.busy.set(false);
      }
    }
  }

  protected back(): void {
    if (this.step() > 1) this.step.set((this.step() - 1) as 1 | 2);
  }

  protected async publish(): Promise<void> {
    this.busy.set(true);
    try {
      const result = await this.#api.release(this.id(), this.version().trim(), [...this.excluded()], false);
      this.published.set(result);
      this.#notices.say(`Released ${this.version().trim()}`);
      this.#celebrations.play({ kind: 'stamp', version: result.version });
    } catch (error) {
      this.#fail(error);
    } finally {
      this.busy.set(false);
    }
  }

  protected async copy(notes: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(notes);
      this.#notices.say('Release notes copied');
    } catch {
      this.#notices.fail('The browser did not allow copying; select the notes and copy them by hand.');
    }
  }

  async #load(id: string): Promise<void> {
    try {
      this.#items.set(await this.#api.items(id));
      const last = this.last();
      if (!this.version()) this.version.set(suggestVersions(last).find((s) => s.kind === 'minor')?.version ?? '');
    } catch {
      // The store reports the server as offline.
    }
  }

  #fail(error: unknown): void {
    this.#notices.fail(error instanceof WriteError ? error.message : 'Something went wrong; see the browser console.');
  }
}
