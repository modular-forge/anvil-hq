import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { App } from './app';
import type { LoadState } from './core/space-store';
import { SpaceStore } from './core/space-store';
import { ShortcutsService } from './shared/shortcuts/shortcuts';
import { git, space } from './testing';

describe('App', () => {
  const state = signal<LoadState>('ready');

  beforeEach(() => {
    const data = space();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'inbox', children: [] }]),
        {
          provide: SpaceStore,
          useValue: {
            state,
            start: vi.fn(() => Promise.resolve()),
            space: signal(data),
            git: signal(git()),
            projects: signal(data.projects),
            inboxOpen: signal(0),
            project: () => null,
          },
        },
      ],
    });
  });

  async function render(value: LoadState) {
    state.set(value);
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows the shell once the space is loaded', async () => {
    const el = await render('ready');
    expect(el.querySelector('nav[aria-label="Main"]')).not.toBeNull();
    expect(el.querySelector('main#main')).not.toBeNull();
    expect(TestBed.inject(SpaceStore).start).toHaveBeenCalled();
  });

  it('explains how to open the board without a valid token', async () => {
    const el = await render('unauthorized');
    expect(el.querySelector('nav')).toBeNull();
    expect(el.textContent).toContain('#token=');
  });

  it('says so when the server cannot be reached', async () => {
    const el = await render('offline');
    expect(el.querySelector('[role="status"]')?.textContent).toContain('anvil serve');
  });

  it('goes to the Inbox with G then I, and lists the shortcuts with ?', async () => {
    await render('ready');
    const press = (key: string) => document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    press('g');
    press('i');
    await vi.waitFor(() => expect(TestBed.inject(Router).url).toBe('/inbox'));
    press('?');
    expect(TestBed.inject(ShortcutsService).isOpen()).toBe(true);
  });
});
