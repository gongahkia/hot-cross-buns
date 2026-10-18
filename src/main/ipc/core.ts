import { BrowserWindow, dialog, ipcMain, shell } from "electron";
import { copyFile, chmod, writeFile } from "node:fs/promises";
import { z } from "zod";
import { CoreStoreError } from "../services/coreStoreError";
import type { WorkspaceClient } from "../services/workspaceClient";
import { getStartupTimings, markStartupTiming } from "../startupTiming";
import { appLogger } from "../diagnostics/appLogger";
import { isLiveGoogleReadOnlyTest, isLiveGoogleTest } from "../liveGoogleTestMode";
import { conflictError, internalError, ok, validationError } from "@shared/result";
import { IPC_CHANNELS } from "@shared/ipc";

const requestSchema = z.object({
  namespace: z.enum([
    "bootstrap", "tasks", "calendar", "notes", "tags", "search", "settings",
    "sync", "google", "undo", "native", "diagnostics", "agent", "duplicates"
  ]),
  action: z.string().min(1).max(80).regex(/^[a-zA-Z][a-zA-Z0-9]*$/),
  payload: z.object({}).catchall(z.unknown()).default({})
}).strict();

const actionMap: Record<string, readonly string[]> = {
  bootstrap: ["get"],
  tasks: ["listTaskLists", "list", "board", "forCalendarRange", "get", "create", "update", "complete", "reopen", "delete", "move", "bulkReschedule", "createTaskList", "renameTaskList", "deleteTaskList"],
  calendar: ["listCalendars", "listEvents", "get", "create", "update", "delete", "complete", "reopen", "listScheduledTaskBlocks", "scheduleTaskBlock", "moveScheduledTaskBlock", "unscheduleTaskBlock", "exportAvailability", "freeBusy", "scheduleSuggest", "smartReschedule"],
  notes: ["list", "get", "create", "update", "delete", "createNoteList", "renameNoteList", "deleteNoteList", "linkSuggest", "legacyMigrationPreview", "importLegacyPseudoNotes"],
  tags: ["list", "create", "update", "delete"],
  search: ["query"],
  settings: ["get", "update", "recoveryAction"],
  sync: ["status", "runNow", "forceFullResync"],
  google: ["status", "saveOAuthClient", "beginOAuth", "reconfigureOptionalAccess", "cancelOAuth", "disconnect", "searchDriveFiles", "pickAndUploadDriveFile", "searchGmailMessages", "captureGmailMessage", "previewAccountCopy", "copyAccountData"],
  undo: ["status", "undo", "redo"],
  native: ["capabilities", "listFontFamilies", "requestNotificationPermission", "openExternalUrl", "importMenuBarIcon"],
  diagnostics: ["summary", "logs", "history", "pendingMutations", "rescheduleNotifications", "retryPendingMutation", "cancelPendingMutation", "clearLogs", "copyableSummary", "exportBundle", "markCachedDataRendered", "recordTiming"],
  agent: [],
  duplicates: []
};

const isoDateSchema = z.string().datetime({ offset: true });
const idSchema = z.string().min(1).max(200);
const taskWriteSchema = z.object({
  id: idSchema.optional(), listId: idSchema.optional(), title: z.string().trim().min(1).max(10_000).optional(),
  notes: z.string().max(100_000).optional(), status: z.enum(["active", "completed", "deleted", "hidden"]).optional(),
  dueDate: z.string().max(100).nullable().optional(), parentId: idSchema.nullable().optional(), previousTaskId: idSchema.nullable().optional(),
  durationMinutes: z.number().finite().min(1).max(1_440).nullable().optional(), lockedSchedule: z.boolean().optional(),
  plannedStart: isoDateSchema.nullable().optional(), plannedEnd: isoDateSchema.nullable().optional(), accountId: idSchema.optional()
}).passthrough();
const eventWriteSchema = z.object({
  id: idSchema.optional(), calendarId: idSchema.optional(), title: z.string().trim().min(1).max(10_000).optional(),
  startsAt: isoDateSchema.optional(), endsAt: isoDateSchema.optional(), allDay: z.boolean().optional(),
  description: z.string().max(100_000).optional(), scope: z.enum(["series", "seriesAll", "occurrence", "following", "seriesFuture", "thisAndFollowing", "future"]).optional()
}).passthrough();

