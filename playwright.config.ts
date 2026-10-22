import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/smoke",
  // Profile directories isolate data; Electron menus and global shortcuts still
  // share one desktop. Keep app fixtures sequential on the host.
  workers: 1,
  timeout: 30_000,
  reporter: [["list"], ["html", { outputFolder: "output/playwright-report", open: "never" }], ["junit", { outputFile: "output/playwright-results.xml" }]],
  outputDir: "output/playwright",
  use: {
    screenshot: "only-on-failure",
    trace: "retain-on-failure"
  }
});
