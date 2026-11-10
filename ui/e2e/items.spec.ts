import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

// These tests change the shared copy of examples/ in order, like a person working through the
// board: each one leaves the data as the next one expects it.
test.describe.configure({ mode: 'serial' });

const ROOT = resolve(import.meta.dirname, '..', '..');
const DATA = () => process.env['ANVIL_E2E_DATA'] ?? '';

function item(project: string, id: string): string {
  return readFileSync(join(DATA(), 'projects', project, 'items', `${id}.md`), 'utf8');
}

function anvil(...args: string[]): void {
  execFileSync(process.execPath, [join(ROOT, 'bin', 'anvil.ts'), ...args, '--data', DATA()], { stdio: 'ignore' });
}

async function openProject(page: Page, name: RegExp): Promise<void> {
  await page.goto(process.env['ANVIL_E2E_URL'] ?? '');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name }).click();
}

const card = (page: Page, id: string) => page.locator(`[data-id="${id}"]`);
const column = (page: Page, name: string) => page.getByRole('region', { name });

test('opens an item in the panel and closes it with Escape, back on its card', async ({ page }) => {
  await openProject(page, /Bakery site/);
  await card(page, 'BS-3').click();
  const panel = page.getByRole('complementary');
  await expect(panel.getByRole('heading', { level: 2 })).toHaveText('Send orders by email: one message per order');
  await expect(panel.getByLabel('Status')).toHaveValue('doing');
  await expect(page).toHaveURL(/\?item=BS-3$/);

  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(card(page, 'BS-3')).toBeFocused();
});

test('moves a card one column with Shift and the arrow keys', async ({ page }) => {
  await openProject(page, /Bakery site/);
  await card(page, 'BS-5').focus();
  await page.keyboard.press('Shift+ArrowRight');
  await expect(column(page, 'Todo').locator('[data-id="BS-5"]')).toBeVisible();
  await expect(card(page, 'BS-5')).toBeFocused();
  expect(item('bakery-site', 'BS-5')).toContain('status: todo');
});

test('moves a card by dragging it to another column', async ({ page }) => {
  await openProject(page, /Bakery site/);
  await card(page, 'BS-5').dragTo(column(page, 'Doing'));
  await expect(column(page, 'Doing').locator('[data-id="BS-5"]')).toBeVisible();
  expect(item('bakery-site', 'BS-5')).toContain('status: doing');
});

test('asks why before blocking, and shows the reason on the card', async ({ page }) => {
  await openProject(page, /Bakery site/);
  await card(page, 'BS-5').focus();
  await page.keyboard.press('Shift+ArrowRight');
  const dialog = page.getByRole('dialog', { name: 'Why is BS-5 blocked?' });
  await expect(dialog.getByRole('button', { name: 'Block BS-5' })).toBeDisabled();
  await dialog.getByLabel('Reason').fill('Waiting for photos from the bakery');
  await dialog.getByRole('button', { name: 'Block BS-5' }).click();
  await expect(card(page, 'BS-5')).toContainText('Waiting for photos from the bakery');
  expect(item('bakery-site', 'BS-5')).toContain('reason: Waiting for photos from the bakery');
});

test('refuses done while tasks are open, and opens the open task', async ({ page }) => {
  await openProject(page, /Bakery site/);
  await card(page, 'BS-1').click();
  await page.getByRole('complementary').getByLabel('Status').selectOption('done');
  const dialog = page.getByRole('dialog', { name: "BS-1 can't be done yet" });
  await expect(dialog).toContainText('BS-3');
  await dialog.getByRole('button', { name: 'Open BS-3' }).click();
  await expect(page).toHaveURL(/\?item=BS-3$/);
  expect(item('bakery-site', 'BS-1')).toContain('status: doing');
});

