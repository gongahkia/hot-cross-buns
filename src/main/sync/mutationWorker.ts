import { redactErrorMessage } from "@shared/redaction";
import { addUtcDaysIso, startOfUtcDayIso } from "@shared/domain/calendar";
import type { HcbErrorCode } from "@shared/ipc/result";
import {
  GoogleApiError,
  type GoogleCalendarEventWriteInput,
  type GoogleCalendarWriteTransport,
  type GoogleTasksWriteTransport
} from "../google";
import { appLogger } from "../diagnostics/appLogger";
import {
  backoffConstraintMultiplier,
  defaultBackoffConstraintState,
  type BackoffConstraintState
} from "./backoffPolicy";
import type {
  CalendarEventMutationTarget,
  GoogleSyncRepository,
  PendingGoogleMutation,
  TaskMutationTarget
} from "./readSyncRepository";

export interface MutationBackoffPolicyOptions {
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterMs?: number;
  random?: () => number;
  constraintState?: () => BackoffConstraintState;
}

export class MutationBackoffPolicy {
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly jitterMs: number;
  private readonly random: () => number;
  private readonly constraintState: () => BackoffConstraintState;

  constructor(options: MutationBackoffPolicyOptions = {}) {
    this.baseDelayMs = options.baseDelayMs ?? 60_000;
    this.maxDelayMs = options.maxDelayMs ?? 15 * 60_000;
    this.jitterMs = options.jitterMs ?? 10_000;
    this.random = options.random ?? Math.random;
    this.constraintState = options.constraintState ?? defaultBackoffConstraintState;
  }

  retryDelayMs(error: unknown, attemptCount: number): number | undefined {
    if (!isRetryableGoogleMutationError(error)) {
      return undefined;
    }

    if (error instanceof GoogleApiError && error.retryAfterMs !== undefined) {
      return Math.round(error.retryAfterMs * backoffConstraintMultiplier(this.constraintState()));
    }

    const attempt = Math.max(0, Math.min(Math.floor(attemptCount), 10));
    const exponentialDelay = this.baseDelayMs * 2 ** attempt;
    const jitter = Math.round(this.jitterMs * Math.min(1, Math.max(0, this.random())));

    return Math.round(
      Math.min(exponentialDelay + jitter, this.maxDelayMs + this.jitterMs) *
        backoffConstraintMultiplier(this.constraintState())
    );
  }
}

export interface MutationFailedEvent {
  id: string;
  operation: string;
  resourceType: string;
  resourceId: string;
  errorCode: HcbErrorCode;
  attemptCount: number;
  nextRetryAt?: string;
}

export interface GooglePendingMutationWorkerOptions {
  repository: GoogleSyncRepository;
  tasks: GoogleTasksWriteTransport;
  calendar: GoogleCalendarWriteTransport;
  backoffPolicy?: MutationBackoffPolicy;
  now?: () => Date;
  batchSize?: number;
  onMutationFailed?: (event: MutationFailedEvent) => void | Promise<void>;
}

export interface GooglePendingMutationWorkerRunResult {
  attemptedCount: number;
  appliedCount: number;
  failedCount: number;
  pausedCount: number;
  locked: boolean;
  nextRetryAt?: string;
}

class MutationWorkerError extends Error {
  readonly code: HcbErrorCode;

  constructor(code: HcbErrorCode, message: string) {
    super(message);
    this.name = "MutationWorkerError";
    this.code = code;
  }
}

export class GooglePendingMutationWorker {
  private readonly repository: GoogleSyncRepository;
  private readonly tasks: GoogleTasksWriteTransport;
  private readonly calendar: GoogleCalendarWriteTransport;
  private readonly backoffPolicy: MutationBackoffPolicy;
  private readonly now: () => Date;
  private readonly batchSize: number;
  private readonly onMutationFailed: ((event: MutationFailedEvent) => void | Promise<void>) | undefined;
  private running = false;

  constructor(options: GooglePendingMutationWorkerOptions) {
    this.repository = options.repository;
    this.tasks = options.tasks;
    this.calendar = options.calendar;
    this.backoffPolicy = options.backoffPolicy ?? new MutationBackoffPolicy();
    this.now = options.now ?? (() => new Date());
    this.batchSize = Math.max(1, Math.min(100, options.batchSize ?? 25));
    this.onMutationFailed = options.onMutationFailed;
  }

