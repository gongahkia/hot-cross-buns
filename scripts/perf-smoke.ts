import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { REQUIRED_GOOGLE_SCOPES } from "../src/main/google/types";
import {
  LocalPerformanceRepository,
  LocalPlannerRepository,
  LocalSettingsRepository
} from "../src/main/data/localRepositories";
import { runLocalDataMigrations } from "../src/main/data/migrations";
import { createAppSqliteConnection, type SqliteConnection } from "../src/main/data/sqliteConnection";
import {
  calendarLocalId,
  GoogleSyncRepository,
  taskListLocalId,
  taskLocalId
} from "../src/main/sync/readSyncRepository";
import type {
  AutoTagRule,
  DiagnosticsHealthResponse,
  DiagnosticsIpcMetricsResponse,
  DiagnosticsPerformanceResponse,
  LocalPerformanceTiming,
  StartupTimingSnapshot
} from "../src/shared/ipc/contracts";
import type { HcbResult } from "../src/shared/ipc/result";
import { redactSensitiveText } from "../src/shared/redaction";
import {
  generatePerfFixtureSet,
  summarizeAllPerfFixtureSets,
  type PerfFixtureSize
} from "./perf/fixtures";
import {
  writePerformanceReport,
  type PerfIpcRouteReport,
  type PerfLaunchCapture,
  type PerfMeasurement,
  type PerfQueryPlanReport,
  type PerfQueryPlanRow,
  type PerfReport,
  type StartupTimingCapture
} from "./perf/report";

const rootDir = process.cwd();
const artifactDir = resolve(rootDir, "artifacts", "perf");
const mode = "report-only" as const;
const accountId = "perf-generated-account";
const fixtureSize = parsePerfFixtureSize(process.env.HCB_PERF_FIXTURE_SIZE);
const perfFixture = generatePerfFixtureSet(fixtureSize);
const skipUiFlows = process.env.HCB_PERF_SKIP_UI_FLOWS === "1";
const skipElectronLaunch = process.env.HCB_PERF_SKIP_ELECTRON === "1";
const appShellTimeoutMs = parsePositiveInteger(process.env.HCB_PERF_APP_SHELL_TIMEOUT_MS) ?? 45_000;
type DiagnosticsHealthResult = HcbResult<DiagnosticsHealthResponse> | null;

interface QueryPlanRow extends Record<string, unknown> {
  id: number;
  parent: number;
  detail: string;
}

interface SeedResult {
  databasePath: string;
  durationMs: number;
}

interface SqliteBaselineResult {
  measurements: PerfMeasurement[];
  queryPlans: PerfQueryPlanReport[];
}

function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown performance harness error";

  return redactSensitiveText(message).slice(0, 500);
}

function roundMs(value: number): number {
  return Math.max(0, Math.round(value * 100) / 100);
}

function parsePerfFixtureSize(value: string | undefined): PerfFixtureSize {
  if (value === "small" || value === "medium" || value === "event15k" || value === "large") {
    return value;
  }

  if (value === "15k-event") {
    return "event15k";
  }

  return "medium";
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function temporaryUserDataDir(): { root: string; userDataDir: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "hcb2-perf-"));
  const userDataDir = join(root, "user-data");

  return {
    root,
    userDataDir,
    cleanup: () => {
      rmSync(root, { recursive: true, force: true });
    }
  };
}

