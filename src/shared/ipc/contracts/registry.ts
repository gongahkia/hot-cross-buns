import { hcbResultSchema } from "../result";
import {
  defineIpcContract,
  entityByIdRequestSchema,
  mutationAckSchema,
  type IpcContract
} from "./core";
import {
  calendarEventCreateRequestSchema,
  calendarEventDeleteRequestSchema,
  calendarEventDetailSchema,
  calendarEventUpdateRequestSchema,
  calendarListRequestSchema,
  calendarListResponseSchema,
  calendarRangeRequestSchema,
  calendarRangeResponseSchema,
  availabilityExportRequestSchema,
  availabilityExportResponseSchema,
  calendarScheduleSuggestRequestSchema,
  calendarScheduleSuggestResponseSchema,
  scheduledTaskBlockCreateRequestSchema,
  scheduledTaskBlockListRequestSchema,
  scheduledTaskBlockListResponseSchema,
  scheduledTaskBlockMoveRequestSchema,
  scheduledTaskBlockSummarySchema,
  scheduledTaskBlockUnscheduleRequestSchema
} from "./calendar";
import {
  diagnosticsCachedDataRenderedRequestSchema,
  diagnosticsClearLogsRequestSchema,
  diagnosticsClearLogsResponseSchema,
  diagnosticsCopyableSummaryRequestSchema,
  diagnosticsCopyableSummaryResponseSchema,
  diagnosticsExportBundleRequestSchema,
  diagnosticsExportBundleResponseSchema,
  diagnosticsHealthRequestSchema,
  diagnosticsHealthResponseSchema,
  diagnosticsHistoryRequestSchema,
  diagnosticsHistoryResponseSchema,
  diagnosticsIpcMetricsRequestSchema,
  diagnosticsIpcMetricsResponseSchema,
  diagnosticsLogsRequestSchema,
  diagnosticsLogsResponseSchema,
  diagnosticsPerformanceRequestSchema,
  diagnosticsPerformanceResponseSchema,
  diagnosticsPendingMutationActionRequestSchema,
  diagnosticsPendingMutationActionResponseSchema,
  diagnosticsPendingMutationsRequestSchema,
  diagnosticsPendingMutationsResponseSchema,
  diagnosticsRescheduleNotificationsRequestSchema,
  diagnosticsRescheduleNotificationsResponseSchema,
  diagnosticsRevealLogsFolderRequestSchema,
  diagnosticsRevealLogsFolderResponseSchema,
  diagnosticsShellVisibleRequestSchema,
  diagnosticsSummaryRequestSchema,
  diagnosticsSummaryResponseSchema,
  startupTimingSnapshotSchema
} from "./diagnostics";
import {
  googleBeginOAuthRequestSchema,
  googleBeginOAuthResponseSchema,
  googleDisconnectRequestSchema,
  googleSaveOAuthClientRequestSchema,
  googleStatusRequestSchema,
  googleStatusResponseSchema
} from "./google";
import { mcpSetEnabledRequestSchema, mcpStatusRequestSchema, mcpStatusResponseSchema } from "./mcp";
import {
  nativeCapabilitiesRequestSchema,
  nativeCapabilitiesResponseSchema,
  nativeFontFamiliesRequestSchema,
  nativeFontFamiliesResponseSchema,
  nativeNotificationPermissionRequestSchema,
  nativeNotificationPermissionResponseSchema
} from "./native";
import {
  noteBrokenLinksRequestSchema,
  noteBrokenLinksResponseSchema,
  noteCreateRequestSchema,
  noteDeleteRequestSchema,
  noteDetailSchema,
  noteLinkSuggestRequestSchema,
  noteLinkSuggestResponseSchema,
  noteListCreateRequestSchema,
  noteListDeleteRequestSchema,
  noteListRequestSchema,
  noteListRenameRequestSchema,
  noteListResponseSchema,
  noteListSummarySchema,
  noteUpdateRequestSchema
} from "./notes";
import { searchQueryRequestSchema, searchQueryResponseSchema } from "./search";
import {
  settingsGetRequestSchema,
  settingsRecoveryActionRequestSchema,
  settingsRecoveryActionResponseSchema,
  settingsSnapshotSchema,
  settingsUpdateRequestSchema
} from "./settings";
import {
  syncRunNowRequestSchema,
  syncRunNowResponseSchema,
  syncStatusRequestSchema,
  syncStatusResponseSchema
} from "./sync";
import {
  undoApplyResponseSchema,
  undoRequestSchema,
  undoStackStatusResponseSchema
} from "./undo";
import {
  taskCompletionRequestSchema,
  taskCreateRequestSchema,
  taskDeleteRequestSchema,
  taskDetailSchema,
  taskListCreateRequestSchema,
  taskListDeleteRequestSchema,
  taskListRenameRequestSchema,
  taskListRequestSchema,
  taskListResponseSchema,
  taskListSummarySchema,
  taskListsRequestSchema,
  taskListsResponseSchema,
  taskMoveRequestSchema,
  taskUpdateRequestSchema
} from "./tasks";

