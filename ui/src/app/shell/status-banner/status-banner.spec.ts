import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Space } from '../../core/models';
import { SpaceStore, type LoadState } from '../../core/space-store';
import { space } from '../../testing';
import { StatusBanner } from './status-banner';

describe('StatusBanner', () => {
  const state = signal<LoadState>('ready');
  const data = signal<Space | null>(space());

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [{ provide: SpaceStore, useValue: { state, space: data } }] });
  });

  async function render(value: LoadState, overrides: Partial<Space> = {}) {
    state.set(value);
    data.set(space(overrides));
    const fixture = TestBed.createComponent(StatusBanner);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('says nothing while all is well', async () => {
    expect((await render('ready')).textContent?.trim()).toBe('');
  });

  it('says the server stopped, that the board retries, and how to start it', async () => {
    const el = await render('offline');
    expect(el.querySelector('h2')?.textContent).toBe('Lost the connection to anvil');
    expect(el.querySelector('code')?.textContent).toBe('anvil serve');
  });

  it('lists the first problems while the board is read-only', async () => {
    const problems = Array.from({ length: 7 }, (_, i) => ({ file: `projects/alpha/items/AL-${i + 1}.md`, message: 'status "blocked" needs a reason' }));
    const el = await render('ready', { readOnly: true, problems, problemCount: 7 });
    expect(el.querySelector('h2')?.textContent).toBe('7 problems break the format');
    expect(el.querySelectorAll('.problems li').length).toBe(5);
    expect(el.textContent).toContain('anvil validate');
  });
});
