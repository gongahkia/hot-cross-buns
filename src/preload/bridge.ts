import {
  healthCheckRequestSchema,
  healthCheckResultSchema,
  shellVisibleRequestSchema,
  shellVisibleResultSchema
} from "@shared/diagnostics";
import {
  plannerCompleteTaskRequestSchema,
  plannerSaveTaskRequestSchema,
  plannerSyncStatusResultSchema,
  plannerTaskListRequestSchema,
  plannerTaskMutationResultEnvelopeSchema,
  plannerTaskPageResultSchema,
  plannerWorkspaceResultSchema,
  type PlannerSyncStatus,
  type PlannerTaskMutationResult,
  type PlannerTaskPage,
  type PlannerWorkspace
} from "@shared/planner";
import { IPC_CHANNELS } from "@shared/ipc";
import {
  settingsDataInfoResultSchema,
  settingsGetResultSchema,
  settingsSaveRequestSchema,
  settingsSaveResultSchema,
  type AppSettings,
  type SettingsDataInfo
} from "@shared/settings";
import type { HcbApi } from "@shared/preloadApi";
import type { HcbResult } from "@shared/result";
import { ipcError, validationError } from "@shared/result";
import type { z } from "zod";

export interface IpcBridge {
  invoke: (channel: string, payload: unknown) => Promise<unknown>;
}

function validationResult<T>(message: string): HcbResult<T> {
  return validationError(message) as HcbResult<T>;
}

function ipcFailure<T>(message: string): HcbResult<T> {
  return ipcError(message) as HcbResult<T>;
}

