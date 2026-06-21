import { describe, expect, it, vi } from "vitest";
import { createTemporarySqliteConnection, type SqliteConnection } from "../data/sqliteConnection";
import {
  GoogleApiError,
  GOOGLE_CALENDAR_SCOPE,
  GOOGLE_TASKS_SCOPE,
  sanitizeGoogleAccountConnectionStatus,
  type GoogleCalendarReadTransport,
  type GoogleTasksReadTransport
} from "../google";
import { SyncBackoffPolicy } from "./backoffPolicy";
import { GoogleSyncRepository } from "./readSyncRepository";
import { GoogleReadSyncService } from "./readSyncService";

function connectedAccount() {
  return sanitizeGoogleAccountConnectionStatus({
    accountId: "google:account-1",
    googleAccountId: "account-1",
    email: "planner@example.com",
    displayName: "Planner",
    connectionState: "connected",
    grantedScopes: [GOOGLE_TASKS_SCOPE, GOOGLE_CALENDAR_SCOPE],
    lastAuthenticatedAt: "2026-05-22T09:00:00.000Z",
    updatedAt: "2026-05-22T09:00:00.000Z"
  });
}

function clock() {
  let currentMs = Date.parse("2026-05-22T10:00:00.000Z");

  return () => {
    currentMs += 250;
    return new Date(currentMs);
  };
}

function defaultTasksTransport(): GoogleTasksReadTransport {
  return {
    listTaskLists: vi.fn(async () => [
      {
        id: "list-1",
        title: "Inbox",
        updatedAt: "2026-05-21T01:00:00.000Z",
        etag: "list-etag"
      }
    ]),
    listTasks: vi.fn(async () => ({
      serverDate: "Fri, 22 May 2026 02:00:00 GMT",
      tasks: [
        {
          id: "task-1",
          taskListId: "list-1",
          title: "Plan launch",
          notes: "Local cache only",
          status: "needsAction" as const,
          dueAt: "2026-05-23T00:00:00.000Z",
          completedAt: null,
          deleted: false,
          hidden: false,
          position: "0001",
          etag: "task-etag",
          updatedAt: "2026-05-21T02:00:00.000Z"
        }
      ]
    }))
  };
}

function defaultCalendarTransport(): GoogleCalendarReadTransport {
  return {
    listCalendarLists: vi.fn(async () => [
      {
        id: "primary",
        summary: "Primary",
        timeZone: "Asia/Singapore",
        accessRole: "owner",
        isSelected: true,
        isHidden: false,
        isPrimary: true,
        etag: "calendar-etag",
        updatedAt: "2026-05-21T03:00:00.000Z"
      }
    ]),
    listEvents: vi.fn(async () => ({
      nextSyncToken: "calendar-sync-next",
      events: [
        {
          id: "event-1",
          calendarId: "primary",
          status: "confirmed" as const,
          summary: "Launch review",
          description: "Agenda",
          location: "Room 1",
          startAt: "2026-05-24T01:00:00.000Z",
          startTimeZone: "Asia/Singapore",
          endAt: "2026-05-24T02:00:00.000Z",
          endTimeZone: "Asia/Singapore",
          isAllDay: false,
          etag: "event-etag",
          updatedAt: "2026-05-21T04:00:00.000Z"
        }
      ]
    }))
  };
}

async function withRepository<T>(
  run: (repository: GoogleSyncRepository, connection: SqliteConnection) => Promise<T>
): Promise<T> {
  const temporary = createTemporarySqliteConnection("hcb-google-sync-test-");

  try {
    return await run(new GoogleSyncRepository(temporary.connection), temporary.connection);
  } finally {
    temporary.cleanup();
  }
}

