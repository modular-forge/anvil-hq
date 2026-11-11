import { TestBed } from '@angular/core/testing';
import { bodyBlocks } from '../../core/item-text';
import { Markdown } from './markdown';

describe('Markdown', () => {
  async function render(body: string, linkMentions = true) {
    const fixture = TestBed.createComponent(Markdown);
    fixture.componentRef.setInput('blocks', bodyBlocks(body, (id) => id === 'AB-1'));
    fixture.componentRef.setInput('linkMentions', linkMentions);
    await fixture.whenStable();
    return fixture;
  }

  it('renders the Markdown subset as elements, headings from h4', async () => {
    const el = (await render('# Title\n\nSome **bold**, *soft* and `code`, see [docs](https://example.com).\n\n1. one\n2. two\n')).nativeElement as HTMLElement;
    expect(el.querySelector('h4')?.textContent).toBe('Title');
    expect(el.querySelector('strong')?.textContent).toBe('bold');
    expect(el.querySelector('em')?.textContent).toBe('soft');
    expect(el.querySelector('p code')?.textContent).toBe('code');
    const link = el.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://example.com');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(el.querySelectorAll('ol li').length).toBe(2);
  });

  it('shows HTML in a body as text: nothing in it runs or becomes an element', async () => {
    const el = (await render('<img src=x onerror="alert(1)"> and <script>alert(2)</script>\n\n```\n<b>raw</b>\n```')).nativeElement as HTMLElement;
    expect(el.querySelector('img, script, b')).toBeNull();
    expect(el.querySelector('p')?.textContent).toContain('<img src=x onerror="alert(1)">');
    expect(el.querySelector('pre')?.textContent).toBe('<b>raw</b>');
  });

  it('turns mentions into buttons that report the id, or plain text when asked', async () => {
    const fixture = await render('Follows AB-1.');
    const opened: string[] = [];
    fixture.componentInstance.mention.subscribe((id) => opened.push(id));
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('button.mention')?.click();
    expect(opened).toEqual(['AB-1']);
    const plain = (await render('Follows AB-1.', false)).nativeElement as HTMLElement;
    expect(plain.querySelector('button')).toBeNull();
    expect(plain.textContent).toContain('AB-1');
  });
});
