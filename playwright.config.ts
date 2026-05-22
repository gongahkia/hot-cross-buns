import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/smoke",
  timeout: 30_000,
  reporter: [["list"]],
  outputDir: "output/playwright",
  use: {
    screenshot: "only-on-failure",
    trace: "retain-on-failure"
  }
});