function seedPerfFixtureDatabase(userDataDir: string): SeedResult {
  const startedAt = performance.now();
  const connection = createAppSqliteConnection({ appSupportDirectory: userDataDir });

  try {
    runLocalDataMigrations(connection);
    const syncRepository = new GoogleSyncRepository(connection);
    const settingsRepository = new LocalSettingsRepository(connection);
    const now = perfFixture.baseTime;

    settingsRepository.update({
      selectedTaskListIds: perfFixture.taskLists.map((list) => taskListLocalId(accountId, list.id)),
      selectedCalendarIds: perfFixture.calendars.map((calendar) => calendarLocalId(accountId, calendar.id)),
      setupCompletedAt: now
    });

    syncRepository.upsertAccountStatus({
      accountId,
      googleAccountId: "generated-perf-account",
      email: "generated-perf@example.invalid",
      displayName: "Generated Performance Account",
      avatarUrl: null,
      locale: "en",
      timeZone: "UTC",
      connectionState: "connected",
      grantedScopes: REQUIRED_GOOGLE_SCOPES,
      missingScopes: [],
      lastAuthenticatedAt: now,
      updatedAt: now
    });
    syncRepository.writeTaskLists(
      accountId,
      perfFixture.taskLists.map((list) => ({
        id: list.id,
        title: list.title,
        updatedAt: now
      })),
      now
    );

    for (const taskList of perfFixture.taskLists) {
      syncRepository.writeTasks(
        accountId,
        taskList.id,
        perfFixture.tasks
          .filter((task) => task.taskListId === taskList.id)
          .map((task) => ({
            id: task.id,
            taskListId: task.taskListId,
            parentId: task.parentTaskId,
            title: task.title,
            notes: `Generated local task notes for ${task.title}`,
            status: task.status,
            dueAt: task.dueAt,
            completedAt: task.completedAt,
            deleted: false,
            hidden: false,
            position: String(task.sortOrder).padStart(12, "0"),
            updatedAt: task.updatedAt
          })),
        {
          fullSync: true,
          now
        }
      );
    }

    syncRepository.writeCalendarLists(
      accountId,
      perfFixture.calendars.map((calendar, index) => ({
        id: calendar.id,
        summary: calendar.title,
        timeZone: "UTC",
        isSelected: true,
        isHidden: false,
        isPrimary: index === 0,
        updatedAt: now
      })),
      now
    );

    for (const calendar of perfFixture.calendars) {
      syncRepository.writeCalendarEvents(
        accountId,
        calendar.id,
        perfFixture.eventInstances
          .filter((event) => event.calendarId === calendar.id)
          .map((event) => ({
            id: event.id,
            calendarId: event.calendarId,
            status: "confirmed" as const,
            summary: event.title,
            description: `Generated local calendar description for ${event.title}`,
            location: "Generated local fixture",
            startAt: event.startsAt,
            endAt: event.endsAt,
            isAllDay: event.isAllDay,
            updatedAt: event.updatedAt
          })),
        {
          fullSync: true,
          now
        }
      );
    }

    connection.executeTransaction(
      perfFixture.notes.map((note, index) => ({
        kind: "run",
        sql: `INSERT INTO google_tasks (
          id, account_id, task_list_id, google_id, parent_task_id, title, notes,
          status, due_at, due_time_zone, completed_at, position, sort_order,
          is_hidden, local_priority, local_tags_json, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, NULL, ?, ?, 'needsAction', NULL, NULL, NULL, NULL, ?, 0, 'none', '[]', ?, ?, NULL)
        ON CONFLICT(id) DO UPDATE SET
          task_list_id = excluded.task_list_id,
          google_id = excluded.google_id,
          title = excluded.title,
          notes = excluded.notes,
          sort_order = excluded.sort_order,
          updated_at = excluded.updated_at,
          deleted_at = NULL;`,
        params: [
          note.id,
          accountId,
          taskListLocalId(accountId, perfFixture.taskLists[0].id),
          note.id,
          note.title,
          note.body,
          index + 100_000,
          note.updatedAt,
          note.updatedAt
        ]
      }))
    );

    syncRepository.saveCheckpoint({
      accountId,
      resourceType: "tasks",
      resourceId: perfFixture.taskLists[0].id,
      checkpointType: "syncToken",
      checkpointValue: "generated-task-checkpoint",
      metadata: { fixture: fixtureSize },
      now
    });
    syncRepository.saveCheckpoint({
      accountId,
      resourceType: "calendar",
      resourceId: perfFixture.calendars[0].id,
      checkpointType: "syncToken",
      checkpointValue: "generated-calendar-checkpoint",
      metadata: { fixture: fixtureSize },
      now
    });
    connection.run(
      `INSERT INTO google_pending_mutations (
        id, account_id, resource_type, resource_id, operation, payload_json, status,
        attempt_count, next_retry_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        next_retry_at = excluded.next_retry_at,
        updated_at = excluded.updated_at;`,
      [
        "perf-pending-mutation-1",
        accountId,
        "task",
        taskLocalId(accountId, perfFixture.taskLists[0].id, perfFixture.tasks[0].id),
        "update",
        JSON.stringify({ generated: true }),
        "pending",
        0,
        now,
        now,
        now
      ]
    );

    return {
      databasePath: connection.databasePath,
      durationMs: roundMs(performance.now() - startedAt)
    };
  } finally {
    connection.close();
  }
}