export function createHcbApi(ipc: IpcBridge): HcbApi {
  const legacyApi = {
    diagnostics: {
      health: async () => {
        const request = healthCheckRequestSchema.safeParse({});
        if (!request.success) {
          return validationResult("Invalid health check request");
        }

        try {
          const rawResult = await ipc.invoke(IPC_CHANNELS.diagnostics.health, request.data);
          const parsedResult = healthCheckResultSchema.safeParse(rawResult);

          if (!parsedResult.success) {
            return validationResult("Invalid health check response");
          }

          return parsedResult.data;
        } catch {
          return ipcFailure("Diagnostics health check failed");
        }
      },
      markShellVisible: async () => {
        const request = shellVisibleRequestSchema.safeParse({
          rendererNowMs: performance.now()
        });

        if (!request.success) {
          return validationResult("Invalid shell visibility request");
        }

        try {
          const rawResult = await ipc.invoke(
            IPC_CHANNELS.diagnostics.markShellVisible,
            request.data
          );
          const parsedResult = shellVisibleResultSchema.safeParse(rawResult);

          if (!parsedResult.success) {
            return validationResult("Invalid shell visibility response");
          }

          return parsedResult.data;
        } catch {
          return ipcFailure("Shell visibility timing failed");
        }
      }
    },
    planner: {
      workspace: async (): Promise<HcbResult<PlannerWorkspace>> =>
        invokeValidated<PlannerWorkspace>(
          ipc,
          IPC_CHANNELS.planner.workspace,
          {},
          plannerWorkspaceResultSchema
        ),
      listTasks: async (payload): Promise<HcbResult<PlannerTaskPage>> => {
        const request = plannerTaskListRequestSchema.safeParse(payload);
        if (!request.success) {
          return validationResult("Invalid task list request");
        }

        return invokeValidated<PlannerTaskPage>(
          ipc,
          IPC_CHANNELS.planner.listTasks,
          request.data,
          plannerTaskPageResultSchema
        );
      },
      saveTask: async (payload): Promise<HcbResult<PlannerTaskMutationResult>> => {
        const request = plannerSaveTaskRequestSchema.safeParse(payload);
        if (!request.success) {
          return validationResult("Invalid task change request");
        }

        return invokeValidated<PlannerTaskMutationResult>(
          ipc,
          IPC_CHANNELS.planner.saveTask,
          request.data,
          plannerTaskMutationResultEnvelopeSchema
        );
      },
      completeTask: async (payload): Promise<HcbResult<PlannerTaskMutationResult>> => {
        const request = plannerCompleteTaskRequestSchema.safeParse(payload);
        if (!request.success) {
          return validationResult("Invalid task completion request");
        }

        return invokeValidated<PlannerTaskMutationResult>(
          ipc,
          IPC_CHANNELS.planner.completeTask,
          request.data,
          plannerTaskMutationResultEnvelopeSchema
        );
      },
      syncStatus: async (): Promise<HcbResult<PlannerSyncStatus>> =>
        invokeValidated<PlannerSyncStatus>(
          ipc,
          IPC_CHANNELS.planner.syncStatus,
          {},
          plannerSyncStatusResultSchema
        )
    },
    settings: {
      get: async (): Promise<HcbResult<AppSettings>> =>
        invokeValidated<AppSettings>(
          ipc,
          IPC_CHANNELS.settings.get,
          {},
          settingsGetResultSchema
        ),
      save: async (payload): Promise<HcbResult<AppSettings>> => {
        const request = settingsSaveRequestSchema.safeParse(payload);
        if (!request.success) {
          return validationResult("Invalid settings update");
        }

        return invokeValidated<AppSettings>(
          ipc,
          IPC_CHANNELS.settings.save,
          request.data,
          settingsSaveResultSchema
        );
      },
      dataInfo: async (): Promise<HcbResult<SettingsDataInfo>> =>
        invokeValidated<SettingsDataInfo>(
          ipc,
          IPC_CHANNELS.settings.dataInfo,
          {},
          settingsDataInfoResultSchema
        )
    }
  };

  const core = (namespace: string, action: string) => async (payload: unknown = {}): Promise<HcbResult<any>> => {
    if (!isPlainObject(payload)) {
      return validationResult("Invalid restored application request");
    }

    try {
      const result = await ipc.invoke(IPC_CHANNELS.core.invoke, { namespace, action, payload });
      return isResultEnvelope(result)
        ? result
        : validationResult("Invalid restored application response");
    } catch {
      return ipcFailure("The restored application request failed");
    }
  };
  const actions = (namespace: string, names: readonly string[]): Record<string, any> =>
    Object.fromEntries(names.map((action) => [action, core(namespace, action)]));

  return {
    ...legacyApi,
    bootstrap: actions("bootstrap", ["get"]),
    tasks: actions("tasks", [
      "listTaskLists", "list", "get", "create", "update", "complete", "reopen", "delete",
      "move", "bulkReschedule", "createTaskList", "renameTaskList", "deleteTaskList"
    ]),
    calendar: actions("calendar", [
      "listCalendars", "listEvents", "get", "create", "update", "delete", "complete", "reopen",
      "listScheduledTaskBlocks", "scheduleTaskBlock", "moveScheduledTaskBlock", "unscheduleTaskBlock",
      "exportAvailability", "scheduleSuggest", "smartReschedule"
    ]),
    notes: actions("notes", ["list", "get", "create", "update", "delete", "entityLinks", "listBrokenLinks", "linkSuggest"]),
    tags: actions("tags", ["list", "create", "update", "delete", "merge", "bulkApply", "previewAutoReapply", "applyAutoReapply", "analytics"]),
    search: actions("search", ["query", "installModel", "uninstallModel", "rebuildIndex"]),
    settings: {
      ...legacyApi.settings,
      ...actions("settings", [
        "get", "update", "recoveryAction", "customizationStatus", "logExtensionMessage", "setExtensionEnabled",
        "setSnippetEnabled", "reloadCustomization", "listAttachments", "addAttachment", "openAttachment",
        "downloadAttachment", "removeAttachment", "listIcsSubscriptions", "subscribeIcs", "refreshIcsSubscription",
        "deleteIcsSubscription", "importIcs", "listLocalPointers", "repairLocalPointer", "exportLocalReport",
        "exportPortableArchive", "previewPortableImport", "importPortableArchive", "hcbVaultRemoteStatus",
        "hcbVaultRemoteCredentialStatus", "saveHcbVaultRemoteCredentials", "deleteHcbVaultRemoteCredentials",
        "pullHcbVaultRemote", "pushHcbVaultRemote"
      ])
    },
    google: actions("google", ["status", "saveOAuthClient", "beginOAuth", "disconnect"]),
    diagnostics: {
      ...legacyApi.diagnostics,
      ...actions("diagnostics", [
        "summary", "logs", "history", "pendingMutations", "rescheduleNotifications", "retryPendingMutation",
        "cancelPendingMutation", "clearLogs", "revealLogsFolder", "copyableSummary", "exportBundle",
        "markCachedDataRendered", "recordTiming"
      ])
    },
    sync: {
      ...actions("sync", ["status", "runNow", "forceFullResync"]),
      subscribeStatus: (listener: (status: any) => void): (() => void) => {
        void core("sync", "status")({}).then((result) => { if (result.ok) listener(result.data); });
        return () => undefined;
      }
    },
    undo: actions("undo", ["status", "undo", "redo"]),
    native: {
      ...actions("native", ["capabilities", "listFontFamilies", "requestNotificationPermission", "openExternalUrl", "importMenuBarIcon"]),
      subscribeAction: (_listener: (action: any) => void): (() => void) => () => undefined
    },
    agent: actions("agent", ["listActions", "applyAction", "rejectAction"]),
    duplicates: actions("duplicates", ["cleanup"])
  } as HcbApi;
}

async function invokeValidated<T>(
  ipc: IpcBridge,
  channel: string,
  payload: unknown,
  schema: z.ZodTypeAny
): Promise<HcbResult<T>> {
  try {
    const parsed = schema.safeParse(await ipc.invoke(channel, payload));
    return parsed.success
      ? (parsed.data as HcbResult<T>)
      : validationResult("Invalid local planner response");
  } catch {
    return ipcFailure("Local planner request failed");
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isResultEnvelope(value: unknown): value is HcbResult<any> {
  return isPlainObject(value) && typeof value.ok === "boolean" &&
    (value.ok ? "data" in value : "error" in value);
}
