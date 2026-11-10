import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Project } from '../../core/models';
import { SpaceStore } from '../../core/space-store';
import { ThemeService } from '../../core/theme';
import { project, space } from '../../testing';
import { Sidebar, groupProjects } from './sidebar';

describe('groupProjects', () => {
  it('groups registered projects by state, in order, by name, and leaves out done ones and empty groups', () => {
    const groups = groupProjects([
      project({ id: 'inbox', reserved: true }),
      project({ id: 'zeta', name: 'Zeta', state: 'active' }),
      project({ id: 'alpha', name: 'Alpha', state: 'active' }),
      project({ id: 'old', name: 'Old', state: 'paused' }),
      project({ id: 'idea', name: 'Idea', state: 'idea' }),
      project({ id: 'gone', name: 'Gone', state: 'done' }),
    ]);
    expect(groups.map((g) => [g.label, g.projects.map((p) => p.id)])).toEqual([
      ['Active', ['alpha', 'zeta']],
      ['Ideas', ['idea']],
      ['Paused', ['old']],
    ]);
  });
});

describe('Sidebar', () => {
  const projects = signal<Project[]>(space().projects);

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: SpaceStore,
          useValue: {
            projects,
            space: signal(space()),
            inboxOpen: signal(2),
          },
        },
      ],
    });
  });

  async function render() {
    const fixture = TestBed.createComponent(Sidebar);
    await fixture.whenStable();
    return fixture;
  }

  it('shows the fixed links, the open inbox count and the projects by group', async () => {
    const el = (await render()).nativeElement as HTMLElement;
    const nav = el.querySelector('nav[aria-label="Main"]');
    expect(nav).not.toBeNull();
    expect(el.querySelector('a[href="/inbox"]')?.textContent).toContain('2');
    const groups = [...el.querySelectorAll('section')].map((s) => s.getAttribute('aria-label'));
    expect(groups).toEqual(['Active', 'Paused']);
    const alpha = el.querySelector('a[href="/projects/alpha"]');
    expect(alpha?.textContent).toContain('AL');
    expect(alpha?.textContent).toContain('work in progress');
    expect(el.querySelector('a[href="/projects/gamma"]')).toBeNull();
    expect(el.textContent).toContain('/data/demo');
  });

  it('switches the theme with pressed buttons', async () => {
    const fixture = await render();
    const el = fixture.nativeElement as HTMLElement;
    const [dark, light] = [...el.querySelectorAll<HTMLButtonElement>('[aria-label="Theme"] button')];
    light?.click();
    await fixture.whenStable();
    expect(TestBed.inject(ThemeService).theme()).toBe('light');
    expect(document.documentElement.dataset['theme']).toBe('light');
    expect(light?.getAttribute('aria-pressed')).toBe('true');
    expect(dark?.getAttribute('aria-pressed')).toBe('false');
  });
});
