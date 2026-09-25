import { ipcMain } from "electron";
import {
  plannerCompleteTaskRequestSchema,
  plannerSaveTaskRequestSchema,
  plannerTaskListRequestSchema
} from "@shared/planner";
import { IPC_CHANNELS } from "@shared/ipc";
import { conflictError, internalError, ok, validationError } from "@shared/result";
import { PlannerConflictError, PlannerStore } from "../services/plannerStore";

export function registerPlannerIpc(planner: PlannerStore): void {
  ipcMain.handle(IPC_CHANNELS.planner.workspace, async (_event, payload: unknown) => {
    if (!isEmptyObject(payload)) {
      return validationError("Invalid planner workspace request");
    }

    return execute(() => planner.workspace());
  });

  ipcMain.handle(IPC_CHANNELS.planner.listTasks, async (_event, payload: unknown) => {
    const request = plannerTaskListRequestSchema.safeParse(payload);
    if (!request.success) {
      return validationError("Invalid task list request");
    }

    return execute(() => planner.listTasks(request.data));
  });

  ipcMain.handle(IPC_CHANNELS.planner.saveTask, async (_event, payload: unknown) => {
    const request = plannerSaveTaskRequestSchema.safeParse(payload);
    if (!request.success) {
      return validationError("Invalid task change request");
    }

    return execute(() => planner.saveTask(request.data));
  });

  ipcMain.handle(IPC_CHANNELS.planner.completeTask, async (_event, payload: unknown) => {
    const request = plannerCompleteTaskRequestSchema.safeParse(payload);
    if (!request.success) {
      return validationError("Invalid task completion request");
    }

    return execute(() => planner.completeTask(request.data));
  });

  ipcMain.handle(IPC_CHANNELS.planner.syncStatus, async (_event, payload: unknown) => {
    if (!isEmptyObject(payload)) {
      return validationError("Invalid sync status request");
    }

    return execute(() => planner.syncStatus());
  });
}

async function execute<T>(operation: () => Promise<T>) {
  try {
    return ok(await operation());
  } catch (error: unknown) {
    if (error instanceof PlannerConflictError) {
      return conflictError(error.message);
    }

    return internalError("The local planner could not complete that request");
  }
}

function isEmptyObject(payload: unknown): payload is Record<string, never> {
  return (
    typeof payload === "object" &&
    payload !== null &&
    !Array.isArray(payload) &&
    Object.keys(payload).length === 0
  );
}
