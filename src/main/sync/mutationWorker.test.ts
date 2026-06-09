import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runLocalDataMigrations } from "../data/migrations";
import { LocalPlannerRepository } from "../data/localRepositories";
import {
  createTemporarySqliteConnection,
  type SqliteConnection,
  type TemporarySqliteConnection
} from "../data/sqliteConnection";
import {
  GoogleApiError,
  GOOGLE_CALENDAR_SCOPE,
  GOOGLE_TASKS_SCOPE,
  sanitizeGoogleAccountConnectionStatus,
  type GoogleCalendarWriteTransport,
  type GoogleTasksWriteTransport
} from "../google";
import { GoogleSyncRepository } from "./readSyncRepository";
import { GooglePendingMutationWorker, MutationBackoffPolicy } from "./mutationWorker";

const now = "2026-05-22T10:00:00.000Z";

let temp: TemporarySqliteConnection | undefined;

afterEach(() => {
  temp?.cleanup();
  temp = undefined;
});

function connectedAccount() {
  return sanitizeGoogleAccountConnectionStatus({
    accountId: "acct-1",
    googleAccountId: "acct-1",
    email: "planner@example.com",
    displayName: "Planner",
    connectionState: "connected",
    grantedScopes: [GOOGLE_TASKS_SCOPE, GOOGLE_CALENDAR_SCOPE],
    lastAuthenticatedAt: now,
    updatedAt: now
  });
}

function createHarness() {
  temp = createTemporarySqliteConnection("hcb2-mutation-worker-");
  runLocalDataMigrations(temp.connection);

  const repository = new GoogleSyncRepository(temp.connection);
  const planner = new LocalPlannerRepository(temp.connection);

  repository.upsertAccountStatus(connectedAccount());
  repository.writeTaskLists(
    "acct-1",
    [{ id: "inbox", title: "Inbox", updatedAt: now, etag: "list-etag" }],
    now
  );
  repository.writeTasks(
    "acct-1",
    "inbox",
    [
      {
        id: "existing-task",
        taskListId: "inbox",
        title: "Existing task",
        status: "needsAction",
        deleted: false,
        hidden: false,
        updatedAt: now,
        etag: "task-etag"
      }
    ],
    { fullSync: true, now }
  );
  repository.writeCalendarLists(
    "acct-1",
    [
      {
        id: "primary",
        summary: "Primary",
        timeZone: "UTC",
        isSelected: true,
        isHidden: false,
        isPrimary: true,
        updatedAt: now,
        etag: "calendar-etag"
      }
    ],
    now
  );
  repository.writeCalendarEvents(
    "acct-1",
    "primary",
    [
      {
        id: "existing-event",
        calendarId: "primary",
        status: "confirmed",
        summary: "Existing event",
        startAt: "2026-05-22T11:00:00.000Z",
        endAt: "2026-05-22T12:00:00.000Z",
        isAllDay: false,
        updatedAt: now,
        etag: "event-etag"
      }
    ],
    { fullSync: true, now }
  );

  return {
    connection: temp.connection,
    repository,
    planner
  };
}

