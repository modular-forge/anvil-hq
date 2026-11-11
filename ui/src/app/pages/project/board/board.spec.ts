import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Api } from '../../../core/api';
import type { ItemSummary, Space } from '../../../core/models';
import { SpaceStore } from '../../../core/space-store';
import { Dialogs } from '../../../shared/dialogs/dialogs';
import { project, space, summary } from '../../../testing';
import { NO_FILTERS, ProjectBoard } from '../project-board';
import { Board, emptyColumn } from './board';

describe('emptyColumn', () => {
  it('says how a card gets there, or that the filters hide everything', () => {
    expect(emptyColumn('blocked', false, false)).toEqual({ title: 'Nothing is stuck', hint: 'Drop a card here to block it' });
    expect(emptyColumn('blocked', false, true)).toEqual({ title: 'Nothing is stuck', hint: '' });
    expect(emptyColumn('todo', true, false).title).toBe('No cards match');
  });
});

describe('Board', () => {
  let items: ItemSummary[];
  const spaceSignal = signal<Space | null>(space());

  beforeEach(() => {
    items = [summary('AB-1', { status: 'todo' }), summary('AB-2', { status: 'todo' }), summary('AB-3', { status: 'doing' })];
    TestBed.configureTestingModule({
      providers: [
        ProjectBoard,
        { provide: Api, useValue: { items: () => Promise.resolve(items), item: () => Promise.reject(new Error('none')), history: () => Promise.resolve([]) } },
        { provide: SpaceStore, useValue: { space: spaceSignal, projects: signal([project({ id: 'alpha' })]), project: () => null } },
        { provide: Dialogs, useValue: { open: () => Promise.resolve(null), current: signal(null) } },
      ],
    });
  });

  async function render() {
    const board = TestBed.inject(ProjectBoard);
    board.projectId.set('alpha');
    await board.load();
    const fixture = TestBed.createComponent(Board);
    await fixture.whenStable();
    return { board, fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('walks the cards with J and K, in reading order', async () => {
    const { el } = await render();
    document.body.append(el);
    const card = (id: string) => el.querySelector<HTMLElement>(`[data-id="${id}"]`);
    card('AB-1')?.focus();
    const press = (key: string) => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    press('j');
    expect(document.activeElement).toBe(card('AB-2'));
    press('j');
    expect(document.activeElement).toBe(card('AB-3'));
    press('k');
    expect(document.activeElement).toBe(card('AB-2'));
    el.remove();
  });

  it('says why a column is empty, and when the filters hide every card', async () => {
    const { board, fixture, el } = await render();
    const blocked = el.querySelector('section[aria-label="Blocked"]');
    expect(blocked?.querySelector('.empty')?.textContent).toContain('Nothing is stuck');
    board.filters.set({ ...NO_FILTERS, kind: 'bug' });
    await fixture.whenStable();
    expect(el.querySelector('section[aria-label="Todo"] .empty')?.textContent).toContain('No cards match');
  });
});