function collectSqliteBaseline(userDataDir: string): SqliteBaselineResult {
  const connection = createAppSqliteConnection({ appSupportDirectory: userDataDir });

  try {
    runLocalDataMigrations(connection);
    const performanceRepository = new LocalPerformanceRepository(connection);
    const plannerRepository = new LocalPlannerRepository(connection, performanceRepository);
    const settingsRepository = new LocalSettingsRepository(connection);
    const syncRepository = new GoogleSyncRepository(connection);
    const measurements: PerfMeasurement[] = [];
    const autoTagRule: AutoTagRule = {
      id: "perf-auto-tag-generated-task",
      name: "Generated task",
      enabled: true,
      targetKinds: ["task", "event", "note"],
      matchField: "title",
      matchType: "prefix",
      pattern: "Generated task 00001",
      tags: ["perf"],
      stripMatchedPrefix: false,
      eventColorId: null,
      overrideExistingEventColor: false,
      createdAt: perfFixture.baseTime,
      updatedAt: perfFixture.baseTime
    };

    settingsRepository.update({ autoTagRules: [autoTagRule] });

    measure(measurements, `sqlite.task-lists.${fixtureSize}`, () =>
      plannerRepository.listTaskLists({ limit: 100 })
    );
    measure(measurements, `sqlite.tasks.active-list.${fixtureSize}`, () =>
      plannerRepository.listTasks({
        listId: taskListLocalId(accountId, perfFixture.taskLists[0].id),
        status: "active",
        limit: 100
      })
    );
    measure(measurements, `sqlite.tasks.calendar-bootstrap.${fixtureSize}`, () =>
      plannerRepository.listCalendarBootstrapTasks({
        start: perfFixture.baseTime,
        end: "2026-02-10T00:00:00.000Z",
        listIds: perfFixture.taskLists.map((list) => taskListLocalId(accountId, list.id)),
        limit: 100
      })
    );
    measure(measurements, `sqlite.events.visible-range.${fixtureSize}`, () =>
      plannerRepository.listCalendarEvents({
        calendarIds: [calendarLocalId(accountId, perfFixture.calendars[0].id)],
        start: perfFixture.baseTime,
        end: "2026-02-10T00:00:00.000Z",
        limit: 250
      })
    );
    measure(measurements, `sqlite.notes.recent.${fixtureSize}`, () =>
      plannerRepository.listNotes({ limit: 50 })
    );
    measure(measurements, `sqlite.tag-analytics.${fixtureSize}`, () =>
      plannerRepository.tagAnalytics()
    );
    measure(measurements, `search.${fixtureSize}-local`, () =>
      plannerRepository.search({
        query: "generated",
        limit: 30
      })
    );
    measure(measurements, "sqlite.checkpoint.read", () =>
      syncRepository.readCheckpoint({
        accountId,
        resourceType: "tasks",
        resourceId: perfFixture.taskLists[0].id,
        checkpointType: "syncToken"
      })
    );
    measure(measurements, "sqlite.pending-mutations.ready", () =>
      connection.get<{ count: number }>(
        `SELECT COUNT(*) AS count
         FROM google_pending_mutations
         WHERE status IN ('pending', 'failed', 'applying')
           AND (next_retry_at IS NULL OR next_retry_at <= ?);`,
        [perfFixture.baseTime]
      )
    );
    measure(measurements, `sqlite.auto-tags.preview-tasks.${fixtureSize}`, () =>
      plannerRepository.previewAutoTagReapply([autoTagRule], { kind: "task", scope: "all" })
    );
    measure(measurements, `sqlite.auto-tags.preview-events.${fixtureSize}`, () =>
      plannerRepository.previewAutoTagReapply([autoTagRule], { kind: "event", scope: "all" })
    );
    measure(measurements, `sqlite.auto-tags.preview-notes.${fixtureSize}`, () =>
      plannerRepository.previewAutoTagReapply([autoTagRule], { kind: "note", scope: "all" })
    );
    measure(measurements, `sqlite.auto-tags.apply-task.${fixtureSize}`, () =>
      plannerRepository.applyAutoTagReapply([autoTagRule], { kind: "task", scope: "all", confirm: true })
    );

    return {
      measurements,
      queryPlans: collectQueryPlans(connection)
    };
  } catch (error) {
    return {
      measurements: [
        {
          name: "sqlite.baseline",
          status: "skipped",
          reason: sanitizeError(error)
        }
      ],
      queryPlans: []
    };
  } finally {
    connection.close();
  }
}

function measure(measurements: PerfMeasurement[], name: string, operation: () => unknown): void {
  const startedAt = performance.now();

  try {
    operation();
    measurements.push({
      name,
      status: "collected",
      valueMs: roundMs(performance.now() - startedAt)
    });
  } catch (error) {
    measurements.push({
      name,
      status: "skipped",
      reason: sanitizeError(error)
    });
  }
}

