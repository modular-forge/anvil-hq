import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const ROOT = resolve(import.meta.dirname, '..', '..');

/** The board's address with its token, as `anvil serve` printed it. */
function boardUrl(): string {
  const url = process.env['ANVIL_E2E_URL'];
  if (!url) throw new Error('ANVIL_E2E_URL is not set: run through playwright.config.ts');
  return url;
}

/** Runs the anvil CLI on the test's data space, like a Claude session or the user would. */
function anvil(...args: string[]): void {
  execFileSync(process.execPath, [join(ROOT, 'bin', 'anvil.ts'), ...args, '--data', process.env['ANVIL_E2E_DATA'] ?? ''], { stdio: 'ignore' });
}

test('stays locked without the token', async ({ page }) => {
  await page.goto(new URL('/', boardUrl()).href);
  await expect(page.getByRole('heading', { name: 'Open the board from its link' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
});

test('opens with the token, then hides it from the address bar', async ({ page }) => {
  await page.goto(boardUrl());
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link', { name: /Bakery site/ })).toBeVisible();
  await expect(nav.getByRole('region', { name: 'Paused' }).getByRole('link', { name: /Home lab/ })).toBeVisible();
  expect(page.url()).not.toContain('token');

  // A reload keeps working: the token lives in sessionStorage now.
  await page.reload();
  await expect(nav.getByRole('link', { name: /Pocket Budget/ })).toBeVisible();
});

test('moves between pages and keeps the theme choice', async ({ page }) => {
  await page.goto(boardUrl());
  const nav = page.getByRole('navigation', { name: 'Main' });
  await nav.getByRole('link', { name: /Pocket Budget/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Pocket Budget' })).toBeVisible();
  await expect(nav.getByRole('link', { name: /Pocket Budget/ })).toHaveAttribute('aria-current', 'page');

  await page.getByRole('button', { name: 'Light' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('button', { name: 'Light' })).toHaveAttribute('aria-pressed', 'true');
});

test('shows changes made outside the board without a reload', async ({ page }) => {
  await page.goto(boardUrl());
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /Home lab/ }).click();
  const doing = page.getByRole('region', { name: 'Doing' }).locator('[data-id="HL-1"]');
  await expect(page.getByRole('region', { name: 'Todo' }).locator('[data-id="HL-1"]')).toBeVisible();

  anvil('item', 'status', 'HL-1', 'doing');
  await expect(doing).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'No remote' })).toBeVisible();
});