  async drainDue(limit = this.batchSize): Promise<GooglePendingMutationWorkerRunResult> {
    if (this.running) {
      return {
        attemptedCount: 0,
        appliedCount: 0,
        failedCount: 0,
        pausedCount: 0,
        locked: true
      };
    }

    this.running = true;
    let attemptedCount = 0;
    let appliedCount = 0;
    let failedCount = 0;
    let pausedCount = 0;
    let nextRetryAt: string | undefined;

    try {
      const mutations = this.repository.listDuePendingMutations({
        now: this.now().toISOString(),
        limit
      });
      appLogger.info("mutation drain start", "mutation", { count: mutations.length });

      for (const queued of mutations) {
        const accountId = queued.accountId;

        if (!accountId || this.repository.accountStatus(accountId)?.connectionState !== "connected") {
          pausedCount += 1;
          continue;
        }

        const mutation = this.repository.claimPendingMutation(queued.id, this.now().toISOString());

        if (!mutation || mutation.status !== "applying") {
          continue;
        }

        attemptedCount += 1;

        try {
          await this.applyMutation(mutation);
          this.repository.markMutationApplied(mutation.id, this.now().toISOString());
          appLogger.info("mutation applied", "mutation", {
            operation: mutation.operation,
            resourceType: mutation.resourceType,
            resourceId: mutation.resourceId
          });
          appliedCount += 1;
        } catch (thrown) {
          const failure = this.classifyFailure(thrown, mutation.attemptCount + 1);

          if (failure.pauseAccount && mutation.accountId) {
            this.repository.pauseAccountForMutationAuthFailure({
              accountId: mutation.accountId,
              connectionState: "reauth_required",
              now: this.now().toISOString()
            });
          }

          this.repository.markMutationFailed({
            id: mutation.id,
            attemptCount: mutation.attemptCount + 1,
            errorCode: failure.code,
            errorMessage: failure.message,
            nextRetryAt: failure.nextRetryAt,
            now: this.now().toISOString()
          });
          appLogger.warn("mutation failed", "mutation", {
            operation: mutation.operation,
            resourceType: mutation.resourceType,
            resourceId: mutation.resourceId,
            errorCode: failure.code,
            attemptCount: mutation.attemptCount + 1
          });
          void Promise.resolve(this.onMutationFailed?.({
            id: mutation.id,
            operation: mutation.operation,
            resourceType: mutation.resourceType,
            resourceId: mutation.resourceId,
            errorCode: failure.code,
            attemptCount: mutation.attemptCount + 1,
            ...(failure.nextRetryAt === undefined ? {} : { nextRetryAt: failure.nextRetryAt })
          })).catch((error) => {
            appLogger.warn("mutation failed webhook emit failed", "webhook", {
              message: error instanceof Error ? error.message : String(error)
            });
          });

          if (failure.nextRetryAt !== undefined) {
            nextRetryAt =
              nextRetryAt === undefined || failure.nextRetryAt < nextRetryAt
                ? failure.nextRetryAt
                : nextRetryAt;
          }

          failedCount += 1;
        }
      }
    } finally {
      this.running = false;
    }

    return {
      attemptedCount,
      appliedCount,
      failedCount,
      pausedCount,
      locked: false,
      ...(nextRetryAt === undefined ? {} : { nextRetryAt })
    };
  }

  private async applyMutation(mutation: PendingGoogleMutation): Promise<void> {
    switch (mutation.operation) {
      case "task_list.create":
        return this.applyTaskListCreate(mutation);
      case "task_list.rename":
        return this.applyTaskListRename(mutation);
      case "task_list.delete":
        return this.applyTaskListDelete(mutation);
      case "task.create":
        return this.applyTaskCreate(mutation);
      case "task.update":
        return this.applyTaskUpdate(mutation);
      case "task.complete":
        return this.applyTaskCompletion(mutation, true);
      case "task.reopen":
        return this.applyTaskCompletion(mutation, false);
      case "task.move":
        return this.applyTaskMove(mutation);
      case "task.move_list":
        return this.applyTaskListMove(mutation);
      case "task.delete":
        return this.applyTaskDelete(mutation);
      case "calendar.events.create":
        return this.applyCalendarEventCreate(mutation);
      case "calendar.events.update":
        return this.applyCalendarEventUpdate(mutation);
      case "calendar.events.delete":
        return this.applyCalendarEventDelete(mutation);
      default:
        throw new MutationWorkerError(
          "VALIDATION_ERROR",
          `Unsupported Google mutation operation '${mutation.operation}'.`
        );
    }
  }

