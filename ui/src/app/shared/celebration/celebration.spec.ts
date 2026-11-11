import { TestBed } from '@angular/core/testing';
import { CELEBRATION_MS, CelebrationHost, Celebrations } from './celebration';

describe('Celebrations', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('plays over the page, hidden from screen readers, and is gone after 1.2 s', () => {
    vi.useFakeTimers();
    const fixture = TestBed.createComponent(CelebrationHost);
    TestBed.inject(Celebrations).play({ kind: 'stamp', version: '1.4.0' });
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.stage')?.getAttribute('aria-hidden')).toBe('true');
    expect(el.querySelector('text')?.textContent).toBe('v1.4.0');
    vi.advanceTimersByTime(CELEBRATION_MS);
    fixture.detectChanges();
    expect(el.querySelector('.stage')).toBeNull();
  });

  it('plays nothing with reduced motion', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce') }));
    const celebrations = TestBed.inject(Celebrations);
    celebrations.play({ kind: 'forge', label: 'AL-7 forged' });
    expect(celebrations.current()).toBeNull();
  });
});
