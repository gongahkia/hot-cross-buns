import { BrowserWindow, clipboard, dialog, ipcMain, shell } from "electron";
import { copyFile, chmod, writeFile } from "node:fs/promises";
import { z } from "zod";
import { CoreStoreError } from "../services/coreStoreError";
import type { WorkspaceClient } from "../services/workspaceClient";
import { getStartupTimings, markStartupTiming } from "../startupTiming";
import { appLogger } from "../diagnostics/appLogger";
import { isLiveGoogleReadOnlyTest, isLiveGoogleTest } from "../liveGoogleTestMode";
import { conflictError, internalError, ok, validationError } from "@shared/result";
import { IPC_CHANNELS } from "@shared/ipc";

import { requestSchema, payloadIsValid } from "@shared/ipc/coreValidation";
export { payloadIsValid } from "@shared/ipc/coreValidation";

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
    if (request.data.namespace === "native" && request.data.action === "writeClipboardText") {
      clipboard.writeText(request.data.payload.text as string);
      return ok({ copied: true });
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

      if (request.data.namespace === "diagnostics" && request.data.action === "previewMutationResolution") {
        return ok(await googleSync.previewMutationResolution(request.data.payload));
      }
      if (request.data.namespace === "diagnostics" && request.data.action === "resolveMutation") {
        const result = await googleSync.resolveMutation(request.data.payload);
        if (request.data.payload.strategy === "local" && !isLiveGoogleTest()) void googleSync.scheduleAfterLocalMutation().catch(() => undefined);
        return ok(result);
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
    "listTaskLists", "list", "board", "context", "forCalendarRange", "get", "listCalendars", "listEvents", "listScheduledTaskBlocks",
    "exportAvailability", "freeBusy", "scheduleSuggest"
  ]).has(action);
}

function isGoogleMutationRequest(namespace: string, action: string, payload: Record<string, unknown>): boolean {
  return (namespace === "tasks" || namespace === "calendar") && isWriteAction(action, payload) ||
    (namespace === "diagnostics" && ["retryPendingMutation", "resolveMutation"].includes(action)) ||
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

  return (namespace === "diagnostics" && ["retryPendingMutation", "cancelPendingMutation", "resolveMutation"].includes(action)) ||
    (namespace === "tasks" || namespace === "calendar") && isWriteAction(action, payload);
}