  private async applyTaskListCreate(mutation: PendingGoogleMutation): Promise<void> {
    const target = this.requireTaskList(mutation.resourceId);
    const remote = await this.tasks.insertTaskList(textPayload(mutation, "title") ?? target.title);

    this.repository.updateTaskListFromRemote({
      localId: target.id,
      remote,
      now: this.now().toISOString()
    });
  }

  private async applyTaskListRename(mutation: PendingGoogleMutation): Promise<void> {
    const target = this.requireTaskList(mutation.resourceId);
    const remoteId = requireRemoteGoogleId(target.googleId, target.id, "task list");
    const remote = await this.tasks.updateTaskList({
      taskListId: remoteId,
      title: textPayload(mutation, "title") ?? target.title,
      ifMatch: target.etag
    });

    this.repository.updateTaskListFromRemote({
      localId: target.id,
      remote,
      now: this.now().toISOString()
    });
  }

  private async applyTaskListDelete(mutation: PendingGoogleMutation): Promise<void> {
    const target = this.requireTaskList(mutation.resourceId);
    const remoteId = optionalRemoteGoogleId(target.googleId, target.id);

    if (remoteId) {
      await this.tasks.deleteTaskList({
        taskListId: remoteId,
        ifMatch: target.etag
      });
    }
  }

  private async applyTaskCreate(mutation: PendingGoogleMutation): Promise<void> {
    const target = this.requireTask(mutation.resourceId);
    const remote = await this.tasks.insertTask(target.taskListGoogleId, {
      title: target.title,
      notes: target.notes ?? "",
      dueDate: dateOnlyFromIso(target.dueAt),
      parentId: target.parentGoogleId,
      previousSiblingId: this.previousSiblingGoogleId(mutation)
    });

    this.repository.updateTaskFromRemote({
      localId: target.id,
      accountId: target.accountId,
      remote,
      now: this.now().toISOString()
    });
  }

  private async applyTaskUpdate(mutation: PendingGoogleMutation): Promise<void> {
    const target = this.requireTask(mutation.resourceId);
    const remote = await this.tasks.updateTask({
      taskListId: target.taskListGoogleId,
      taskId: requireRemoteGoogleId(target.googleId, target.id, "task"),
      title: target.title,
      notes: target.notes ?? "",
      dueDate: dateOnlyFromIso(target.dueAt),
      ifMatch: target.etag
    });

    this.repository.updateTaskFromRemote({
      localId: target.id,
      accountId: target.accountId,
      remote,
      now: this.now().toISOString()
    });
  }

  private async applyTaskCompletion(
    mutation: PendingGoogleMutation,
    completed: boolean
  ): Promise<void> {
    const target = this.requireTask(mutation.resourceId);
    const remote = await this.tasks.setTaskCompleted({
      taskListId: target.taskListGoogleId,
      taskId: requireRemoteGoogleId(target.googleId, target.id, "task"),
      completed,
      ifMatch: target.etag
    });

    this.repository.updateTaskFromRemote({
      localId: target.id,
      accountId: target.accountId,
      remote,
      now: this.now().toISOString()
    });
  }

  private async applyTaskMove(mutation: PendingGoogleMutation): Promise<void> {
    const target = this.requireTask(mutation.resourceId);
    const remote = await this.tasks.moveTask({
      taskListId: target.taskListGoogleId,
      taskId: requireRemoteGoogleId(target.googleId, target.id, "task"),
      parentId: target.parentGoogleId,
      previousSiblingId: this.previousSiblingGoogleId(mutation)
    });

    this.repository.updateTaskFromRemote({
      localId: target.id,
      accountId: target.accountId,
      remote,
      now: this.now().toISOString()
    });
  }

