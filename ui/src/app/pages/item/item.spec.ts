import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Api, type FieldChanges } from '../../core/api';
import type { ItemDetail, Space, WriteResult } from '../../core/models';
import { SpaceStore } from '../../core/space-store';
import { Dialogs } from '../../shared/dialogs/dialogs';
import { detail, project, space, step, summary } from '../../testing';
import { ItemPage, isWebLink, parseLabels } from './item';

describe('parseLabels', () => {
  it('splits on commas and spaces, dropping blanks and repeats', () => {
    expect(parseLabels(' ui, forms  ui,,api ')).toEqual(['ui', 'forms', 'api']);
    expect(parseLabels('  ')).toEqual([]);
  });
});

describe('isWebLink', () => {
  it('accepts only http and https addresses', () => {
    expect(isWebLink('https://example.com/issues/18')).toBe(true);
    expect(isWebLink('http://example.com')).toBe(true);
    expect(isWebLink('javascript:alert(1)')).toBe(false);
    expect(isWebLink('see the issue')).toBe(false);
  });
});

describe('ItemPage', () => {
  let patches: { id: string; changes: FieldChanges }[];
  let descriptions: { id: string; text: string }[];
  let current: ItemDetail;
  const spaceSignal = signal<Space | null>(space());

  beforeEach(() => {
    patches = [];
    descriptions = [];
    spaceSignal.set(space());
    current = detail(
      'AL-7',
      { kind: 'feature', status: 'doing', priority: 'high', labels: ['camera'], links: ['https://example.com/18', 'javascript:alert(1)'] },
      [step(1, 'Sketch it', true)],
      [summary('AL-8', { parent: 'AL-7', status: 'doing' }), summary('AL-9', { parent: 'AL-7', status: 'done', evidence: 'x' })],
    );
    current.body = 'Scan receipts. Amounts as in AL-8.';
    current.description = current.body;
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            item: () => Promise.resolve(current),
            history: () => Promise.resolve([{ hash: 'abc1234', date: '2026-11-01T10:00:00Z', subject: 'AL-7: todo → doing' }]),
            items: () => Promise.resolve([current, ...current.children]),
            setDescription: (item: { id: string }, text: string): Promise<WriteResult> => {
              descriptions.push({ id: item.id, text });
              return Promise.resolve({ message: 'ok', commit: null, item: null });
            },
            setFields: (item: { id: string }, changes: FieldChanges): Promise<WriteResult> => {
              patches.push({ id: item.id, changes });
              return Promise.resolve({ message: 'ok', commit: null, item: null });
            },
          },
        },
        {
          provide: SpaceStore,
          useValue: { space: spaceSignal, projects: signal([project({ id: 'alpha' })]), project: (id: string) => (id === 'alpha' ? project({ id: 'alpha', name: 'Alpha' }) : null) },
        },
        { provide: Dialogs, useValue: { open: () => Promise.resolve(null), current: signal(null) } },
      ],
    });
  });

  async function render() {
    const fixture = TestBed.createComponent(ItemPage);
    fixture.componentRef.setInput('id', 'AL-7');
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
    return fixture;
  }

  it('shows the item as an article with its properties beside it', async () => {
    const el = (await render()).nativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent).toContain('Item AL-7');
    expect(el.querySelector('.description')?.textContent).toContain('Scan receipts.');
    expect(el.querySelector<HTMLSelectElement>('#item-status')?.value).toBe('doing');
    expect(el.querySelector<HTMLSelectElement>('#item-priority')?.value).toBe('high');
    expect(el.querySelector<HTMLInputElement>('#item-labels')?.value).toBe('camera');
    expect(el.querySelector('.tasks')?.textContent).toContain('1 of 2 closed');
    expect(el.querySelector('.history')?.textContent).toContain('abc1234');
    // Only the web link becomes an anchor.
    expect([...el.querySelectorAll('a[target="_blank"]')].map((a) => a.getAttribute('href'))).toEqual(['https://example.com/18']);
    expect(el.textContent).toContain('javascript:alert(1)');
    // An open task keeps the feature from closing, and the page says so before anyone tries.
    expect(el.querySelector('[role="note"]')?.textContent).toContain('AL-8');
    expect(el.textContent).toContain('+ Add task to AL-7');
  });

  it('announces its sections one level below the title, without skipping a heading level', async () => {
    const el = (await render()).nativeElement as HTMLElement;
    const levels = [...el.querySelectorAll('h3')].map((h) => h.getAttribute('aria-level'));
    expect(levels.length).toBeGreaterThanOrEqual(4);
    expect(new Set(levels)).toEqual(new Set(['2']));
  });

  it('edits the title in place with E, and saves fields when they change', async () => {
    const fixture = await render();
    const el = fixture.nativeElement as HTMLElement;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e' }));
    await fixture.whenStable();
    const input = el.querySelector<HTMLInputElement>('#item-title');
    expect(input).not.toBeNull();
    if (!input) return;
    input.value = 'Receipt scanning';
    input.closest('form')?.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    expect(patches).toEqual([{ id: 'AL-7', changes: { title: 'Receipt scanning' } }]);

    const labels = el.querySelector<HTMLInputElement>('#item-labels');
    if (!labels) return;
    labels.value = 'camera, ocr';
    labels.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(patches.at(-1)).toEqual({ id: 'AL-7', changes: { labels: ['camera', 'ocr'] } });

    const priority = el.querySelector<HTMLSelectElement>('#item-priority');
    if (!priority) return;
    priority.value = '';
    priority.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(patches.at(-1)).toEqual({ id: 'AL-7', changes: { priority: null } });
  });

  it('offers no editing while the data space is read-only', async () => {
    spaceSignal.set(space({ readOnly: true }));
    const el = (await render()).nativeElement as HTMLElement;
    expect(el.querySelector('#title-button')).toBeNull();
    expect(el.querySelector<HTMLSelectElement>('#item-priority')?.disabled).toBe(true);
    expect(el.querySelector('.actions')).toBeNull();
  });

  it('edits the description in Markdown, saving with Ctrl Enter and cancelling with Escape', async () => {
    const fixture = await render();
    const el = fixture.nativeElement as HTMLElement;
    const editButton = () => el.querySelector<HTMLButtonElement>('.description .edit');
    editButton()?.click();
    await fixture.whenStable();
    const area = el.querySelector<HTMLTextAreaElement>('#desc-text');
    expect(area?.value).toBe('Scan receipts. Amounts as in AL-8.');
    if (!area) return;

    area.value = 'Changed';
    area.dispatchEvent(new Event('input'));
    area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await fixture.whenStable();
    expect(el.querySelector('#desc-text')).toBeNull();
    expect(descriptions).toEqual([]);

    editButton()?.click();
    await fixture.whenStable();
    const again = el.querySelector<HTMLTextAreaElement>('#desc-text');
    if (!again) return;
    again.value = '## Why\n\nPeople **never** type receipts.';
    again.dispatchEvent(new Event('input'));
    again.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    await fixture.whenStable();
    expect(descriptions).toEqual([{ id: 'AL-7', text: '## Why\n\nPeople **never** type receipts.' }]);
  });
});
