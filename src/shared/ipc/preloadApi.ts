import type {
  CalendarRangeRequest,
  CalendarRangeResponse,
  DiagnosticsHealthResponse,
  DiagnosticsIpcMetricsResponse,
  DiagnosticsShellVisibleRequest,
  EntityByIdRequest,
  McpSetEnabledRequest,
  McpStatusResponse,
  NativeCapabilitiesResponse,
  NativeNotificationPermissionResponse,
  NoteDetail,
  NoteListRequest,
  NoteListResponse,
  SearchQueryRequest,
  SearchQueryResponse,
  SettingsSnapshot,
  SettingsUpdateRequest,
  StartupTimingSnapshot,
  SyncRunNowRequest,
  SyncRunNowResponse,
  SyncStatusResponse,
  TaskDetail,
  TaskListRequest,
  TaskListResponse
} from "./contracts";
import type { HcbResult } from "./result";

export interface HcbApi {
  tasks: {
    list: (request?: TaskListRequest) => Promise<HcbResult<TaskListResponse>>;
    get: (request: EntityByIdRequest) => Promise<HcbResult<TaskDetail>>;
  };
  calendar: {
    listEvents: (request: CalendarRangeRequest) => Promise<HcbResult<CalendarRangeResponse>>;
  };
  notes: {
    list: (request?: NoteListRequest) => Promise<HcbResult<NoteListResponse>>;
    get: (request: EntityByIdRequest) => Promise<HcbResult<NoteDetail>>;
  };
  search: {
    query: (request: SearchQueryRequest) => Promise<HcbResult<SearchQueryResponse>>;
  };
  sync: {
    status: () => Promise<HcbResult<SyncStatusResponse>>;
    runNow: (request?: SyncRunNowRequest) => Promise<HcbResult<SyncRunNowResponse>>;
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
    ipcMetrics: () => Promise<HcbResult<DiagnosticsIpcMetricsResponse>>;
  };
}
