import type {
  AvailabilityExportRequest,
  AvailabilityExportResponse,
  CalendarRangeRequest,
  CalendarRangeResponse,
  CalendarScheduleSuggestRequest,
  CalendarScheduleSuggestResponse,
  AgentActionApplyRequest,
  AgentActionApplyResponse,
  AgentActionClearExpiredResponse,
  AgentActionListRequest,
  AgentActionListResponse,
  AgentActionRejectRequest,
  AgentActionRejectResponse,
  ChatClearRequest,
  ChatClearResponse,
  ChatListMessagesRequest,
  ChatListMessagesResponse,
  ChatListSessionsRequest,
  ChatListSessionsResponse,
  ChatProviderHealthResponse,
  ChatSendRequest,
  ChatSendResponse,
  DuplicateCleanupRequest,
  DuplicateCleanupResponse,
  CalendarEventCompletionRequest,
  CalendarEventCreateRequest,
  CalendarEventDeleteRequest,
  CalendarEventDetail,
  CalendarEventUpdateRequest,
  CalendarListRequest,
  CalendarListResponse,
  EntityByIdRequest,
  GoogleBeginOAuthResponse,
  GoogleDisconnectRequest,
  GoogleSaveOAuthClientRequest,
  GoogleStatusResponse,
  McpSetEnabledRequest,
  McpStatusResponse,
  NativeCapabilitiesResponse,
  NativeFontFamiliesResponse,
  NativeNotificationPermissionResponse,
  NoteBrokenLinksRequest,
  NoteBrokenLinksResponse,
  NoteCreateRequest,
  NoteDeleteRequest,
  NoteDetail,
  NoteLinkSuggestRequest,
  NoteLinkSuggestResponse,
  NoteListCreateRequest,
  NoteListDeleteRequest,
  NoteListRequest,
  NoteListRenameRequest,
  NoteListResponse,
  NoteListSummary,
  NoteUpdateRequest,
  SearchQueryRequest,
  SearchQueryResponse,
  PortableArchivePathRequest,
  PortableExportResponse,
  PortableImportPreview,
  PortableImportRequest,
  PortableImportResponse,
  SettingsRecoveryActionRequest,
  SettingsRecoveryActionResponse,
  ScheduledTaskBlockCreateRequest,
  ScheduledTaskBlockListRequest,
  ScheduledTaskBlockListResponse,
  ScheduledTaskBlockMoveRequest,
  ScheduledTaskBlockSummary,
  ScheduledTaskBlockUnscheduleRequest,
  SettingsSnapshot,
  SettingsUpdateRequest,
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
  TaskListsRequest,
  TaskListsResponse,
  TaskMoveRequest,
  TaskListRequest,
  TaskListResponse,
  TaskListSummary,
  TaskUpdateRequest,
  WebhookDeleteRequest,
  WebhookListRequest,
  WebhookListResponse,
  WebhookMutationResponse,
  WebhookTestRequest,
  WebhookUpsertRequest,
  WebhookEvent
} from "@shared/ipc/contracts";

export type DomainJsonPrimitive = string | number | boolean | null;
export type DomainJsonValue =
  | DomainJsonPrimitive
  | DomainJsonValue[]
  | { [key: string]: DomainJsonValue };
export type DomainJsonObject = { [key: string]: DomainJsonValue };
export type MaybePromise<T> = T | Promise<T>;

export interface SearchDomainInput {
  query: string;
  scope?: string;
  limit?: number;
}

export interface WeekDomainInput {
  startDate?: string;
}

export interface PlanningReadDomainService {
  search: (input: SearchDomainInput) => MaybePromise<DomainJsonObject[]>;
  today: () => MaybePromise<DomainJsonObject>;
  week: (input: WeekDomainInput) => MaybePromise<DomainJsonObject>;
}

