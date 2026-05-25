import type { JsonValue } from "@shared/domain/localData";
import type { HcbErrorCode } from "@shared/ipc/result";
import type { SqliteConnection } from "../../data/sqliteConnection";
import type {
  GoogleAccountConnectionStatusDto,
  GoogleCalendarEventMirror,
  GoogleCalendarListMirror,
  GoogleTaskListMirror,
  GoogleTaskMirror
} from "../../google";
import type {
  SanitizedSyncDiagnosticsDto,
  SanitizedSyncStatusDto,
  SyncProgressEvent
} from "../types";
import {
  accountStatus as readAccountStatus,
  latestAccountStatus as readLatestAccountStatus,
  upsertAccountStatus as writeAccountStatus
} from "./accounts";
import {
  checkpointDiagnostics as readCheckpointDiagnostics,
  clearAllCheckpoints as clearAllStoredCheckpoints,
  clearCheckpoint as deleteCheckpoint,
  readCheckpoint as readStoredCheckpoint,
  saveCheckpoint as saveStoredCheckpoint
} from "./checkpoints";
import {
  cacheDiagnostics as readCacheDiagnostics,
  clearLocalGoogleCache as clearStoredLocalGoogleCache,
  recordDiagnostics as writeDiagnostics,
  recordProgressEvent as writeProgressEvent,
  selectedResourceDiagnostics as readSelectedResourceDiagnostics,
  syncStatus as readSyncStatus
} from "./diagnostics";
import {
  calendarMutationTarget as readCalendarMutationTarget,
  calendarEventMutationTarget as readCalendarEventMutationTarget,
  cancelPendingMutation as cancelStoredPendingMutation,
  claimPendingMutation as claimStoredPendingMutation,
  enqueuePendingMutation as enqueueStoredPendingMutation,
  listActivePendingMutations as listStoredActivePendingMutations,
  listDuePendingMutations as listStoredDuePendingMutations,
  markMutationApplied as markStoredMutationApplied,
  markMutationFailed as markStoredMutationFailed,
  pauseAccountForMutationAuthFailure as pauseStoredAccountForMutationAuthFailure,
  pendingMutationById as readPendingMutationById,
  pendingMutationDiagnostics as readPendingMutationDiagnostics,
  retryPendingMutation as retryStoredPendingMutation,
  taskListMutationTarget as readTaskListMutationTarget,
  taskMutationTarget as readTaskMutationTarget
} from "./mutations";
import {
  updateCalendarEventFromRemote as updateStoredCalendarEventFromRemote,
  updateTaskFromRemote as updateStoredTaskFromRemote,
  updateTaskListFromRemote as updateStoredTaskListFromRemote,
  writeCalendarEvents as writeStoredCalendarEvents,
  writeCalendarLists as writeStoredCalendarLists,
  writeTaskLists as writeStoredTaskLists,
  writeTasks as writeStoredTasks
} from "./mirrors";
import { ensureGoogleSyncSchema } from "./schema";
import type {
  CalendarEventMutationTarget,
  CalendarEventWriteOptions,
  CalendarMutationTarget,
  GoogleCacheDiagnostics,
  GoogleCheckpointDiagnostics,
  GoogleSyncRepositoryOptions,
  PendingGoogleMutation,
  PendingMutationDiagnostics,
  SelectedResourceDiagnostics,
  TaskListMutationTarget,
  TaskMutationTarget,
  TaskWriteOptions
} from "./types";
import { normalizeTimeZone } from "./timeZone";

export class GoogleSyncRepository {
  private readonly connection: SqliteConnection;
  private readonly defaultTimeZone: string;

  constructor(connection: SqliteConnection, options: GoogleSyncRepositoryOptions = {}) {
    this.connection = connection;
    this.defaultTimeZone = normalizeTimeZone(options.defaultTimeZone);
    this.ensureSchema();
  }

  ensureSchema(): void {
    ensureGoogleSyncSchema(this.connection, this.defaultTimeZone);
  }

  upsertAccountStatus(status: GoogleAccountConnectionStatusDto): void {
    writeAccountStatus(this.connection, status);
  }

  latestAccountStatus(): GoogleAccountConnectionStatusDto | null {
    return readLatestAccountStatus(this.connection);
  }

  accountStatus(accountId: string): GoogleAccountConnectionStatusDto | null {
    return readAccountStatus(this.connection, accountId);
  }

  readCheckpoint(request: {
    accountId: string;
    resourceType: string;
    resourceId: string;
    checkpointType: string;
  }): string | null {
    return readStoredCheckpoint(this.connection, request);
  }

  saveCheckpoint(request: {
    accountId: string;
    resourceType: string;
    resourceId: string;
    checkpointType: string;
    checkpointValue: string;
    metadata?: JsonValue;
    now: string;
  }): void {
    saveStoredCheckpoint(this.connection, request);
  }

  clearCheckpoint(request: {
    accountId: string;
    resourceType: string;
    resourceId: string;
    checkpointType: string;
  }): void {
    deleteCheckpoint(this.connection, request);
  }

  writeTaskLists(accountId: string, taskLists: readonly GoogleTaskListMirror[], now: string): void {
    writeStoredTaskLists(this.connection, accountId, taskLists, now);
  }

