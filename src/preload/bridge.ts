import {
  HCB_IPC_VERSION,
  IPC_CHANNELS,
  ipcContracts,
  nativeActionSchema,
  resultSchemaForContract,
  syncStatusResponseSchema,
  type IpcContract
} from "@shared/ipc/contracts";
import type { HcbApi } from "@shared/ipc/preloadApi";
import type { HcbResult } from "@shared/ipc/result";
import { ipcError, validationError } from "@shared/ipc/result";

export interface IpcBridge {
  invoke: (channel: string, payload: unknown) => Promise<unknown>;
  on?: (channel: string, listener: (event: unknown, payload: unknown) => void) => void;
  removeListener?: (
    channel: string,
    listener: (event: unknown, payload: unknown) => void
  ) => void;
}

function validationResult<T>(message: string): HcbResult<T> {
  return validationError(message) as HcbResult<T>;
}

function ipcFailure<T>(message: string): HcbResult<T> {
  return ipcError(message) as HcbResult<T>;
}

function nowMs(): number | undefined {
  if (typeof performance === "undefined") {
    return undefined;
  }

  const now = performance.now();
  return Number.isFinite(now) && now >= 0 ? now : undefined;
}

function withRendererTiming(request?: { rendererNowMs?: number }): { rendererNowMs?: number } {
  if (request && "rendererNowMs" in request) {
    return request;
  }

  const rendererNowMs = nowMs();
  return rendererNowMs === undefined ? {} : { rendererNowMs };
}

function freezeApi<T extends object>(api: T): T {
  for (const value of Object.values(api)) {
    if (value && typeof value === "object") {
      freezeApi(value as Record<string, unknown>);
    }
  }

  return Object.freeze(api);
}

async function invokeContract<T>(
  ipc: IpcBridge,
  contract: IpcContract,
  requestPayload: unknown,
  failureMessage: string
): Promise<HcbResult<T>> {
  const request = contract.requestSchema.safeParse(requestPayload ?? {});

  if (!request.success) {
    return validationResult(`Invalid ${contract.domain}.${contract.method} request`);
  }

  try {
    const rawResult = await ipc.invoke(IPC_CHANNELS.dispatch, {
      version: HCB_IPC_VERSION,
      domain: contract.domain,
      method: contract.method,
      request: request.data
    });
    const parsedResult = resultSchemaForContract(contract).safeParse(rawResult);

    if (!parsedResult.success) {
      return validationResult(`Invalid ${contract.domain}.${contract.method} response`);
    }

    return parsedResult.data as HcbResult<T>;
  } catch {
    return ipcFailure(failureMessage);
  }
}