export function payloadIsValid(namespace: string, action: string, payload: Record<string, unknown>): boolean {
  if (!actionMap[namespace]?.includes(action)) return false;
  if (namespace === "tasks" && action === "forCalendarRange") return z.object({ start: isoDateSchema, end: isoDateSchema, limit: z.number().int().min(1).max(1000).optional(), cursor: z.string().regex(/^\d+$/).max(16).optional() }).strict().safeParse(payload).success;
  if (namespace === "tasks" && action === "board") return z.object({
    listId: idSchema.optional(), starred: z.boolean().optional(), sort: z.enum(["myOrder", "date", "deadline", "starred", "title"]).optional(),
    completedOpen: z.boolean().optional(), collapsedTaskIds: z.array(idSchema).max(10_000).optional(),
    cursor: z.string().regex(/^\d+$/).max(16).optional(), limit: z.number().int().min(1).max(200).optional()
  }).strict().safeParse(payload).success;
  if (namespace === "tasks" && action === "bulkReschedule") return z.object({ taskIds: z.array(idSchema).min(1).max(500), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable() }).strict().safeParse(payload).success;
  if (namespace === "tasks" && ["create", "update", "complete", "reopen", "delete", "move"].includes(action)) return taskWriteSchema.safeParse(payload).success;
  if (namespace === "calendar" && ["create", "update", "complete", "reopen"].includes(action)) return eventWriteSchema.safeParse(payload).success;
  if (namespace === "calendar" && action === "scheduleTaskBlock") return z.object({ taskId: idSchema, calendarId: idSchema, startsAt: isoDateSchema, endsAt: isoDateSchema.optional(), durationMinutes: z.number().finite().min(5).max(1_440).optional() }).safeParse(payload).success;
  if (namespace === "calendar" && action === "smartReschedule") return z.union([
    z.object({
      apply: z.literal(false).optional(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      calendarId: idSchema,
      workingHours: z.object({
        startMinutes: z.number().finite().min(0).max(1_439).optional(),
        endMinutes: z.number().finite().min(1).max(1_440).optional(),
        start: z.number().finite().min(0).max(24).optional(),
        end: z.number().finite().min(0).max(24).optional()
      }).strict().optional(),
      capacityMinutes: z.number().finite().min(5).max(1_440).optional(),
      candidateScope: z.enum(["dueSoon", "allOpen"]).optional()
    }).strict(),
    z.object({ apply: z.literal(true), planId: z.string().uuid() }).strict()
  ]).safeParse(payload).success;
  if (namespace === "calendar" && action === "exportAvailability") return z.object({ start: isoDateSchema, end: isoDateSchema, calendarIds: z.array(idSchema).max(100).optional(), format: z.literal("text").optional() }).safeParse(payload).success;
  if (namespace === "google" && action === "saveOAuthClient") return z.object({ clientId: z.string().trim().min(10).max(500), clientSecret: z.string().max(1_000).optional() }).safeParse(payload).success;
  if (namespace === "google" && action === "beginOAuth") return z.object({ requestedServices: z.array(z.enum(["drive", "driveUpload", "gmail"])).max(3).optional() }).safeParse(payload).success;
  if (namespace === "google" && action === "reconfigureOptionalAccess") return z.object({ accountId: idSchema, requestedServices: z.array(z.enum(["drive", "driveUpload", "gmail"])).max(3), confirmation: z.literal("RECONFIGURE_OPTIONAL_ACCESS") }).strict().safeParse(payload).success;
  if (namespace === "google" && action === "disconnect") return z.object({ accountId: idSchema.optional() }).safeParse(payload).success;
  if (namespace === "google" && ["searchDriveFiles", "searchGmailMessages"].includes(action)) return z.object({ accountId: idSchema.optional(), query: z.string().max(500).optional() }).safeParse(payload).success;
  if (namespace === "google" && action === "pickAndUploadDriveFile") return z.object({ accountId: idSchema.optional() }).strict().safeParse(payload).success;
  if (namespace === "google" && action === "captureGmailMessage") return z.object({ accountId: idSchema.optional(), listId: idSchema.optional(), messageId: idSchema, threadId: idSchema.optional(), subject: z.string().max(10_000).optional(), from: z.string().max(10_000).optional(), snippet: z.string().max(100_000).optional() }).safeParse(payload).success;
  if (namespace === "google" && action === "previewAccountCopy") return z.object({ sourceAccountId: idSchema, destinationAccountId: idSchema, destinationCalendarId: idSchema }).safeParse(payload).success;
  if (namespace === "google" && action === "copyAccountData") return z.object({ sourceAccountId: idSchema, destinationAccountId: idSchema, destinationCalendarId: idSchema, confirmation: z.literal("COPY") }).safeParse(payload).success;
  if (namespace === "calendar" && action === "freeBusy") return z.object({ accountId: idSchema.optional(), start: isoDateSchema, end: isoDateSchema, calendarIds: z.array(z.string().min(1).max(500)).min(1).max(50) }).safeParse(payload).success;
  if (namespace === "notes" && action === "create") return z.object({ title: z.string().trim().min(1).max(10_000), body: z.string().max(100_000).optional(), listId: idSchema.optional(), tags: z.array(z.string().trim().min(1).max(100)).max(100).optional() }).strict().safeParse(payload).success;
  if (namespace === "notes" && action === "update") return z.object({ id: idSchema, title: z.string().trim().min(1).max(10_000).optional(), body: z.string().max(100_000).optional(), listId: idSchema.optional(), tags: z.array(z.string().trim().min(1).max(100)).max(100).optional() }).strict().safeParse(payload).success;
  if (namespace === "notes" && action === "delete") return z.object({ id: idSchema }).strict().safeParse(payload).success;
  if (namespace === "notes" && action === "createNoteList") return z.object({ title: z.string().trim().min(1).max(500) }).strict().safeParse(payload).success;
  if (namespace === "notes" && action === "renameNoteList") return z.object({ id: idSchema, title: z.string().trim().min(1).max(500) }).strict().safeParse(payload).success;
  if (namespace === "notes" && action === "deleteNoteList") return z.object({ id: idSchema }).strict().safeParse(payload).success;
  if (namespace === "notes" && action === "legacyMigrationPreview") return z.object({ limit: z.number().int().min(1).max(1_000).optional() }).strict().safeParse(payload).success;
  if (namespace === "notes" && action === "importLegacyPseudoNotes") return z.object({ taskIds: z.array(idSchema).min(1).max(1_000) }).strict().safeParse(payload).success;
  if (namespace === "native" && action === "openExternalUrl") return z.object({ url: z.string().url().max(4_096) }).safeParse(payload).success;
  if (namespace === "settings" && action === "recoveryAction") return z.object({
    action: z.enum(["refresh", "forceFullResync", "resetOnboarding", "checkForUpdates", "backupNow", "exportBackup", "openBackupsFolder", "restoreLocalNotes"]),
    confirmation: z.object({ accepted: z.boolean(), phrase: z.string().max(100) }).optional()
  }).strict().safeParse(payload).success;
  return true;
}

export function registerCoreIpc(
  services: WorkspaceClient,
  onCachedDataRendered?: () => void
): void {
  const { core: store, googleOAuth, googleSync, backups } = services;
  googleSync.onStatus((status) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IPC_CHANNELS.core.syncStatus, status);
    }
  });

  ipcMain.handle("hcb:core:invoke", async (_event, payload: unknown) => {
    const request = requestSchema.safeParse(payload);

    if (!request.success) {
      return validationError("Invalid restored application request");
    }
    if (!payloadIsValid(request.data.namespace, request.data.action, request.data.payload)) {
      return validationError("Unsupported or malformed application request");
    }
    if (isLiveGoogleReadOnlyRequest(request.data.namespace, request.data.action, request.data.payload)) {
      return validationError("Live Google read-only mode blocks mutations and non-read-only sync.");
    }
    if (googleOAuth.isReconfiguring() && isGoogleMutationRequest(request.data.namespace, request.data.action, request.data.payload)) {
      return conflictError("Google access is being reconfigured. Wait for the browser authorization to open, then try again.");
    }

    try {
      await services.ready;
      if (request.data.namespace === "diagnostics" && request.data.action === "markCachedDataRendered") {
        const timing = markStartupTiming("cachedDataRenderedMs");
        onCachedDataRendered?.();
        return ok(timing);
      }
      if (request.data.namespace === "diagnostics" && request.data.action === "exportBundle") {
        const selected = await dialog.showSaveDialog({ title: "Export diagnostics", defaultPath: "Hot Cross Buns diagnostics.json", filters: [{ name: "JSON", extensions: ["json"] }] });
        if (selected.canceled || !selected.filePath) return ok({ exported: false, message: "Export cancelled." });
        const summary = await store.dispatch("diagnostics", "summary");
        if (summary.performance) summary.performance.startup = getStartupTimings();
        const bundle = { generatedAt: new Date().toISOString(), summary, logs: await store.dispatch("diagnostics", "logs", {}) };
        await writeFile(selected.filePath, JSON.stringify(bundle, null, 2), { mode: 0o600 });
        await chmod(selected.filePath, 0o600);
        return ok({ exported: true, message: `Diagnostics saved to ${selected.filePath}` });
      }
      if (request.data.namespace === "settings" && request.data.action === "recoveryAction") {
        const action = request.data.payload.action;
        if (action === "backupNow") {
          const path = await backups.create();
          return ok({ completed: true, path, message: `Backup saved to ${path}` });
        }
        if (action === "exportBackup") {
          const selected = await dialog.showSaveDialog({ title: "Export Hot Cross Buns backup", defaultPath: "Hot Cross Buns.sqlite", filters: [{ name: "Hot Cross Buns backup", extensions: ["sqlite"] }] });
          if (selected.canceled || !selected.filePath) return ok({ completed: false, message: "Export cancelled." });
          const snapshot = await backups.create();
          await copyFile(snapshot, selected.filePath);
          await chmod(selected.filePath, 0o600);
          return ok({ completed: true, message: `Backup exported to ${selected.filePath}` });
        }
        if (action === "openBackupsFolder") {
          const error = await shell.openPath(backups.directory);
          if (error) throw new CoreStoreError(error);
          return ok({ completed: true, message: "Opened the backup folder." });
        }
        if (action === "restoreLocalNotes") {
          const confirmation = z.object({ accepted: z.literal(true), phrase: z.literal("RESTORE NOTES") }).safeParse(request.data.payload.confirmation);
          if (!confirmation.success) return validationError("Confirm RESTORE NOTES before restoring a backup.");
          const selected = await dialog.showOpenDialog({ title: "Restore local notes from backup", properties: ["openFile"], filters: [{ name: "Hot Cross Buns backup", extensions: ["sqlite"] }] });
          if (selected.canceled || !selected.filePaths[0]) return ok({ completed: false, message: "Restore cancelled." });
          await backups.create();
          const count = await store.restoreLocalNotes(selected.filePaths[0]);
          return ok({ completed: true, message: `Restored ${count} local notes. A backup of your previous data was saved first. Google data and queued changes were preserved.` });
        }
        if (action === "refresh") {
          await googleSync.runNow({ reason: "manual" });
          return ok({ completed: true, message: "Google refresh completed." });
        }
      }
      if (request.data.namespace === "google" && request.data.action === "saveOAuthClient") {
        return ok(await googleOAuth.saveClient(request.data.payload));
      }

      if (request.data.namespace === "google" && request.data.action === "status") {
        return ok(await googleOAuth.status());
      }

      if (request.data.namespace === "google" && request.data.action === "beginOAuth") {
        return ok(await googleOAuth.begin(request.data.payload));
      }

      if (request.data.namespace === "google" && request.data.action === "reconfigureOptionalAccess") {
        return ok(await googleOAuth.reconfigureOptionalAccess(request.data.payload));
      }

      if (request.data.namespace === "google" && request.data.action === "cancelOAuth") {
        return ok(await googleOAuth.cancel());
      }

      if (request.data.namespace === "google" && request.data.action === "disconnect") {
        return ok(await googleOAuth.disconnect(request.data.payload));
      }

      if (request.data.namespace === "google" && request.data.action === "searchDriveFiles") {
        return ok(await googleSync.searchDriveFiles(request.data.payload));
      }

      if (request.data.namespace === "google" && request.data.action === "pickAndUploadDriveFile") {
        const focusedWindow = BrowserWindow.getFocusedWindow();
        const selected = focusedWindow
          ? await dialog.showOpenDialog(focusedWindow, { properties: ["openFile"] })
          : await dialog.showOpenDialog({ properties: ["openFile"] });
        if (selected.canceled || !selected.filePaths[0]) return ok({ cancelled: true });
        return ok({ cancelled: false, item: await googleSync.uploadLocalDriveFile({ accountId: request.data.payload.accountId, filePath: selected.filePaths[0] }) });
      }

      if (request.data.namespace === "google" && request.data.action === "searchGmailMessages") {
        return ok(await googleSync.searchGmailMessages(request.data.payload));
      }

      if (request.data.namespace === "google" && request.data.action === "captureGmailMessage") {
        const task = await googleSync.captureGmailMessage(request.data.payload);
        if (!isLiveGoogleTest()) void googleSync.scheduleAfterLocalMutation().catch(() => undefined);
        return ok(task);
      }

      if (request.data.namespace === "calendar" && request.data.action === "freeBusy") {
        return ok(await googleSync.queryFreeBusy(request.data.payload));
      }

      if (request.data.namespace === "sync" && request.data.action === "runNow") {
        return ok(await googleSync.runNow(request.data.payload));
      }

      if (request.data.namespace === "sync" && request.data.action === "forceFullResync") {
        return ok(await googleSync.forceFullResync(request.data.payload));
      }

      if (
        request.data.namespace === "settings" &&
        request.data.action === "recoveryAction" &&
        request.data.payload.action === "forceFullResync"
      ) {
        return ok(await googleSync.forceFullResync());
      }

      const response = await Promise.resolve(store.dispatch(request.data.namespace, request.data.action, request.data.payload));
      if (request.data.namespace === "diagnostics" && request.data.action === "summary" && response.performance) response.performance.startup = getStartupTimings();
      if (request.data.namespace === "settings" && request.data.action === "update" && !isLiveGoogleTest()) {
        if ("syncMode" in request.data.payload) await googleSync.startBackgroundSync();
        if ("dailyLocalBackupEnabled" in request.data.payload) await backups.start();
      }
      if (
        (["tasks", "calendar"].includes(request.data.namespace) && isWriteAction(request.data.action, request.data.payload)) ||
        (request.data.namespace === "diagnostics" && request.data.action === "retryPendingMutation")
      ) {
        if (!isLiveGoogleTest()) {
          void googleSync.scheduleAfterLocalMutation().catch(() => undefined);
        }
      }
      if (request.data.namespace === "google" && request.data.action === "copyAccountData" && !isLiveGoogleTest()) {
        void googleSync.scheduleAfterLocalMutation().catch(() => undefined);
      }
      return ok(response);
    } catch (error: unknown) {
      if (error instanceof CoreStoreError) {
        return conflictError(error.message);
      }

      appLogger.warn("Core IPC operation failed", "core-ipc", {
        namespace: request.data.namespace,
        action: request.data.action,
        error: error instanceof Error ? error.message : String(error)
      });

      return internalError("The local workspace could not complete that request");
    }
  });
}

