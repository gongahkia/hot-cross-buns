import { defineConfig } from '@playwright/test';

// keep Node date fixtures aligned with the app's default zone and browser context.
process.env.TZ = 'Asia/Singapore';

const port = Number(process.env.HOT_CROSS_BUNS_TEST_PORT ?? 4173);
const browserPath = process.env.HOT_CROSS_BUNS_TEST_BROWSER_PATH;
const useChrome = process.env.HOT_CROSS_BUNS_TEST_CHROME;

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  timeout: 30000,
  workers: 2,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    channel: useChrome ? 'chrome' : undefined,
    launchOptions: browserPath ? { executablePath: browserPath } : undefined,
    viewport: { width: 1280, height: 1000 },
    timezoneId: 'Asia/Singapore',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npm run preview -- --port ${port}`,
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: false,
  },
});
