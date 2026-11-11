import { TestBed } from '@angular/core/testing';
import { Motion } from './motion';

function setTransition(value: unknown): void {
  Object.defineProperty(document, 'startViewTransition', { value, configurable: true, writable: true });
}

describe('Motion', () => {
  afterEach(() => {
    Reflect.deleteProperty(document, 'startViewTransition');
    vi.unstubAllGlobals();
  });

  it('just applies the change where view transitions are missing', async () => {
    const update = vi.fn();
    await TestBed.inject(Motion).transition(update);
    expect(update).toHaveBeenCalledOnce();
  });

  it('applies the change inside a view transition when there is one', async () => {
    const start = vi.fn((callback: () => Promise<void>) => {
      const done = callback();
      return { updateCallbackDone: done, finished: done };
    });
    setTransition(start);
    const update = vi.fn();
    await TestBed.inject(Motion).transition(update);
    expect(start).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledOnce();
  });

  it('skips the transition with reduced motion', async () => {
    const start = vi.fn();
    setTransition(start);
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const update = vi.fn();
    await TestBed.inject(Motion).share(document.body, '.panel', update);
    expect(start).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledOnce();
  });
});
