import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { StartupTimingSnapshot } from "../../src/shared/ipc/contracts";
import type { PerfFixtureSummary } from "./fixtures";

export type PerfReportMode = "report-only";
export type PerfCaptureStatus = "collected" | "skipped";

export interface PerfMeasurement {
  name: string;
  status: PerfCaptureStatus;
  valueMs?: number;
  reason?: string;
}

export interface StartupTimingCapture {
  status: PerfCaptureStatus;
  timings?: StartupTimingSnapshot;
  wallClockMs?: number;
  reason?: string;
}

export interface PerfReport {
  schemaVersion: 1;
  generatedAt: string;
  mode: PerfReportMode;
  status: "completed";
  artifactConvention: {
    json: "artifacts/perf/latest.json";
    markdown: "artifacts/perf/latest.md";
  };
  environment: {
    node: string;
    platform: NodeJS.Platform;
    arch: string;
  };
  fixtures: PerfFixtureSummary[];
  startup: StartupTimingCapture;
  measurements: PerfMeasurement[];
  futureHooks: string[];
  notes: string[];
}

export interface WrittenPerfReportPaths {
  jsonPath: string;
  markdownPath: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KiB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function startupRows(startup: StartupTimingCapture): string[] {
  const timings = startup.timings;

  if (startup.status === "skipped" || !timings) {
    return [`| Startup | skipped | ${startup.reason ?? "No startup timing captured."} |`];
  }

  const phases: Array<[keyof StartupTimingSnapshot, string]> = [
    ["processStartedMs", "Process started"],
    ["appReadyMs", "App ready"],
    ["windowCreatedMs", "Main window created"],
    ["rendererLoadedMs", "Renderer loaded"],
    ["shellVisibleMs", "Shell visible"],
    ["databaseReadyMs", "Database ready"]
  ];

  return phases.map(([key, label]) => {
    const value = timings[key];
    return `| ${label} | ${value === undefined ? "pending" : `${value}ms`} | ${key} |`;
  });
}

function measurementRows(measurements: PerfMeasurement[]): string[] {
  if (measurements.length === 0) {
    return ["| None | skipped | Product flows are not implemented yet. |"];
  }

  return measurements.map((measurement) => {
    const value =
      measurement.status === "collected" && measurement.valueMs !== undefined
        ? `${measurement.valueMs}ms`
        : "skipped";
    return `| ${measurement.name} | ${value} | ${measurement.reason ?? ""} |`;
  });
}

export function renderPerformanceMarkdown(report: PerfReport): string {
  return [
    "# Performance Smoke",
    "",
    `Generated: ${report.generatedAt}`,
    `Mode: ${report.mode}`,
    "",
    "## Fixtures",
    "",
    "| Size | Tasks | Event instances | Notes | Total records | JSON size | SHA-256 |",
    "|---|---:|---:|---:|---:|---:|---|",
    ...report.fixtures.map(
      (fixture) =>
        `| ${fixture.size} | ${fixture.counts.tasks} | ${fixture.counts.eventInstances} | ${fixture.counts.notes} | ${fixture.totalRecords} | ${formatBytes(
          fixture.jsonBytes
        )} | ${fixture.sha256.slice(0, 12)} |`
    ),
    "",
    "## Startup",
    "",
    "| Phase | Value | Field |",
    "|---|---:|---|",
    ...startupRows(report.startup),
    "",
    "## Measurements",
    "",
    "| Measurement | Value | Notes |",
    "|---|---:|---|",
    ...measurementRows(report.measurements),
    "",
    "## Future Hooks",
    "",
    ...report.futureHooks.map((hook) => `- ${hook}`),
    "",
    "## Notes",
    "",
    ...report.notes.map((note) => `- ${note}`),
    ""
  ].join("\n");
}

export function writePerformanceReport(
  report: PerfReport,
  artifactDir: string
): WrittenPerfReportPaths {
  mkdirSync(artifactDir, { recursive: true });

  const jsonPath = join(artifactDir, "latest.json");
  const markdownPath = join(artifactDir, "latest.md");

  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(markdownPath, renderPerformanceMarkdown(report));

  return { jsonPath, markdownPath };
}
