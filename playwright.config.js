import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'node tools/static-server.js 4173',
    url: 'http://127.0.0.1:4173/Social.html',
    reuseExistingServer: true,
    timeout: 20_000
  },
  // Uses the Edge build already installed on Windows; run
  // `npx playwright install chromium` and switch channel to 'chromium' to use
  // Playwright's bundled browser instead.
  projects: [{ name: 'edge', use: { browserName: 'chromium', channel: 'msedge' } }]
});