  private async applyTaskListMove(mutation: PendingGoogleMutation): Promise<void> {
    const target = this.requireTask(mutation.resourceId);
    const fromTaskListId = textPayload(mutation, "fromTaskListId");
    const fromTaskList = fromTaskListId ? this.repository.taskListMutationTarget(fromTaskListId) : null;
    const oldRemoteTaskId = optionalRemoteGoogleId(target.googleId, target.id);
    const remote = await this.tasks.insertTask(target.taskListGoogleId, {
      title: target.title,
      notes: target.notes ?? "",
      dueDate: dateOnlyFromIso(target.dueAt),
      parentId: target.parentGoogleId,
      previousSiblingId: this.previousSiblingGoogleId(mutation)
    });

    if (oldRemoteTaskId && fromTaskList) {
      const fromRemoteListId = optionalRemoteGoogleId(fromTaskList.googleId, fromTaskList.id);

      if (fromRemoteListId) {
        await this.tasks.deleteTask({
          taskListId: fromRemoteListId,
          taskId: oldRemoteTaskId,
          ifMatch: target.etag
        });
      }
    }

    this.repository.updateTaskFromRemote({
      localId: target.id,
      accountId: target.accountId,
      remote,
      now: this.now().toISOString()
    });
  }

  private async applyTaskDelete(mutation: PendingGoogleMutation): Promise<void> {
    const target = this.requireTask(mutation.resourceId);
    const remoteId = optionalRemoteGoogleId(target.googleId, target.id);

    if (remoteId) {
      await this.tasks.deleteTask({
        taskListId: target.taskListGoogleId,
        taskId: remoteId,
        ifMatch: target.etag
      });
    }
  }

  private async applyCalendarEventCreate(mutation: PendingGoogleMutation): Promise<void> {
    const target = this.requireCalendarEvent(mutation.resourceId);
    const remote = await this.calendar.insertEvent(
      this.calendarGoogleIdForMutation(mutation, target),
      calendarEventWriteInput(target, mutation)
    );

    this.repository.updateCalendarEventFromRemote({
      localId: target.id,
      accountId: target.accountId,
      remote,
      now: this.now().toISOString()
    });
  }

  private async applyCalendarEventUpdate(mutation: PendingGoogleMutation): Promise<void> {
    const target = this.requireCalendarEvent(mutation.resourceId);
    const calendarId = this.calendarGoogleIdForMutation(mutation, target);
    const remote = await this.calendar.updateEvent({
      calendarId,
      eventId: requireRemoteGoogleId(target.googleId, target.id, "calendar event"),
      ifMatch: target.etag,
      ...calendarEventWriteInput(target, mutation)
    });

    this.repository.updateCalendarEventFromRemote({
      localId: target.id,
      accountId: target.accountId,
      remote,
      now: this.now().toISOString()
    });
  }

  private async applyCalendarEventDelete(mutation: PendingGoogleMutation): Promise<void> {
    const target = this.requireCalendarEvent(mutation.resourceId);
    const remoteId = optionalRemoteGoogleId(target.googleId, target.id);

    if (remoteId) {
      await this.calendar.deleteEvent({
        calendarId: target.calendarGoogleId,
        eventId: remoteId,
        ifMatch: target.etag
      });
    }
  }

  private requireTaskList(id: string) {
    const target = this.repository.taskListMutationTarget(id);

    if (!target) {
      throw new MutationWorkerError("VALIDATION_ERROR", "Queued task list was not found.");
    }

    return target;
  }

  private requireTask(id: string): TaskMutationTarget {
    const target = this.repository.taskMutationTarget(id);

    if (!target) {
      throw new MutationWorkerError("VALIDATION_ERROR", "Queued task was not found.");
    }

    return target;
  }

  private requireCalendarEvent(id: string): CalendarEventMutationTarget {
    const target = this.repository.calendarEventMutationTarget(id);

    if (!target) {
      throw new MutationWorkerError("VALIDATION_ERROR", "Queued calendar event was not found.");
    }

    return target;
  }

