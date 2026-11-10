import { TestBed } from '@angular/core/testing';
import { DialogHost } from './dialog-host';
import { Dialogs } from './dialogs';

describe('DialogHost', () => {
  beforeAll(() => {
    // jsdom has no modal dialogs: open and close them as attributes.
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.open = true;
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
      this.open = false;
    };
  });

  async function render() {
    const fixture = TestBed.createComponent(DialogHost);
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement, dialogs: TestBed.inject(Dialogs) };
  }

  it('needs a reason before blocking, and answers with it', async () => {
    const { fixture, el, dialogs } = await render();
    const answer = dialogs.open({ kind: 'reason', status: 'blocked', item: { id: 'AB-1', title: 'T', kind: 'task' } });
    await fixture.whenStable();
    expect(el.querySelector('dialog')?.open).toBe(true);
    expect(el.querySelector('h2')?.textContent).toContain('Why is AB-1 blocked?');
    const submit = el.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(submit?.disabled).toBe(true);

    const field = el.querySelector<HTMLTextAreaElement>('textarea');
    if (field) {
      field.value = '  Waiting for the owner  ';
      field.dispatchEvent(new Event('input'));
    }
    await fixture.whenStable();
    expect(submit?.disabled).toBe(false);
    submit?.click();
    expect(await answer).toEqual({ value: 'Waiting for the owner' });
    await fixture.whenStable();
    expect(el.querySelector('dialog')?.open).toBe(false);
  });

  it('lets done be confirmed without evidence', async () => {
    const { fixture, el, dialogs } = await render();
    const answer = dialogs.open({ kind: 'done', item: { id: 'AB-1', title: 'T', kind: 'task' } });
    await fixture.whenStable();
    [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Skip')?.click();
    expect(await answer).toEqual({ value: '' });
  });

  it('shows the differences of a conflict and answers with the choice', async () => {
    const { fixture, el, dialogs } = await render();
    const answer = dialogs.open({ kind: 'conflict', id: 'AB-1', lines: ['- status: todo', '+ status: doing'] });
    await fixture.whenStable();
    expect(el.querySelector('.del')?.textContent).toBe('- status: todo');
    expect(el.querySelector('.add')?.textContent).toBe('+ status: doing');
    [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Reload')?.click();
    expect(await answer).toEqual({ value: 'reload' });
  });

  it('answers null when dismissed, and when another dialog replaces it', async () => {
    const { fixture, el, dialogs } = await render();
    const first = dialogs.open({ kind: 'skip', step: 'One' });
    const second = dialogs.open({ kind: 'skip', step: 'Two' });
    expect(await first).toBeNull();
    await fixture.whenStable();
    [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Cancel')?.click();
    expect(await second).toBeNull();
  });
});
