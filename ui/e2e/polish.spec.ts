import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

// The item page, filters, keyboard shortcuts and the narrow layout. Each test makes its own
// items in Home lab, so it does not depend on what the other files left behind.
test.describe.configure({ mode: 'serial' });

const ROOT = resolve(import.meta.dirname, '..', '..');
const DATA = () => process.env['ANVIL_E2E_DATA'] ?? '';

/** Runs the anvil CLI on the test's data space and returns the id it created. */
function create(...args: string[]): string {
  const out = execFileSync(process.execPath, [join(ROOT, 'bin', 'anvil.ts'), 'item', 'create', ...args, '--json', '--data', DATA()], { encoding: 'utf8' });
  return (JSON.parse(out) as { id: string }).id;
}

function file(id: string): string {
  return readFileSync(join(DATA(), 'projects', 'home-lab', 'items', `${id}.md`), 'utf8');
}

async function open(page: Page, path: string): Promise<void> {
  const url = new URL(process.env['ANVIL_E2E_URL'] ?? '');
  await page.goto(`${url.origin}${path}${url.hash}`);
}

test('filters the board by kind and label, in the URL', async ({ page }) => {
  const bug = create('home-lab', '--kind', 'bug', '--title', 'The fan is loud at night', '--labels', 'hardware');
  await open(page, '/projects/home-lab');
  await expect(page.locator(`[data-id="${bug}"]`)).toBeVisible();
  await page.getByLabel('Kind').selectOption('bug');
  await expect(page).toHaveURL(/kind=bug/);
  await expect(page.locator(`[data-id="${bug}"]`)).toBeVisible();
  await expect(page.locator('[data-id="HL-1"]')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Doing' })).toContainText('No cards match');

  await page.reload();
  await expect(page.getByLabel('Kind')).toHaveValue('bug');
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.locator('[data-id="HL-1"]')).toBeVisible();
});

test('opens an item on its own page and edits it there', async ({ page }) => {
  const feature = create('home-lab', '--kind', 'feature', '--title', 'Backups for the NAS');
  await open(page, `/projects/home-lab?item=${feature}`);
  await page.getByRole('complementary').getByRole('link', { name: 'Open full page' }).click();
  await expect(page).toHaveURL(new RegExp(`/items/${feature}$`));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Backups for the NAS');

  await page.keyboard.press('e');
  await page.getByLabel('Title').fill('Nightly backups for the NAS');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nightly backups for the NAS');
  expect(file(feature)).toContain('title: Nightly backups for the NAS');

  await page.getByLabel('Priority').selectOption('high');
  await expect.poll(() => file(feature)).toContain('priority: high');
  await page.getByLabel('Labels').fill('storage, nightly');
  await page.getByLabel('Labels').press('Enter');
  await expect.poll(() => file(feature)).toContain('labels: [storage, nightly]');

  await page.getByRole('button', { name: `+ Add task to ${feature}` }).click();
  await page.getByLabel(`New task in ${feature}`).fill('Pick a backup tool');
  await page.keyboard.press('Enter');
  const tasks = page.getByRole('region', { name: 'Tasks' });
  await expect(tasks).toContainText('Pick a backup tool');
  await expect(page.getByRole('note')).toContainText('Not ready to close');
  const task = (await tasks.getByRole('button', { name: /Pick a backup tool/ }).textContent())?.match(/HL-\d+/)?.[0] ?? '';
  expect(existsSync(join(DATA(), 'projects', 'home-lab', 'items', `${task}.md`))).toBe(true);
  expect(file(task)).toContain(`parent: ${feature}`);
});

test('edits the description in Markdown and keeps the steps', async ({ page }) => {
  const task = create('home-lab', '--kind', 'task', '--title', 'Label the cables', '--body', 'Old notes.', '--step', 'Buy labels', '--step', 'Print them');
  await open(page, `/items/${task}`);
  await page.getByRole('button', { name: 'Edit the description' }).click();
  const area = page.getByLabel('Description, in Markdown');
  await expect(area).toHaveValue('Old notes.');
  await area.fill('## Why\n\nNobody knows which cable is **which**.\n\n- one label per end');
  await page.keyboard.press('Control+Enter');

  await expect(page.locator('anv-markdown').getByRole('heading', { name: 'Why' })).toBeVisible();
  await expect(page.locator('anv-markdown strong')).toHaveText('which');
  await expect(page.getByRole('checkbox', { name: /Buy labels/ })).toBeVisible();
  await expect.poll(() => file(task)).toContain('## Why\n\nNobody knows which cable is **which**.\n\n- one label per end\n\n- [ ] Buy labels\n- [ ] Print them\n');
});

test('moves around with the keyboard and lists the shortcuts', async ({ page }) => {
  await open(page, '/projects/home-lab');
  await expect(page.locator('[data-id="HL-1"]')).toBeVisible();
  await page.keyboard.press('j');
  await expect(page.locator('[data-id]').first()).toBeFocused();
  await page.keyboard.press('j');
  await expect(page.locator('[data-id]').nth(1)).toBeFocused();

  await page.keyboard.press('?');
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  await page.keyboard.press('g');
  await page.keyboard.press('i');
  await expect(page).toHaveURL(/\/inbox$/);
  await page.keyboard.press('g');
  await page.keyboard.press('h');
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
});

test('folds the sidebar behind a Menu button on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, '/');
  const nav = page.getByRole('navigation', { name: 'Main' });
  const inbox = nav.getByRole('link', { name: /Inbox/ });
  await expect(inbox).toBeHidden();
  await nav.getByRole('button', { name: 'Menu' }).click();
  await expect(inbox).toBeVisible();
  await inbox.click();
  await expect(page).toHaveURL(/\/inbox$/);
  await expect(inbox).toBeHidden();
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
});
