import { defineConfig } from '@playwright/test';

const port = Number(process.env.JING_TEST_PORT ?? process.env.STILL_TEST_PORT ?? 4173);

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    channel: 'chrome',
    viewport: { width: 1280, height: 1000 },
  },
  webServer: {
    command: `npm run preview -- --port ${port}`,
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: false,
  },
});