  private previousSiblingGoogleId(mutation: PendingGoogleMutation): string | null {
    const previousSiblingId = textPayload(mutation, "previousSiblingId");

    if (!previousSiblingId) {
      return null;
    }

    const previousSibling = this.repository.taskMutationTarget(previousSiblingId);

    return previousSibling
      ? optionalRemoteGoogleId(previousSibling.googleId, previousSibling.id)
      : null;
  }

  private calendarGoogleIdForMutation(
    mutation: PendingGoogleMutation,
    target: CalendarEventMutationTarget
  ): string {
    const calendarLocalId = textPayload(mutation, "calendarId") ?? target.calendarId;
    const calendar = this.repository.calendarMutationTarget(calendarLocalId);

    return calendar?.googleId ?? target.calendarGoogleId;
  }

  private classifyFailure(
    thrown: unknown,
    attemptCount: number
  ): {
    code: HcbErrorCode;
    message: string;
    nextRetryAt?: string;
    pauseAccount: boolean;
  } {
    const code = mutationErrorCode(thrown);
    const retryDelayMs = this.backoffPolicy.retryDelayMs(thrown, attemptCount);
    const message = redactErrorMessage(
      thrown instanceof Error ? thrown.message : "Google mutation failed"
    );

    return {
      code,
      message,
      ...(retryDelayMs === undefined
        ? {}
        : { nextRetryAt: new Date(this.now().getTime() + retryDelayMs).toISOString() }),
      pauseAccount: code === "UNAUTHORIZED" || code === "FORBIDDEN"
    };
  }
}

function isRetryableGoogleMutationError(error: unknown): boolean {
  return error instanceof GoogleApiError && (error.kind === "rate_limited" || error.kind === "server");
}

function mutationErrorCode(error: unknown): HcbErrorCode {
  if (error instanceof MutationWorkerError) {
    return error.code;
  }

  if (error instanceof GoogleApiError) {
    switch (error.kind) {
      case "unauthorized":
        return "UNAUTHORIZED";
      case "forbidden":
        return "FORBIDDEN";
      case "rate_limited":
        return "RATE_LIMITED";
      case "server":
      case "transport":
        return "SERVICE_UNAVAILABLE";
      case "conflict":
      case "precondition_failed":
        return "CONFLICT";
      case "invalid_payload":
      case "not_found":
        return "VALIDATION_ERROR";
      default:
        return "SERVICE_UNAVAILABLE";
    }
  }

  return "INTERNAL_ERROR";
}

function optionalRemoteGoogleId(googleId: string, localId: string): string | null {
  if (
    googleId === localId ||
    googleId.startsWith("pending:") ||
    googleId.startsWith("local-") ||
    googleId.includes(":pending:")
  ) {
    return null;
  }

  return googleId;
}

function requireRemoteGoogleId(googleId: string, localId: string, resourceName: string): string {
  const remoteId = optionalRemoteGoogleId(googleId, localId);

  if (remoteId === null) {
    throw new MutationWorkerError(
      "VALIDATION_ERROR",
      `Queued ${resourceName} mutation is waiting for a remote Google id.`
    );
  }

  return remoteId;
}

function dateOnlyFromIso(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  return value.slice(0, 10);
}

function textPayload(mutation: PendingGoogleMutation, key: string): string | null {
  if (!isJsonObject(mutation.payload)) {
    return null;
  }

  const value = mutation.payload[key];

  return typeof value === "string" && value.length > 0 ? value : null;
}

function booleanPayload(mutation: PendingGoogleMutation, key: string): boolean | null {
  if (!isJsonObject(mutation.payload)) {
    return null;
  }

  const value = mutation.payload[key];

  return typeof value === "boolean" ? value : null;
}

function stringArrayPayload(mutation: PendingGoogleMutation, key: string): string[] | null {
  if (!isJsonObject(mutation.payload)) {
    return null;
  }

  const value = mutation.payload[key];

  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : null;
}

function numberArrayPayload(mutation: PendingGoogleMutation, key: string): number[] | null {
  if (!isJsonObject(mutation.payload)) {
    return null;
  }

  const value = mutation.payload[key];

  return Array.isArray(value)
    ? value.filter((item): item is number => typeof item === "number" && Number.isFinite(item))
    : null;
}