export interface TaskDomainService {
  getTask: (id: string) => MaybePromise<DomainJsonObject>;
  listTaskLists: () => MaybePromise<DomainJsonObject[]>;
  previewCreateTaskList: (input: DomainJsonObject) => MaybePromise<DomainJsonObject>;
  createTaskList: (input: DomainJsonObject) => MaybePromise<DomainJsonObject>;
  previewRenameTaskList: (id: string, input: DomainJsonObject) => MaybePromise<DomainJsonObject>;
  renameTaskList: (id: string, input: DomainJsonObject) => MaybePromise<DomainJsonObject>;
  previewDeleteTaskList: (id: string) => MaybePromise<DomainJsonObject>;
  deleteTaskList: (id: string) => MaybePromise<DomainJsonObject>;
  previewCreateTask: (input: DomainJsonObject) => MaybePromise<DomainJsonObject>;
  createTask: (input: DomainJsonObject) => MaybePromise<DomainJsonObject>;
  previewUpdateTask: (id: string, patch: DomainJsonObject) => MaybePromise<DomainJsonObject>;
  updateTask: (id: string, patch: DomainJsonObject) => MaybePromise<DomainJsonObject>;
  previewCompleteTask: (id: string) => MaybePromise<DomainJsonObject>;
  completeTask: (id: string) => MaybePromise<DomainJsonObject>;
  previewReopenTask: (id: string) => MaybePromise<DomainJsonObject>;
  reopenTask: (id: string) => MaybePromise<DomainJsonObject>;
  previewMoveTask: (id: string, input: DomainJsonObject) => MaybePromise<DomainJsonObject>;
  moveTask: (id: string, input: DomainJsonObject) => MaybePromise<DomainJsonObject>;
  previewDeleteTask: (id: string) => MaybePromise<DomainJsonObject>;
  deleteTask: (id: string) => MaybePromise<DomainJsonObject>;
}

export interface NoteDomainService {
  getNote: (id: string) => MaybePromise<DomainJsonObject>;
  listNoteLists: () => MaybePromise<DomainJsonObject[]>;
  previewCreateNoteList: (input: DomainJsonObject) => MaybePromise<DomainJsonObject>;
  createNoteList: (input: DomainJsonObject) => MaybePromise<DomainJsonObject>;
  previewRenameNoteList: (id: string, input: DomainJsonObject) => MaybePromise<DomainJsonObject>;
  renameNoteList: (id: string, input: DomainJsonObject) => MaybePromise<DomainJsonObject>;
  previewDeleteNoteList: (id: string) => MaybePromise<DomainJsonObject>;
  deleteNoteList: (id: string) => MaybePromise<DomainJsonObject>;
  previewCreateNote: (input: DomainJsonObject) => MaybePromise<DomainJsonObject>;
  createNote: (input: DomainJsonObject) => MaybePromise<DomainJsonObject>;
  previewUpdateNote: (id: string, patch: DomainJsonObject) => MaybePromise<DomainJsonObject>;
  updateNote: (id: string, patch: DomainJsonObject) => MaybePromise<DomainJsonObject>;
  previewDeleteNote: (id: string) => MaybePromise<DomainJsonObject>;
  deleteNote: (id: string) => MaybePromise<DomainJsonObject>;
}

export interface CalendarDomainService {
  getEvent: (id: string) => MaybePromise<DomainJsonObject>;
  listCalendars: () => MaybePromise<DomainJsonObject[]>;
  previewCreateEvent: (input: DomainJsonObject) => MaybePromise<DomainJsonObject>;
  createEvent: (input: DomainJsonObject) => MaybePromise<DomainJsonObject>;
  previewUpdateEvent: (id: string, patch: DomainJsonObject) => MaybePromise<DomainJsonObject>;
  updateEvent: (id: string, patch: DomainJsonObject) => MaybePromise<DomainJsonObject>;
  previewCompleteEvent: (id: string, input: DomainJsonObject) => MaybePromise<DomainJsonObject>;
  completeEvent: (id: string, input: DomainJsonObject) => MaybePromise<DomainJsonObject>;
  previewReopenEvent: (id: string, input: DomainJsonObject) => MaybePromise<DomainJsonObject>;
  reopenEvent: (id: string, input: DomainJsonObject) => MaybePromise<DomainJsonObject>;
  previewDeleteEvent: (id: string) => MaybePromise<DomainJsonObject>;
  deleteEvent: (id: string) => MaybePromise<DomainJsonObject>;
  previewScheduleTaskBlock: (input: DomainJsonObject) => MaybePromise<DomainJsonObject>;
  scheduleTaskBlock: (input: DomainJsonObject) => MaybePromise<DomainJsonObject>;
}

