import { TestBed } from '@angular/core/testing';
import { TOKEN_KEY } from '../../core/token';
import { Locked } from './locked';

describe('Locked', () => {
  afterEach(() => sessionStorage.clear());

  function render(): HTMLElement {
    const fixture = TestBed.createComponent(Locked);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('asks for the printed link when the tab has no token', () => {
    expect(render().querySelector('h1')?.textContent).toBe('Open the board from its link');
  });

  it('says the key expired when the server refuses the token the tab has', () => {
    sessionStorage.setItem(TOKEN_KEY, 'old-token');
    expect(render().querySelector('h1')?.textContent).toBe("This tab's key is no longer valid");
  });
});
