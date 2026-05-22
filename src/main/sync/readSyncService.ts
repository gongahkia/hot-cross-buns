import type {
  GoogleAccountConnectionStatusDto,
  GoogleCalendarListMirror,
  GoogleCalendarReadTransport,
  GoogleTasksReadTransport
} from "../google";
import { GoogleApiError } from "../google";
import { SyncBackoffPolicy } from "./backoffPolicy";
import type { GoogleSyncRepository } from "./readSyncRepository";
import type {
  ReadSyncFailure,
  ReadSyncResource,
  ReadSyncResourceSummary,
  ReadSyncResult,
  ReadSyncRunRequest,
  SanitizedSyncDiagnosticsDto,
  SyncProgressEvent
} from "./types";

export interface GoogleReadSyncServiceOptions {
  repository: GoogleSyncRepository;
  tasks: GoogleTasksReadTransport;
  calendar: GoogleCalendarReadTransport;
  backoffPolicy?: SyncBackoffPolicy;
  now?: () => Date;
  eventSink?: (event: SyncProgressEvent) => void;
}

interface MutableRunCounters {
  taskListCount: number;
  taskCount: number;
  calendarListCount: number;
  eventCount: number;
}

const DEFAULT_RESOURCES: readonly ReadSyncResource[] = ["tasks", "calendar"];
const TASKS_WATERMARK_SLACK_MS = 5 * 60 * 1000;

export class GoogleReadSyncService {
  private readonly repository: GoogleSyncRepository;
  private readonly tasks: GoogleTasksReadTransport;
  private readonly calendar: GoogleCalendarReadTransport;
  private readonly backoffPolicy: SyncBackoffPolicy;
  private readonly now: () => Date;
  private readonly eventSink: ((event: SyncProgressEvent) => void) | undefined;

  constructor(options: GoogleReadSyncServiceOptions) {
    this.repository = options.repository;
    this.tasks = options.tasks;
    this.calendar = options.calendar;
    this.backoffPolicy = options.backoffPolicy ?? new SyncBackoffPolicy();
    this.now = options.now ?? (() => new Date());
    this.eventSink = options.eventSink;
  }

