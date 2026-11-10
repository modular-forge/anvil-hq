import { ChangeDetectionStrategy, Component, type ElementRef, Injectable, Injector, afterNextRender, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Api } from '../../core/api';
import type { Project, SearchResult } from '../../core/models';
import { SpaceStore } from '../../core/space-store';
import { STATUSES } from '../../core/statuses';
import { ThemeService } from '../../core/theme';
import { Composer, projectInUrl } from '../new-item/composer';

const SEARCH_DELAY_MS = 150;
const MAX_PER_GROUP = 8;

export interface PaletteEntry {
  key: string;
  label: string;
  meta: string;
  icon: 'item' | 'project' | 'note' | 'action';
  /** A colour token for the icon: a status, or null for the default. */
  tone: string | null;
  shortcut?: string;
  run: () => void;
}

export interface PaletteGroup {
  name: string;
  entries: PaletteEntry[];
}

/** The project folder in a data space path (projects/<id>/…). */
export function projectOfFile(file: string): string {
  return file.split('/')[1] ?? '';
}

/** Projects whose name, id or prefix contains `query` (all of them when it is empty). */
export function matchProjects(projects: readonly Project[], query: string): Project[] {
  const q = query.trim().toLowerCase();
  return projects.filter((p) => !q || [p.name, p.id, p.prefix].some((value) => value.toLowerCase().includes(q)));
}

@Injectable({ providedIn: 'root' })
export class PaletteService {
  readonly #open = signal(false);
  readonly isOpen = this.#open.asReadonly();

  open(): void {
    this.#open.set(true);
  }

  close(): void {
    this.#open.set(false);
  }
}

/** Search items, projects and journal notes, or run a command. Ctrl K. */
@Component({
  selector: 'anv-palette',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  templateUrl: './palette.html',
  styleUrl: './palette.scss',
})
export class Palette {
  readonly #api = inject(Api);
  readonly #router = inject(Router);
  readonly #store = inject(SpaceStore);
  readonly #theme = inject(ThemeService);
  readonly #composer = inject(Composer);
  protected readonly palette = inject(PaletteService);

  protected readonly query = signal('');
  protected readonly archive = signal(false);
  protected readonly active = signal(0);
  readonly #found = signal<SearchResult | null>(null);
  #timer: ReturnType<typeof setTimeout> | undefined;

  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('dialog');
  private readonly input = viewChild<ElementRef<HTMLInputElement>>('input');
  readonly #injector = inject(Injector);

