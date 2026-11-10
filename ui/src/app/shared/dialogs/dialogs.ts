import { Injectable, signal } from '@angular/core';
import type { ItemSummary, Project } from '../../core/models';

/** The item a dialog is about. */
export interface DialogItem {
  id: string;
  title: string;
  kind: string;
}

export type DialogRequest =
  /** Moving to blocked or cancelled: a reason is required. */
  | { kind: 'reason'; status: 'blocked' | 'cancelled'; item: DialogItem }
  /** Moving to done: evidence is optional on the board. */
  | { kind: 'done'; item: DialogItem }
  /** Done refused: unchecked steps or open tasks. Answers with the id of a task to open. */
  | { kind: 'refused'; item: DialogItem; steps: string[]; children: ItemSummary[] }
  /** The last open task of a feature or bug was closed. */
  | { kind: 'close-parent'; parent: DialogItem }
  /** Skipping a step: a reason is required. */
  | { kind: 'skip'; step: string }
  /** Moving an item, and its tasks, to another project. Answers with the project id. */
  | { kind: 'move'; item: DialogItem; tasks: number; projects: Project[] }
  /** The item changed on disk. Answers "reload" or "discard". */
  | { kind: 'conflict'; id: string; lines: string[] };

/** What the user chose: text typed, a project or item id, or a button's value. Null: dismissed. */
export interface DialogAnswer {
  value: string;
}

interface Open {
  request: DialogRequest;
  resolve: (answer: DialogAnswer | null) => void;
}

/** Opens one dialog at a time; the DialogHost in the app shell shows it. */
@Injectable({ providedIn: 'root' })
export class Dialogs {
  readonly #open = signal<Open | null>(null);
  readonly current = this.#open.asReadonly();

  open(request: DialogRequest): Promise<DialogAnswer | null> {
    this.#open()?.resolve(null);
    return new Promise((resolve) => this.#open.set({ request, resolve }));
  }

  /** Called by the host when the user answers or dismisses. */
  close(answer: DialogAnswer | null): void {
    const open = this.#open();
    this.#open.set(null);
    open?.resolve(answer);
  }
}
