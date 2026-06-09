import type {
  AvailabilityExportRequest,
  AvailabilityExportResponse,
  BootstrapGetRequest,
  BootstrapGetResponse,
  AgentActionApplyRequest,
  AgentActionApplyResponse,
  AgentActionClearExpiredResponse,
  AgentActionListRequest,
  AgentActionListResponse,
  AgentActionRejectRequest,
  AgentActionRejectResponse,
  CalendarRangeRequest,
  CalendarRangeResponse,
  CalendarScheduleSuggestRequest,
  CalendarScheduleSuggestResponse,
  CalendarEventCompletionRequest,
  CalendarEventCreateRequest,
  CalendarEventDeleteRequest,
  CalendarEventDetail,
  CalendarEventUpdateRequest,
  CalendarListRequest,
  CalendarListResponse,
  ChatClearRequest,
  ChatClearResponse,
  ChatListMessagesRequest,
  ChatListMessagesResponse,
  ChatListSessionsRequest,
  ChatListSessionsResponse,
  ChatProviderHealthResponse,
  ChatSendRequest,
  ChatSendResponse,
  DiagnosticsCachedDataRenderedRequest,
  DiagnosticsClearLogsResponse,
  DiagnosticsCopyableSummaryResponse,
  DiagnosticsExportBundleResponse,
  DiagnosticsHealthResponse,
  DiagnosticsHistoryRequest,
  DiagnosticsHistoryResponse,
  DiagnosticsIpcMetricsResponse,
  DiagnosticsLogsRequest,
  DiagnosticsLogsResponse,
  DiagnosticsPerformanceRequest,
  DiagnosticsPerformanceResponse,
  DiagnosticsPendingMutationActionRequest,
  DiagnosticsPendingMutationActionResponse,
  DiagnosticsPendingMutationsRequest,
  DiagnosticsPendingMutationsResponse,
  DiagnosticsRecordTimingRequest,
  DiagnosticsRecordTimingResponse,
  DiagnosticsRescheduleNotificationsResponse,
  DiagnosticsRevealLogsFolderResponse,
  DiagnosticsSummaryResponse,
  DuplicateCleanupRequest,
  DuplicateCleanupResponse,
  DiagnosticsShellVisibleRequest,
  EntityByIdRequest,
  GoogleBeginOAuthResponse,
  GoogleDisconnectRequest,
  GoogleSaveOAuthClientRequest,
  GoogleStatusResponse,
  McpSetEnabledRequest,
  McpStatusResponse,
  MutationAck,
  NativeAction,
  NativeCapabilitiesResponse,
  NativeFontFamiliesResponse,
  NativeImportMenuBarIconRequest,
  NativeImportMenuBarIconResponse,
  NativeNotificationPermissionResponse,
  NoteCreateRequest,
  NoteDeleteRequest,
  NoteDetail,
  NoteBrokenLinksRequest,
  NoteBrokenLinksResponse,
  NoteLinkSuggestRequest,
  NoteLinkSuggestResponse,
  NoteListCreateRequest,
  NoteListDeleteRequest,
  NoteListRequest,
  NoteListRenameRequest,
  NoteListResponse,
  NoteListSummary,
  NoteUpdateRequest,
  PortableArchivePathRequest,
  PortableExportResponse,
  PortableImportPreview,
  PortableImportRequest,
  PortableImportResponse,
  SearchQueryRequest,
  SearchQueryResponse,
  ScheduledTaskBlockCreateRequest,
  ScheduledTaskBlockListRequest,
  ScheduledTaskBlockListResponse,
  ScheduledTaskBlockMoveRequest,
  ScheduledTaskBlockSummary,
  ScheduledTaskBlockUnscheduleRequest,
  SettingsRecoveryActionRequest,
  SettingsRecoveryActionResponse,
  SettingsSnapshot,
  SettingsUpdateRequest,
  StartupTimingSnapshot,
  SyncRunNowRequest,
  SyncRunNowResponse,
  SyncStatusResponse,
  TagBulkApplyRequest,
  TagCreateRequest,
  TagDeleteRequest,
  TagListRequest,
  TagListResponse,
  TagMergeRequest,
  TagMutationResponse,
  TagUpdateRequest,
  UndoApplyResponse,
  UndoStackStatusResponse,
  TaskCompletionRequest,
  TaskCreateRequest,
  TaskDeleteRequest,
  TaskDetail,
  TaskListCreateRequest,
  TaskListDeleteRequest,
  TaskListRenameRequest,
  TaskListSummary,
  TaskListsRequest,
  TaskListsResponse,
  TaskMoveRequest,
  TaskListRequest,
  TaskListResponse,
  TaskUpdateRequest,
  WebhookDeleteRequest,
  WebhookListRequest,
  WebhookListResponse,
  WebhookMutationResponse,
  WebhookTestRequest,
  WebhookUpsertRequest
} from "./contracts";
import type { HcbResult } from "./result";