  async runReadSync(request: ReadSyncRunRequest): Promise<ReadSyncResult> {
    const resources = normalizedResources(request.resources);
    const runStartedAt = this.now();
    const startedAt = runStartedAt.toISOString();
    const runId = `google-read-sync:${runStartedAt.getTime()}:${Math.random().toString(36).slice(2, 8)}`;
    const events: SyncProgressEvent[] = [];
    const summaries: ReadSyncResourceSummary[] = [];
    const counters: MutableRunCounters = {
      taskListCount: 0,
      taskCount: 0,
      calendarListCount: 0,
      eventCount: 0
    };
    const emit = (event: Omit<SyncProgressEvent, "runId" | "accountId" | "at">) => {
      const progressEvent: SyncProgressEvent = {
        runId,
        accountId: request.account.accountId,
        at: this.now().toISOString(),
        ...event
      };

      events.push(progressEvent);
      this.repository.recordProgressEvent(progressEvent);
      this.eventSink?.(progressEvent);
    };

    const baseDiagnostics: SanitizedSyncDiagnosticsDto = {
      runId,
      accountId: request.account.accountId,
      state: "running",
      resources,
      startedAt
    };

    emit({ type: "sync.started", totalCount: resources.length });
    this.repository.upsertAccountStatus(request.account);
    this.repository.recordDiagnostics(baseDiagnostics);

    if (request.account.connectionState !== "connected") {
      const failure: ReadSyncFailure = {
        code: "UNAUTHORIZED",
        message: "Google account is not connected",
        recoverable: true
      };
      const diagnostics = this.completeDiagnostics(baseDiagnostics, runStartedAt, counters, failure);

      this.repository.recordDiagnostics(diagnostics);
      emit({ type: "sync.failed", errorCode: failure.code, durationMs: diagnostics.durationMs });

      return {
        ok: false,
        error: failure,
        diagnostics,
        summaries,
        events
      };
    }

    try {
      if (!request.dryRun && resources.includes("tasks")) {
        const summary = await this.syncTasks({
          account: request.account,
          full: request.full ?? false,
          runStartedAt,
          completedTaskRetentionDaysBack: request.completedTaskRetentionDaysBack ?? 0,
          emit
        });
        summaries.push(summary);
        counters.taskListCount = summary.listCount;
        counters.taskCount = summary.itemCount;
      }

      if (!request.dryRun && resources.includes("calendar")) {
        const summary = await this.syncCalendar({
          account: request.account,
          full: request.full ?? false,
          runStartedAt,
          eventRetentionDaysBack: request.eventRetentionDaysBack ?? 0,
          emit
        });
        summaries.push(summary);
        counters.calendarListCount = summary.listCount;
        counters.eventCount = summary.itemCount;
      }

      const diagnostics = this.completeDiagnostics(baseDiagnostics, runStartedAt, counters);

      this.repository.recordDiagnostics(diagnostics);
      emit({ type: "sync.completed", durationMs: diagnostics.durationMs, completedCount: summaries.length });

      return {
        ok: true,
        diagnostics,
        summaries,
        events
      };
    } catch (thrown) {
      const failure = sanitizedSyncFailure(thrown);
      const retryAfterMs = this.backoffPolicy.retryDelayMs(thrown, request.attempt ?? 0);
      const failureWithRetry =
        retryAfterMs === undefined
          ? failure
          : {
              ...failure,
              retryAfterMs
            };

      if (retryAfterMs !== undefined) {
        emit({
          type: "backoff.scheduled",
          errorCode: failure.code,
          retryAfterMs
        });
      }

      const diagnostics = this.completeDiagnostics(
        baseDiagnostics,
        runStartedAt,
        counters,
        failureWithRetry
      );

      this.repository.recordDiagnostics(diagnostics);
      emit({
        type: "sync.failed",
        errorCode: failure.code,
        retryAfterMs,
        durationMs: diagnostics.durationMs
      });

      return {
        ok: false,
        error: failureWithRetry,
        diagnostics,
        summaries,
        events
      };
    }
  }

  status() {
    return this.repository.syncStatus();
  }

  private async syncTasks(options: {
    account: GoogleAccountConnectionStatusDto;
    full: boolean;
    runStartedAt: Date;
    completedTaskRetentionDaysBack: number;
    emit: (event: Omit<SyncProgressEvent, "runId" | "accountId" | "at">) => void;
  }): Promise<ReadSyncResourceSummary> {
    const startedAt = this.now();

    options.emit({ type: "resource.started", resource: "tasks", stage: "taskLists.list" });
    const taskLists = await this.tasks.listTaskLists();
    const nowIso = this.now().toISOString();

    this.repository.writeTaskLists(options.account.accountId, taskLists, nowIso);
    options.emit({
      type: "resource.progress",
      resource: "tasks",
      stage: "taskLists.write",
      completedCount: taskLists.length,
      totalCount: taskLists.length
    });

    let taskCount = 0;
    let fullSyncCount = 0;
    const completedMin = retentionLowerBound(options.completedTaskRetentionDaysBack, options.runStartedAt);

    for (const taskList of taskLists) {
      const checkpoint = options.full
        ? null
        : this.repository.readCheckpoint({
            accountId: options.account.accountId,
            resourceType: "task_list",
            resourceId: taskList.id,
            checkpointType: "watermark"
          });
      const didFullSync = checkpoint === null;
      const page = await this.tasks.listTasks({
        taskListId: taskList.id,
        updatedMin: checkpoint,
        completedMin: didFullSync ? completedMin : null
      });
      const writeNow = this.now().toISOString();
      const nextWatermark =
        page.serverDate !== undefined && page.serverDate !== null
          ? normalizeServerDate(page.serverDate) ?? writeNow
          : new Date(options.runStartedAt.getTime() - TASKS_WATERMARK_SLACK_MS).toISOString();

      this.repository.writeTasks(options.account.accountId, taskList.id, page.tasks, {
        fullSync: didFullSync,
        now: writeNow
      });
      this.repository.saveCheckpoint({
        accountId: options.account.accountId,
        resourceType: "task_list",
        resourceId: taskList.id,
        checkpointType: "watermark",
        checkpointValue: nextWatermark,
        metadata: {
          source: page.serverDate === undefined || page.serverDate === null ? "local-clock-slack" : "google-server-date"
        },
        now: writeNow
      });

      taskCount += page.tasks.length;
      fullSyncCount += didFullSync ? 1 : 0;
      options.emit({
        type: "resource.progress",
        resource: "tasks",
        stage: "tasks.write",
        completedCount: taskCount,
        totalCount: taskLists.length
      });
    }

    const elapsedMs = durationMs(startedAt, this.now());
    options.emit({
      type: "resource.completed",
      resource: "tasks",
      stage: "tasks.read",
      completedCount: taskCount,
      totalCount: taskLists.length,
      durationMs: elapsedMs
    });

    return {
      resource: "tasks",
      listCount: taskLists.length,
      itemCount: taskCount,
      fullSyncCount,
      durationMs: elapsedMs
    };
  }