function collectQueryPlans(connection: SqliteConnection): PerfQueryPlanReport[] {
  const taskListId = taskListLocalId(accountId, perfFixture.taskLists[0].id);
  const calendarId = calendarLocalId(accountId, perfFixture.calendars[0].id);
  const parentTask = perfFixture.tasks.find((task) => task.parentTaskId !== null);
  const parentTaskId =
    parentTask?.parentTaskId === null || parentTask?.parentTaskId === undefined
      ? taskLocalId(accountId, perfFixture.taskLists[0].id, perfFixture.tasks[0].id)
      : taskLocalId(accountId, parentTask.taskListId, parentTask.parentTaskId);
  const ftsQuery = "generated*";

  return [
    queryPlan(connection, {
      name: "task.active-by-list",
      category: "task",
      sql: `SELECT tasks.id, tasks.title, tasks.due_at
            FROM google_tasks tasks
            INNER JOIN google_task_lists lists ON lists.id = tasks.task_list_id
            WHERE tasks.deleted_at IS NULL
              AND tasks.is_hidden = 0
              AND lists.deleted_at IS NULL
              AND tasks.task_list_id = ?
              AND tasks.status != 'completed'
            ORDER BY
              CASE WHEN tasks.due_at IS NULL THEN 1 ELSE 0 END,
              tasks.due_at ASC,
              tasks.sort_order ASC,
              tasks.updated_at DESC,
              tasks.id ASC
            LIMIT ? OFFSET ?`,
      params: [taskListId, 100, 0]
    }),
    queryPlan(connection, {
      name: "task.subtasks-by-parent",
      category: "task",
      sql: `SELECT id, title, status
            FROM google_tasks
            WHERE parent_task_id = ?
              AND deleted_at IS NULL
            ORDER BY sort_order ASC, id ASC
            LIMIT ?`,
      params: [parentTaskId, 50]
    }),
    queryPlan(connection, {
      name: "task.calendar-bootstrap",
      category: "task",
      sql: `SELECT tasks.id, tasks.title, tasks.due_at
            FROM google_tasks tasks
            INNER JOIN google_task_lists lists ON lists.id = tasks.task_list_id
            WHERE lists.deleted_at IS NULL
              AND tasks.deleted_at IS NULL
              AND tasks.is_hidden = 0
              AND tasks.parent_task_id IS NULL
              AND tasks.due_at IS NOT NULL
              AND tasks.task_list_id IN (?)
              AND tasks.due_at >= ?
              AND tasks.due_at < ?
            ORDER BY
              tasks.due_at ASC,
              tasks.sort_order ASC,
              tasks.updated_at DESC,
              tasks.id ASC
            LIMIT ? OFFSET ?`,
      params: [taskListId, perfFixture.baseTime, "2026-02-10T00:00:00.000Z", 100, 0]
    }),
    queryPlan(connection, {
      name: "event.visible-range",
      category: "event",
      sql: `SELECT events.id, events.summary, events.start_at, events.end_at
            FROM google_calendar_events events
            INNER JOIN google_calendar_lists calendars ON calendars.id = events.calendar_id
            WHERE events.deleted_at IS NULL
              AND events.status != 'cancelled'
              AND calendars.deleted_at IS NULL
              AND events.start_at < ?
              AND events.end_at > ?
              AND events.calendar_id IN (?)
            ORDER BY events.start_at ASC, events.end_at ASC, events.id ASC
            LIMIT ? OFFSET ?`,
      params: ["2026-02-10T00:00:00.000Z", perfFixture.baseTime, calendarId, 250, 0]
    }),
    queryPlan(connection, {
      name: "note.recent",
      category: "note",
      sql: `SELECT tasks.id, tasks.title, tasks.notes, tasks.updated_at
            FROM google_tasks tasks
            INNER JOIN google_task_lists lists ON lists.id = tasks.task_list_id
            WHERE tasks.deleted_at IS NULL
              AND tasks.is_hidden = 0
              AND tasks.status != 'completed'
              AND tasks.parent_task_id IS NULL
              AND tasks.due_at IS NULL
              AND lists.deleted_at IS NULL
            ORDER BY tasks.updated_at DESC, tasks.id ASC
            LIMIT ? OFFSET ?`,
      params: [50, 0]
    }),
    queryPlan(connection, {
      name: "search.tasks-fts",
      category: "search",
      sql: `SELECT tasks.id, tasks.title, tasks.updated_at
            FROM google_tasks_fts
            INNER JOIN google_tasks tasks ON tasks.rowid = google_tasks_fts.rowid
            INNER JOIN google_task_lists lists ON lists.id = tasks.task_list_id
            WHERE google_tasks_fts MATCH ?
              AND tasks.deleted_at IS NULL
              AND tasks.is_hidden = 0
              AND lists.deleted_at IS NULL
            ORDER BY tasks.updated_at DESC, tasks.id ASC
            LIMIT ?`,
      params: [ftsQuery, 30]
    }),
    queryPlan(connection, {
      name: "search.events-fts",
      category: "search",
      sql: `SELECT events.id, events.summary, events.updated_at
            FROM google_calendar_events_fts
            INNER JOIN google_calendar_events events ON events.rowid = google_calendar_events_fts.rowid
            INNER JOIN google_calendar_lists calendars ON calendars.id = events.calendar_id
            WHERE google_calendar_events_fts MATCH ?
              AND events.deleted_at IS NULL
              AND events.status != 'cancelled'
              AND calendars.deleted_at IS NULL
            ORDER BY events.updated_at DESC, events.id ASC
            LIMIT ?`,
      params: [ftsQuery, 30]
    }),
    queryPlan(connection, {
      name: "search.notes-fts",
      category: "search",
      sql: `SELECT tasks.id, tasks.title, tasks.notes, tasks.updated_at
            FROM google_tasks_fts
            INNER JOIN google_tasks tasks ON tasks.rowid = google_tasks_fts.rowid
            INNER JOIN google_task_lists lists ON lists.id = tasks.task_list_id
            WHERE google_tasks_fts MATCH ?
              AND tasks.deleted_at IS NULL
              AND tasks.is_hidden = 0
              AND tasks.status != 'completed'
              AND tasks.parent_task_id IS NULL
              AND tasks.due_at IS NULL
              AND lists.deleted_at IS NULL
            ORDER BY tasks.updated_at DESC, tasks.id ASC
            LIMIT ?`,
      params: [ftsQuery, 30]
    }),
    queryPlan(connection, {
      name: "checkpoint.lookup",
      category: "checkpoint",
      sql: `SELECT checkpoint_value
            FROM google_sync_checkpoints
            WHERE account_id = ?
              AND resource_type = ?
              AND resource_id = ?
              AND checkpoint_type = ?`,
      params: [accountId, "tasks", perfFixture.taskLists[0].id, "syncToken"]
    }),
    queryPlan(connection, {
      name: "pending-mutation.ready",
      category: "pending_mutation",
      sql: `SELECT id, resource_type, resource_id
            FROM google_pending_mutations
            WHERE status IN ('pending', 'failed', 'applying')
              AND (next_retry_at IS NULL OR next_retry_at <= ?)
            ORDER BY next_retry_at ASC, created_at ASC
            LIMIT ?`,
      params: [perfFixture.baseTime, 50]
    })
  ];
}