describe("Google read sync service", () => {
  it("syncs task and calendar mirrors with sanitized diagnostics and checkpoints", async () => {
    await withRepository(async (repository, connection) => {
      const tasks = defaultTasksTransport();
      const calendar = defaultCalendarTransport();
      const progress = vi.fn();
      const service = new GoogleReadSyncService({
        repository,
        tasks,
        calendar,
        now: clock(),
        eventSink: progress
      });

      const result = await service.runReadSync({
        account: connectedAccount(),
        resources: ["tasks", "calendar"]
      });

      expect(result.ok).toBe(true);
      expect(result.diagnostics.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.diagnostics).toMatchObject({
        state: "idle",
        taskListCount: 1,
        taskCount: 1,
        calendarListCount: 1,
        eventCount: 1
      });
      expect(repository.syncStatus()).toMatchObject({
        state: "idle",
        pendingMutationCount: 0
      });
      expect(
        repository.readCheckpoint({
          accountId: "google:account-1",
          resourceType: "task_list",
          resourceId: "list-1",
          checkpointType: "watermark:v3-split-completed"
        })
      ).toBe("2026-05-22T02:00:00.000Z");
      expect(
        repository.readCheckpoint({
          accountId: "google:account-1",
          resourceType: "calendar",
          resourceId: "primary",
          checkpointType: "sync_token"
        })
      ).toBe("calendar-sync-next");
      expect(
        connection.get<{ title: string }>("SELECT title FROM google_tasks WHERE google_id = ?;", [
          "task-1"
        ])
      ).toEqual({ title: "Plan launch" });
      expect(
        connection.get<{ summary: string }>(
          "SELECT summary FROM google_calendar_events WHERE google_id = ?;",
          ["event-1"]
        )
      ).toEqual({ summary: "Launch review" });
      expect(progress).toHaveBeenCalledWith(expect.objectContaining({ type: "resource.progress" }));
      expect(JSON.stringify(result)).not.toContain("token");
      expect(JSON.stringify(result)).not.toContain("Local cache only");
      expect(JSON.stringify(result)).not.toContain("Agenda");
    });
  });

  it("full-syncs open no-date tasks separately from retained completed tasks", async () => {
    await withRepository(async (repository, connection) => {
      const tasks: GoogleTasksReadTransport = {
        listTaskLists: vi.fn(async () => [
          {
            id: "list-1",
            title: "Inbox",
            updatedAt: "2026-05-21T01:00:00.000Z"
          }
        ]),
        listTasks: vi.fn(async (request) => ({
          serverDate: "Fri, 22 May 2026 02:00:00 GMT",
          tasks:
            request.showCompleted === false
              ? [
                  {
                    id: "task-open-note",
                    taskListId: "list-1",
                    title: "Undated Google task",
                    status: "needsAction" as const,
                    dueAt: null,
                    completedAt: null,
                    deleted: false,
                    hidden: false,
                    position: "0001",
                    updatedAt: "2026-05-21T02:00:00.000Z"
                  }
                ]
              : [
                  {
                    id: "task-completed",
                    taskListId: "list-1",
                    title: "Finished Google task",
                    status: "completed" as const,
                    dueAt: null,
                    completedAt: "2026-05-21T03:00:00.000Z",
                    deleted: false,
                    hidden: true,
                    position: "0002",
                    updatedAt: "2026-05-21T03:00:00.000Z"
                  }
                ]
        }))
      };
      const service = new GoogleReadSyncService({
        repository,
        tasks,
        calendar: defaultCalendarTransport(),
        now: clock()
      });

      const result = await service.runReadSync({
        account: connectedAccount(),
        resources: ["tasks"],
        completedTaskRetentionDaysBack: 365,
        full: true
      });

      expect(result.ok).toBe(true);
      expect(result.diagnostics.taskCount).toBe(2);
      expect(tasks.listTasks).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          taskListId: "list-1",
          updatedMin: null,
          showCompleted: false
        })
      );
      expect(tasks.listTasks).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          taskListId: "list-1",
          updatedMin: null,
          completedMin: "2025-05-22T10:00:00.250Z",
          showCompleted: true
        })
      );
      expect(
        connection.get<{ title: string; dueAt: string | null; status: string }>(
          "SELECT title, due_at AS dueAt, status FROM google_tasks WHERE google_id = ?;",
          ["task-open-note"]
        )
      ).toEqual({
        title: "Undated Google task",
        dueAt: null,
        status: "needsAction"
      });
      expect(
        connection.get<{ title: string; status: string }>(
          "SELECT title, status FROM google_tasks WHERE google_id = ?;",
          ["task-completed"]
        )
      ).toEqual({
        title: "Finished Google task",
        status: "completed"
      });
    });
  });

  it.each([
    {
      kind: "unauthorized" as const,
      status: 401,
      expected: "UNAUTHORIZED" as const
    },
    {
      kind: "forbidden" as const,
      status: 403,
      expected: "FORBIDDEN" as const
    }
  ])("returns sanitized account-action failures for Google $status", async ({ kind, status, expected }) => {
    await withRepository(async (repository) => {
      const tasks: GoogleTasksReadTransport = {
        listTaskLists: vi.fn(async () => {
          throw new GoogleApiError({
            kind,
            status,
            message: `secret-token should not leak for ${status}`,
            responseBodyBytes: 64
          });
        }),
        listTasks: vi.fn()
      };
      const service = new GoogleReadSyncService({
        repository,
        tasks,
        calendar: defaultCalendarTransport(),
        now: clock()
      });

      const result = await service.runReadSync({
        account: connectedAccount(),
        resources: ["tasks"]
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(expected);
        expect(result.error.recoverable).toBe(true);
      }
      expect(JSON.stringify(result)).not.toContain("secret-token");
      expect(repository.syncStatus().lastErrorCode).toBe(expected);
    });
  });

  it("falls back to a full Calendar resync when Google invalidates nextSyncToken", async () => {
    await withRepository(async (repository) => {
      repository.saveCheckpoint({
        accountId: "google:account-1",
        resourceType: "calendar",
        resourceId: "primary",
        checkpointType: "sync_token",
        checkpointValue: "stale-token",
        metadata: {},
        now: "2026-05-22T09:00:00.000Z"
      });
      const listEvents: GoogleCalendarReadTransport["listEvents"] = vi
        .fn()
        .mockRejectedValueOnce(
          new GoogleApiError({
            kind: "invalid_sync_token",
            status: 410,
            message: "sync token expired"
          })
        )
        .mockResolvedValueOnce({
          nextSyncToken: "fresh-token",
          events: [
            {
              id: "event-fresh",
              calendarId: "primary",
              status: "confirmed",
              summary: "Fresh full sync event",
              startAt: "2026-05-25T01:00:00.000Z",
              endAt: "2026-05-25T02:00:00.000Z",
              isAllDay: false
            }
          ]
        });
      const calendar: GoogleCalendarReadTransport = {
        listCalendarLists: vi.fn(async () => [
          {
            id: "primary",
            summary: "Primary",
            isSelected: true,
            isHidden: false,
            isPrimary: true
          }
        ]),
        listEvents
      };
      const service = new GoogleReadSyncService({
        repository,
        tasks: defaultTasksTransport(),
        calendar,
        now: clock()
      });

      const result = await service.runReadSync({
        account: connectedAccount(),
        resources: ["calendar"]
      });

      expect(result.ok).toBe(true);
      expect(listEvents).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          syncToken: "stale-token"
        })
      );
      expect(listEvents).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          syncToken: null
        })
      );
      expect(
        repository.readCheckpoint({
          accountId: "google:account-1",
          resourceType: "calendar",
          resourceId: "primary",
          checkpointType: "sync_token"
        })
      ).toBe("fresh-token");
      expect(result.events).toContainEqual(
        expect.objectContaining({
          type: "checkpoint.invalid",
          resource: "calendar"
        })
      );
      expect(result.summaries[0]).toMatchObject({
        resource: "calendar",
        fullSyncCount: 1,
        itemCount: 1
      });
    });
  });

  it("schedules jittered backoff for Google 429 responses", async () => {
    await withRepository(async (repository) => {
      const tasks: GoogleTasksReadTransport = {
        listTaskLists: vi.fn(async () => {
          throw new GoogleApiError({
            kind: "rate_limited",
            status: 429,
            message: "rate limited"
          });
        }),
        listTasks: vi.fn()
      };
      const service = new GoogleReadSyncService({
        repository,
        tasks,
        calendar: defaultCalendarTransport(),
        backoffPolicy: new SyncBackoffPolicy({
          baseDelayMs: 1_000,
          jitterMs: 200,
          random: () => 0.5
        }),
        now: clock()
      });

      const result = await service.runReadSync({
        account: connectedAccount(),
        resources: ["tasks"],
        attempt: 1
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatchObject({
          code: "RATE_LIMITED",
          retryAfterMs: 2_100
        });
      }
      expect(result.events).toContainEqual(
        expect.objectContaining({
          type: "backoff.scheduled",
          retryAfterMs: 2_100
        })
      );
      expect(repository.syncStatus().lastErrorCode).toBe("RATE_LIMITED");
    });
  });

  it("schedules retry-after backoff for Google 5xx responses", async () => {
    await withRepository(async (repository) => {
      const calendar: GoogleCalendarReadTransport = {
        listCalendarLists: vi.fn(async () => {
          throw new GoogleApiError({
            kind: "server",
            status: 503,
            message: "server unavailable",
            retryAfterMs: 45_000
          });
        }),
        listEvents: vi.fn()
      };
      const service = new GoogleReadSyncService({
        repository,
        tasks: defaultTasksTransport(),
        calendar,
        backoffPolicy: new SyncBackoffPolicy({
          baseDelayMs: 1_000,
          jitterMs: 0,
          random: () => 0
        }),
        now: clock()
      });

      const result = await service.runReadSync({
        account: connectedAccount(),
        resources: ["calendar"]
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatchObject({
          code: "SERVICE_UNAVAILABLE",
          retryAfterMs: 45_000
        });
      }
      expect(result.events).toContainEqual(
        expect.objectContaining({
          type: "backoff.scheduled",
          retryAfterMs: 45_000
        })
      );
      expect(repository.syncStatus().lastErrorCode).toBe("SERVICE_UNAVAILABLE");
    });
  });
});