export function createHcbApi(ipc: IpcBridge): HcbApi {
  return freezeApi({
    tasks: {
      listTaskLists: (request = {}) =>
        invokeContract(
          ipc,
          ipcContracts.tasks.listTaskLists,
          request,
          "Task list source request failed"
        ),
      list: (request = {}) =>
        invokeContract(ipc, ipcContracts.tasks.list, request, "Task list request failed"),
      get: (request) =>
        invokeContract(ipc, ipcContracts.tasks.get, request, "Task detail request failed"),
      create: (request) =>
        invokeContract(ipc, ipcContracts.tasks.create, request, "Task create request failed"),
      update: (request) =>
        invokeContract(ipc, ipcContracts.tasks.update, request, "Task update request failed"),
      complete: (request) =>
        invokeContract(ipc, ipcContracts.tasks.complete, request, "Task complete request failed"),
      reopen: (request) =>
        invokeContract(ipc, ipcContracts.tasks.reopen, request, "Task reopen request failed"),
      move: (request) =>
        invokeContract(ipc, ipcContracts.tasks.move, request, "Task move request failed"),
      delete: (request) =>
        invokeContract(ipc, ipcContracts.tasks.delete, request, "Task delete request failed"),
      createTaskList: (request) =>
        invokeContract(
          ipc,
          ipcContracts.tasks.createTaskList,
          request,
          "Task list create request failed"
        ),
      renameTaskList: (request) =>
        invokeContract(
          ipc,
          ipcContracts.tasks.renameTaskList,
          request,
          "Task list rename request failed"
        ),
      deleteTaskList: (request) =>
        invokeContract(
          ipc,
          ipcContracts.tasks.deleteTaskList,
          request,
          "Task list delete request failed"
        )
    },
    calendar: {
      listCalendars: (request = {}) =>
        invokeContract(
          ipc,
          ipcContracts.calendar.listCalendars,
          request,
          "Calendar source request failed"
        ),
      listEvents: (request) =>
        invokeContract(
          ipc,
          ipcContracts.calendar.listEvents,
          request,
          "Calendar range request failed"
        ),
      get: (request) =>
        invokeContract(ipc, ipcContracts.calendar.get, request, "Calendar event request failed"),
      create: (request) =>
        invokeContract(
          ipc,
          ipcContracts.calendar.create,
          request,
          "Calendar event create request failed"
        ),
      update: (request) =>
        invokeContract(
          ipc,
          ipcContracts.calendar.update,
          request,
          "Calendar event update request failed"
        ),
      delete: (request) =>
        invokeContract(
          ipc,
          ipcContracts.calendar.delete,
          request,
          "Calendar event delete request failed"
        ),
      listScheduledTaskBlocks: (request) =>
        invokeContract(
          ipc,
          ipcContracts.calendar.listScheduledTaskBlocks,
          request,
          "Scheduled task block list request failed"
        ),
      scheduleTaskBlock: (request) =>
        invokeContract(
          ipc,
          ipcContracts.calendar.scheduleTaskBlock,
          request,
          "Task scheduling request failed"
        ),
      moveScheduledTaskBlock: (request) =>
        invokeContract(
          ipc,
          ipcContracts.calendar.moveScheduledTaskBlock,
          request,
          "Scheduled task move request failed"
        ),
      unscheduleTaskBlock: (request) =>
        invokeContract(
          ipc,
          ipcContracts.calendar.unscheduleTaskBlock,
          request,
          "Scheduled task unschedule request failed"
        ),
      exportAvailability: (request) =>
        invokeContract(
          ipc,
          ipcContracts.calendar.exportAvailability,
          request,
          "Availability export request failed"
        )
    },
    notes: {
      list: (request = {}) =>
        invokeContract(ipc, ipcContracts.notes.list, request, "Note list request failed"),
      get: (request) =>
        invokeContract(ipc, ipcContracts.notes.get, request, "Note detail request failed"),
      create: (request) =>
        invokeContract(ipc, ipcContracts.notes.create, request, "Note create request failed"),
      update: (request) =>
        invokeContract(ipc, ipcContracts.notes.update, request, "Note update request failed"),
      delete: (request) =>
        invokeContract(ipc, ipcContracts.notes.delete, request, "Note delete request failed")
    },
    search: {
      query: (request) =>
        invokeContract(ipc, ipcContracts.search.query, request, "Search request failed")
    },
    sync: {
      status: () => invokeContract(ipc, ipcContracts.sync.status, {}, "Sync status failed"),
      runNow: (request = {}) =>
        invokeContract(ipc, ipcContracts.sync.runNow, request, "Sync request failed"),
      subscribeStatus: (listener) => {
        if (!ipc.on || !ipc.removeListener) {
          return () => undefined;
        }

        const eventListener = (_event: unknown, payload: unknown): void => {
          const parsed = syncStatusResponseSchema.safeParse(payload);

          if (parsed.success) {
            listener(parsed.data);
          }
        };

        ipc.on(IPC_CHANNELS.syncStatus, eventListener);

        return () => {
          ipc.removeListener?.(IPC_CHANNELS.syncStatus, eventListener);
        };
      }
    },
    google: {
      status: () => invokeContract(ipc, ipcContracts.google.status, {}, "Google status failed"),
      saveOAuthClient: (request) =>
        invokeContract(
          ipc,
          ipcContracts.google.saveOAuthClient,
          request,
          "Google OAuth client update failed"
        ),
      beginOAuth: () =>
        invokeContract(ipc, ipcContracts.google.beginOAuth, {}, "Google OAuth start failed"),
      disconnect: (request = {}) =>
        invokeContract(ipc, ipcContracts.google.disconnect, request, "Google disconnect failed")
    },
    settings: {
      get: () => invokeContract(ipc, ipcContracts.settings.get, {}, "Settings request failed"),
      update: (request) =>
        invokeContract(ipc, ipcContracts.settings.update, request, "Settings update failed"),
      recoveryAction: (request) =>
        invokeContract(
          ipc,
          ipcContracts.settings.recoveryAction,
          request,
          "Settings recovery action failed"
        )
    },
    mcp: {
      status: () => invokeContract(ipc, ipcContracts.mcp.status, {}, "MCP status failed"),
      setEnabled: (request) =>
        invokeContract(ipc, ipcContracts.mcp.setEnabled, request, "MCP settings update failed")
    },
    native: {
      capabilities: () =>
        invokeContract(ipc, ipcContracts.native.capabilities, {}, "Native capability request failed"),
      requestNotificationPermission: () =>
        invokeContract(
          ipc,
          ipcContracts.native.requestNotificationPermission,
          {},
          "Notification permission request failed"
        ),
      subscribeAction: (listener) => {
        if (!ipc.on || !ipc.removeListener) {
          return () => undefined;
        }

        const eventListener = (_event: unknown, payload: unknown): void => {
          const parsed = nativeActionSchema.safeParse(payload);

          if (parsed.success) {
            listener(parsed.data);
          }
        };

        ipc.on(IPC_CHANNELS.nativeAction, eventListener);

        return () => {
          ipc.removeListener?.(IPC_CHANNELS.nativeAction, eventListener);
        };
      }
    },
    diagnostics: {
      health: () =>
        invokeContract(ipc, ipcContracts.diagnostics.health, {}, "Diagnostics health check failed"),
      markShellVisible: (request) =>
        invokeContract(
          ipc,
          ipcContracts.diagnostics.markShellVisible,
          withRendererTiming(request),
          "Shell visibility timing failed"
        ),
      markCachedDataRendered: (request) =>
        invokeContract(
          ipc,
          ipcContracts.diagnostics.markCachedDataRendered,
          withRendererTiming(request),
          "Cached data render timing failed"
        ),
      ipcMetrics: () =>
        invokeContract(
          ipc,
          ipcContracts.diagnostics.ipcMetrics,
          {},
          "IPC metrics request failed"
        ),
      performance: (request = {}) =>
        invokeContract(
          ipc,
          ipcContracts.diagnostics.performance,
          request,
          "Performance metrics request failed"
        ),
      summary: () =>
        invokeContract(
          ipc,
          ipcContracts.diagnostics.summary,
          {},
          "Diagnostics summary request failed"
        )
    }
  });
}
