import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LocalPerformanceTiming, StartupTimingSnapshot } from "../../src/shared/ipc/contracts";
import { redactLogValue } from "../../src/shared/redaction";
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

export interface PerfLaunchCapture extends StartupTimingCapture {
  name: "cold" | "warm";
  commandPaletteOpenMs?: number;
}

export interface PerfQueryPlanRow {
  id: number;
  parent: number;
  detail: string;
}

export interface PerfQueryPlanReport {
  name: string;
  category: "task" | "event" | "note" | "search" | "checkpoint" | "pending_mutation";
  status: PerfCaptureStatus;
  rows?: PerfQueryPlanRow[];
  usesIndex?: boolean;
  hasFullTableScan?: boolean;
  reason?: string;
}

export interface PerfIpcRouteReport {
  route: string;
  totalCalls: number;
  averageDurationMs: number;
  lastDurationMs?: number;
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
  launches?: PerfLaunchCapture[];
  measurements: PerfMeasurement[];
  queryPlans?: PerfQueryPlanReport[];
  ipcRoutes?: PerfIpcRouteReport[];
  performanceTimings?: LocalPerformanceTiming[];
  futureHooks: string[];
  notes: string[];
}

export interface WrittenPerfReportPaths {
  jsonPath: string;
  markdownPath: string;
}

export function sanitizePerformanceReport(report: PerfReport): PerfReport {
  return redactLogValue(report) as PerfReport;
}

export function requiredElectronLaunchFailure(report: PerfReport): string | null {
  const launches = report.launches ?? [];
  const requiredTimingFields = ["shellVisibleMs", "cachedDataRenderedMs"] as const;

  if (launches.length === 0) {
    return "Required Electron launch timings were not captured.";
  }

  const skippedLaunches = launches.filter((launch) => launch.status !== "collected" || !launch.timings);

  if (skippedLaunches.length === 0) {
    const incompleteLaunches = launches
      .map((launch) => ({
        launch,
        missing: requiredTimingFields.filter((field) => launch.timings?.[field] === undefined)
      }))
      .filter(({ missing }) => missing.length > 0);

    if (incompleteLaunches.length === 0) {
      return null;
    }

    return `Required Electron launch timings were incomplete for ${incompleteLaunches
      .map(({ launch, missing }) => `${launch.name}: missing ${missing.join(", ")}`)
      .join("; ")}`;
  }

  return `Required Electron launch timings were skipped for ${skippedLaunches
    .map((launch) => `${launch.name}: ${launch.reason ?? "no timing data"}`)
    .join("; ")}`;
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
    ["databaseReadyMs", "Database ready"],
    ["cachedDataRenderedMs", "Cached data rendered"]
  ];

  return phases.map(([key, label]) => {
    const value = timings[key];
    return `| ${label} | ${value === undefined ? "pending" : `${value}ms`} | ${key} |`;
  });
}

