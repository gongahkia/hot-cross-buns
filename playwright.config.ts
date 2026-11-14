import { defineConfig } from '@playwright/test';

const port = Number(process.env.SHIO_PAN_TEST_PORT ?? 4173);
const browserPath = process.env.SHIO_PAN_TEST_BROWSER_PATH;
const useChrome = process.env.SHIO_PAN_TEST_CHROME;

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  timeout: 30000,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    channel: useChrome ? 'chrome' : undefined,
    launchOptions: browserPath ? { executablePath: browserPath } : undefined,
    viewport: { width: 1280, height: 1000 },
  },
  webServer: {
    command: `npm run preview -- --port ${port}`,
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: false,
  },
});
