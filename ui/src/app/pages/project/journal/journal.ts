import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, WriteError } from '../../../core/api';
import { mentions } from '../../../core/item-text';
import { SpaceStore } from '../../../core/space-store';
import { Notices } from '../../../shared/notices/notices';
import { ProjectBoard } from '../project-board';
import { dayLabel, localDate, parseNote, type JournalDay } from './journal-notes';

/** How many of the latest notes the tab shows. */
const DAYS = 14;

/** A project's journal: today's note to write in, and the latest days to read. */
@Component({
  selector: 'anv-journal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  templateUrl: './journal.html',
  styleUrl: './journal.scss',
})
export class Journal {
  readonly #api = inject(Api);
  readonly #notices = inject(Notices);
  protected readonly store = inject(SpaceStore);
  protected readonly board = inject(ProjectBoard);

  readonly project = input.required<string>();
  protected readonly draft = signal('');
  protected readonly saving = signal(false);
  protected readonly days = signal<JournalDay[]>([]);
  protected readonly today = localDate(new Date());
  readonly #now = new Date();

  protected readonly readOnly = computed(() => this.store.space()?.readOnly ?? true);

  constructor() {
    effect(() => {
      const project = this.project();
      this.store.space();
      untracked(() => void this.#load(project));
    });
  }

  protected label(date: string): string {
    return dayLabel(date, this.#now);
  }

  protected parts(text: string) {
    return mentions(text, (id) => this.board.byId().has(id));
  }

  protected keydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void this.add();
    }
  }

  async add(): Promise<void> {
    const text = this.draft().trim();
    if (!text || this.saving() || this.readOnly()) return;
    this.saving.set(true);
    try {
      await this.#api.addJournal(this.project(), text);
      this.draft.set('');
      this.#notices.say('Note added to the journal');
      await this.#load(this.project());
    } catch (error) {
      this.#notices.fail(error instanceof WriteError ? error.message : 'The note could not be saved.');
    } finally {
      this.saving.set(false);
    }
  }

  async #load(project: string): Promise<void> {
    try {
      const notes = (await this.#api.journal(project)).slice(0, DAYS);
      const texts = await Promise.all(notes.map((n) => this.#api.journalNote(project, n.date)));
      if (project === this.project()) this.days.set(texts.map((n) => ({ date: n.date, entries: parseNote(n.text) })));
    } catch {
      // The store reports the server as offline.
    }
  }
}
