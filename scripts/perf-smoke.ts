import { _electron as electron, type ElectronApplication } from "@playwright/test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import type { StartupTimingSnapshot } from "../src/shared/ipc/contracts";
import { summarizeAllPerfFixtureSets } from "./perf/fixtures";
import {
  writePerformanceReport,
  type PerfMeasurement,
  type PerfReport,
  type StartupTimingCapture
} from "./perf/report";

const rootDir = process.cwd();
const artifactDir = resolve(rootDir, "artifacts", "perf");
const mode = "report-only" as const;

function redactSensitiveText(text: string): string {
  const home = process.env.HOME;
  const withRedactedSecrets = text
    .replace(/\b((?:access|refresh|id)_token)\b\s*([=:])\s*["']?[^"'\s]+/gi, "$1$2<redacted>")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer <redacted>");

  if (!home) {
    return withRedactedSecrets;
  }

  return withRedactedSecrets.split(home).join("~");
}

function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown performance harness error";

  return redactSensitiveText(message).slice(0, 500);
}

async function collectStartupTiming(): Promise<StartupTimingCapture> {
  const mainOutputPath = resolve(rootDir, "out", "main", "index.js");

  if (!existsSync(mainOutputPath)) {
    return {
      status: "skipped",
      reason: "Build output is missing. Run pnpm build before collecting startup timings."
    };
  }

  let electronApp: ElectronApplication | undefined;
  const tempRoot = mkdtempSync(join(tmpdir(), "hcb2-perf-"));
  const userDataDir = join(tempRoot, "user-data");
  const startedAt = performance.now();

  try {
    electronApp = await electron.launch({
      args: [rootDir],
      env: {
        ...process.env,
        HCB_PERF_RUN: "1",
        HCB_USER_DATA_DIR: userDataDir,
        NODE_ENV: "test"
      }
    });

    const page = await electronApp.firstWindow({ timeout: 15_000 });

    await page.getByTestId("app-shell").waitFor({ state: "visible", timeout: 15_000 });
    await page
      .waitForFunction(
        async () => {
          const result = await window.hcb?.diagnostics.health();
          return Boolean(result?.ok && result.data.startup.shellVisibleMs !== undefined);
        },
        undefined,
        { timeout: 5_000 }
      )
      .catch(() => undefined);

    const health = await page.evaluate(async () => {
      const result = await window.hcb?.diagnostics.health();
      return result ?? null;
    });

    if (!health?.ok) {
      return {
        status: "skipped",
        reason: "Diagnostics health did not return startup timings."
      };
    }

    return {
      status: "collected",
      timings: health.data.startup,
      wallClockMs: Math.round(performance.now() - startedAt)
    };
  } catch (error) {
    return {
      status: "skipped",
      reason: sanitizeError(error)
    };
  } finally {
    await electronApp?.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function startupMeasurements(startup: StartupTimingCapture): PerfMeasurement[] {
  if (startup.status !== "collected" || !startup.timings) {
    return [
      {
        name: "startup.shell-visible",
        status: "skipped",
        reason: startup.reason ?? "Startup timing unavailable."
      }
    ];
  }

  const measurements: PerfMeasurement[] = [];

  for (const [field, name] of [
    ["appReadyMs", "startup.app-ready"],
    ["windowCreatedMs", "startup.main-window-created"],
    ["rendererLoadedMs", "startup.renderer-loaded"],
    ["shellVisibleMs", "startup.shell-visible"],
    ["databaseReadyMs", "startup.database-ready"]
  ] as const) {
    const value = startup.timings[field];
    measurements.push(
      value === undefined
        ? {
            name,
            status: "skipped",
            reason:
              field === "databaseReadyMs"
                ? "No database initialization exists in the scaffold yet."
                : "Startup mark was not reported."
          }
        : {
            name,
            status: "collected",
            valueMs: value
          }
    );
  }

  return measurements;
}

async function main(): Promise<void> {
  const fixtureStartedAt = performance.now();
  const fixtures = summarizeAllPerfFixtureSets();
  const fixtureGenerationMs = Math.round(performance.now() - fixtureStartedAt);
  const startup = await collectStartupTiming();

  const report: PerfReport = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode,
    status: "completed",
    artifactConvention: {
      json: "artifacts/perf/latest.json",
      markdown: "artifacts/perf/latest.md"
    },
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch
    },
    fixtures,
    startup,
    measurements: [
      {
        name: "fixtures.generate-all",
        status: "collected",
        valueMs: fixtureGenerationMs
      },
      ...startupMeasurements(startup),
      {
        name: "search.medium-local",
        status: "skipped",
        reason: "Search product flow and local index are not implemented yet."
      },
      {
        name: "tasks.large-scroll",
        status: "skipped",
        reason: "Tasks list product flow is not implemented yet."
      },
      {
        name: "calendar.large-month-navigation",
        status: "skipped",
        reason: "Calendar product flow is not implemented yet."
      }
    ],
    futureHooks: [
      "Load generated fixtures into the temporary SQLite path once migrations and repositories exist.",
      "Record cold and warm launch separately once packaged app launch paths are stable.",
      "Measure command palette and quick capture latency once those flows exist.",
      "Add local search, task list scroll, calendar navigation, and SQLite query-plan measurements after the relevant features land.",
      "Introduce hard failure thresholds only after stable baselines are accepted."
    ],
    notes: [
      "Report-only mode records numbers and skipped hooks without failing on product flows that do not exist yet.",
      "Fixture data is generated locally and deterministically; the harness does not call Google or read user app data.",
      "Electron security settings are left unchanged for measurement."
    ]
  };

  const written = writePerformanceReport(report, artifactDir);

  console.log(`Wrote performance report to ${written.jsonPath}`);
  console.log(`Wrote performance markdown to ${written.markdownPath}`);
}

void main().catch((error) => {
  console.error(sanitizeError(error));
  process.exitCode = 1;
});
