import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  testMatch: ["smoke/**/*.spec.ts", "browser/**/*.spec.ts"],
  workers: 1,
  timeout: 60_000,
  reporter: [["list"], ["html", { outputFolder: "output/playwright-report", open: "never" }], ["junit", { outputFile: "output/playwright-results.xml" }]],
  outputDir: "output/playwright",
  use: {
    baseURL: "http://127.0.0.1:4174",
    viewport: { width: 1180, height: 760 },
    permissions: ["clipboard-read", "clipboard-write"],
    screenshot: "only-on-failure",
    trace: "retain-on-failure"
  },
  webServer: {
    command: "corepack pnpm exec vite build --mode test --outDir ../../dist-test && corepack pnpm exec vite preview --host 127.0.0.1 --port 4174 --strictPort --outDir ../../dist-test",
    url: "http://127.0.0.1:4174",
    // Every validation owns a freshly built static bundle, including local runs.
    reuseExistingServer: false,
    timeout: 120_000
  }
});