test('checks and skips steps, closes the task and offers to close its feature', async ({ page }) => {
  await openProject(page, /Bakery site/);
  await card(page, 'BS-3').click();
  const panel = page.getByRole('complementary');

  await panel.getByRole('checkbox', { name: 'Email template with the order lines' }).click();
  await expect(panel.getByRole('checkbox', { name: 'Email template with the order lines' })).toHaveAttribute('aria-checked', 'true');
  expect(item('bakery-site', 'BS-3')).toContain('- [x] Email template with the order lines');

  await panel.getByRole('button', { name: 'Skip step 3' }).click();
  const skip = page.getByRole('dialog', { name: /Skip/ });
  await skip.getByLabel('Reason').fill('The form service filters spam');
  await skip.getByRole('button', { name: 'Skip step' }).click();
  await expect.poll(() => item('bakery-site', 'BS-3')).toContain('- [x] ~~Spam protection~~ (skipped: The form service filters spam)');

  await panel.getByLabel('Status').selectOption('done');
  const done = page.getByRole('dialog', { name: 'Done: what proves it?' });
  await done.getByLabel('Evidence').fill('https://example.com/pull/9');
  await done.getByRole('button', { name: 'Mark done' }).click();

  const parent = page.getByRole('dialog', { name: 'Close BS-1 too?' });
  await parent.getByRole('button', { name: 'Close BS-1' }).click();
  await expect(column(page, 'Done').locator('[data-id="BS-1"]')).toBeVisible();
  expect(item('bakery-site', 'BS-3')).toContain('evidence: https://example.com/pull/9');
  expect(item('bakery-site', 'BS-1')).toContain('evidence: confirmed by user (board)');
});

test('shows what changed on disk when another writer got there first, and writes nothing', async ({ page }) => {
  // Without the change feed the board only polls, so it still shows the old version.
  await page.route('**/api/events', (route) => route.abort());
  await openProject(page, /Pocket Budget/);
  await card(page, 'PB-6').click();
  await expect(page.getByRole('complementary').getByLabel('Status')).toHaveValue('doing');

  anvil('item', 'set', 'PB-6', '--title', 'Store amounts as integer cents everywhere');
  await card(page, 'PB-6').focus();
  await page.keyboard.press('Shift+ArrowLeft');

  const dialog = page.getByRole('dialog', { name: 'PB-6 was changed elsewhere' });
  await expect(dialog.getByLabel('What changed')).toContainText('+ title: Store amounts as integer cents everywhere');
  await dialog.getByRole('button', { name: 'Reload' }).click();
  await expect(page.getByRole('complementary').getByRole('heading', { level: 2 })).toHaveText('Store amounts as integer cents everywhere');
  expect(item('pocket-budget', 'PB-6')).toContain('status: doing');
});

test('moves an item to another project under a new id', async ({ page }) => {
  await openProject(page, /Pocket Budget/);
  await card(page, 'PB-6').click();
  await page.getByRole('button', { name: 'Move to another project…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Move PB-6' });
  await dialog.getByLabel('Target project').selectOption('home-lab');
  await dialog.getByRole('button', { name: 'Move 1 item' }).click();
  await expect(card(page, 'PB-6')).toHaveCount(0);
  expect(existsSync(join(DATA(), 'projects/pocket-budget/items/PB-6.md'))).toBe(false);
  expect(item('home-lab', 'HL-2')).toContain('aliases: [PB-6]');
});

test('cancels with a reason, hides the card and shows it with Show cancelled', async ({ page }) => {
  await openProject(page, /Bakery site/);
  await card(page, 'BS-5').click();
  await page.getByRole('button', { name: 'Cancel idea…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Cancel BS-5?' });
  await dialog.getByLabel('Reason').fill('Not for this season');
  await dialog.getByRole('button', { name: 'Cancel idea' }).click();
  await page.keyboard.press('Escape');
  await expect(card(page, 'BS-5')).toHaveCount(0);

  await page.getByRole('button', { name: /Show cancelled/ }).click();
  await expect(column(page, 'Cancelled').locator('[data-id="BS-5"]')).toContainText('Not for this season');
});

test('moves one column per quick key press, without tripping over its own changes', async ({ page }) => {
  await openProject(page, /Home lab/);
  await card(page, 'HL-1').focus();
  await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(column(page, 'Backlog').locator('[data-id="HL-1"]')).toBeVisible();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  expect(item('home-lab', 'HL-1')).toContain('status: backlog');
});
