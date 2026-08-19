import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/ui-e2e',
  timeout: 10 * 60 * 1000,
  expect: { timeout: 60_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: 'test-results',
  // F-03 evidence: failed runs must leave reproducible traces, screenshots
  // and (via helpers.launchApp) Electron main-process logs in test-results/.
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  reporter: [['list'], ...(process.env.CI ? [['github'] as const] : [])]
});