function launchRows(launches: PerfLaunchCapture[] | undefined): string[] {
  if (launches === undefined || launches.length === 0) {
    return ["| Launch | skipped |  |  |  | No Electron launch timing captured. |"];
  }

  return launches.map((launch) => {
    if (launch.status === "skipped" || !launch.timings) {
      return `| ${launch.name} | skipped |  |  |  | ${launch.reason ?? "Launch skipped."} |`;
    }

    return `| ${launch.name} | ${launch.timings.shellVisibleMs ?? "pending"}ms | ${
      launch.timings.cachedDataRenderedMs ?? "pending"
    }ms | ${launch.commandPaletteOpenMs ?? "pending"}ms | ${launch.wallClockMs ?? "pending"}ms | |`;
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

function queryPlanRows(queryPlans: PerfQueryPlanReport[] | undefined): string[] {
  if (queryPlans === undefined || queryPlans.length === 0) {
    return ["| None | skipped | | | No query-plan reports captured. |"];
  }

  return queryPlans.map((plan) => {
    if (plan.status === "skipped" || !plan.rows) {
      return `| ${plan.name} | ${plan.category} | skipped | | ${plan.reason ?? ""} |`;
    }

    const details = plan.rows.map((row) => row.detail.replace(/\|/g, "\\|")).join("; ");
    const indexStatus = plan.hasFullTableScan
      ? "review"
      : plan.usesIndex
        ? "indexed"
        : "no index";

    return `| ${plan.name} | ${plan.category} | ${indexStatus} | ${details} | |`;
  });
}

function ipcRouteRows(ipcRoutes: PerfIpcRouteReport[] | undefined): string[] {
  if (ipcRoutes === undefined || ipcRoutes.length === 0) {
    return ["| None | 0 |  | No IPC route metrics captured. |"];
  }

  return ipcRoutes.map(
    (route) =>
      `| ${route.route} | ${route.totalCalls} | ${route.averageDurationMs}ms | ${
        route.lastDurationMs === undefined ? "" : `${route.lastDurationMs}ms`
      } |`
  );
}

function performanceTimingRows(timings: LocalPerformanceTiming[] | undefined): string[] {
  if (timings === undefined || timings.length === 0) {
    return ["| None |  |  | No performance timings captured. |"];
  }

  return timings.slice(0, 25).map((timing) => {
    const metadata = timing.metadata === undefined
      ? ""
      : JSON.stringify(timing.metadata).replace(/\|/g, "\\|");
    return `| ${timing.kind} | ${timing.name} | ${timing.durationMs}ms | ${metadata} |`;
  });
}

export function renderPerformanceMarkdown(report: PerfReport): string {
  const sanitizedReport = sanitizePerformanceReport(report);

  return [
    "# Performance Smoke",
    "",
    `Generated: ${sanitizedReport.generatedAt}`,
    `Mode: ${sanitizedReport.mode}`,
    "",
    "## Fixtures",
    "",
    "| Size | Tasks | Event instances | Notes | Total records | JSON size | SHA-256 |",
    "|---|---:|---:|---:|---:|---:|---|",
    ...sanitizedReport.fixtures.map(
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
    ...startupRows(sanitizedReport.startup),
    "",
    "## Launches",
    "",
    "| Launch | Shell visible | Cached render | Command palette | Wall clock | Notes |",
    "|---|---:|---:|---:|---:|---|",
    ...launchRows(sanitizedReport.launches),
    "",
    "## Measurements",
    "",
    "| Measurement | Value | Notes |",
    "|---|---:|---|",
    ...measurementRows(sanitizedReport.measurements),
    "",
    "## SQLite Query Plans",
    "",
    "| Query | Category | Plan status | Details | Notes |",
    "|---|---|---|---|---|",
    ...queryPlanRows(sanitizedReport.queryPlans),
    "",
    "## IPC Routes",
    "",
    "| Route | Calls | Average | Last |",
    "|---|---:|---:|---:|",
    ...ipcRouteRows(sanitizedReport.ipcRoutes),
    "",
    "## Performance Timings",
    "",
    "| Kind | Name | Duration | Metadata |",
    "|---|---|---:|---|",
    ...performanceTimingRows(sanitizedReport.performanceTimings),
    "",
    "## Future Hooks",
    "",
    ...sanitizedReport.futureHooks.map((hook) => `- ${hook}`),
    "",
    "## Notes",
    "",
    ...sanitizedReport.notes.map((note) => `- ${note}`),
    ""
  ].join("\n");
}

export function writePerformanceReport(
  report: PerfReport,
  artifactDir: string
): WrittenPerfReportPaths {
  mkdirSync(artifactDir, { recursive: true });
  const sanitizedReport = sanitizePerformanceReport(report);

  const jsonPath = join(artifactDir, "latest.json");
  const markdownPath = join(artifactDir, "latest.md");

  writeFileSync(jsonPath, `${JSON.stringify(sanitizedReport, null, 2)}\n`);
  writeFileSync(markdownPath, renderPerformanceMarkdown(sanitizedReport));

  return { jsonPath, markdownPath };
}