  private async syncCalendar(options: {
    account: GoogleAccountConnectionStatusDto;
    full: boolean;
    runStartedAt: Date;
    eventRetentionDaysBack: number;
    emit: (event: Omit<SyncProgressEvent, "runId" | "accountId" | "at">) => void;
  }): Promise<ReadSyncResourceSummary> {
    const startedAt = this.now();

    options.emit({ type: "resource.started", resource: "calendar", stage: "calendarLists.list" });
    const calendars = await this.calendar.listCalendarLists();
    const nowIso = this.now().toISOString();

    this.repository.writeCalendarLists(options.account.accountId, calendars, nowIso);
    options.emit({
      type: "resource.progress",
      resource: "calendar",
      stage: "calendarLists.write",
      completedCount: calendars.length,
      totalCount: calendars.length
    });

    let eventCount = 0;
    let fullSyncCount = 0;
    const selectedCalendars = selectedCalendarLists(calendars);
    const fullSyncTimeMin = retentionLowerBound(options.eventRetentionDaysBack, options.runStartedAt);

    for (const calendar of selectedCalendars) {
      const checkpoint = options.full
        ? null
        : this.repository.readCheckpoint({
            accountId: options.account.accountId,
            resourceType: "calendar",
            resourceId: calendar.id,
            checkpointType: "sync_token"
          });
      let didFullSync = checkpoint === null;
      let page;

      try {
        page = await this.calendar.listEvents({
          calendarId: calendar.id,
          syncToken: checkpoint,
          timeMin: didFullSync ? fullSyncTimeMin : null,
          defaultTimeZone: calendar.timeZone ?? null
        });
      } catch (thrown) {
        if (!(thrown instanceof GoogleApiError) || thrown.kind !== "invalid_sync_token") {
          throw thrown;
        }

        this.repository.clearCheckpoint({
          accountId: options.account.accountId,
          resourceType: "calendar",
          resourceId: calendar.id,
          checkpointType: "sync_token"
        });
        options.emit({
          type: "checkpoint.invalid",
          resource: "calendar",
          stage: "events.list"
        });
        page = await this.calendar.listEvents({
          calendarId: calendar.id,
          syncToken: null,
          timeMin: fullSyncTimeMin,
          defaultTimeZone: calendar.timeZone ?? null
        });
        didFullSync = true;
      }

      const writeNow = this.now().toISOString();

      this.repository.writeCalendarEvents(options.account.accountId, calendar.id, page.events, {
        fullSync: didFullSync,
        now: writeNow
      });

      const nextSyncToken = page.nextSyncToken ?? checkpoint;

      if (nextSyncToken !== null && nextSyncToken !== undefined && nextSyncToken.length > 0) {
        this.repository.saveCheckpoint({
          accountId: options.account.accountId,
          resourceType: "calendar",
          resourceId: calendar.id,
          checkpointType: "sync_token",
          checkpointValue: nextSyncToken,
          metadata: {
            fullResync: didFullSync
          },
          now: writeNow
        });
      }

      eventCount += page.events.length;
      fullSyncCount += didFullSync ? 1 : 0;
      options.emit({
        type: "resource.progress",
        resource: "calendar",
        stage: "events.write",
        completedCount: eventCount,
        totalCount: selectedCalendars.length
      });
    }

    const duration = durationMs(startedAt, this.now());
    options.emit({
      type: "resource.completed",
      resource: "calendar",
      stage: "events.read",
      completedCount: eventCount,
      totalCount: selectedCalendars.length,
      durationMs: duration
    });

    return {
      resource: "calendar",
      listCount: calendars.length,
      itemCount: eventCount,
      fullSyncCount,
      durationMs: duration
    };
  }