function taskWrites(overrides: Partial<GoogleTasksWriteTransport> = {}): GoogleTasksWriteTransport {
  return {
    insertTaskList: vi.fn(async (title) => ({
      id: "remote-list-1",
      title,
      updatedAt: now,
      etag: "remote-list-etag"
    })),
    updateTaskList: vi.fn(async ({ taskListId, title }) => ({
      id: taskListId,
      title,
      updatedAt: now,
      etag: "remote-list-etag"
    })),
    deleteTaskList: vi.fn(async () => undefined),
    insertTask: vi.fn(async (taskListId, input) => ({
      id: "remote-task-1",
      taskListId,
      title: input.title,
      notes: input.notes ?? null,
      status: "needsAction" as const,
      dueAt: input.dueDate ? `${input.dueDate}T00:00:00.000Z` : null,
      completedAt: null,
      deleted: false,
      hidden: false,
      etag: "remote-task-etag",
      updatedAt: now
    })),
    updateTask: vi.fn(async (input) => ({
      id: input.taskId,
      taskListId: input.taskListId,
      title: input.title ?? "Updated task",
      notes: input.notes ?? null,
      status: input.status ?? "needsAction" as const,
      dueAt: input.dueDate ? `${input.dueDate}T00:00:00.000Z` : null,
      completedAt: input.completedAt ?? null,
      deleted: false,
      hidden: false,
      etag: "remote-task-etag",
      updatedAt: now
    })),
    setTaskCompleted: vi.fn(async (request) => ({
      id: request.taskId,
      taskListId: request.taskListId,
      title: "Completed task",
      status: request.completed ? "completed" as const : "needsAction" as const,
      completedAt: request.completed ? now : null,
      deleted: false,
      hidden: false,
      etag: "remote-task-etag",
      updatedAt: now
    })),
    moveTask: vi.fn(async (input) => ({
      id: input.taskId,
      taskListId: input.taskListId,
      parentId: input.parentId ?? null,
      title: "Moved task",
      status: "needsAction" as const,
      deleted: false,
      hidden: false,
      etag: "remote-task-etag",
      updatedAt: now
    })),
    deleteTask: vi.fn(async () => undefined),
    ...overrides
  };
}

function calendarWrites(
  overrides: Partial<GoogleCalendarWriteTransport> = {}
): GoogleCalendarWriteTransport {
  return {
    insertEvent: vi.fn(async (calendarId, input) => ({
      id: "remote-event-1",
      calendarId,
      status: "confirmed" as const,
      summary: input.summary,
      description: input.description ?? null,
      location: input.location ?? null,
      colorId: input.colorId ?? null,
      startAt: input.startAt,
      startTimeZone: input.startTimeZone ?? null,
      endAt: input.endAt,
      endTimeZone: input.endTimeZone ?? null,
      isAllDay: input.isAllDay,
      attendeeEmails: [...(input.attendeeEmails ?? [])],
      reminderMinutes: [...(input.reminderMinutes ?? [])],
      etag: "remote-event-etag",
      updatedAt: now
    })),
    updateEvent: vi.fn(async (input) => ({
      id: input.eventId,
      calendarId: input.calendarId,
      status: "confirmed" as const,
      summary: input.summary,
      description: input.description ?? null,
      location: input.location ?? null,
      colorId: input.colorId ?? null,
      startAt: input.startAt,
      startTimeZone: input.startTimeZone ?? null,
      endAt: input.endAt,
      endTimeZone: input.endTimeZone ?? null,
      isAllDay: input.isAllDay,
      attendeeEmails: [...(input.attendeeEmails ?? [])],
      reminderMinutes: [...(input.reminderMinutes ?? [])],
      etag: "remote-event-etag",
      updatedAt: now
    })),
    deleteEvent: vi.fn(async () => undefined),
    ...overrides
  };
}

function mutationRows(connection: SqliteConnection) {
  return connection.query<{
    operation: string;
    status: string;
    attemptCount: number;
    nextRetryAt: string | null;
    lastErrorCode: string | null;
  }>(
    `SELECT
       operation,
       status,
       attempt_count AS attemptCount,
       next_retry_at AS nextRetryAt,
       last_error_code AS lastErrorCode
     FROM google_pending_mutations
     ORDER BY created_at ASC, id ASC;`
  );
}

