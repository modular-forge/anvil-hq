import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { WriteError } from '../../core/api';
import type { GitStatus } from '../../core/models';
import { SpaceStore } from '../../core/space-store';
import { Notices } from '../../shared/notices/notices';
import { git } from '../../testing';
import { Topbar, backupDetails, backupLabel, canPush, crumbsFor } from './topbar';

describe('crumbsFor', () => {
  const names = (id: string) => (id === 'alpha' ? 'Alpha site' : null);

  it('names each place of the board', () => {
    expect(crumbsFor('/', names)).toEqual({ parent: null, here: 'Home' });
    expect(crumbsFor('/inbox', names)).toEqual({ parent: null, here: 'Inbox' });
    expect(crumbsFor('/general?x=1', names)).toEqual({ parent: null, here: 'General' });
    expect(crumbsFor('/projects/alpha', names)).toEqual({ parent: 'Projects', here: 'Alpha site' });
    expect(crumbsFor('/projects/unknown', names)).toEqual({ parent: 'Projects', here: 'unknown' });
    const prefixes = (prefix: string) => (prefix === 'AL' ? 'Alpha site' : null);
    expect(crumbsFor('/items/AL-7', names, prefixes)).toEqual({ parent: 'Alpha site', here: 'AL-7' });
    expect(crumbsFor('/items/ZZ-1', names, prefixes)).toEqual({ parent: 'Items', here: 'ZZ-1' });
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

describe('backupDetails', () => {
  it('says how far behind the only copy is, and what to do', () => {
    expect(backupDetails(git({ unpushed: 12, oldestUnpushed: '2026-11-03T09:00:00+01:00', stale: true }))).toEqual({
      title: '12 commits not pushed',
      text: 'Their only copy is on this machine; the oldest is from 2026-11-03. Push the data space to back it up.',
    });
    expect(backupDetails(git({ upstream: false, unpushed: null })).title).toBe('No remote');
  });
});

describe('canPush', () => {
  it('needs an upstream and something to send', () => {
    expect(canPush(null)).toBe(false);
    expect(canPush(git())).toBe(false);
    expect(canPush(git({ unpushed: 2 }))).toBe(true);
    expect(canPush(git({ upstream: false, unpushed: null }))).toBe(false);
    expect(canPush(git({ repository: false, unpushed: 2 }))).toBe(false);
  });
});

describe('Topbar', () => {
  const status = signal<GitStatus | null>(git({ unpushed: 2 }));
  let pushes: number;
  let pushReply: () => Promise<number>;

  beforeEach(() => {
    pushes = 0;
    pushReply = () => {
      status.set(git());
      return Promise.resolve(2);
    };
    status.set(git({ unpushed: 2 }));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'projects/:id', children: [] }]),
        {
          provide: SpaceStore,
          useValue: {
            git: status,
            space: signal({ dir: '/data/demo' }),
            project: (id: string) => (id === 'alpha' ? { name: 'Alpha site' } : null),
            projects: signal([]),
            push: () => {
              pushes++;
              return pushReply();
            },
          },
        },
      ],
    });
  });

  async function render() {
    const fixture = TestBed.createComponent(Topbar);
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('shows where the board is and the unpushed commits', async () => {
    const fixture = TestBed.createComponent(Topbar);
    await TestBed.inject(Router).navigateByUrl('/projects/alpha');
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.crumbs')?.textContent).toContain('Projects');
    expect(el.querySelector('.here')?.textContent).toBe('Alpha site');
    expect(el.querySelector('button.backup')?.textContent).toContain('2 not pushed');
    expect(el.querySelector('button.backup.stale')).toBeNull();
  });

  it('opens the details of a stale backup, and pushes when asked', async () => {
    status.set(git({ unpushed: 11, stale: true }));
    const { fixture, el } = await render();
    const pill = el.querySelector<HTMLButtonElement>('button.backup.stale');
    expect(pill?.getAttribute('aria-expanded')).toBe('false');
    pill?.click();
    await fixture.whenStable();
    expect(pill?.getAttribute('aria-expanded')).toBe('true');
    expect(el.querySelector('#backup-panel')?.textContent).toContain('11 commits not pushed');
    expect(pushes).toBe(0);

    el.querySelector('#backup-panel')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await fixture.whenStable();
    expect(el.querySelector('#backup-panel')).toBeNull();
    pill?.click();
    await fixture.whenStable();

    el.querySelector<HTMLButtonElement>('#backup-panel button.push')?.click();
    await fixture.whenStable();
    expect(pushes).toBe(1);
    expect(el.querySelector('#backup-panel')).toBeNull();
    expect(el.querySelector('button.backup')).toBeNull();
    expect(TestBed.inject(Notices).message()).toBe('Pushed 2 commits');
  });

  it('keeps the panel open with the reason when the push is refused', async () => {
    pushReply = () => Promise.reject(new WriteError('the remote has commits this copy does not have', 409));
    const { fixture, el } = await render();
    el.querySelector<HTMLButtonElement>('button.backup')?.click();
    await fixture.whenStable();
    el.querySelector<HTMLButtonElement>('button.push')?.click();
    await fixture.whenStable();
    expect(el.querySelector('#backup-panel [role="alert"]')?.textContent).toContain('the remote has commits');
    expect(el.querySelector<HTMLButtonElement>('button.push')?.disabled).toBe(false);
  });

  it('offers no push without a remote', async () => {
    status.set(git({ upstream: false, unpushed: null, stale: true }));
    const { fixture, el } = await render();
    el.querySelector<HTMLButtonElement>('button.backup')?.click();
    await fixture.whenStable();
    expect(el.querySelector('#backup-panel')?.textContent).toContain('Add a private remote');
    expect(el.querySelector('button.push')).toBeNull();
  });
});
