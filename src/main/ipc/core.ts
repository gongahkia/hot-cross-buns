import { BrowserWindow, dialog, ipcMain } from "electron";
import { z } from "zod";
import { CoreStore, CoreStoreError } from "../services/coreStore";
import { GoogleOAuthController } from "../services/googleOAuth";
import { GoogleSyncService } from "../services/googleSync";
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
  tasks: ["listTaskLists", "list", "get", "create", "update", "complete", "reopen", "delete", "move", "bulkReschedule", "createTaskList", "renameTaskList", "deleteTaskList"],
  calendar: ["listCalendars", "listEvents", "get", "create", "update", "delete", "complete", "reopen", "listScheduledTaskBlocks", "scheduleTaskBlock", "moveScheduledTaskBlock", "unscheduleTaskBlock", "exportAvailability", "freeBusy", "scheduleSuggest", "smartReschedule"],
  notes: ["list", "get", "create", "update", "delete", "createNoteList", "renameNoteList", "deleteNoteList", "entityLinks", "listBrokenLinks", "linkSuggest", "legacyMigrationPreview", "importLegacyPseudoNotes"],
  tags: ["list", "create", "update", "delete", "merge", "bulkApply", "previewAutoReapply", "applyAutoReapply", "analytics"],
  search: ["query", "installModel", "uninstallModel", "rebuildIndex"],
  settings: ["get", "update", "recoveryAction", "customizationStatus", "logExtensionMessage", "setExtensionEnabled", "setSnippetEnabled", "reloadCustomization", "listAttachments", "addAttachment", "openAttachment", "downloadAttachment", "removeAttachment", "listIcsSubscriptions", "subscribeIcs", "refreshIcsSubscription", "deleteIcsSubscription", "importIcs", "listLocalPointers", "repairLocalPointer", "exportLocalReport", "exportPortableArchive", "previewPortableImport", "importPortableArchive", "hcbVaultRemoteStatus", "hcbVaultRemoteCredentialStatus", "saveHcbVaultRemoteCredentials", "deleteHcbVaultRemoteCredentials", "pullHcbVaultRemote", "pushHcbVaultRemote"],
  sync: ["status", "runNow", "forceFullResync"],
  google: ["status", "saveOAuthClient", "beginOAuth", "reconfigureOptionalAccess", "cancelOAuth", "disconnect", "searchDriveFiles", "pickAndUploadDriveFile", "searchGmailMessages", "captureGmailMessage", "previewAccountCopy", "copyAccountData"],
  undo: ["status", "undo", "redo"],
  native: ["capabilities", "listFontFamilies", "requestNotificationPermission", "openExternalUrl", "importMenuBarIcon"],
  diagnostics: ["summary", "logs", "history", "pendingMutations", "rescheduleNotifications", "retryPendingMutation", "cancelPendingMutation", "clearLogs", "revealLogsFolder", "copyableSummary", "exportBundle", "markCachedDataRendered", "recordTiming"],
  agent: ["listActions", "applyAction", "rejectAction"],
  duplicates: ["cleanup"]
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
      capacityMinutes: z.number().finite().min(5).max(1_440).optional()
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
  return true;
}

export function registerCoreIpc(
  store: CoreStore,
  googleOAuth: GoogleOAuthController,
  googleSync: GoogleSyncService
): void {
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
      if (request.data.namespace === "google" && request.data.action === "saveOAuthClient") {
        return ok(await googleOAuth.saveClient(request.data.payload));
      }

      if (request.data.namespace === "google" && request.data.action === "status") {
        return ok(googleOAuth.status());
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
        const task = googleSync.captureGmailMessage(request.data.payload);
        if (!isLiveGoogleTest()) googleSync.scheduleAfterLocalMutation();
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
      if (
        (["tasks", "calendar"].includes(request.data.namespace) && isWriteAction(request.data.action, request.data.payload)) ||
        (request.data.namespace === "diagnostics" && request.data.action === "retryPendingMutation")
      ) {
        if (!isLiveGoogleTest()) {
          googleSync.scheduleAfterLocalMutation();
        }
      }
      if (request.data.namespace === "google" && request.data.action === "copyAccountData" && !isLiveGoogleTest()) {
        googleSync.scheduleAfterLocalMutation();
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
    "listTaskLists", "list", "get", "listCalendars", "listEvents", "listScheduledTaskBlocks",
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