function isWriteAction(action: string, payload: Record<string, unknown> = {}): boolean {
  if (action === "smartReschedule") return payload.apply === true;
  return !new Set([
    "listTaskLists", "list", "board", "forCalendarRange", "get", "listCalendars", "listEvents", "listScheduledTaskBlocks",
    "exportAvailability", "freeBusy", "scheduleSuggest"
  ]).has(action);
}

function isGoogleMutationRequest(namespace: string, action: string, payload: Record<string, unknown>): boolean {
  return (namespace === "tasks" || namespace === "calendar") && isWriteAction(action, payload) ||
    (namespace === "diagnostics" && action === "retryPendingMutation") ||
    (namespace === "google" && action === "copyAccountData");
}

function isLiveGoogleReadOnlyRequest(namespace: string, action: string, payload: Record<string, unknown>): boolean {
  if (!isLiveGoogleReadOnlyTest()) {
    return false;
  }

  if (namespace === "sync") {
    return action !== "status" && !(action === "runNow" && payload.readOnly === true);
  }

  if (namespace === "google") {
    return action !== "status";
  }

  if (namespace === "settings" && action === "recoveryAction" && payload.action === "forceFullResync") {
    return true;
  }

  return (namespace === "tasks" || namespace === "calendar") && isWriteAction(action, payload);
}
