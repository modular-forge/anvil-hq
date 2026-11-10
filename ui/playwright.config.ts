import { defineConfig } from '@playwright/test';

// End-to-end tests: the real `anvil serve` over a temporary copy of examples/, driving the built
// board (ui-dist/) in the Chrome already installed on the machine, so CI downloads no browser.
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env['CI'],
  retries: 0,
  reporter: 'list',
  use: {
    channel: 'chrome',
    trace: 'retain-on-failure',
  },
});
