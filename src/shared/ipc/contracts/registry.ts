import { hcbResultSchema } from "../result";
import {
  bootstrapGetRequestSchema,
  bootstrapGetResponseSchema
} from "./bootstrap";
import {
  defineIpcContract,
  entityByIdRequestSchema,
  mutationAckSchema,
  type IpcContract
} from "./core";
import {
  agentActionApplyRequestSchema,
  agentActionApplyResponseSchema,
  agentActionClearExpiredRequestSchema,
  agentActionClearExpiredResponseSchema,
  agentActionListRequestSchema,
  agentActionListResponseSchema,
  agentActionRejectRequestSchema,
  agentActionRejectResponseSchema
} from "./agent";
import {
  calendarEventCreateRequestSchema,
  calendarEventDeleteRequestSchema,
  calendarEventCompletionRequestSchema,
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
  chatClearRequestSchema,
  chatClearResponseSchema,
  chatListMessagesRequestSchema,
  chatListMessagesResponseSchema,
  chatListSessionsRequestSchema,
  chatListSessionsResponseSchema,
  chatProviderHealthRequestSchema,
  chatProviderHealthResponseSchema,
  chatSendRequestSchema,
  chatSendResponseSchema
} from "./chat";
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
  diagnosticsRecordTimingRequestSchema,
  diagnosticsRecordTimingResponseSchema,
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
  duplicateCleanupRequestSchema,
  duplicateCleanupResponseSchema
} from "./duplicates";
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
  nativeImportMenuBarIconRequestSchema,
  nativeImportMenuBarIconResponseSchema,
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
  autoTagReapplyApplyRequestSchema,
  autoTagReapplyApplyResponseSchema,
  autoTagReapplyPreviewRequestSchema,
  autoTagReapplyPreviewResponseSchema,
  tagBulkApplyRequestSchema,
  tagAnalyticsResponseSchema,
  tagCreateRequestSchema,
  tagDeleteRequestSchema,
  tagListRequestSchema,
  tagListResponseSchema,
  tagMergeRequestSchema,
  tagMutationResponseSchema,
  tagUpdateRequestSchema
} from "./tags";
import {
  settingsGetRequestSchema,
  localPointerListRequestSchema,
  localPointerListResponseSchema,
  localPointerRepairRequestSchema,
  localPointerRepairResponseSchema,
  portableArchivePathRequestSchema,
  portableExportResponseSchema,
  portableImportPreviewSchema,
  portableImportRequestSchema,
  portableImportResponseSchema,
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
  webhookDeleteRequestSchema,
  webhookListRequestSchema,
  webhookListResponseSchema,
  webhookMutationResponseSchema,
  webhookTestRequestSchema,
  webhookUpsertRequestSchema
} from "./webhooks";
import {
  undoApplyResponseSchema,
  undoRequestSchema,
  undoStackStatusResponseSchema
} from "./undo";
import {
  taskCompletionRequestSchema,
  taskBulkMutationResponseSchema,
  taskBulkRescheduleRequestSchema,
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
  bootstrap: {
    get: defineIpcContract(
      "bootstrap",
      "get",
      bootstrapGetRequestSchema,
      bootstrapGetResponseSchema
    )
  },
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
    bulkReschedule: defineIpcContract(
      "tasks",
      "bulkReschedule",
      taskBulkRescheduleRequestSchema,
      taskBulkMutationResponseSchema
    ),
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
    complete: defineIpcContract(
      "calendar",
      "complete",
      calendarEventCompletionRequestSchema,
      calendarEventDetailSchema
    ),
    reopen: defineIpcContract(
      "calendar",
      "reopen",
      calendarEventCompletionRequestSchema,
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
  tags: {
    list: defineIpcContract("tags", "list", tagListRequestSchema, tagListResponseSchema),
    create: defineIpcContract("tags", "create", tagCreateRequestSchema, tagMutationResponseSchema),
    update: defineIpcContract("tags", "update", tagUpdateRequestSchema, tagMutationResponseSchema),
    delete: defineIpcContract("tags", "delete", tagDeleteRequestSchema, tagMutationResponseSchema),
    merge: defineIpcContract("tags", "merge", tagMergeRequestSchema, tagMutationResponseSchema),
    bulkApply: defineIpcContract("tags", "bulkApply", tagBulkApplyRequestSchema, tagMutationResponseSchema),
    previewAutoReapply: defineIpcContract(
      "tags",
      "previewAutoReapply",
      autoTagReapplyPreviewRequestSchema,
      autoTagReapplyPreviewResponseSchema
    ),
    applyAutoReapply: defineIpcContract(
      "tags",
      "applyAutoReapply",
      autoTagReapplyApplyRequestSchema,
      autoTagReapplyApplyResponseSchema
    ),
    analytics: defineIpcContract("tags", "analytics", settingsGetRequestSchema, tagAnalyticsResponseSchema)
  },
  duplicates: {
    cleanup: defineIpcContract(
      "duplicates",
      "cleanup",
      duplicateCleanupRequestSchema,
      duplicateCleanupResponseSchema
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
  agent: {
    listActions: defineIpcContract(
      "agent",
      "listActions",
      agentActionListRequestSchema,
      agentActionListResponseSchema
    ),
    applyAction: defineIpcContract(
      "agent",
      "applyAction",
      agentActionApplyRequestSchema,
      agentActionApplyResponseSchema
    ),
    rejectAction: defineIpcContract(
      "agent",
      "rejectAction",
      agentActionRejectRequestSchema,
      agentActionRejectResponseSchema
    ),
    clearExpired: defineIpcContract(
      "agent",
      "clearExpired",
      agentActionClearExpiredRequestSchema,
      agentActionClearExpiredResponseSchema
    )
  },
  webhooks: {
    list: defineIpcContract("webhooks", "list", webhookListRequestSchema, webhookListResponseSchema),
    upsert: defineIpcContract("webhooks", "upsert", webhookUpsertRequestSchema, webhookMutationResponseSchema),
    delete: defineIpcContract("webhooks", "delete", webhookDeleteRequestSchema, webhookMutationResponseSchema),
    test: defineIpcContract("webhooks", "test", webhookTestRequestSchema, webhookMutationResponseSchema)
  },
  chat: {
    listSessions: defineIpcContract(
      "chat",
      "listSessions",
      chatListSessionsRequestSchema,
      chatListSessionsResponseSchema
    ),
    listMessages: defineIpcContract(
      "chat",
      "listMessages",
      chatListMessagesRequestSchema,
      chatListMessagesResponseSchema
    ),
    send: defineIpcContract("chat", "send", chatSendRequestSchema, chatSendResponseSchema),
    clear: defineIpcContract("chat", "clear", chatClearRequestSchema, chatClearResponseSchema),
    providerHealth: defineIpcContract(
      "chat",
      "providerHealth",
      chatProviderHealthRequestSchema,
      chatProviderHealthResponseSchema
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
    ),
    exportPortableArchive: defineIpcContract(
      "settings",
      "exportPortableArchive",
      settingsGetRequestSchema,
      portableExportResponseSchema
    ),
    previewPortableImport: defineIpcContract(
      "settings",
      "previewPortableImport",
      portableArchivePathRequestSchema,
      portableImportPreviewSchema
    ),
    importPortableArchive: defineIpcContract(
      "settings",
      "importPortableArchive",
      portableImportRequestSchema,
      portableImportResponseSchema
    ),
    listLocalPointers: defineIpcContract(
      "settings",
      "listLocalPointers",
      localPointerListRequestSchema,
      localPointerListResponseSchema
    ),
    repairLocalPointer: defineIpcContract(
      "settings",
      "repairLocalPointer",
      localPointerRepairRequestSchema,
      localPointerRepairResponseSchema
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
    ),
    importMenuBarIcon: defineIpcContract(
      "native",
      "importMenuBarIcon",
      nativeImportMenuBarIconRequestSchema,
      nativeImportMenuBarIconResponseSchema
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
    recordTiming: defineIpcContract(
      "diagnostics",
      "recordTiming",
      diagnosticsRecordTimingRequestSchema,
      diagnosticsRecordTimingResponseSchema
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