function queryPlan(
  connection: SqliteConnection,
  request: {
    name: string;
    category: PerfQueryPlanReport["category"];
    sql: string;
    params: readonly (string | number | boolean | null)[];
  }
): PerfQueryPlanReport {
  try {
    const rows = connection.query<QueryPlanRow>(`EXPLAIN QUERY PLAN ${request.sql}`, request.params);
    const normalizedRows: PerfQueryPlanRow[] = rows.map((row) => ({
      id: row.id,
      parent: row.parent,
      detail: row.detail
    }));

    return {
      name: request.name,
      category: request.category,
      status: "collected",
      rows: normalizedRows,
      usesIndex: normalizedRows.some((row) => usesIndex(row.detail)),
      hasFullTableScan: normalizedRows.some((row) => hasFullTableScan(row.detail))
    };
  } catch (error) {
    return {
      name: request.name,
      category: request.category,
      status: "skipped",
      reason: sanitizeError(error)
    };
  }
}

function usesIndex(detail: string): boolean {
  return /\bUSING (?:COVERING )?(?:INDEX|AUTOMATIC INDEX|INTEGER PRIMARY KEY)\b/i.test(detail) ||
    /\bVIRTUAL TABLE INDEX\b/i.test(detail);
}

function hasFullTableScan(detail: string): boolean {
  return /\bSCAN\s+\w+\b/i.test(detail) && !/\bUSING\b|\bVIRTUAL TABLE INDEX\b/i.test(detail);
}

async function collectLaunchTiming(
  name: PerfLaunchCapture["name"],
  userDataDir: string
): Promise<{
  launch: PerfLaunchCapture;
  measurements: PerfMeasurement[];
  ipcRoutes: PerfIpcRouteReport[];
  performanceTimings: LocalPerformanceTiming[];
}> {
  const mainOutputPath = resolve(rootDir, "out", "main", "index.js");
  const skippedLaunch: PerfLaunchCapture = {
    name,
    status: "skipped",
    reason: "Build output is missing. Run pnpm build before collecting startup timings."
  };

  if (!existsSync(mainOutputPath)) {
    return {
      launch: skippedLaunch,
      measurements: launchSkippedMeasurements(name, skippedLaunch.reason),
      ipcRoutes: [],
      performanceTimings: []
    };
  }

  let electronApp: ElectronApplication | undefined;
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

    const page = await waitForAppShellWindow(electronApp, appShellTimeoutMs);
    await page
      .waitForFunction(
        `(async () => {
          const result = await window.hcb?.diagnostics.health();
          return Boolean(
            result?.ok &&
              result.data.startup.shellVisibleMs !== undefined &&
              result.data.startup.cachedDataRenderedMs !== undefined
          );
        })()`,
        undefined,
        { timeout: 10_000 }
      )
      .catch(() => undefined);

    const health = (await page.evaluate(`(async () => {
      const result = await window.hcb?.diagnostics.health();
      return result ?? null;
    })()`)) as DiagnosticsHealthResult;

    if (!health?.ok) {
      return {
        launch: {
          name,
          status: "skipped",
          reason: "Diagnostics health did not return startup timings."
        },
        measurements: launchSkippedMeasurements(
          name,
          "Diagnostics health did not return startup timings."
        ),
        ipcRoutes: [],
        performanceTimings: []
      };
    }

    const commandPaletteOpenMs = await measureCommandPaletteOpen(page);
    const rendererMeasurements = await collectRendererMeasurements(page, name);
    const rendererFlowMeasurements = skipUiFlows
      ? []
      : await collectRendererFlowMeasurements(page, name);
    const ipcMetrics = (await page.evaluate(`(async () => {
      const result = await window.hcb?.diagnostics.ipcMetrics();
      return result?.ok ? result.data : null;
    })()`)) as DiagnosticsIpcMetricsResponse | null;
    const performanceResponse = (await page.evaluate(`(async () => {
      const result = await window.hcb?.diagnostics.performance({ limit: 100 });
      return result?.ok ? result.data : null;
    })()`)) as DiagnosticsPerformanceResponse | null;

    const launch: PerfLaunchCapture = {
      name,
      status: "collected",
      timings: health.data.startup,
      wallClockMs: roundMs(performance.now() - startedAt),
      commandPaletteOpenMs
    };

    return {
      launch,
      measurements: [
        ...startupMeasurements(launch),
        {
          name: `${name}.command-palette.open`,
          status: "collected",
          valueMs: commandPaletteOpenMs
        },
        ...rendererMeasurements,
        ...rendererFlowMeasurements
      ],
      ipcRoutes: ipcRouteReports(ipcMetrics),
      performanceTimings: performanceResponse?.timings ?? []
    };
  } catch (error) {
    const reason = sanitizeError(error);

    return {
      launch: {
        name,
        status: "skipped",
        reason
      },
      measurements: launchSkippedMeasurements(name, reason),
      ipcRoutes: [],
      performanceTimings: []
    };
  } finally {
    await electronApp?.close();
  }
}

