import { DOCUMENT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { THEME_KEY, ThemeService } from './theme';

describe('ThemeService', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset['theme'];
  });

  it('follows the system until a theme is chosen', () => {
    const theme = TestBed.inject(ThemeService);
    expect(theme.theme()).toBe(window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    expect(TestBed.inject(DOCUMENT).documentElement.dataset['theme']).toBeUndefined();
  });

  it('applies and remembers a choice', () => {
    const theme = TestBed.inject(ThemeService);
    theme.set('light');
    expect(theme.theme()).toBe('light');
    expect(document.documentElement.dataset['theme']).toBe('light');
    expect(localStorage.getItem(THEME_KEY)).toBe('light');
  });

  it('starts from a stored choice', () => {
    localStorage.setItem(THEME_KEY, 'light');
    const theme = TestBed.inject(ThemeService);
    expect(theme.theme()).toBe('light');
    expect(document.documentElement.dataset['theme']).toBe('light');
  });

  it('ignores a stored value it does not know', () => {
    localStorage.setItem(THEME_KEY, 'purple');
    expect(TestBed.inject(ThemeService).theme()).not.toBe('purple');
  });
});
