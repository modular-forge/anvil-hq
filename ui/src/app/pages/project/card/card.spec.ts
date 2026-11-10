import { TestBed } from '@angular/core/testing';
import { step, summary } from '../../../testing';
import { Card } from './card';

describe('Card', () => {
  async function render(movable = true) {
    const fixture = TestBed.createComponent(Card);
    fixture.componentRef.setInput('item', summary('AB-2', { parent: 'AB-1', priority: 'high', labels: ['ui'] }, [step(1, 'One', true), step(2, 'Two')]));
    fixture.componentRef.setInput('parentTitle', 'The feature');
    fixture.componentRef.setInput('movable', movable);
    await fixture.whenStable();
    const button = (fixture.nativeElement as HTMLElement).querySelector('button') as HTMLButtonElement;
    return { fixture, button };
  }

  it('shows the id, title, parent, priority, steps and labels', async () => {
    const { button } = await render();
    const text = button.textContent ?? '';
    for (const part of ['AB-2', 'Item AB-2', 'AB-1', 'The feature', 'high', '1/2', 'ui']) expect(text).toContain(part);
    expect(button.getAttribute('data-id')).toBe('AB-2');
    expect(button.draggable).toBe(true);
  });

  it('asks to move one column with Shift and the arrows, and opens on click', async () => {
    const { fixture, button } = await render();
    const steps: number[] = [];
    let opened = 0;
    fixture.componentInstance.step.subscribe((delta) => steps.push(delta));
    fixture.componentInstance.opened.subscribe(() => opened++);
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true }));
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true }));
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    button.click();
    expect(steps).toEqual([1, -1]);
    expect(opened).toBe(1);
  });

  it('cannot be moved while the board is read-only', async () => {
    const { fixture, button } = await render(false);
    const steps: number[] = [];
    fixture.componentInstance.step.subscribe((delta) => steps.push(delta));
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true }));
    expect(steps).toEqual([]);
    expect(button.draggable).toBe(false);
  });
});
