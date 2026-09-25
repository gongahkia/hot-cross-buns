import { ipcMain } from "electron";
import { z } from "zod";
import { CoreStore, CoreStoreError } from "../services/coreStore";
import { GoogleOAuthController } from "../services/googleOAuth";
import { GoogleSyncService } from "../services/googleSync";
import { conflictError, internalError, ok, validationError } from "@shared/result";

const requestSchema = z.object({
  namespace: z.enum([
    "bootstrap", "tasks", "calendar", "notes", "tags", "search", "settings",
    "sync", "google", "undo", "native", "diagnostics", "agent", "duplicates"
  ]),
  action: z.string().min(1).max(80).regex(/^[a-zA-Z][a-zA-Z0-9]*$/),
  payload: z.object({}).catchall(z.unknown()).default({})
}).strict();

export function registerCoreIpc(
  store: CoreStore,
  googleOAuth: GoogleOAuthController,
  googleSync: GoogleSyncService
): void {
  ipcMain.handle("hcb:core:invoke", async (_event, payload: unknown) => {
    const request = requestSchema.safeParse(payload);

    if (!request.success) {
      return validationError("Invalid restored application request");
    }

    try {
      if (request.data.namespace === "google" && request.data.action === "saveOAuthClient") {
        return ok(await googleOAuth.saveClient(request.data.payload));
      }

      if (request.data.namespace === "google" && request.data.action === "beginOAuth") {
        return ok(await googleOAuth.begin());
      }

      if (request.data.namespace === "google" && request.data.action === "disconnect") {
        return ok(await googleOAuth.disconnect());
      }

      if (request.data.namespace === "sync" && request.data.action === "runNow") {
        return ok(await googleSync.runNow(request.data.payload));
      }

      if (request.data.namespace === "sync" && request.data.action === "forceFullResync") {
        return ok(await googleSync.forceFullResync());
      }

      if (
        request.data.namespace === "settings" &&
        request.data.action === "recoveryAction" &&
        request.data.payload.action === "forceFullResync"
      ) {
        return ok(await googleSync.forceFullResync());
      }

      const response = store.dispatch(request.data.namespace, request.data.action, request.data.payload);
      if (["tasks", "calendar"].includes(request.data.namespace) && isWriteAction(request.data.action)) {
        void googleSync.runNow({ reason: "local-mutation" }).catch(() => undefined);
      }
      return ok(response);
    } catch (error: unknown) {
      if (error instanceof CoreStoreError) {
        return conflictError(error.message);
      }

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