export interface DiagnosticsDomainService {
  status: () => MaybePromise<DomainJsonObject>;
  logs: (input: { limit?: number; level?: string }) => MaybePromise<DomainJsonObject[]>;
  diff: (input: { limit?: number }) => MaybePromise<DomainJsonObject[]>;
  show: (input: { kind: string; id?: string }) => MaybePromise<DomainJsonObject>;
}

export interface McpUndoDomainService {
  status: () => MaybePromise<DomainJsonObject>;
  undo: () => MaybePromise<DomainJsonObject>;
  redo: () => MaybePromise<DomainJsonObject>;
}

export interface McpSyncQueueDomainService {
  previewRunNow: (input: DomainJsonObject) => MaybePromise<DomainJsonObject>;
  runNow: (input: DomainJsonObject) => MaybePromise<DomainJsonObject>;
  pendingMutations: (input: { limit?: number }) => MaybePromise<DomainJsonObject[]>;
  previewRetryMutation: (id: string) => MaybePromise<DomainJsonObject>;
  retryMutation: (id: string) => MaybePromise<DomainJsonObject>;
  previewCancelMutation: (id: string) => MaybePromise<DomainJsonObject>;
  cancelMutation: (id: string) => MaybePromise<DomainJsonObject>;
}

export interface McpDomainServices {
  planning: PlanningReadDomainService;
  tasks: TaskDomainService;
  notes: NoteDomainService;
  calendar: CalendarDomainService;
  diagnostics: DiagnosticsDomainService;
  undo: McpUndoDomainService;
  syncQueue: McpSyncQueueDomainService;
}

export interface McpAdminDomainServices {
  settings: Pick<SettingsDomainService, "get" | "update">;
  google: Pick<GoogleControlDomainService, "status" | "saveOAuthClient" | "beginOAuth">;
  mcp: Pick<McpControlDomainService, "status" | "setEnabled">;
}