function reminderArrayPayload(
  mutation: PendingGoogleMutation,
  key: string
): Array<{ method: "popup" | "email"; minutes: number }> | null {
  if (!isJsonObject(mutation.payload)) {
    return null;
  }

  const value = mutation.payload[key];

  if (!Array.isArray(value)) {
    return null;
  }

  return value.flatMap((item): Array<{ method: "popup" | "email"; minutes: number }> => {
    if (!isJsonObject(item)) {
      return [];
    }

    const method = item.method;
    const minutes = item.minutes;

    if ((method !== "popup" && method !== "email") || typeof minutes !== "number" || !Number.isInteger(minutes)) {
      return [];
    }

    return minutes >= 0 && minutes <= 28 * 24 * 60 ? [{ method, minutes }] : [];
  });
}

function conferenceCreateRequestPayload(mutation: PendingGoogleMutation): { type: "hangoutsMeet" } | null {
  if (!isJsonObject(mutation.payload) || !isJsonObject(mutation.payload.conferenceCreateRequest)) {
    return null;
  }

  return mutation.payload.conferenceCreateRequest.type === "hangoutsMeet"
    ? { type: "hangoutsMeet" }
    : null;
}

function calendarEventWriteInput(
  target: CalendarEventMutationTarget,
  mutation: PendingGoogleMutation
): GoogleCalendarEventWriteInput {
  const hcbKind = textPayload(mutation, "hcbKind") === "birthday" || target.hcbKind === "birthday"
    ? "birthday"
    : null;
  const summary = textPayload(mutation, "title") ?? target.summary;
  const startAt = textPayload(mutation, "startsAt") ?? target.startAt;

  if (hcbKind === "birthday") {
    const birthdayStart = startOfUtcDayIso(startAt);
    return {
      hcbKind,
      summary,
      startAt: birthdayStart,
      endAt: addUtcDaysIso(birthdayStart, 1),
      isAllDay: true,
      recurrenceRule: "RRULE:FREQ=YEARLY",
      colorId: textPayload(mutation, "colorId") ?? target.colorId,
      reminderMinutes: numberArrayPayload(mutation, "reminderMinutes") ?? target.reminderMinutes,
      reminders: reminderArrayPayload(mutation, "reminders") ?? target.reminders,
      remindersUseDefault: booleanPayload(mutation, "remindersUseDefault") ?? target.remindersUseDefault
    };
  }

  return {
    summary,
    description: textPayload(mutation, "notes") ?? target.description ?? "",
    location: textPayload(mutation, "location") ?? target.location ?? "",
    startAt,
    startTimeZone: target.startTimeZone,
    endAt: textPayload(mutation, "endsAt") ?? target.endAt,
    endTimeZone: target.endTimeZone,
    isAllDay: booleanPayload(mutation, "allDay") ?? target.isAllDay,
    recurrenceRule: textPayload(mutation, "recurrenceRule") ?? target.recurrenceRule,
    colorId: textPayload(mutation, "colorId") ?? target.colorId,
    transparency: textPayload(mutation, "transparency") === "transparent" ||
    textPayload(mutation, "transparency") === "opaque"
      ? textPayload(mutation, "transparency") as "transparent" | "opaque"
      : target.transparency === "transparent" || target.transparency === "opaque"
        ? target.transparency
        : null,
    visibility: textPayload(mutation, "visibility") === "default" ||
    textPayload(mutation, "visibility") === "public" ||
    textPayload(mutation, "visibility") === "private"
      ? textPayload(mutation, "visibility") as "default" | "public" | "private"
      : target.visibility === "default" || target.visibility === "public" || target.visibility === "private"
        ? target.visibility
        : null,
    attendeeEmails: stringArrayPayload(mutation, "guestEmails") ?? target.attendeeEmails,
    reminderMinutes: numberArrayPayload(mutation, "reminderMinutes") ?? target.reminderMinutes,
    reminders: reminderArrayPayload(mutation, "reminders") ?? target.reminders,
    remindersUseDefault: booleanPayload(mutation, "remindersUseDefault") ?? target.remindersUseDefault,
    conferenceCreateRequest: conferenceCreateRequestPayload(mutation)
  };
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
