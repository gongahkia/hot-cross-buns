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
    bootstrap: {
      get: (request) =>
        invokeContract(ipc, ipcContracts.bootstrap.get, request, "Bootstrap request failed")
    },
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
      bulkReschedule: (request) =>
        invokeContract(
          ipc,
          ipcContracts.tasks.bulkReschedule,
          request,
          "Bulk task reschedule request failed"
        ),
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
      complete: (request) =>
        invokeContract(
          ipc,
          ipcContracts.calendar.complete,
          request,
          "Calendar event complete request failed"
        ),
      reopen: (request) =>
        invokeContract(
          ipc,
          ipcContracts.calendar.reopen,
          request,
          "Calendar event reopen request failed"
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
      scheduleSuggest: (request) =>
        invokeContract(
          ipc,
          ipcContracts.calendar.scheduleSuggest,
          request,
          "Schedule suggestion request failed"
        ),
      smartReschedule: (request) =>
        invokeContract(
          ipc,
          ipcContracts.calendar.smartReschedule,
          request,
          "Smart reschedule request failed"
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
      createList: (request) =>
        invokeContract(ipc, ipcContracts.notes.createList, request, "Note list create request failed"),
      renameList: (request) =>
        invokeContract(ipc, ipcContracts.notes.renameList, request, "Note list rename request failed"),
      deleteList: (request) =>
        invokeContract(ipc, ipcContracts.notes.deleteList, request, "Note list delete request failed"),
      get: (request) =>
        invokeContract(ipc, ipcContracts.notes.get, request, "Note detail request failed"),
      create: (request) =>
        invokeContract(ipc, ipcContracts.notes.create, request, "Note create request failed"),
      update: (request) =>
        invokeContract(ipc, ipcContracts.notes.update, request, "Note update request failed"),
      delete: (request) =>
        invokeContract(ipc, ipcContracts.notes.delete, request, "Note delete request failed"),
      linkSuggest: (request) =>
        invokeContract(ipc, ipcContracts.notes.linkSuggest, request, "Note link suggest request failed"),
      listBrokenLinks: (request) =>
        invokeContract(ipc, ipcContracts.notes.listBrokenLinks, request, "Broken note links request failed"),
      entityLinks: (request) =>
        invokeContract(ipc, ipcContracts.notes.entityLinks, request, "Entity links request failed")
    },
    search: {
      query: (request) =>
        invokeContract(ipc, ipcContracts.search.query, request, "Search request failed"),
      listModels: () =>
        invokeContract(ipc, ipcContracts.search.listModels, {}, "Semantic model list request failed"),
      installModel: (request) =>
        invokeContract(ipc, ipcContracts.search.installModel, request, "Semantic model install failed"),
      uninstallModel: (request) =>
        invokeContract(ipc, ipcContracts.search.uninstallModel, request, "Semantic model uninstall failed"),
      rebuildIndex: (request = {}) =>
        invokeContract(ipc, ipcContracts.search.rebuildIndex, request, "Semantic index rebuild failed")
    },
    tags: {
      list: (request = {}) =>
        invokeContract(ipc, ipcContracts.tags.list, request, "Tag list request failed"),
      create: (request) =>
        invokeContract(ipc, ipcContracts.tags.create, request, "Tag create request failed"),
      update: (request) =>
        invokeContract(ipc, ipcContracts.tags.update, request, "Tag update request failed"),
      delete: (request) =>
        invokeContract(ipc, ipcContracts.tags.delete, request, "Tag delete request failed"),
      merge: (request) =>
        invokeContract(ipc, ipcContracts.tags.merge, request, "Tag merge request failed"),
      bulkApply: (request) =>
        invokeContract(ipc, ipcContracts.tags.bulkApply, request, "Tag bulk apply request failed"),
      previewAutoReapply: (request) =>
        invokeContract(
          ipc,
          ipcContracts.tags.previewAutoReapply,
          request,
          "Auto tag reapply preview failed"
        ),
      applyAutoReapply: (request) =>
        invokeContract(
          ipc,
          ipcContracts.tags.applyAutoReapply,
          request,
          "Auto tag reapply failed"
        ),
      analytics: () =>
        invokeContract(ipc, ipcContracts.tags.analytics, {}, "Tag analytics request failed")
    },
    duplicates: {
      cleanup: (request) =>
        invokeContract(ipc, ipcContracts.duplicates.cleanup, request, "Duplicate cleanup request failed")
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
        ),
      exportPortableArchive: () =>
        invokeContract(
          ipc,
          ipcContracts.settings.exportPortableArchive,
          {},
          "Portable archive export failed"
        ),
      previewPortableImport: (request) =>
        invokeContract(
          ipc,
          ipcContracts.settings.previewPortableImport,
          request,
          "Portable archive preview failed"
        ),
      importPortableArchive: (request) =>
        invokeContract(
          ipc,
          ipcContracts.settings.importPortableArchive,
          request,
          "Portable archive import failed"
        ),
      exportHcbVault: (request) =>
        invokeContract(
          ipc,
          ipcContracts.settings.exportHcbVault,
          request,
          "HCB vault export failed"
        ),
      importHcbVault: (request) =>
        invokeContract(
          ipc,
          ipcContracts.settings.importHcbVault,
          request,
          "HCB vault import failed"
        ),
      hcbVaultRemoteStatus: (request) =>
        invokeContract(
          ipc,
          ipcContracts.settings.hcbVaultRemoteStatus,
          request,
          "HCB vault host status failed"
        ),
      pushHcbVaultRemote: (request) =>
        invokeContract(
          ipc,
          ipcContracts.settings.pushHcbVaultRemote,
          request,
          "HCB vault host push failed"
        ),
      pullHcbVaultRemote: (request) =>
        invokeContract(
          ipc,
          ipcContracts.settings.pullHcbVaultRemote,
          request,
          "HCB vault host pull failed"
        ),
      listLocalPointers: (request = {}) =>
        invokeContract(
          ipc,
          ipcContracts.settings.listLocalPointers,
          request,
          "Local pointer list failed"
        ),
      repairLocalPointer: (request) =>
        invokeContract(
          ipc,
          ipcContracts.settings.repairLocalPointer,
          request,
          "Local pointer repair failed"
        ),
      customizationStatus: () =>
        invokeContract(
          ipc,
          ipcContracts.settings.customizationStatus,
          {},
          "Customization status failed"
        ),
      reloadCustomization: () =>
        invokeContract(
          ipc,
          ipcContracts.settings.reloadCustomization,
          {},
          "Customization reload failed"
        ),
      setSnippetEnabled: (request) =>
        invokeContract(
          ipc,
          ipcContracts.settings.setSnippetEnabled,
          request,
          "Snippet setting update failed"
        ),
      setExtensionEnabled: (request) =>
        invokeContract(
          ipc,
          ipcContracts.settings.setExtensionEnabled,
          request,
          "Extension setting update failed"
        ),
      logExtensionMessage: (request) =>
        invokeContract(
          ipc,
          ipcContracts.settings.logExtensionMessage,
          request,
          "Extension log failed"
        ),
      listAttachments: (request) =>
        invokeContract(
          ipc,
          ipcContracts.settings.listAttachments,
          request,
          "Attachment list failed"
        ),
      addAttachment: (request) =>
        invokeContract(
          ipc,
          ipcContracts.settings.addAttachment,
          request,
          "Attachment add failed"
        ),
      removeAttachment: (request) =>
        invokeContract(
          ipc,
          ipcContracts.settings.removeAttachment,
          request,
          "Attachment remove failed"
        ),
      openAttachment: (request) =>
        invokeContract(
          ipc,
          ipcContracts.settings.openAttachment,
          request,
          "Attachment open failed"
        ),
      downloadAttachment: (request) =>
        invokeContract(
          ipc,
          ipcContracts.settings.downloadAttachment,
          request,
          "Attachment download failed"
        ),
      importIcs: (request) =>
        invokeContract(
          ipc,
          ipcContracts.settings.importIcs,
          request,
          "ICS import failed"
        ),
      listIcsSubscriptions: () =>
        invokeContract(
          ipc,
          ipcContracts.settings.listIcsSubscriptions,
          {},
          "ICS subscription list failed"
        ),
      subscribeIcs: (request) =>
        invokeContract(
          ipc,
          ipcContracts.settings.subscribeIcs,
          request,
          "ICS subscription save failed"
        ),
      refreshIcsSubscription: (request) =>
        invokeContract(
          ipc,
          ipcContracts.settings.refreshIcsSubscription,
          request,
          "ICS subscription refresh failed"
        ),
      deleteIcsSubscription: (request) =>
        invokeContract(
          ipc,
          ipcContracts.settings.deleteIcsSubscription,
          request,
          "ICS subscription delete failed"
        ),
      exportLocalReport: (request) =>
        invokeContract(
          ipc,
          ipcContracts.settings.exportLocalReport,
          request,
          "Local report export failed"
        )
    },
    undo: {
      status: () => invokeContract(ipc, ipcContracts.undo.status, {}, "Undo status failed"),
      undo: () => invokeContract(ipc, ipcContracts.undo.undo, {}, "Undo failed"),
      redo: () => invokeContract(ipc, ipcContracts.undo.redo, {}, "Redo failed")
    },
    mcp: {
      status: () => invokeContract(ipc, ipcContracts.mcp.status, {}, "MCP status failed"),
      setEnabled: (request) =>
        invokeContract(ipc, ipcContracts.mcp.setEnabled, request, "MCP settings update failed")
    },
    agent: {
      listActions: (request = {}) =>
        invokeContract(ipc, ipcContracts.agent.listActions, request, "Agent action list request failed"),
      applyAction: (request) =>
        invokeContract(ipc, ipcContracts.agent.applyAction, request, "Agent action apply failed"),
      rejectAction: (request) =>
        invokeContract(ipc, ipcContracts.agent.rejectAction, request, "Agent action reject failed"),
      clearExpired: () =>
        invokeContract(ipc, ipcContracts.agent.clearExpired, {}, "Agent action cleanup failed")
    },
    webhooks: {
      list: (request = {}) =>
        invokeContract(ipc, ipcContracts.webhooks.list, request, "Webhook list request failed"),
      upsert: (request) =>
        invokeContract(ipc, ipcContracts.webhooks.upsert, request, "Webhook save request failed"),
      delete: (request) =>
        invokeContract(ipc, ipcContracts.webhooks.delete, request, "Webhook delete request failed"),
      test: (request) =>
        invokeContract(ipc, ipcContracts.webhooks.test, request, "Webhook test request failed")
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
      listFontFamilies: () =>
        invokeContract(ipc, ipcContracts.native.listFontFamilies, {}, "Native font list request failed"),
      importMenuBarIcon: (request) =>
        invokeContract(
          ipc,
          ipcContracts.native.importMenuBarIcon,
          request,
          "Menu bar icon import failed"
        ),
      openExternalUrl: (request) =>
        invokeContract(
          ipc,
          ipcContracts.native.openExternalUrl,
          request,
          "External URL open failed"
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
      recordTiming: (request) =>
        invokeContract(
          ipc,
          ipcContracts.diagnostics.recordTiming,
          request,
          "Performance timing record failed"
        ),
      summary: () =>
        invokeContract(
          ipc,
          ipcContracts.diagnostics.summary,
          {},
          "Diagnostics summary request failed"
        ),
      logs: (request = {}) =>
        invokeContract(
          ipc,
          ipcContracts.diagnostics.logs,
          request,
          "Diagnostics logs request failed"
        ),
      clearLogs: () =>
        invokeContract(
          ipc,
          ipcContracts.diagnostics.clearLogs,
          {},
          "Diagnostics log clear request failed"
        ),
      revealLogsFolder: () =>
        invokeContract(
          ipc,
          ipcContracts.diagnostics.revealLogsFolder,
          {},
          "Diagnostics log folder request failed"
        ),
      history: (request = {}) =>
        invokeContract(
          ipc,
          ipcContracts.diagnostics.history,
          request,
          "Diagnostics history request failed"
        ),
      pendingMutations: (request = {}) =>
        invokeContract(
          ipc,
          ipcContracts.diagnostics.pendingMutations,
          request,
          "Diagnostics pending mutation request failed"
        ),
      retryPendingMutation: (request) =>
        invokeContract(
          ipc,
          ipcContracts.diagnostics.retryPendingMutation,
          request,
          "Diagnostics pending mutation retry failed"
        ),
      cancelPendingMutation: (request) =>
        invokeContract(
          ipc,
          ipcContracts.diagnostics.cancelPendingMutation,
          request,
          "Diagnostics pending mutation cancel failed"
        ),
      copyableSummary: () =>
        invokeContract(
          ipc,
          ipcContracts.diagnostics.copyableSummary,
          {},
          "Diagnostics summary copy request failed"
        ),
      exportBundle: () =>
        invokeContract(
          ipc,
          ipcContracts.diagnostics.exportBundle,
          {},
          "Diagnostics bundle export failed"
        ),
      rescheduleNotifications: () =>
        invokeContract(
          ipc,
          ipcContracts.diagnostics.rescheduleNotifications,
          {},
          "Diagnostics notification rebuild failed"
        )
    }
  });
}