function skippedLaunchTiming(
  name: PerfLaunchCapture["name"],
  reason: string
): {
  launch: PerfLaunchCapture;
  measurements: PerfMeasurement[];
  ipcRoutes: PerfIpcRouteReport[];
  performanceTimings: LocalPerformanceTiming[];
} {
  return {
    launch: {
      name,
      status: "skipped",
      reason
    },
    measurements: launchSkippedMeasurements(name, reason),
    ipcRoutes: [],
    performanceTimings: []
  };
}

async function waitForAppShellWindow(
  electronApp: ElectronApplication,
  timeoutMs = 45_000
): Promise<Page> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const pages = electronApp.windows().filter((page) => !page.isClosed());

    for (const page of pages) {
      try {
        await page.getByTestId("app-shell").waitFor({ state: "visible", timeout: 250 });
        return page;
      } catch {
        // ignore transient startup/sync windows
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error("App shell window did not appear before timeout.");
}

async function measureCommandPaletteOpen(page: Page): Promise<number> {
  const startedAt = performance.now();
  await page.keyboard.press("Control+P");
  const dialog = page.getByRole("dialog", { name: "Command palette" });
  await dialog.waitFor({ state: "visible", timeout: 5_000 });
  const durationMs = roundMs(performance.now() - startedAt);
  await page.keyboard.press("Escape").catch(() => undefined);
  await dialog.waitFor({ state: "hidden", timeout: 5_000 }).catch(async () => {
    await page
      .getByRole("button", { name: "Close command palette" })
      .click({ timeout: 1_000 })
      .catch(() => undefined);
  });
  return durationMs;
}

async function collectRendererMeasurements(
  page: Page,
  launchName: string
): Promise<PerfMeasurement[]> {
  return page.evaluate(`(async () => {
    const evaluatedLaunchName = ${JSON.stringify(launchName)};
    const evaluatedFixtureSize = ${JSON.stringify(fixtureSize)};

    async function measureIpc(name, operation) {
      const startedAt = performance.now();

      try {
        await operation();
        return {
          name: evaluatedLaunchName + "." + name,
          status: "collected",
          valueMs: Math.max(0, Math.round((performance.now() - startedAt) * 100) / 100)
        };
      } catch (error) {
        return {
          name: evaluatedLaunchName + "." + name,
          status: "skipped",
          reason: error instanceof Error ? error.message.slice(0, 160) : "Renderer measurement failed."
        };
      }
    }

    function utcDayRange(date) {
      const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
      const end = new Date(start.getTime());
      end.setUTCDate(end.getUTCDate() + 1);
      return {
        start: start.toISOString(),
        end: end.toISOString()
      };
    }

    async function measureBootstrap(name, calendarRange) {
      const startedAt = performance.now();

      try {
        const result = await window.hcb.bootstrap.get({
          mode: "light",
          calendarRange: {
            start: calendarRange.start,
            end: calendarRange.end,
            limit: 500
          }
        });
        const payloadBytes = new Blob([JSON.stringify(result)]).size;
        return {
          name: evaluatedLaunchName + "." + name,
          status: "collected",
          valueMs: Math.max(0, Math.round((performance.now() - startedAt) * 100) / 100),
          reason: "payloadBytes=" + payloadBytes
        };
      } catch (error) {
        return {
          name: evaluatedLaunchName + "." + name,
          status: "skipped",
          reason: error instanceof Error ? error.message.slice(0, 160) : "Bootstrap measurement failed."
        };
      }
    }

    if (!window.hcb) {
      return [
        {
          name: evaluatedLaunchName + ".ipc.health-roundtrip",
          status: "skipped",
          reason: "Preload bridge unavailable."
        }
      ];
    }

    return [
      await measureBootstrap("ipc.bootstrap-light-startup-roundtrip", utcDayRange(new Date())),
      await measureBootstrap("ipc.bootstrap-light-wide-roundtrip", {
        start: "2026-01-05T00:00:00.000Z",
        end: "2026-02-10T00:00:00.000Z"
      }),
      await measureIpc("ipc.health-roundtrip", async () => window.hcb.diagnostics.health()),
      await measureIpc("ipc.tasks-list-roundtrip", async () =>
        window.hcb.tasks.list({ status: "active", limit: 100 })
      ),
      await measureIpc("ipc.calendar-range-roundtrip", async () =>
        window.hcb.calendar.listEvents({
          start: "2026-01-05T00:00:00.000Z",
          end: "2026-02-10T00:00:00.000Z",
          limit: 250
        })
      ),
      await measureIpc("search." + evaluatedFixtureSize + "-local", async () =>
        window.hcb.search.query({ query: "generated", limit: 30 })
      )
    ];
  })()`) as Promise<PerfMeasurement[]>;
}

async function collectRendererFlowMeasurements(
  page: Page,
  launchName: string
): Promise<PerfMeasurement[]> {
  const measurements: PerfMeasurement[] = [];

  measurements.push(
    await measurePageFlow(
      launchName,
      "quick-capture.open",
      async () => {
        await navigateToSection(page, "Tasks");
        const quickCaptureInput = page.getByRole("textbox", { name: "Quick capture task" });
        const quickCaptureButton = page.getByRole("button", { name: /^Quick capture$/ }).first();

        if (await quickCaptureInput.count() > 0) {
          await quickCaptureButton.click({ timeout: 5_000 });
          await quickCaptureInput.waitFor({ state: "hidden", timeout: 5_000 }).catch(() => undefined);
        }
      },
      async () => {
        const quickCaptureInput = page.getByRole("textbox", { name: "Quick capture task" });
        const quickCaptureButton = page.getByRole("button", { name: /^Quick capture$/ }).first();

        await quickCaptureButton.click({ timeout: 5_000 });
        await quickCaptureInput.waitFor({ state: "visible", timeout: 5_000 });
      }
    )
  );

  measurements.push(
    await measurePageFlow(
      launchName,
      "tasks.complete",
      async () => {
        await navigateToSection(page, "Tasks");
      },
      async () => {
        const completeButton = page.getByRole("button", { name: /^Complete / }).first();
        const taskName = await completeButton.getAttribute("aria-label");

        await completeButton.click();

        if (taskName) {
          await page
            .getByRole("button", { name: taskName })
            .waitFor({ state: "hidden", timeout: 5_000 })
            .catch(() => undefined);
        }
      }
    )
  );

  measurements.push(
    await measurePageFlow(
      launchName,
      "tasks.scroll",
      async () => {
        await navigateToSection(page, "Tasks");
      },
      async () => {
        const taskList = page.getByRole("list", { name: /tasks$/i }).first();

        await taskList.evaluate((element) => {
          element.scrollTop = element.scrollHeight;
          element.dispatchEvent(new Event("scroll", { bubbles: true }));
        });
        await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
      }
    )
  );

  measurements.push(
    await measurePageFlow(
      launchName,
      "calendar.month-navigation",
      async () => {
        await navigateToSection(page, "Calendar");
        await page.getByRole("tab", { name: "Agenda" }).click().catch(() => undefined);
      },
      async () => {
        await page.getByRole("tab", { name: "Month" }).click();
        await page.getByRole("grid", { name: "Calendar month view" }).waitFor({
          state: "visible",
          timeout: 5_000
        });
      }
    )
  );

  measurements.push(
    await measurePageFlow(
      launchName,
      "notes.edit",
      async () => {
        await navigateToSection(page, "Notes");
        await page.getByRole("textbox", { name: "Note body" }).waitFor({
          state: "visible",
          timeout: 5_000
        });
      },
      async () => {
        const body = page.getByRole("textbox", { name: "Note body" });

        await body.fill("Performance smoke edit with generated local data.");
        await body.blur();
      }
    )
  );

  measurements.push(
    await measurePageFlow(
      launchName,
      "search.ui",
      async () => {
        await navigateToSection(page, "Search");
      },
      async () => {
        await page.getByRole("textbox", { name: "Search local cache" }).fill("generated");
        await page
          .getByText(/Generated (task|event|note)/)
          .first()
          .waitFor({ state: "visible", timeout: 5_000 });
      }
    )
  );

  return measurements;
}

async function navigateToSection(page: Page, label: string): Promise<void> {
  await page.getByRole("button", { name: new RegExp(`^${label}\\b`) }).click({ timeout: 5_000 });
  await page.locator("#planner-title").filter({ hasText: label }).waitFor({
    state: "visible",
    timeout: 5_000
  });
}

async function measurePageFlow(
  launchName: string,
  flowName: string,
  setup: () => Promise<void>,
  operation: () => Promise<void>
): Promise<PerfMeasurement> {
  try {
    await setup();
    const startedAt = performance.now();
    await operation();
    return {
      name: `${launchName}.${flowName}`,
      status: "collected",
      valueMs: roundMs(performance.now() - startedAt)
    };
  } catch (error) {
    return {
      name: `${launchName}.${flowName}`,
      status: "skipped",
      reason: sanitizeError(error)
    };
  }
}

function ipcRouteReports(
  metrics: DiagnosticsIpcMetricsResponse | null
): PerfIpcRouteReport[] {
  return (metrics?.routes ?? []).map((route) => ({
    route: route.route,
    totalCalls: route.totalCalls,
    averageDurationMs: route.averageDurationMs,
    ...(route.lastDurationMs === undefined ? {} : { lastDurationMs: route.lastDurationMs })
  }));
}

function launchSkippedMeasurements(name: string, reason: string | undefined): PerfMeasurement[] {
  return [
    {
      name: `${name}.startup.shell-visible`,
      status: "skipped",
      reason: reason ?? "Launch skipped."
    },
    {
      name: `${name}.startup.cached-data-rendered`,
      status: "skipped",
      reason: reason ?? "Launch skipped."
    },
    {
      name: `${name}.command-palette.open`,
      status: "skipped",
      reason: reason ?? "Launch skipped."
    }
  ];
}

function startupMeasurements(startup: StartupTimingCapture & { name?: string }): PerfMeasurement[] {
  if (startup.status !== "collected" || !startup.timings) {
    return [
      {
        name: `${startup.name ?? "startup"}.startup.shell-visible`,
        status: "skipped",
        reason: startup.reason ?? "Startup timing unavailable."
      }
    ];
  }

  const prefix = startup.name === undefined ? "startup" : `${startup.name}.startup`;
  const measurements: PerfMeasurement[] = [];

  for (const [field, name] of [
    ["appReadyMs", "app-ready"],
    ["windowCreatedMs", "main-window-created"],
    ["rendererLoadedMs", "renderer-loaded"],
    ["shellVisibleMs", "shell-visible"],
    ["databaseReadyMs", "database-ready"],
    ["cachedDataRenderedMs", "cached-data-rendered"]
  ] as const) {
    const value = startup.timings[field as keyof StartupTimingSnapshot];
    measurements.push(
      value === undefined
        ? {
            name: `${prefix}.${name}`,
            status: "skipped",
            reason:
              field === "databaseReadyMs"
                ? "No database initialization was reported."
                : "Startup mark was not reported."
          }
        : {
            name: `${prefix}.${name}`,
            status: "collected",
            valueMs: value
          }
    );
  }

  return measurements;
}

async function main(): Promise<void> {
  const temp = temporaryUserDataDir();

  try {
    const fixtureStartedAt = performance.now();
    const fixtures = summarizeAllPerfFixtureSets();
    const fixtureGenerationMs = roundMs(performance.now() - fixtureStartedAt);
    const seedResult = seedPerfFixtureDatabase(temp.userDataDir);
    const sqlite = collectSqliteBaseline(temp.userDataDir);
    const launchSkipReason = "Electron launch skipped by HCB_PERF_SKIP_ELECTRON=1.";
    const cold = skipElectronLaunch
      ? skippedLaunchTiming("cold", launchSkipReason)
      : await collectLaunchTiming("cold", temp.userDataDir);
    const warm = skipElectronLaunch
      ? skippedLaunchTiming("warm", launchSkipReason)
      : await collectLaunchTiming("warm", temp.userDataDir);
    const launches = [cold.launch, warm.launch];
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
      startup: launches[0],
      launches,
      measurements: [
        {
          name: "fixtures.generate-all",
          status: "collected",
          valueMs: fixtureGenerationMs
        },
        {
          name: `fixtures.seed-${fixtureSize}-sqlite`,
          status: "collected",
          valueMs: seedResult.durationMs
        },
        ...sqlite.measurements,
        ...cold.measurements,
        ...warm.measurements
      ],
      queryPlans: sqlite.queryPlans,
      ipcRoutes: mergeIpcRoutes([...cold.ipcRoutes, ...warm.ipcRoutes]),
      performanceTimings: warm.performanceTimings.length > 0
        ? warm.performanceTimings
        : cold.performanceTimings,
      futureHooks: [
        "Add native global-hotkey quick capture latency once the OS shortcut flow is implemented.",
        "Add large-fixture Electron launch coverage once seeded startup time is stable enough for local developer machines.",
        "Introduce hard failure thresholds only after stable baselines are accepted."
      ],
      notes: [
        "Report-only mode records numbers and query plans without failing on local timing variance.",
        "Fixture data is generated locally and deterministically; the harness does not call Google or read user app data.",
        `The ${fixtureSize} fixture is seeded into a temporary app data path before launch and deleted after reporting.`,
        skipUiFlows ? "Renderer UI flow measurements were skipped for this run." : "Renderer UI flow measurements were enabled for this run.",
        skipElectronLaunch ? "Electron launch measurements were skipped for this run." : "Electron launch measurements were enabled for this run.",
        `App shell wait timeout: ${appShellTimeoutMs}ms.`,
        "Electron security settings and renderer isolation are left unchanged for measurement.",
        `Temporary database path during run: ${redactSensitiveText(seedResult.databasePath)}`
      ]
    };

    const written = writePerformanceReport(report, artifactDir);

    console.log(`Wrote performance report to ${written.jsonPath}`);
    console.log(`Wrote performance markdown to ${written.markdownPath}`);
  } finally {
    temp.cleanup();
  }
}

function mergeIpcRoutes(routes: PerfIpcRouteReport[]): PerfIpcRouteReport[] {
  const merged = new Map<string, PerfIpcRouteReport>();

  for (const route of routes) {
    const existing = merged.get(route.route);

    if (!existing) {
      merged.set(route.route, { ...route });
      continue;
    }

    const totalCalls = existing.totalCalls + route.totalCalls;
    const averageDurationMs =
      (existing.averageDurationMs * existing.totalCalls + route.averageDurationMs * route.totalCalls) /
      totalCalls;

    merged.set(route.route, {
      route: route.route,
      totalCalls,
      averageDurationMs: roundMs(averageDurationMs),
      lastDurationMs: route.lastDurationMs ?? existing.lastDurationMs
    });
  }

  return [...merged.values()].sort((left, right) => left.route.localeCompare(right.route));
}

void main().catch((error) => {
  console.error(sanitizeError(error));
  process.exitCode = 1;
});
