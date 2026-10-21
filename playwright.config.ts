import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E configuration for Dental Solutions.
 *
 * The app is a Vite dev server on port 3000. Playwright starts it automatically
 * via webServer. Tests run against Chromium only (the desktop shell uses
 * WebView2, which is Chromium-based).
 *
 * Usage:
 *   npx playwright test              — run all E2E tests
 *   npx playwright test --ui         — interactive mode
 *   npx playwright test e2e/login.spec.ts  — single file
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});