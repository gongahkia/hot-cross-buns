import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/live-google",
  timeout: 180_000,
  reporter: [["list"]],
  outputDir: "output/playwright-live-google",
  use: {
    screenshot: "only-on-failure",
    trace: "retain-on-failure"
  }
});
