import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import type { GitStatus } from '../../core/models';
import { SpaceStore } from '../../core/space-store';
import { git } from '../../testing';
import { Topbar, backupLabel, crumbsFor } from './topbar';

describe('crumbsFor', () => {
  const names = (id: string) => (id === 'alpha' ? 'Alpha site' : null);

  it('names each place of the board', () => {
    expect(crumbsFor('/', names)).toEqual({ parent: null, here: 'Home' });
    expect(crumbsFor('/inbox', names)).toEqual({ parent: null, here: 'Inbox' });
    expect(crumbsFor('/general?x=1', names)).toEqual({ parent: null, here: 'General' });
    expect(crumbsFor('/projects/alpha', names)).toEqual({ parent: 'Projects', here: 'Alpha site' });
    expect(crumbsFor('/projects/unknown', names)).toEqual({ parent: 'Projects', here: 'unknown' });
  });
});

describe('backupLabel', () => {
  it('speaks only when the backup needs attention', () => {
    expect(backupLabel(null)).toBeNull();
    expect(backupLabel(git())).toBeNull();
    expect(backupLabel(git({ unpushed: 3 }))).toBe('3 not pushed');
    expect(backupLabel(git({ upstream: false, unpushed: null }))).toBe('No remote');
    expect(backupLabel(git({ repository: false }))).toBe('Not a git repository');
  });
});

describe('Topbar', () => {
  const status = signal<GitStatus | null>(git({ unpushed: 2 }));

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'projects/:id', children: [] }]),
        { provide: SpaceStore, useValue: { git: status, project: (id: string) => (id === 'alpha' ? { name: 'Alpha site' } : null) } },
      ],
    });
  });

  it('shows where the board is and the unpushed commits', async () => {
    const fixture = TestBed.createComponent(Topbar);
    await TestBed.inject(Router).navigateByUrl('/projects/alpha');
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.crumbs')?.textContent).toContain('Projects');
    expect(el.querySelector('.here')?.textContent).toBe('Alpha site');
    expect(el.querySelector('[role="status"]')?.textContent).toContain('2 not pushed');
  });
});
