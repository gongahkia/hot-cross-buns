import type {
  CalendarRangeRequest,
  CalendarRangeResponse,
  CalendarListRequest,
  CalendarListResponse,
  DiagnosticsCachedDataRenderedRequest,
  DiagnosticsHealthResponse,
  DiagnosticsIpcMetricsResponse,
  DiagnosticsPerformanceRequest,
  DiagnosticsPerformanceResponse,
  DiagnosticsShellVisibleRequest,
  EntityByIdRequest,
  McpSetEnabledRequest,
  McpStatusResponse,
  MutationAck,
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
  SettingsSnapshot,
  SettingsUpdateRequest,
  StartupTimingSnapshot,
  SyncRunNowRequest,
  SyncRunNowResponse,
  SyncStatusResponse,
  TaskDetail,
  TaskListsRequest,
  TaskListsResponse,
  TaskListRequest,
  TaskListResponse
} from "./contracts";
import type { HcbResult } from "./result";

export interface HcbApi {
  tasks: {
    listTaskLists: (request?: TaskListsRequest) => Promise<HcbResult<TaskListsResponse>>;
    list: (request?: TaskListRequest) => Promise<HcbResult<TaskListResponse>>;
    get: (request: EntityByIdRequest) => Promise<HcbResult<TaskDetail>>;
  };
  calendar: {
    listCalendars: (request?: CalendarListRequest) => Promise<HcbResult<CalendarListResponse>>;
    listEvents: (request: CalendarRangeRequest) => Promise<HcbResult<CalendarRangeResponse>>;
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
  settings: {
    get: () => Promise<HcbResult<SettingsSnapshot>>;
    update: (request: SettingsUpdateRequest) => Promise<HcbResult<SettingsSnapshot>>;
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
  };
}