export interface PlannerViewDomainService {
  listTaskLists: (request: TaskListsRequest) => MaybePromise<TaskListsResponse>;
  listTasks: (request: TaskListRequest) => MaybePromise<TaskListResponse>;
  listCalendarBootstrapTasks?: (request: {
    start: string;
    end: string;
    listIds?: string[];
    taskIds?: string[];
    cursor?: string;
    limit?: number;
  }) => MaybePromise<TaskListResponse>;
  getTask: (request: EntityByIdRequest) => MaybePromise<TaskDetail>;
  createTask: (request: TaskCreateRequest) => MaybePromise<TaskDetail>;
  updateTask: (request: TaskUpdateRequest) => MaybePromise<TaskDetail>;
  completeTask: (request: TaskCompletionRequest) => MaybePromise<TaskDetail>;
  reopenTask: (request: TaskCompletionRequest) => MaybePromise<TaskDetail>;
  moveTask: (request: TaskMoveRequest) => MaybePromise<TaskDetail>;
  deleteTask: (request: TaskDeleteRequest) => MaybePromise<{ id: string; queued: boolean; revision?: string }>;
  createTaskList: (request: TaskListCreateRequest) => MaybePromise<TaskListSummary>;
  renameTaskList: (request: TaskListRenameRequest) => MaybePromise<TaskListSummary>;
  deleteTaskList: (request: TaskListDeleteRequest) => MaybePromise<{ id: string; queued: boolean; revision?: string }>;
  listCalendars: (request: CalendarListRequest) => MaybePromise<CalendarListResponse>;
  listCalendarEvents: (request: CalendarRangeRequest) => MaybePromise<CalendarRangeResponse>;
  getCalendarEvent: (request: EntityByIdRequest) => MaybePromise<CalendarEventDetail>;
  createCalendarEvent: (request: CalendarEventCreateRequest) => MaybePromise<CalendarEventDetail>;
  updateCalendarEvent: (request: CalendarEventUpdateRequest) => MaybePromise<CalendarEventDetail>;
  completeCalendarEvent: (request: CalendarEventCompletionRequest) => MaybePromise<CalendarEventDetail>;
  reopenCalendarEvent: (request: CalendarEventCompletionRequest) => MaybePromise<CalendarEventDetail>;
  deleteCalendarEvent: (request: CalendarEventDeleteRequest) => MaybePromise<{
    id: string;
    queued: boolean;
    revision?: string;
  }>;
  listScheduledTaskBlocks: (
    request: ScheduledTaskBlockListRequest
  ) => MaybePromise<ScheduledTaskBlockListResponse>;
  scheduleTaskBlock: (
    request: ScheduledTaskBlockCreateRequest
  ) => MaybePromise<ScheduledTaskBlockSummary>;
  moveScheduledTaskBlock: (
    request: ScheduledTaskBlockMoveRequest
  ) => MaybePromise<ScheduledTaskBlockSummary>;
  unscheduleTaskBlock: (
    request: ScheduledTaskBlockUnscheduleRequest
  ) => MaybePromise<{ id: string; queued: boolean; revision?: string }>;
  scheduleSuggest: (
    request: CalendarScheduleSuggestRequest
  ) => MaybePromise<CalendarScheduleSuggestResponse>;
  exportAvailability: (
    request: AvailabilityExportRequest
  ) => MaybePromise<AvailabilityExportResponse>;
  listNotes: (request: NoteListRequest) => MaybePromise<NoteListResponse>;
  createNoteList: (request: NoteListCreateRequest) => MaybePromise<NoteListSummary>;
  renameNoteList: (request: NoteListRenameRequest) => MaybePromise<NoteListSummary>;
  deleteNoteList: (request: NoteListDeleteRequest) => MaybePromise<{ id: string; queued: boolean; revision?: string }>;
  getNote: (request: EntityByIdRequest) => MaybePromise<NoteDetail>;
  createNote: (request: NoteCreateRequest) => MaybePromise<NoteDetail>;
  updateNote: (request: NoteUpdateRequest) => MaybePromise<NoteDetail>;
  deleteNote: (request: NoteDeleteRequest) => MaybePromise<{ id: string; queued: boolean; revision?: string }>;
  suggestNoteLinks: (request: NoteLinkSuggestRequest) => MaybePromise<NoteLinkSuggestResponse>;
  listBrokenNoteLinks: (request: NoteBrokenLinksRequest) => MaybePromise<NoteBrokenLinksResponse>;
  search: (request: SearchQueryRequest) => MaybePromise<SearchQueryResponse>;
  listTags: (request: TagListRequest) => MaybePromise<TagListResponse>;
  createTag: (request: TagCreateRequest) => MaybePromise<TagMutationResponse>;
  updateTag: (request: TagUpdateRequest) => MaybePromise<TagMutationResponse>;
  deleteTag: (request: TagDeleteRequest) => MaybePromise<TagMutationResponse>;
  mergeTags: (request: TagMergeRequest) => MaybePromise<TagMutationResponse>;
  bulkApplyTags: (request: TagBulkApplyRequest) => MaybePromise<TagMutationResponse>;
  cleanupDuplicates: (request: DuplicateCleanupRequest) => MaybePromise<DuplicateCleanupResponse>;
}

