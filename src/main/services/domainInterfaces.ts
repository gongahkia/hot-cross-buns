import type {
  CalendarRangeRequest,
  CalendarRangeResponse,
  CalendarListRequest,
  CalendarListResponse,
  EntityByIdRequest,
  McpSetEnabledRequest,
  McpStatusResponse,
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
  SyncRunNowRequest,
  SyncRunNowResponse,
  SyncStatusResponse,
  TaskDetail,
  TaskListsRequest,
  TaskListsResponse,
  TaskListRequest,
  TaskListResponse
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
  previewCreateTask: (input: DomainJsonObject) => MaybePromise<DomainJsonObject>;
  createTask: (input: DomainJsonObject) => MaybePromise<DomainJsonObject>;
  previewUpdateTask: (id: string, patch: DomainJsonObject) => MaybePromise<DomainJsonObject>;
  updateTask: (id: string, patch: DomainJsonObject) => MaybePromise<DomainJsonObject>;
  previewCompleteTask: (id: string) => MaybePromise<DomainJsonObject>;
  completeTask: (id: string) => MaybePromise<DomainJsonObject>;
  previewReopenTask: (id: string) => MaybePromise<DomainJsonObject>;
  reopenTask: (id: string) => MaybePromise<DomainJsonObject>;
  previewMoveTask: (id: string, taskListId: string) => MaybePromise<DomainJsonObject>;
  moveTask: (id: string, taskListId: string) => MaybePromise<DomainJsonObject>;
  previewDeleteTask: (id: string) => MaybePromise<DomainJsonObject>;
  deleteTask: (id: string) => MaybePromise<DomainJsonObject>;
}

export interface NoteDomainService {
  getNote: (id: string) => MaybePromise<DomainJsonObject>;
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
  previewDeleteEvent: (id: string) => MaybePromise<DomainJsonObject>;
  deleteEvent: (id: string) => MaybePromise<DomainJsonObject>;
}

export interface McpDomainServices {
  planning: PlanningReadDomainService;
  tasks: TaskDomainService;
  notes: NoteDomainService;
  calendar: CalendarDomainService;
}

export interface PlannerViewDomainService {
  listTaskLists: (request: TaskListsRequest) => MaybePromise<TaskListsResponse>;
  listTasks: (request: TaskListRequest) => MaybePromise<TaskListResponse>;
  getTask: (request: EntityByIdRequest) => MaybePromise<TaskDetail>;
  listCalendars: (request: CalendarListRequest) => MaybePromise<CalendarListResponse>;
  listCalendarEvents: (request: CalendarRangeRequest) => MaybePromise<CalendarRangeResponse>;
  getCalendarEvent: (request: EntityByIdRequest) => MaybePromise<DomainJsonObject>;
  listNotes: (request: NoteListRequest) => MaybePromise<NoteListResponse>;
  getNote: (request: EntityByIdRequest) => MaybePromise<NoteDetail>;
  createNote: (request: NoteCreateRequest) => MaybePromise<NoteDetail>;
  updateNote: (request: NoteUpdateRequest) => MaybePromise<NoteDetail>;
  deleteNote: (request: NoteDeleteRequest) => MaybePromise<{ id: string; queued: boolean; revision?: string }>;
  search: (request: SearchQueryRequest) => MaybePromise<SearchQueryResponse>;
}

export interface SyncControlDomainService {
  status: () => MaybePromise<SyncStatusResponse>;
  runNow: (request: SyncRunNowRequest) => MaybePromise<SyncRunNowResponse>;
  subscribeStatus?: (listener: (status: SyncStatusResponse) => void) => () => void;
}

export interface SettingsDomainService {
  get: () => MaybePromise<SettingsSnapshot>;
  update: (request: SettingsUpdateRequest) => MaybePromise<SettingsSnapshot>;
}

export interface McpControlDomainService {
  status: () => MaybePromise<McpStatusResponse>;
  setEnabled: (request: McpSetEnabledRequest) => MaybePromise<McpStatusResponse>;
}

export interface NativeDomainService {
  capabilities: () => MaybePromise<NativeCapabilitiesResponse>;
  requestNotificationPermission: () => MaybePromise<NativeNotificationPermissionResponse>;
}

export interface AppDomainServices {
  planner: PlannerViewDomainService;
  sync: SyncControlDomainService;
  settings: SettingsDomainService;
  mcp: McpControlDomainService;
  native: NativeDomainService;
  mcpTools: McpDomainServices;
}
