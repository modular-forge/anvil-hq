import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Api } from '../../core/api';
import type { Project } from '../../core/models';
import { SpaceStore } from '../../core/space-store';
import { project, space } from '../../testing';
import { HomePage } from './home';

describe('HomePage', () => {
  const projects = signal<Project[]>([]);

  beforeEach(() => {
    projects.set([
      project({ id: 'inbox', prefix: 'IN', name: 'Inbox', reserved: true, counts: { backlog: 9 } }),
      project({ id: 'alpha', name: 'Alpha', counts: { doing: 1, blocked: 2, todo: 3, backlog: 4, done: 5 } }),
      project({ id: 'beta', prefix: 'BE', name: 'Beta', state: 'paused' }),
    ]);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: Api, useValue: { allItems: () => Promise.resolve([]) } },
        {
          provide: SpaceStore,
          useValue: { space: signal(space()), projects, state: signal('ready'), git: signal(null), inboxOpen: signal(0), project: (id: string) => projects().find((p) => p.id === id) ?? null },
        },
      ],
    });
  });

  async function render(): Promise<HTMLElement> {
    const fixture = TestBed.createComponent(HomePage);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  /** The counts line of each project card, by project name. */
  function counts(el: HTMLElement): Record<string, string> {
    return Object.fromEntries(
      [...el.querySelectorAll('.project')].map((card) => [
        card.querySelector('.name')?.textContent?.trim() ?? '',
        [...card.querySelectorAll('.counts > span')].map((s) => s.textContent?.trim()).join(', '),
      ]),
    );
  }

  it('shows the open work of each project in board order: backlog, todo, doing and blocked', async () => {
    expect(counts(await render())).toEqual({
      Alpha: '4 backlog, 3 todo, 1 doing, 2 blocked',
      Beta: '0 backlog, 0 todo, 0 doing, 0 blocked',
    });
  });

  it('marks the blocked count only when something is blocked', async () => {
    const el = await render();
    expect([...el.querySelectorAll('.counts .alert')].map((s) => s.textContent?.trim())).toEqual(['2 blocked']);
  });
});
