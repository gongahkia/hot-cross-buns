import { describe, expect, it } from "vitest";
import {
  renderPerformanceMarkdown,
  requiredElectronLaunchFailure,
  sanitizePerformanceReport,
  type PerfReport
} from "./report";

const reportWithSecrets: PerfReport = {
  schemaVersion: 1,
  generatedAt: "2026-05-22T10:00:00.000Z",
  mode: "report-only",
  status: "completed",
  artifactConvention: {
    json: "artifacts/perf/latest.json",
    markdown: "artifacts/perf/latest.md"
  },
  environment: {
    node: "v20.0.0",
    platform: "darwin",
    arch: "arm64"
  },
  fixtures: [],
  startup: {
    status: "skipped",
    reason: "Bearer fake-mcp-token"
  },
  measurements: [
    {
      name: "sqlite.baseline",
      status: "skipped",
      reason: "access_token=fake-access-token"
    }
  ],
  queryPlans: [
    {
      name: "search.tasks",
      category: "search",
      status: "collected",
      rows: [{ id: 1, parent: 0, detail: "SCAN fake_refresh_token=fake-refresh-token" }]
    }
  ],
  futureHooks: ["Do not include client_secret=fake-client-secret"],
  notes: ["Temporary path includes /Users/example/private and refreshToken: fake-refresh-token"]
};

describe("performance report redaction", () => {
  it("redacts representative secrets from JSON and markdown report output", () => {
    const sanitized = sanitizePerformanceReport(reportWithSecrets);
    const markdown = renderPerformanceMarkdown(reportWithSecrets);

    expect(JSON.stringify(sanitized)).not.toMatch(
      /fake-access-token|fake-refresh-token|fake-client-secret|fake-mcp-token|\/Users\/example/
    );
    expect(markdown).not.toMatch(
      /fake-access-token|fake-refresh-token|fake-client-secret|fake-mcp-token|\/Users\/example/
    );
  });
});

describe("requiredElectronLaunchFailure", () => {
  it("passes when all Electron launch timings are collected", () => {
    expect(requiredElectronLaunchFailure({
      ...reportWithSecrets,
      launches: [
        {
          name: "cold",
          status: "collected",
          timings: { shellVisibleMs: 100, cachedDataRenderedMs: 120 }
        },
        {
          name: "warm",
          status: "collected",
          timings: { shellVisibleMs: 80, cachedDataRenderedMs: 95 }
        }
      ]
    })).toBeNull();
  });

  it("reports skipped Electron launch timings", () => {
    expect(requiredElectronLaunchFailure({
      ...reportWithSecrets,
      launches: [
        {
          name: "cold",
          status: "skipped",
          reason: "App shell timeout."
        },
        {
          name: "warm",
          status: "collected",
          timings: { shellVisibleMs: 80, cachedDataRenderedMs: 95 }
        }
      ]
    })).toContain("cold: App shell timeout.");
  });

  it("reports incomplete Electron launch timings", () => {
    expect(requiredElectronLaunchFailure({
      ...reportWithSecrets,
      launches: [
        {
          name: "cold",
          status: "collected",
          timings: { cachedDataRenderedMs: 120 }
        },
        {
          name: "warm",
          status: "collected",
          timings: { shellVisibleMs: 80 }
        }
      ]
    })).toBe(
      "Required Electron launch timings were incomplete for cold: missing shellVisibleMs; warm: missing cachedDataRenderedMs"
    );
  });

  it("reports missing Electron launch timings", () => {
    expect(requiredElectronLaunchFailure({
      ...reportWithSecrets,
      launches: []
    })).toBe("Required Electron launch timings were not captured.");
  });
});
