import { ipcMain } from "electron";
import { z } from "zod";
import { CoreStore, CoreStoreError } from "../services/coreStore";
import { conflictError, internalError, ok, validationError } from "@shared/result";

const requestSchema = z.object({
  namespace: z.enum([
    "bootstrap", "tasks", "calendar", "notes", "tags", "search", "settings",
    "sync", "google", "undo", "native", "diagnostics", "agent", "duplicates"
  ]),
  action: z.string().min(1).max(80).regex(/^[a-zA-Z][a-zA-Z0-9]*$/),
  payload: z.object({}).catchall(z.unknown()).default({})
}).strict();

export function registerCoreIpc(store: CoreStore): void {
  ipcMain.handle("hcb:core:invoke", async (_event, payload: unknown) => {
    const request = requestSchema.safeParse(payload);

    if (!request.success) {
      return validationError("Invalid restored application request");
    }

    try {
      return ok(store.dispatch(request.data.namespace, request.data.action, request.data.payload));
    } catch (error: unknown) {
      if (error instanceof CoreStoreError) {
        return conflictError(error.message);
      }

      return internalError("The local workspace could not complete that request");
    }
  });
}