  protected readonly groups = computed<PaletteGroup[]>(() => {
    const query = this.query();
    const found = this.#found();
    const items = (found?.items ?? []).slice(0, MAX_PER_GROUP).map<PaletteEntry>((hit) => {
      const project = projectOfFile(hit.file);
      return {
        key: `item:${hit.id}`,
        label: `${hit.id} · ${hit.title}`,
        meta: [this.#store.project(project)?.name ?? project, STATUSES[hit.status]?.name ?? hit.status, hit.archived ? 'archived' : '']
          .filter(Boolean)
          .join(' · '),
        icon: 'item',
        tone: hit.archived ? null : hit.status,
        run: () => void this.#router.navigate(['/projects', project], { queryParams: { item: hit.id, view: null } }),
      };
    });
    const projects = matchProjects(this.#store.projects(), query).slice(0, MAX_PER_GROUP).map<PaletteEntry>((p) => ({
      key: `project:${p.id}`,
      label: p.name,
      meta: [p.prefix, p.state, p.kind].filter(Boolean).join(' · '),
      icon: 'project',
      tone: null,
      run: () => void this.#router.navigate(p.id === 'inbox' || p.id === 'general' ? [`/${p.id}`] : ['/projects', p.id]),
    }));
    const journal = (found?.journal ?? []).slice(0, 5).map<PaletteEntry>((hit) => {
      const project = projectOfFile(hit.file);
      return {
        key: `note:${hit.file}:${hit.line}`,
        label: hit.text,
        meta: `${this.#store.project(project)?.name ?? project} · ${hit.file.split('/').pop()?.replace(/\.md$/, '') ?? ''}`,
        icon: 'note',
        tone: null,
        run: () => void this.#router.navigate(['/projects', project], { queryParams: { view: 'journal', item: null } }),
      };
    });
    const actions = this.#actions().filter((a) => !query.trim() || a.label.toLowerCase().includes(query.trim().toLowerCase()));
    return [
      { name: 'Items', entries: items },
      { name: 'Projects', entries: projects },
      { name: 'Journal', entries: journal },
      { name: 'Actions', entries: actions },
    ].filter((group) => group.entries.length > 0);
  });

  protected readonly entries = computed(() => this.groups().flatMap((group) => group.entries));
  protected readonly activeKey = computed(() => this.entries()[this.active()]?.key ?? null);

  constructor() {
    effect(() => {
      const open = this.palette.isOpen();
      const dialog = this.dialog()?.nativeElement;
      if (!dialog) return;
      if (open && !dialog.open) {
        untracked(() => {
          this.query.set('');
          this.archive.set(false);
          this.#found.set(null);
          this.active.set(0);
        });
        dialog.showModal();
        // The input appears with the open state: give it the keyboard once it is there.
        afterNextRender(() => this.input()?.nativeElement.focus(), { injector: this.#injector });
      } else if (!open && dialog.open) {
        dialog.close();
      }
    });
    // Search as the user types, a moment after the last key.
    effect(() => {
      const query = this.query().trim();
      const archive = this.archive();
      clearTimeout(this.#timer);
      untracked(() => this.active.set(0));
      if (query.length < 2) {
        this.#found.set(null);
        return;
      }
      this.#timer = setTimeout(() => void this.#search(query, archive), SEARCH_DELAY_MS);
    });
  }

  protected keydown(event: KeyboardEvent): void {
    const count = this.entries().length;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (count) this.active.set((this.active() + (event.key === 'ArrowDown' ? 1 : count - 1)) % count);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const entry = this.entries()[this.active()];
      if (entry) this.choose(entry);
    }
  }

  protected choose(entry: PaletteEntry): void {
    this.palette.close();
    entry.run();
  }

  protected entryIndex(entry: PaletteEntry): number {
    return this.entries().indexOf(entry);
  }

  async #search(query: string, archive: boolean): Promise<void> {
    try {
      const found = await this.#api.search(query, archive);
      if (query === this.query().trim() && archive === this.archive()) this.#found.set(found);
    } catch {
      this.#found.set(null);
    }
  }

  #actions(): PaletteEntry[] {
    const current = projectInUrl(this.#router.url);
    const project = current ? this.#store.project(current) : null;
    const theme = this.#theme.theme() === 'dark' ? 'light' : 'dark';
    const actions: PaletteEntry[] = [
      { key: 'action:new', label: 'New item', meta: project ? `In ${project.name}` : 'In the inbox', icon: 'action', tone: null, shortcut: 'N', run: () => this.#composer.open() },
    ];
    if (project?.release === 'versioned') {
      actions.push({
        key: 'action:release', label: 'Publish release…', meta: project.name, icon: 'action', tone: null,
        run: () => void this.#router.navigate(['/projects', project.id, 'release']),
      });
    }
    actions.push(
      { key: 'action:home', label: 'Go to Home', meta: 'Everything in the fire', icon: 'action', tone: null, run: () => void this.#router.navigate(['/']) },
      { key: 'action:inbox', label: 'Go to Inbox', meta: `${this.#store.inboxOpen()} waiting`, icon: 'action', tone: null, run: () => void this.#router.navigate(['/inbox']) },
      { key: 'action:general', label: 'Go to General', meta: 'Decisions for every project', icon: 'action', tone: null, run: () => void this.#router.navigate(['/general']) },
      { key: 'action:theme', label: `Switch to the ${theme} theme`, meta: 'Appearance', icon: 'action', tone: null, run: () => this.#theme.set(theme) },
    );
    return actions;
  }
}