export interface SyncControlDomainService {
  status: () => MaybePromise<SyncStatusResponse>;
  runNow: (request: SyncRunNowRequest) => MaybePromise<SyncRunNowResponse>;
  subscribeStatus?: (listener: (status: SyncStatusResponse) => void) => () => void;
}

export interface GoogleControlDomainService {
  status: () => MaybePromise<GoogleStatusResponse>;
  saveOAuthClient: (request: GoogleSaveOAuthClientRequest) => MaybePromise<GoogleStatusResponse>;
  beginOAuth: () => MaybePromise<GoogleBeginOAuthResponse>;
  disconnect: (request: GoogleDisconnectRequest) => MaybePromise<GoogleStatusResponse>;
}

export interface SettingsDomainService {
  get: () => MaybePromise<SettingsSnapshot>;
  update: (request: SettingsUpdateRequest) => MaybePromise<SettingsSnapshot>;
  recoveryAction: (
    request: SettingsRecoveryActionRequest
  ) => MaybePromise<SettingsRecoveryActionResponse>;
  exportPortableArchive: () => MaybePromise<PortableExportResponse>;
  previewPortableImport: (
    request: PortableArchivePathRequest
  ) => MaybePromise<PortableImportPreview>;
  importPortableArchive: (
    request: PortableImportRequest
  ) => MaybePromise<PortableImportResponse>;
}

export interface UndoDomainService {
  status: () => MaybePromise<UndoStackStatusResponse>;
  undo: () => MaybePromise<UndoApplyResponse>;
  redo: () => MaybePromise<UndoApplyResponse>;
}

export interface McpControlDomainService {
  status: () => MaybePromise<McpStatusResponse>;
  setEnabled: (request: McpSetEnabledRequest) => MaybePromise<McpStatusResponse>;
}

export interface AgentActionDomainService {
  listActions: (request: AgentActionListRequest) => MaybePromise<AgentActionListResponse>;
  applyAction: (request: AgentActionApplyRequest) => MaybePromise<AgentActionApplyResponse>;
  rejectAction: (request: AgentActionRejectRequest) => MaybePromise<AgentActionRejectResponse>;
  clearExpired: () => MaybePromise<AgentActionClearExpiredResponse>;
}

export interface WebhookDomainService {
  list: (request: WebhookListRequest) => MaybePromise<WebhookListResponse>;
  upsert: (request: WebhookUpsertRequest) => MaybePromise<WebhookMutationResponse>;
  delete: (request: WebhookDeleteRequest) => MaybePromise<WebhookMutationResponse>;
  test: (request: WebhookTestRequest) => MaybePromise<WebhookMutationResponse>;
  emit: (event: WebhookEvent, payload: DomainJsonObject) => MaybePromise<void>;
}

export interface ChatDomainService {
  listSessions: (request: ChatListSessionsRequest) => MaybePromise<ChatListSessionsResponse>;
  listMessages: (request: ChatListMessagesRequest) => MaybePromise<ChatListMessagesResponse>;
  send: (request: ChatSendRequest) => MaybePromise<ChatSendResponse>;
  clear: (request: ChatClearRequest) => MaybePromise<ChatClearResponse>;
  providerHealth: () => MaybePromise<ChatProviderHealthResponse>;
}

export interface NativeDomainService {
  capabilities: () => MaybePromise<NativeCapabilitiesResponse>;
  requestNotificationPermission: () => MaybePromise<NativeNotificationPermissionResponse>;
  listFontFamilies: () => MaybePromise<NativeFontFamiliesResponse>;
}

export interface AppDomainServices {
  planner: PlannerViewDomainService;
  sync: SyncControlDomainService;
  google: GoogleControlDomainService;
  settings: SettingsDomainService;
  undo: UndoDomainService;
  mcp: McpControlDomainService;
  agent: AgentActionDomainService;
  webhooks: WebhookDomainService;
  chat: ChatDomainService;
  native: NativeDomainService;
  mcpTools: McpDomainServices;
}