export interface HcbApi {
  bootstrap: {
    get: (request: BootstrapGetRequest) => Promise<HcbResult<BootstrapGetResponse>>;
  };
  tasks: {
    listTaskLists: (request?: TaskListsRequest) => Promise<HcbResult<TaskListsResponse>>;
    list: (request?: TaskListRequest) => Promise<HcbResult<TaskListResponse>>;
    get: (request: EntityByIdRequest) => Promise<HcbResult<TaskDetail>>;
    create: (request: TaskCreateRequest) => Promise<HcbResult<TaskDetail>>;
    update: (request: TaskUpdateRequest) => Promise<HcbResult<TaskDetail>>;
    complete: (request: TaskCompletionRequest) => Promise<HcbResult<TaskDetail>>;
    reopen: (request: TaskCompletionRequest) => Promise<HcbResult<TaskDetail>>;
    move: (request: TaskMoveRequest) => Promise<HcbResult<TaskDetail>>;
    delete: (request: TaskDeleteRequest) => Promise<HcbResult<MutationAck>>;
    createTaskList: (request: TaskListCreateRequest) => Promise<HcbResult<TaskListSummary>>;
    renameTaskList: (request: TaskListRenameRequest) => Promise<HcbResult<TaskListSummary>>;
    deleteTaskList: (request: TaskListDeleteRequest) => Promise<HcbResult<MutationAck>>;
  };
  calendar: {
    listCalendars: (request?: CalendarListRequest) => Promise<HcbResult<CalendarListResponse>>;
    listEvents: (request: CalendarRangeRequest) => Promise<HcbResult<CalendarRangeResponse>>;
    get: (request: EntityByIdRequest) => Promise<HcbResult<CalendarEventDetail>>;
    create: (request: CalendarEventCreateRequest) => Promise<HcbResult<CalendarEventDetail>>;
    update: (request: CalendarEventUpdateRequest) => Promise<HcbResult<CalendarEventDetail>>;
    complete: (request: CalendarEventCompletionRequest) => Promise<HcbResult<CalendarEventDetail>>;
    reopen: (request: CalendarEventCompletionRequest) => Promise<HcbResult<CalendarEventDetail>>;
    delete: (request: CalendarEventDeleteRequest) => Promise<HcbResult<MutationAck>>;
    listScheduledTaskBlocks: (
      request: ScheduledTaskBlockListRequest
    ) => Promise<HcbResult<ScheduledTaskBlockListResponse>>;
    scheduleTaskBlock: (
      request: ScheduledTaskBlockCreateRequest
    ) => Promise<HcbResult<ScheduledTaskBlockSummary>>;
    moveScheduledTaskBlock: (
      request: ScheduledTaskBlockMoveRequest
    ) => Promise<HcbResult<ScheduledTaskBlockSummary>>;
    unscheduleTaskBlock: (
      request: ScheduledTaskBlockUnscheduleRequest
    ) => Promise<HcbResult<MutationAck>>;
    scheduleSuggest: (
      request: CalendarScheduleSuggestRequest
    ) => Promise<HcbResult<CalendarScheduleSuggestResponse>>;
    exportAvailability: (
      request: AvailabilityExportRequest
    ) => Promise<HcbResult<AvailabilityExportResponse>>;
  };
  notes: {
    list: (request?: NoteListRequest) => Promise<HcbResult<NoteListResponse>>;
    createList: (request: NoteListCreateRequest) => Promise<HcbResult<NoteListSummary>>;
    renameList: (request: NoteListRenameRequest) => Promise<HcbResult<NoteListSummary>>;
    deleteList: (request: NoteListDeleteRequest) => Promise<HcbResult<MutationAck>>;
    get: (request: EntityByIdRequest) => Promise<HcbResult<NoteDetail>>;
    create: (request: NoteCreateRequest) => Promise<HcbResult<NoteDetail>>;
    update: (request: NoteUpdateRequest) => Promise<HcbResult<NoteDetail>>;
    delete: (request: NoteDeleteRequest) => Promise<HcbResult<MutationAck>>;
    linkSuggest: (request: NoteLinkSuggestRequest) => Promise<HcbResult<NoteLinkSuggestResponse>>;
    listBrokenLinks: (request: NoteBrokenLinksRequest) => Promise<HcbResult<NoteBrokenLinksResponse>>;
  };
  search: {
    query: (request: SearchQueryRequest) => Promise<HcbResult<SearchQueryResponse>>;
  };
  tags: {
    list: (request?: TagListRequest) => Promise<HcbResult<TagListResponse>>;
    create: (request: TagCreateRequest) => Promise<HcbResult<TagMutationResponse>>;
    update: (request: TagUpdateRequest) => Promise<HcbResult<TagMutationResponse>>;
    delete: (request: TagDeleteRequest) => Promise<HcbResult<TagMutationResponse>>;
    merge: (request: TagMergeRequest) => Promise<HcbResult<TagMutationResponse>>;
    bulkApply: (request: TagBulkApplyRequest) => Promise<HcbResult<TagMutationResponse>>;
  };
  duplicates: {
    cleanup: (request: DuplicateCleanupRequest) => Promise<HcbResult<DuplicateCleanupResponse>>;
  };
  sync: {
    status: () => Promise<HcbResult<SyncStatusResponse>>;
    runNow: (request?: SyncRunNowRequest) => Promise<HcbResult<SyncRunNowResponse>>;
    subscribeStatus: (listener: (status: SyncStatusResponse) => void) => () => void;
  };
  google: {
    status: () => Promise<HcbResult<GoogleStatusResponse>>;
    saveOAuthClient: (
      request: GoogleSaveOAuthClientRequest
    ) => Promise<HcbResult<GoogleStatusResponse>>;
    beginOAuth: () => Promise<HcbResult<GoogleBeginOAuthResponse>>;
    disconnect: (request?: GoogleDisconnectRequest) => Promise<HcbResult<GoogleStatusResponse>>;
  };
  settings: {
    get: () => Promise<HcbResult<SettingsSnapshot>>;
    update: (request: SettingsUpdateRequest) => Promise<HcbResult<SettingsSnapshot>>;
    recoveryAction: (
      request: SettingsRecoveryActionRequest
    ) => Promise<HcbResult<SettingsRecoveryActionResponse>>;
    exportPortableArchive: () => Promise<HcbResult<PortableExportResponse>>;
    previewPortableImport: (
      request: PortableArchivePathRequest
    ) => Promise<HcbResult<PortableImportPreview>>;
    importPortableArchive: (
      request: PortableImportRequest
    ) => Promise<HcbResult<PortableImportResponse>>;
  };
  undo: {
    status: () => Promise<HcbResult<UndoStackStatusResponse>>;
    undo: () => Promise<HcbResult<UndoApplyResponse>>;
    redo: () => Promise<HcbResult<UndoApplyResponse>>;
  };
  mcp: {
    status: () => Promise<HcbResult<McpStatusResponse>>;
    setEnabled: (request: McpSetEnabledRequest) => Promise<HcbResult<McpStatusResponse>>;
  };
  agent: {
    listActions: (request?: AgentActionListRequest) => Promise<HcbResult<AgentActionListResponse>>;
    applyAction: (request: AgentActionApplyRequest) => Promise<HcbResult<AgentActionApplyResponse>>;
    rejectAction: (request: AgentActionRejectRequest) => Promise<HcbResult<AgentActionRejectResponse>>;
    clearExpired: () => Promise<HcbResult<AgentActionClearExpiredResponse>>;
  };
  webhooks: {
    list: (request?: WebhookListRequest) => Promise<HcbResult<WebhookListResponse>>;
    upsert: (request: WebhookUpsertRequest) => Promise<HcbResult<WebhookMutationResponse>>;
    delete: (request: WebhookDeleteRequest) => Promise<HcbResult<WebhookMutationResponse>>;
    test: (request: WebhookTestRequest) => Promise<HcbResult<WebhookMutationResponse>>;
  };
  chat: {
    listSessions: (request?: ChatListSessionsRequest) => Promise<HcbResult<ChatListSessionsResponse>>;
    listMessages: (request: ChatListMessagesRequest) => Promise<HcbResult<ChatListMessagesResponse>>;
    send: (request: ChatSendRequest) => Promise<HcbResult<ChatSendResponse>>;
    clear: (request?: ChatClearRequest) => Promise<HcbResult<ChatClearResponse>>;
    providerHealth: () => Promise<HcbResult<ChatProviderHealthResponse>>;
  };
  native: {
    capabilities: () => Promise<HcbResult<NativeCapabilitiesResponse>>;
    requestNotificationPermission: () => Promise<
      HcbResult<NativeNotificationPermissionResponse>
    >;
    listFontFamilies: () => Promise<HcbResult<NativeFontFamiliesResponse>>;
    importMenuBarIcon: (
      request: NativeImportMenuBarIconRequest
    ) => Promise<HcbResult<NativeImportMenuBarIconResponse>>;
    subscribeAction: (listener: (action: NativeAction) => void) => () => void;
  };
  diagnostics: {
    health: () => Promise<HcbResult<DiagnosticsHealthResponse>>;
    markShellVisible: (
      request?: DiagnosticsShellVisibleRequest
    ) => Promise<HcbResult<StartupTimingSnapshot>>;
    markCachedDataRendered: (
      request?: DiagnosticsCachedDataRenderedRequest
    ) => Promise<HcbResult<StartupTimingSnapshot>>;
    ipcMetrics: () => Promise<HcbResult<DiagnosticsIpcMetricsResponse>>;
    performance: (
      request?: DiagnosticsPerformanceRequest
    ) => Promise<HcbResult<DiagnosticsPerformanceResponse>>;
    recordTiming: (
      request: DiagnosticsRecordTimingRequest
    ) => Promise<HcbResult<DiagnosticsRecordTimingResponse>>;
    summary: () => Promise<HcbResult<DiagnosticsSummaryResponse>>;
    logs: (request?: DiagnosticsLogsRequest) => Promise<HcbResult<DiagnosticsLogsResponse>>;
    clearLogs: () => Promise<HcbResult<DiagnosticsClearLogsResponse>>;
    revealLogsFolder: () => Promise<HcbResult<DiagnosticsRevealLogsFolderResponse>>;
    history: (
      request?: DiagnosticsHistoryRequest
    ) => Promise<HcbResult<DiagnosticsHistoryResponse>>;
    pendingMutations: (
      request?: DiagnosticsPendingMutationsRequest
    ) => Promise<HcbResult<DiagnosticsPendingMutationsResponse>>;
    retryPendingMutation: (
      request: DiagnosticsPendingMutationActionRequest
    ) => Promise<HcbResult<DiagnosticsPendingMutationActionResponse>>;
    cancelPendingMutation: (
      request: DiagnosticsPendingMutationActionRequest
    ) => Promise<HcbResult<DiagnosticsPendingMutationActionResponse>>;
    copyableSummary: () => Promise<HcbResult<DiagnosticsCopyableSummaryResponse>>;
    exportBundle: () => Promise<HcbResult<DiagnosticsExportBundleResponse>>;
    rescheduleNotifications: () => Promise<
      HcbResult<DiagnosticsRescheduleNotificationsResponse>
    >;
  };
}
