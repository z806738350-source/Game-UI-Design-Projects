import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/ui-e2e',
  timeout: 20 * 60 * 1000,
  expect: { timeout: 60_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: 'test-results',
  reporter: [['list'], ...(process.env.CI ? [['github'] as const] : [])]
});
