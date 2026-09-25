import { BrowserWindow, ipcMain } from "electron";
import { z } from "zod";
import { CoreStore, CoreStoreError } from "../services/coreStore";
import { GoogleOAuthController } from "../services/googleOAuth";
import { GoogleSyncService } from "../services/googleSync";
import { appLogger } from "../diagnostics/appLogger";
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
  calendar: ["listCalendars", "listEvents", "get", "create", "update", "delete", "complete", "reopen", "listScheduledTaskBlocks", "scheduleTaskBlock", "moveScheduledTaskBlock", "unscheduleTaskBlock", "exportAvailability", "scheduleSuggest", "smartReschedule"],
  notes: ["list", "get", "create", "update", "delete", "entityLinks", "listBrokenLinks", "linkSuggest"],
  tags: ["list", "create", "update", "delete", "merge", "bulkApply", "previewAutoReapply", "applyAutoReapply", "analytics"],
  search: ["query", "installModel", "uninstallModel", "rebuildIndex"],
  settings: ["get", "update", "recoveryAction", "customizationStatus", "logExtensionMessage", "setExtensionEnabled", "setSnippetEnabled", "reloadCustomization", "listAttachments", "addAttachment", "openAttachment", "downloadAttachment", "removeAttachment", "listIcsSubscriptions", "subscribeIcs", "refreshIcsSubscription", "deleteIcsSubscription", "importIcs", "listLocalPointers", "repairLocalPointer", "exportLocalReport", "exportPortableArchive", "previewPortableImport", "importPortableArchive", "hcbVaultRemoteStatus", "hcbVaultRemoteCredentialStatus", "saveHcbVaultRemoteCredentials", "deleteHcbVaultRemoteCredentials", "pullHcbVaultRemote", "pushHcbVaultRemote"],
  sync: ["status", "runNow", "forceFullResync"],
  google: ["status", "saveOAuthClient", "beginOAuth", "disconnect"],
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
  durationMinutes: z.number().finite().min(1).max(1_440).optional(), lockedSchedule: z.boolean().optional(),
  plannedStart: isoDateSchema.nullable().optional(), plannedEnd: isoDateSchema.nullable().optional(), accountId: idSchema.optional()
}).passthrough();
const eventWriteSchema = z.object({
  id: idSchema.optional(), calendarId: idSchema.optional(), title: z.string().trim().min(1).max(10_000).optional(),
  startsAt: isoDateSchema.optional(), endsAt: isoDateSchema.optional(), allDay: z.boolean().optional(),
  description: z.string().max(100_000).optional(), scope: z.enum(["series", "occurrence", "following", "thisAndFollowing", "future"]).optional()
}).passthrough();

function payloadIsValid(namespace: string, action: string, payload: Record<string, unknown>): boolean {
  if (!actionMap[namespace]?.includes(action)) return false;
  if (namespace === "tasks" && ["create", "update", "complete", "reopen", "delete", "move"].includes(action)) return taskWriteSchema.safeParse(payload).success;
  if (namespace === "calendar" && ["create", "update", "complete", "reopen"].includes(action)) return eventWriteSchema.safeParse(payload).success;
  if (namespace === "calendar" && action === "scheduleTaskBlock") return z.object({ taskId: idSchema, calendarId: idSchema, startsAt: isoDateSchema, endsAt: isoDateSchema.optional(), durationMinutes: z.number().finite().min(5).max(1_440).optional() }).safeParse(payload).success;
  if (namespace === "calendar" && action === "exportAvailability") return z.object({ start: isoDateSchema, end: isoDateSchema, calendarIds: z.array(idSchema).max(100).optional(), format: z.literal("text").optional() }).safeParse(payload).success;
  if (namespace === "google" && action === "saveOAuthClient") return z.object({ clientId: z.string().trim().min(10).max(500), clientSecret: z.string().max(1_000).optional() }).safeParse(payload).success;
  if (namespace === "google" && action === "disconnect") return z.object({ accountId: idSchema.optional() }).safeParse(payload).success;
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

    try {
      if (request.data.namespace === "google" && request.data.action === "saveOAuthClient") {
        return ok(await googleOAuth.saveClient(request.data.payload));
      }

      if (request.data.namespace === "google" && request.data.action === "beginOAuth") {
        return ok(await googleOAuth.begin());
      }

      if (request.data.namespace === "google" && request.data.action === "disconnect") {
        return ok(await googleOAuth.disconnect(request.data.payload));
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
        (["tasks", "calendar"].includes(request.data.namespace) && isWriteAction(request.data.action)) ||
        (request.data.namespace === "diagnostics" && request.data.action === "retryPendingMutation")
      ) {
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

function isWriteAction(action: string): boolean {
  return !new Set([
    "listTaskLists", "list", "get", "listCalendars", "listEvents", "listScheduledTaskBlocks",
    "exportAvailability", "scheduleSuggest", "smartReschedule"
  ]).has(action);
}
