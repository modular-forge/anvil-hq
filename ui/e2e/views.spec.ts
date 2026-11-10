import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

// Runs after items.spec.ts on the same copy of examples/, in order.
test.describe.configure({ mode: 'serial' });

const ROOT = resolve(import.meta.dirname, '..', '..');
const DATA = () => process.env['ANVIL_E2E_DATA'] ?? '';
const URL_WITH_TOKEN = () => process.env['ANVIL_E2E_URL'] ?? '';

function file(path: string): string {
  return readFileSync(join(DATA(), path), 'utf8');
}

function anvil(...args: string[]): void {
  execFileSync(process.execPath, [join(ROOT, 'bin', 'anvil.ts'), ...args, '--data', DATA()], { stdio: 'ignore' });
}

/** Opens the board with its token, then goes to `path`. */
async function open(page: Page, path = '/'): Promise<void> {
  await page.goto(URL_WITH_TOKEN());
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  if (path !== '/') await page.goto(new URL(path, URL_WITH_TOKEN()).href);
}

test('home shows what is in the fire and leads to the inbox', async ({ page }) => {
  await open(page);
  const now = page.getByRole('region', { name: 'Now' });
  await expect(now.getByRole('link', { name: /BS-4.*Opening hours wrong on Sundays/ })).toContainText('Waiting for the owner');
  await expect(page.getByRole('main').getByRole('region', { name: /Active/ }).getByRole('link', { name: /Pocket Budget/ })).toBeVisible();
  await page.getByRole('link', { name: /Inbox · 1 item waiting/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
});

test('finds an item from the palette and opens it', async ({ page }) => {
  await open(page);
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Search or run a command' });
  await palette.getByRole('combobox').fill('recurring');
  await expect(palette.getByRole('option', { name: /PB-2 · Recurring expenses/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/projects\/pocket-budget\?item=PB-2$/);
  await expect(page.getByRole('complementary').getByRole('heading', { level: 2 })).toHaveText('Recurring expenses');
});

test('creates an item with N, with its kind, priority, labels and steps', async ({ page }) => {
  await open(page, '/projects/pocket-budget');
  await expect(page.getByRole('region', { name: 'Todo' })).toBeVisible();
  await page.keyboard.press('n');
  const dialog = page.getByRole('dialog', { name: 'New item' });
  await expect(dialog.getByRole('textbox', { name: 'Title' })).toBeFocused();
  await page.keyboard.type('Totals off by one cent on iOS');
  await dialog.getByText('Bug', { exact: true }).click();
  await dialog.getByText('High', { exact: true }).click();
  await dialog.getByLabel('Labels · comma-separated').fill('ios, money');
  await dialog.getByLabel('Steps · optional, one per line').fill('Reproduce on a device\nRound in cents');
  await page.keyboard.press('Control+Enter');

  await expect(page).toHaveURL(/\/projects\/pocket-budget\?item=PB-7$/);
  const text = file('projects/pocket-budget/items/PB-7.md');
  for (const line of ['kind: bug', 'status: todo', 'priority: high', 'labels: [ios, money]', '- [ ] Reproduce on a device']) expect(text).toContain(line);
});

test('adds a task at the foot of a column', async ({ page }) => {
  await open(page, '/projects/pocket-budget');
  await page.getByRole('button', { name: '+ Add to Backlog' }).click();
  await page.getByRole('textbox', { name: 'New task in Backlog' }).fill('Export to CSV');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: 'Backlog' }).locator('[data-id="PB-8"]')).toContainText('Export to CSV');
  expect(file('projects/pocket-budget/items/PB-8.md')).toContain('status: backlog');
});

test('writes in the journal with Ctrl Enter and links the items it mentions', async ({ page }) => {
  await open(page, '/projects/pocket-budget?view=journal');
  await page.getByRole('textbox', { name: /Note for today/ }).fill('Looked into PB-7 with a real phone.');
  await page.keyboard.press('Control+Enter');
  const entry = page.getByRole('region', { name: /Today/ });
  await expect(entry).toContainText('Looked into');
  await entry.getByRole('button', { name: 'PB-7' }).click();
  await expect(page).toHaveURL(/item=PB-7/);
  await expect(page.getByRole('region', { name: 'Todo' })).toBeVisible();
});

test('publishes a release in three steps', async ({ page }) => {
  await open(page, '/projects/pocket-budget');
  await page.getByRole('link', { name: 'Publish release' }).click();
  await expect(page.getByRole('textbox', { name: 'Version' })).toHaveValue('1.11');
  await page.getByRole('button', { name: 'Choose items' }).click();
  await expect(page.getByRole('checkbox', { name: /PB-4/ })).toBeChecked();
  await page.getByRole('button', { name: 'Preview notes' }).click();
  await expect(page.getByText(/## Pocket Budget 1.11/)).toBeVisible();
  expect(file('projects/pocket-budget/items/PB-4.md')).toContain('status: done');

  await page.getByRole('button', { name: 'Publish v1.11' }).click();
  await expect(page.getByRole('heading', { name: 'Released v1.11' })).toBeVisible();
  const released = file('projects/pocket-budget/items/PB-4.md');
  expect(released).toContain('status: released');
  expect(released).toContain('release: "1.11"');
});

test('moves an inbox item to a project', async ({ page }) => {
  await open(page, '/inbox');
  await page.getByRole('button', { name: /IN-1/ }).click();
  await page.getByRole('button', { name: 'Move to…' }).click();
  await page.getByText('Bakery site', { exact: false }).last().click();
  await page.getByRole('button', { name: 'Move to Bakery site' }).click();
  await expect(page.getByText('Nothing waiting here.')).toBeVisible();
  expect(file('projects/bakery-site/items/BS-6.md')).toContain('aliases: [IN-1]');
});

test('turns an idea into a project', async ({ page }) => {
  anvil('item', 'create', 'inbox', '--kind', 'idea', '--title', 'A shared cookbook');
  await open(page, '/inbox');
  await page.getByRole('button', { name: /A shared cookbook/ }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  const dialog = page.getByRole('dialog', { name: /New project from IN-2/ });
  await dialog.getByLabel('Project id').fill('cookbook');
  await dialog.getByLabel('Prefix').fill('CB');
  await dialog.getByLabel('Kind').selectOption('mobile');
  await dialog.getByRole('button', { name: 'Create project' }).click();
  await expect(page).toHaveURL(/\/projects\/cookbook$/);
  await expect(page.getByRole('heading', { level: 1, name: 'A shared cookbook' })).toBeVisible();
  expect(existsSync(join(DATA(), 'projects/cookbook/items/CB-1.md'))).toBe(true);
});

test('lets an inbox item go with a reason', async ({ page }) => {
  anvil('item', 'create', 'inbox', '--kind', 'idea', '--title', 'A smart fridge');
  await open(page, '/inbox');
  await page.getByRole('button', { name: /A smart fridge/ }).click();
  await page.getByRole('button', { name: 'Let go…' }).click();
  const dialog = page.getByRole('dialog', { name: /Cancel IN-3/ });
  await dialog.getByLabel('Reason').fill('Not worth it');
  await dialog.getByRole('button', { name: /Cancel idea/ }).click();
  await expect(page.getByText('Nothing waiting here.')).toBeVisible();
  expect(file('projects/inbox/items/IN-3.md')).toContain('reason: Not worth it');
});

test('lists decisions with their state and jumps to the one that replaced another', async ({ page }) => {
  await open(page, '/general');
  const gn1 = page.getByRole('article', { name: 'Host every static site on the home server' });
  await expect(gn1).toContainText('Superseded');
  await expect(page.getByRole('article', { name: /free static hosting service/ })).toContainText('In force');
  await gn1.getByRole('button', { name: /Superseded by GN-2/ }).click();
  await expect(page.getByRole('article', { name: /free static hosting service/ })).toBeFocused();
});
