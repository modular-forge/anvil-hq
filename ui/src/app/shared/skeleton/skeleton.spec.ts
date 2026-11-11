import { TestBed } from '@angular/core/testing';
import { SKELETON_DELAY_MS, Skeleton } from './skeleton';

describe('Skeleton', () => {
  afterEach(() => vi.useRealTimers());

  it('stays empty for quick loads, then shows the shapes and its label', () => {
    vi.useFakeTimers();
    const fixture = TestBed.createComponent(Skeleton);
    fixture.componentRef.setInput('shape', 'board');
    fixture.componentRef.setInput('label', 'Loading the board…');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[role="status"]')).toBeNull();
    vi.advanceTimersByTime(SKELETON_DELAY_MS);
    fixture.detectChanges();
    expect(el.querySelector('[role="status"]')?.textContent).toContain('Loading the board…');
    expect(el.querySelectorAll('.column').length).toBe(5);
  });
});