describe("Google pending mutation worker", () => {
  it("transitions queued task and calendar mutations through applying to applied", async () => {
    const { connection, planner, repository } = createHarness();
    const createdTask = planner.createTask({
      title: "Queue task create",
      notes: "Stored locally first.",
      dueDate: "2026-05-23",
      listId: "acct-1:task-list:inbox"
    });
    const createdEvent = planner.createCalendarEvent({
      title: "Queue event create",
      calendarId: "acct-1:calendar:primary",
      startsAt: "2026-05-23T00:00:00.000Z",
      endsAt: "2026-05-24T00:00:00.000Z",
      allDay: true,
      hcbKind: "birthday"
    });
    const tasks = taskWrites({
      insertTask: vi.fn(async (taskListId, input) => {
        expect(
          connection.get<{ status: string }>(
            "SELECT status FROM google_pending_mutations WHERE operation = 'task.create';"
          )
        ).toEqual({ status: "applying" });

        return {
          id: "remote-task-created",
          taskListId,
          title: input.title,
          notes: input.notes ?? null,
          status: "needsAction" as const,
          dueAt: "2026-05-23T00:00:00.000Z",
          completedAt: null,
          deleted: false,
          hidden: false,
          etag: "remote-task-etag",
          updatedAt: now
        };
      })
    });
    const calendar = calendarWrites();
    const worker = new GooglePendingMutationWorker({
      repository,
      tasks,
      calendar,
      now: () => new Date(now)
    });

    const result = await worker.drainDue();

    expect(result).toMatchObject({
      attemptedCount: 2,
      appliedCount: 2,
      failedCount: 0,
      locked: false
    });
    expect(calendar.insertEvent).toHaveBeenCalledWith("primary", {
      hcbKind: "birthday",
      summary: "Queue event create",
      startAt: "2026-05-23T00:00:00.000Z",
      endAt: "2026-05-24T00:00:00.000Z",
      isAllDay: true,
      recurrenceRule: "RRULE:FREQ=YEARLY",
      colorId: null,
      reminderMinutes: [],
      reminders: [],
      remindersUseDefault: false
    });
    expect(mutationRows(connection).map((row) => row.status)).toEqual(["applied", "applied"]);
    expect(
      connection.get<{ googleId: string; etag: string | null }>(
        "SELECT google_id AS googleId, etag FROM google_tasks WHERE id = ?;",
        [createdTask.id]
      )
    ).toEqual({ googleId: "remote-task-created", etag: "remote-task-etag" });
    expect(
      connection.get<{ googleId: string; etag: string | null; hcbKind: string | null }>(
        "SELECT google_id AS googleId, etag, hcb_kind AS hcbKind FROM google_calendar_events WHERE id = ?;",
        [createdEvent.id]
      )
    ).toEqual({ googleId: "remote-event-1", etag: "remote-event-etag", hcbKind: "birthday" });
  });

  it("updates birthday events with birthday-safe Google input", async () => {
    const { planner, repository } = createHarness();
    repository.writeCalendarEvents(
      "acct-1",
      "primary",
      [
        {
          id: "birthday-existing",
          calendarId: "primary",
          hcbKind: "birthday",
          status: "confirmed",
          summary: "Birthday existing",
          startAt: "2026-06-01T00:00:00.000Z",
          endAt: "2026-06-02T00:00:00.000Z",
          isAllDay: true,
          recurrenceRule: "RRULE:FREQ=YEARLY",
          updatedAt: now,
          etag: "birthday-etag"
        }
      ],
      { fullSync: false, now }
    );
    planner.updateCalendarEvent({
      id: "acct-1:event:primary:birthday-existing",
      title: "Birthday updated",
      startsAt: "2026-06-03T00:00:00.000Z",
      endsAt: "2026-06-04T00:00:00.000Z",
      allDay: true,
      location: "Should stay local-only",
      notes: "Should stay local-only",
      guestEmails: ["ada@example.com"],
      reminderMinutes: [15],
      hcbKind: "birthday"
    });
    const calendar = calendarWrites();
    const worker = new GooglePendingMutationWorker({
      repository,
      tasks: taskWrites(),
      calendar,
      now: () => new Date(now)
    });

    await expect(worker.drainDue()).resolves.toMatchObject({
      attemptedCount: 1,
      appliedCount: 1,
      failedCount: 0
    });
    expect(calendar.updateEvent).toHaveBeenCalledWith({
      calendarId: "primary",
      eventId: "birthday-existing",
      ifMatch: "birthday-etag",
      hcbKind: "birthday",
      summary: "Birthday updated",
      startAt: "2026-06-03T00:00:00.000Z",
      endAt: "2026-06-04T00:00:00.000Z",
      isAllDay: true,
      recurrenceRule: "RRULE:FREQ=YEARLY",
      colorId: null,
      reminderMinutes: [15],
      reminders: [{ method: "popup", minutes: 15 }],
      remindersUseDefault: false
    });
  });

  it("schedules retryable failures with bounded exponential backoff and later applies them", async () => {
    const { connection, planner, repository } = createHarness();
    planner.createTask({
      title: "Retry me",
      listId: "acct-1:task-list:inbox"
    });
    let current = Date.parse(now);
    const tasks = taskWrites({
      insertTask: vi
        .fn()
        .mockRejectedValueOnce(
          new GoogleApiError({
            kind: "rate_limited",
            status: 429,
            message: "rate limited token should stay redacted"
          })
        )
        .mockResolvedValueOnce({
          id: "remote-task-retried",
          taskListId: "inbox",
          title: "Retry me",
          status: "needsAction" as const,
          deleted: false,
          hidden: false,
          updatedAt: now,
          etag: "remote-task-etag"
        })
    });
    const worker = new GooglePendingMutationWorker({
      repository,
      tasks,
      calendar: calendarWrites(),
      backoffPolicy: new MutationBackoffPolicy({
        baseDelayMs: 1_000,
        jitterMs: 200,
        random: () => 0.5
      }),
      now: () => new Date(current)
    });

    const failed = await worker.drainDue();
    const afterFailure = mutationRows(connection)[0];

    expect(failed).toMatchObject({
      attemptedCount: 1,
      appliedCount: 0,
      failedCount: 1,
      nextRetryAt: "2026-05-22T10:00:02.100Z"
    });
    expect(afterFailure).toMatchObject({
      status: "failed",
      attemptCount: 1,
      nextRetryAt: "2026-05-22T10:00:02.100Z",
      lastErrorCode: "RATE_LIMITED"
    });
    expect(JSON.stringify(afterFailure)).not.toContain("token");

    current = Date.parse("2026-05-22T10:00:02.100Z");

    const retried = await worker.drainDue();

    expect(retried).toMatchObject({
      attemptedCount: 1,
      appliedCount: 1,
      failedCount: 0
    });
    expect(mutationRows(connection)[0]).toMatchObject({
      status: "applied",
      attemptCount: 1,
      nextRetryAt: null,
      lastErrorCode: null
    });
    expect(tasks.insertTask).toHaveBeenCalledTimes(2);
  });

  it("pauses the account and leaves diagnostics when Google reports an auth failure", async () => {
    const { connection, planner, repository } = createHarness();
    planner.createTask({
      title: "Needs reauth",
      listId: "acct-1:task-list:inbox"
    });
    const tasks = taskWrites({
      insertTask: vi.fn(async () => {
        throw new GoogleApiError({
          kind: "unauthorized",
          status: 401,
          message: "access-token must not leak"
        });
      })
    });
    const worker = new GooglePendingMutationWorker({
      repository,
      tasks,
      calendar: calendarWrites(),
      now: () => new Date(now)
    });

    const failed = await worker.drainDue();
    const paused = await worker.drainDue();

    expect(failed).toMatchObject({
      attemptedCount: 1,
      appliedCount: 0,
      failedCount: 1
    });
    expect(paused).toMatchObject({
      attemptedCount: 0,
      appliedCount: 0,
      failedCount: 0
    });
    expect(repository.accountStatus("acct-1")?.connectionState).toBe("reauth_required");
    expect(mutationRows(connection)[0]).toMatchObject({
      status: "failed",
      attemptCount: 1,
      nextRetryAt: null,
      lastErrorCode: "UNAUTHORIZED"
    });
    expect(repository.pendingMutationDiagnostics()).toMatchObject({
      totalCount: 1,
      failedCount: 1,
      authPausedCount: 1,
      lastErrorCode: "UNAUTHORIZED"
    });
    expect(JSON.stringify(repository.pendingMutationDiagnostics())).not.toContain("access-token");
    expect(tasks.insertTask).toHaveBeenCalledTimes(1);
  });

  it("keeps the mutation worker out of renderer and preload source", () => {
    const scannedRoots = [
      join(process.cwd(), "src", "renderer", "src"),
      join(process.cwd(), "src", "preload")
    ];
    const offenders = scannedRoots
      .flatMap(sourceFiles)
      .filter((filePath) => readFileSync(filePath, "utf8").includes("mutationWorker"));

    expect(offenders.map((filePath) => relative(process.cwd(), filePath))).toEqual([]);
  });
});

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return sourceFiles(path);
    }

    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}
