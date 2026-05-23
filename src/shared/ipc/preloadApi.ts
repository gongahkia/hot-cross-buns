import type {
  AvailabilityExportRequest,
  AvailabilityExportResponse,
  CalendarRangeRequest,
  CalendarRangeResponse,
  CalendarEventCreateRequest,
  CalendarEventDeleteRequest,
  CalendarEventDetail,
  CalendarEventUpdateRequest,
  CalendarListRequest,
  CalendarListResponse,
  DiagnosticsCachedDataRenderedRequest,
  DiagnosticsHealthResponse,
  DiagnosticsIpcMetricsResponse,
  DiagnosticsPerformanceRequest,
  DiagnosticsPerformanceResponse,
  DiagnosticsSummaryResponse,
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
  NativeNotificationPermissionResponse,
  NoteCreateRequest,
  NoteDeleteRequest,
  NoteDetail,
  NoteListRequest,
  NoteListResponse,
  NoteUpdateRequest,
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
  TaskUpdateRequest
} from "./contracts";
import type { HcbResult } from "./result";

export interface HcbApi {
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
    exportAvailability: (
      request: AvailabilityExportRequest
    ) => Promise<HcbResult<AvailabilityExportResponse>>;
  };
  notes: {
    list: (request?: NoteListRequest) => Promise<HcbResult<NoteListResponse>>;
    get: (request: EntityByIdRequest) => Promise<HcbResult<NoteDetail>>;
    create: (request: NoteCreateRequest) => Promise<HcbResult<NoteDetail>>;
    update: (request: NoteUpdateRequest) => Promise<HcbResult<NoteDetail>>;
    delete: (request: NoteDeleteRequest) => Promise<HcbResult<MutationAck>>;
  };
  search: {
    query: (request: SearchQueryRequest) => Promise<HcbResult<SearchQueryResponse>>;
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
  };
  mcp: {
    status: () => Promise<HcbResult<McpStatusResponse>>;
    setEnabled: (request: McpSetEnabledRequest) => Promise<HcbResult<McpStatusResponse>>;
  };
  native: {
    capabilities: () => Promise<HcbResult<NativeCapabilitiesResponse>>;
    requestNotificationPermission: () => Promise<
      HcbResult<NativeNotificationPermissionResponse>
    >;
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
    summary: () => Promise<HcbResult<DiagnosticsSummaryResponse>>;
  };
}