  private completeDiagnostics(
    baseDiagnostics: SanitizedSyncDiagnosticsDto,
    startedAt: Date,
    counters: MutableRunCounters,
    failure?: ReadSyncFailure
  ): SanitizedSyncDiagnosticsDto {
    const completedAt = this.now();

    return {
      ...baseDiagnostics,
      state: failure === undefined ? "idle" : "error",
      completedAt: completedAt.toISOString(),
      durationMs: durationMs(startedAt, completedAt),
      ...(failure?.code === undefined ? {} : { lastErrorCode: failure.code }),
      ...(failure?.retryAfterMs === undefined ? {} : { retryAfterMs: failure.retryAfterMs }),
      taskListCount: counters.taskListCount,
      taskCount: counters.taskCount,
      calendarListCount: counters.calendarListCount,
      eventCount: counters.eventCount
    };
  }
}

function normalizedResources(resources: readonly ReadSyncResource[] | undefined): ReadSyncResource[] {
  if (resources === undefined || resources.length === 0) {
    return [...DEFAULT_RESOURCES];
  }

  return [...new Set(resources)];
}

function selectedCalendarLists(calendars: readonly GoogleCalendarListMirror[]): GoogleCalendarListMirror[] {
  const selected = calendars.filter((calendar) => calendar.isSelected && !calendar.isHidden);

  return selected.length > 0 ? selected : calendars.filter((calendar) => !calendar.isHidden);
}

function sanitizedSyncFailure(thrown: unknown): ReadSyncFailure {
  if (thrown instanceof GoogleApiError) {
    switch (thrown.kind) {
      case "unauthorized":
        return {
          code: "UNAUTHORIZED",
          message: "Google account reauthentication is required",
          recoverable: true
        };
      case "forbidden":
        return {
          code: "FORBIDDEN",
          message: "Google denied access to the requested resource",
          recoverable: true
        };
      case "rate_limited":
        return {
          code: "RATE_LIMITED",
          message: "Google rate limit was reached",
          recoverable: true
        };
      case "server":
        return {
          code: "SERVICE_UNAVAILABLE",
          message: "Google service is temporarily unavailable",
          recoverable: true
        };
      case "conflict":
      case "precondition_failed":
        return {
          code: "CONFLICT",
          message: "Google resource changed before sync completed",
          recoverable: true
        };
      default:
        return {
          code: "SERVICE_UNAVAILABLE",
          message: "Google sync could not complete",
          recoverable: true
        };
    }
  }

  return {
    code: "INTERNAL_ERROR",
    message: "Google sync failed",
    recoverable: false
  };
}

function retentionLowerBound(daysBack: number, from: Date): string | null {
  if (daysBack <= 0) {
    return null;
  }

  return new Date(from.getTime() - daysBack * 24 * 60 * 60 * 1000).toISOString();
}

function normalizeServerDate(value: string): string | null {
  const parsed = Date.parse(value);

  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function durationMs(startedAt: Date, completedAt: Date): number {
  return Math.max(0, completedAt.getTime() - startedAt.getTime());
}