export const ipcContracts = {
  tasks: {
    listTaskLists: defineIpcContract(
      "tasks",
      "listTaskLists",
      taskListsRequestSchema,
      taskListsResponseSchema
    ),
    list: defineIpcContract("tasks", "list", taskListRequestSchema, taskListResponseSchema),
    get: defineIpcContract("tasks", "get", entityByIdRequestSchema, taskDetailSchema),
    create: defineIpcContract("tasks", "create", taskCreateRequestSchema, taskDetailSchema),
    update: defineIpcContract("tasks", "update", taskUpdateRequestSchema, taskDetailSchema),
    complete: defineIpcContract(
      "tasks",
      "complete",
      taskCompletionRequestSchema,
      taskDetailSchema
    ),
    reopen: defineIpcContract("tasks", "reopen", taskCompletionRequestSchema, taskDetailSchema),
    move: defineIpcContract("tasks", "move", taskMoveRequestSchema, taskDetailSchema),
    delete: defineIpcContract("tasks", "delete", taskDeleteRequestSchema, mutationAckSchema),
    createTaskList: defineIpcContract(
      "tasks",
      "createTaskList",
      taskListCreateRequestSchema,
      taskListSummarySchema
    ),
    renameTaskList: defineIpcContract(
      "tasks",
      "renameTaskList",
      taskListRenameRequestSchema,
      taskListSummarySchema
    ),
    deleteTaskList: defineIpcContract(
      "tasks",
      "deleteTaskList",
      taskListDeleteRequestSchema,
      mutationAckSchema
    )
  },
  calendar: {
    listCalendars: defineIpcContract(
      "calendar",
      "listCalendars",
      calendarListRequestSchema,
      calendarListResponseSchema
    ),
    listEvents: defineIpcContract(
      "calendar",
      "listEvents",
      calendarRangeRequestSchema,
      calendarRangeResponseSchema
    ),
    get: defineIpcContract("calendar", "get", entityByIdRequestSchema, calendarEventDetailSchema),
    create: defineIpcContract(
      "calendar",
      "create",
      calendarEventCreateRequestSchema,
      calendarEventDetailSchema
    ),
    update: defineIpcContract(
      "calendar",
      "update",
      calendarEventUpdateRequestSchema,
      calendarEventDetailSchema
    ),
    delete: defineIpcContract(
      "calendar",
      "delete",
      calendarEventDeleteRequestSchema,
      mutationAckSchema
    ),
    listScheduledTaskBlocks: defineIpcContract(
      "calendar",
      "listScheduledTaskBlocks",
      scheduledTaskBlockListRequestSchema,
      scheduledTaskBlockListResponseSchema
    ),
    scheduleTaskBlock: defineIpcContract(
      "calendar",
      "scheduleTaskBlock",
      scheduledTaskBlockCreateRequestSchema,
      scheduledTaskBlockSummarySchema
    ),
    moveScheduledTaskBlock: defineIpcContract(
      "calendar",
      "moveScheduledTaskBlock",
      scheduledTaskBlockMoveRequestSchema,
      scheduledTaskBlockSummarySchema
    ),
    unscheduleTaskBlock: defineIpcContract(
      "calendar",
      "unscheduleTaskBlock",
      scheduledTaskBlockUnscheduleRequestSchema,
      mutationAckSchema
    ),
    scheduleSuggest: defineIpcContract(
      "calendar",
      "scheduleSuggest",
      calendarScheduleSuggestRequestSchema,
      calendarScheduleSuggestResponseSchema
    ),
    exportAvailability: defineIpcContract(
      "calendar",
      "exportAvailability",
      availabilityExportRequestSchema,
      availabilityExportResponseSchema
    )
  },
  notes: {
    list: defineIpcContract("notes", "list", noteListRequestSchema, noteListResponseSchema),
    createList: defineIpcContract("notes", "createList", noteListCreateRequestSchema, noteListSummarySchema),
    renameList: defineIpcContract("notes", "renameList", noteListRenameRequestSchema, noteListSummarySchema),
    deleteList: defineIpcContract("notes", "deleteList", noteListDeleteRequestSchema, mutationAckSchema),
    get: defineIpcContract("notes", "get", entityByIdRequestSchema, noteDetailSchema),
    create: defineIpcContract("notes", "create", noteCreateRequestSchema, noteDetailSchema),
    update: defineIpcContract("notes", "update", noteUpdateRequestSchema, noteDetailSchema),
    delete: defineIpcContract("notes", "delete", noteDeleteRequestSchema, mutationAckSchema),
    linkSuggest: defineIpcContract(
      "notes",
      "linkSuggest",
      noteLinkSuggestRequestSchema,
      noteLinkSuggestResponseSchema
    ),
    listBrokenLinks: defineIpcContract(
      "notes",
      "listBrokenLinks",
      noteBrokenLinksRequestSchema,
      noteBrokenLinksResponseSchema
    )
  },
  search: {
    query: defineIpcContract(
      "search",
      "query",
      searchQueryRequestSchema,
      searchQueryResponseSchema
    )
  },
  sync: {
    status: defineIpcContract("sync", "status", syncStatusRequestSchema, syncStatusResponseSchema),
    runNow: defineIpcContract("sync", "runNow", syncRunNowRequestSchema, syncRunNowResponseSchema)
  },
  google: {
    status: defineIpcContract(
      "google",
      "status",
      googleStatusRequestSchema,
      googleStatusResponseSchema
    ),
    saveOAuthClient: defineIpcContract(
      "google",
      "saveOAuthClient",
      googleSaveOAuthClientRequestSchema,
      googleStatusResponseSchema
    ),
    beginOAuth: defineIpcContract(
      "google",
      "beginOAuth",
      googleBeginOAuthRequestSchema,
      googleBeginOAuthResponseSchema
    ),
    disconnect: defineIpcContract(
      "google",
      "disconnect",
      googleDisconnectRequestSchema,
      googleStatusResponseSchema
    )
  },
  settings: {
    get: defineIpcContract("settings", "get", settingsGetRequestSchema, settingsSnapshotSchema),
    update: defineIpcContract(
      "settings",
      "update",
      settingsUpdateRequestSchema,
      settingsSnapshotSchema
    ),
    recoveryAction: defineIpcContract(
      "settings",
      "recoveryAction",
      settingsRecoveryActionRequestSchema,
      settingsRecoveryActionResponseSchema
    )
  },
  undo: {
    status: defineIpcContract("undo", "status", undoRequestSchema, undoStackStatusResponseSchema),
    undo: defineIpcContract("undo", "undo", undoRequestSchema, undoApplyResponseSchema),
    redo: defineIpcContract("undo", "redo", undoRequestSchema, undoApplyResponseSchema)
  },
  mcp: {
    status: defineIpcContract("mcp", "status", mcpStatusRequestSchema, mcpStatusResponseSchema),
    setEnabled: defineIpcContract(
      "mcp",
      "setEnabled",
      mcpSetEnabledRequestSchema,
      mcpStatusResponseSchema
    )
  },
  native: {
    capabilities: defineIpcContract(
      "native",
      "capabilities",
      nativeCapabilitiesRequestSchema,
      nativeCapabilitiesResponseSchema
    ),
    requestNotificationPermission: defineIpcContract(
      "native",
      "requestNotificationPermission",
      nativeNotificationPermissionRequestSchema,
      nativeNotificationPermissionResponseSchema
    ),
    listFontFamilies: defineIpcContract(
      "native",
      "listFontFamilies",
      nativeFontFamiliesRequestSchema,
      nativeFontFamiliesResponseSchema
    )
  },
  diagnostics: {
    health: defineIpcContract(
      "diagnostics",
      "health",
      diagnosticsHealthRequestSchema,
      diagnosticsHealthResponseSchema
    ),
    markShellVisible: defineIpcContract(
      "diagnostics",
      "markShellVisible",
      diagnosticsShellVisibleRequestSchema,
      startupTimingSnapshotSchema
    ),
    markCachedDataRendered: defineIpcContract(
      "diagnostics",
      "markCachedDataRendered",
      diagnosticsCachedDataRenderedRequestSchema,
      startupTimingSnapshotSchema
    ),
    ipcMetrics: defineIpcContract(
      "diagnostics",
      "ipcMetrics",
      diagnosticsIpcMetricsRequestSchema,
      diagnosticsIpcMetricsResponseSchema
    ),
    performance: defineIpcContract(
      "diagnostics",
      "performance",
      diagnosticsPerformanceRequestSchema,
      diagnosticsPerformanceResponseSchema
    ),
    summary: defineIpcContract(
      "diagnostics",
      "summary",
      diagnosticsSummaryRequestSchema,
      diagnosticsSummaryResponseSchema
    ),
    logs: defineIpcContract(
      "diagnostics",
      "logs",
      diagnosticsLogsRequestSchema,
      diagnosticsLogsResponseSchema
    ),
    clearLogs: defineIpcContract(
      "diagnostics",
      "clearLogs",
      diagnosticsClearLogsRequestSchema,
      diagnosticsClearLogsResponseSchema
    ),
    revealLogsFolder: defineIpcContract(
      "diagnostics",
      "revealLogsFolder",
      diagnosticsRevealLogsFolderRequestSchema,
      diagnosticsRevealLogsFolderResponseSchema
    ),
    history: defineIpcContract(
      "diagnostics",
      "history",
      diagnosticsHistoryRequestSchema,
      diagnosticsHistoryResponseSchema
    ),
    pendingMutations: defineIpcContract(
      "diagnostics",
      "pendingMutations",
      diagnosticsPendingMutationsRequestSchema,
      diagnosticsPendingMutationsResponseSchema
    ),
    retryPendingMutation: defineIpcContract(
      "diagnostics",
      "retryPendingMutation",
      diagnosticsPendingMutationActionRequestSchema,
      diagnosticsPendingMutationActionResponseSchema
    ),
    cancelPendingMutation: defineIpcContract(
      "diagnostics",
      "cancelPendingMutation",
      diagnosticsPendingMutationActionRequestSchema,
      diagnosticsPendingMutationActionResponseSchema
    ),
    copyableSummary: defineIpcContract(
      "diagnostics",
      "copyableSummary",
      diagnosticsCopyableSummaryRequestSchema,
      diagnosticsCopyableSummaryResponseSchema
    ),
    exportBundle: defineIpcContract(
      "diagnostics",
      "exportBundle",
      diagnosticsExportBundleRequestSchema,
      diagnosticsExportBundleResponseSchema
    ),
    rescheduleNotifications: defineIpcContract(
      "diagnostics",
      "rescheduleNotifications",
      diagnosticsRescheduleNotificationsRequestSchema,
      diagnosticsRescheduleNotificationsResponseSchema
    )
  }
} as const;

export type IpcContracts = typeof ipcContracts;
export type IpcDomainName = keyof IpcContracts;
export type IpcMethodName<Domain extends IpcDomainName> = keyof IpcContracts[Domain] & string;

export function resultSchemaForContract(contract: IpcContract) {
  return hcbResultSchema(contract.responseSchema);
}