  writeTasks(
    accountId: string,
    taskListGoogleId: string,
    tasks: readonly GoogleTaskMirror[],
    options: TaskWriteOptions
  ): void {
    writeStoredTasks(this.connection, accountId, taskListGoogleId, tasks, options);
  }

  writeCalendarLists(
    accountId: string,
    calendars: readonly GoogleCalendarListMirror[],
    now: string
  ): void {
    writeStoredCalendarLists(this.connection, accountId, calendars, now);
  }

  writeCalendarEvents(
    accountId: string,
    calendarGoogleId: string,
    events: readonly GoogleCalendarEventMirror[],
    options: CalendarEventWriteOptions
  ): void {
    writeStoredCalendarEvents(
      this.connection,
      this.defaultTimeZone,
      accountId,
      calendarGoogleId,
      events,
      options
    );
  }

  enqueuePendingMutation(input: {
    accountId: string | null;
    resourceType: "task" | "task_list" | "event";
    resourceId: string;
    operation: string;
    payload: JsonValue;
    now: string;
  }): { id: string; queued: true } {
    return enqueueStoredPendingMutation(this.connection, input);
  }

  listDuePendingMutations(options: { now: string; limit?: number }): PendingGoogleMutation[] {
    return listStoredDuePendingMutations(this.connection, options);
  }

  listActivePendingMutations(options: { limit?: number } = {}): PendingGoogleMutation[] {
    return listStoredActivePendingMutations(this.connection, options);
  }

  pendingMutationById(id: string): PendingGoogleMutation | null {
    return readPendingMutationById(this.connection, id);
  }

  claimPendingMutation(id: string, now: string): PendingGoogleMutation | null {
    return claimStoredPendingMutation(this.connection, id, now);
  }

  markMutationApplied(id: string, now: string): void {
    markStoredMutationApplied(this.connection, id, now);
  }

  markMutationFailed(input: {
    id: string;
    attemptCount: number;
    errorCode: HcbErrorCode;
    errorMessage: string;
    nextRetryAt?: string | null;
    now: string;
  }): void {
    markStoredMutationFailed(this.connection, input);
  }

  retryPendingMutation(id: string, now: string): PendingGoogleMutation | null {
    return retryStoredPendingMutation(this.connection, id, now);
  }

  cancelPendingMutation(id: string, now: string): PendingGoogleMutation | null {
    return cancelStoredPendingMutation(this.connection, id, now);
  }

  pauseAccountForMutationAuthFailure(input: {
    accountId: string;
    connectionState: "reauth_required" | "sync_paused";
    now: string;
  }): void {
    pauseStoredAccountForMutationAuthFailure(this.connection, input);
  }

  taskListMutationTarget(id: string): TaskListMutationTarget | null {
    return readTaskListMutationTarget(this.connection, id);
  }

  taskMutationTarget(id: string): TaskMutationTarget | null {
    return readTaskMutationTarget(this.connection, id);
  }

  calendarMutationTarget(id: string): CalendarMutationTarget | null {
    return readCalendarMutationTarget(this.connection, id);
  }

  calendarEventMutationTarget(id: string): CalendarEventMutationTarget | null {
    return readCalendarEventMutationTarget(this.connection, id);
  }

  updateTaskListFromRemote(input: {
    localId: string;
    remote: GoogleTaskListMirror;
    now: string;
  }): void {
    updateStoredTaskListFromRemote(this.connection, input);
  }

  updateTaskFromRemote(input: {
    localId: string;
    accountId: string;
    remote: GoogleTaskMirror;
    now: string;
  }): void {
    updateStoredTaskFromRemote(this.connection, input);
  }

  updateCalendarEventFromRemote(input: {
    localId: string;
    accountId: string;
    remote: GoogleCalendarEventMirror;
    now: string;
  }): void {
    updateStoredCalendarEventFromRemote(this.connection, this.defaultTimeZone, input);
  }

  recordProgressEvent(event: SyncProgressEvent): void {
    writeProgressEvent(this.connection, event);
  }

  recordDiagnostics(diagnostics: SanitizedSyncDiagnosticsDto): void {
    writeDiagnostics(this.connection, diagnostics);
  }

  syncStatus(): SanitizedSyncStatusDto {
    return readSyncStatus(this.connection);
  }

  cacheDiagnostics(): GoogleCacheDiagnostics {
    return readCacheDiagnostics(this.connection);
  }

  checkpointDiagnostics(): GoogleCheckpointDiagnostics {
    return readCheckpointDiagnostics(this.connection);
  }

  pendingMutationDiagnostics(): PendingMutationDiagnostics {
    return readPendingMutationDiagnostics(this.connection);
  }

  selectedResourceDiagnostics(settings: {
    selectedTaskListIds: readonly string[];
    selectedCalendarIds: readonly string[];
  }): SelectedResourceDiagnostics {
    return readSelectedResourceDiagnostics(this.connection, settings);
  }

  clearAllCheckpoints(): void {
    clearAllStoredCheckpoints(this.connection);
  }

  clearLocalGoogleCache(now = new Date().toISOString()): void {
    clearStoredLocalGoogleCache(this.connection, now);
  }
}
