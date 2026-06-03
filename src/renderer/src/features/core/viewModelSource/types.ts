import type {
  CalendarEventSummary,
  CalendarListSummary,
  CalendarScheduleSuggestResponse,
  DiagnosticsHealthResponse,
  DiagnosticsSummaryResponse,
  GoogleStatusResponse,
  NativeCapabilitiesResponse,
  NoteListSummary,
  NoteSummary,
  ScheduledTaskBlockCreateRequest,
  ScheduledTaskBlockMoveRequest,
  ScheduledTaskBlockSummary,
  SettingsRecoveryActionRequest,
  SettingsRecoveryActionResponse,
  SettingsSnapshot,
  SettingsUpdateRequest,
  SyncStatusResponse,
  TaskCreateRequest,
  TaskListCreateRequest,
  TaskListRenameRequest,
  TaskListSummary,
  TaskMoveRequest,
  TaskSummary,
  TaskUpdateRequest
} from "@shared/ipc/contracts";
import type { ParsedLocalSearchQuery } from "@shared/search/localSearch";
import type {
  CalendarDayViewModel,
  CalendarEventViewModel,
  CalendarMonthWeekViewModel,
  NoteViewModel,
  SearchViewModel,
  ScheduledTaskBlockViewModel,
  SettingsSectionViewModel,
  TaskFilterId,
  TaskFilterViewModel,
  TaskViewModel
} from "../coreViewModels";

export interface CoreViewModelSource {
  appearanceReady: boolean;
  calendarAgendaEvents: CalendarEventViewModel[];
  calendarDayView: CalendarDayViewModel;
  calendarEventsById: Record<string, CalendarEventViewModel>;
  calendarMonthWeeks: CalendarMonthWeekViewModel[];
  calendarSources: CalendarListSummary[];
  calendarWeekDays: CalendarDayViewModel[];
  dataState: CoreDataState;
  errorMessage?: string;
  getSearchViewModel: (query: string) => SearchViewModel;
  getTaskById: (taskId: string) => TaskViewModel;
  getScheduledTaskBlockById: (blockId: string) => ScheduledTaskBlockViewModel | null;
  getTaskFilterViewModel: (filterId: TaskFilterId) => TaskFilterViewModel;
  hasCachedData: boolean;
  initialNotes: NoteViewModel[];
  noteLists: NoteListSummary[];
  ensureCalendarRange: (range: CalendarRangeLoadRequest) => Promise<boolean>;
  isOffline: boolean;
  isStale: boolean;
  largeTaskWindow: TaskViewModel[];
  refresh: () => void;
  refreshGoogleStatus: () => void;
  resourceCounts: CoreResourceCounts;
  setGoogleStatus: (status: GoogleStatusResponse) => void;
  settings: SettingsSnapshot;
  diagnosticsSummary?: DiagnosticsSummaryResponse;
  googleStatus: GoogleStatusResponse;
  native: NativeCapabilitiesResponse;
  settingsMutationError?: string;
  settingsMutationPending: boolean;
  updateSettings: (request: SettingsUpdateRequest) => Promise<boolean>;
  runRecoveryAction: (
    request: SettingsRecoveryActionRequest
  ) => Promise<SettingsRecoveryActionResponse | null>;
  taskMutationError?: string;
  taskMutationPending: boolean;
  clearTaskMutationError: () => void;
  retryLastTaskMutation: () => void;
  createTask: (request: TaskCreateRequest) => Promise<boolean>;
  updateTask: (request: TaskUpdateRequest) => Promise<boolean>;
  completeTask: (taskId: string) => Promise<boolean>;
  reopenTask: (taskId: string) => Promise<boolean>;
  moveTask: (request: TaskMoveRequest) => Promise<boolean>;
  deleteTask: (taskId: string) => Promise<boolean>;
  createTaskList: (request: TaskListCreateRequest) => Promise<boolean>;
  renameTaskList: (request: TaskListRenameRequest) => Promise<boolean>;
  deleteTaskList: (taskListId: string) => Promise<boolean>;
  scheduleTaskBlock: (request: ScheduledTaskBlockCreateRequest) => Promise<boolean>;
  moveScheduledTaskBlock: (request: ScheduledTaskBlockMoveRequest) => Promise<boolean>;
  unscheduleTaskBlock: (blockId: string) => Promise<boolean>;
  scheduledTaskBlocks: ScheduledTaskBlockViewModel[];
  settingsSections: SettingsSectionViewModel[];
  syncStatus: SyncStatusResponse;
  taskFilterViewModels: TaskFilterViewModel[];
  taskLists: TaskListSummary[];
  todayViewModel: {
    metrics: Array<{ id: string; label: string; value: string }>;
    focusTasks: TaskViewModel[];
    currentTimeLabel: string;
    conflictCount: number;
    schedule: CalendarScheduleSuggestResponse;
    nextUp: {
      kind: "event" | "scheduledTaskBlock";
      itemId: string;
      title: string;
      detail: string;
    } | null;
    timelineRows: Array<{ kind: "task" | "event" | "scheduledTaskBlock"; itemId: string }>;
  };
}

export interface CalendarRangeLoadRequest {
  start: string;
  end: string;
}

export type CoreDataState = "loading" | "ready" | "empty" | "error" | "offline" | "stale";

export interface CoreDataSnapshot {
  taskLists: TaskListSummary[];
  tasks: TaskSummary[];
  calendars: CalendarListSummary[];
  events: CalendarEventSummary[];
  scheduledTaskBlocks: ScheduledTaskBlockSummary[];
  scheduleSuggestion: CalendarScheduleSuggestResponse;
  notes: NoteSummary[];
  noteLists: NoteListSummary[];
  settings: SettingsSnapshot;
  syncStatus: SyncStatusResponse;
  googleStatus: GoogleStatusResponse;
  health?: DiagnosticsHealthResponse;
  native: NativeCapabilitiesResponse;
  diagnosticsSummary?: DiagnosticsSummaryResponse;
  resourceCounts: CoreResourceCounts;
}

export interface CoreResourceCounts {
  calendarEvents: number;
  notes: number;
  tasks: number;
}

export interface CoreDataLoadState {
  snapshot: CoreDataSnapshot;
  state: CoreDataState;
  appearanceReady: boolean;
  errorMessage?: string;
}

export interface SearchHookState {
  viewModel: SearchViewModel;
  state: "idle" | "loading" | "results" | "empty" | "error" | "offline" | "stale" | "invalid";
  parsed: ParsedLocalSearchQuery;
  errorMessage?: string;
  latencyMs?: number;
}

export interface TaskMutationUiState {
  pending: boolean;
  error?: string;
}

export type SettingsMutationUiState = TaskMutationUiState;

export interface CalendarEventDayIndex {
  eventsByDay: Map<string, CalendarEventViewModel[]>;
}

export interface CoreViewModelSourceOptions {
  appearanceReady: boolean;
  state: CoreDataState;
  errorMessage?: string;
  refresh: () => void;
  refreshGoogleStatus: () => void;
  setGoogleStatus: (status: GoogleStatusResponse) => void;
  ensureCalendarRange: (range: CalendarRangeLoadRequest) => Promise<boolean>;
  taskViewModelCache: Map<string, { signature: string; viewModel: TaskViewModel }>;
  calendarEventViewModelCache: Map<string, { signature: string; viewModel: CalendarEventViewModel }>;
  taskMutation: TaskMutationUiState;
  settingsMutation: SettingsMutationUiState;
  updateSettings: (request: SettingsUpdateRequest) => Promise<boolean>;
  runRecoveryAction: (
    request: SettingsRecoveryActionRequest
  ) => Promise<SettingsRecoveryActionResponse | null>;
  clearTaskMutationError: () => void;
  retryLastTaskMutation: () => void;
  createTask: (request: TaskCreateRequest) => Promise<boolean>;
  updateTask: (request: TaskUpdateRequest) => Promise<boolean>;
  completeTask: (taskId: string) => Promise<boolean>;
  reopenTask: (taskId: string) => Promise<boolean>;
  moveTask: (request: TaskMoveRequest) => Promise<boolean>;
  deleteTask: (taskId: string) => Promise<boolean>;
  createTaskList: (request: TaskListCreateRequest) => Promise<boolean>;
  renameTaskList: (request: TaskListRenameRequest) => Promise<boolean>;
  deleteTaskList: (taskListId: string) => Promise<boolean>;
  scheduleTaskBlock: (request: ScheduledTaskBlockCreateRequest) => Promise<boolean>;
  moveScheduledTaskBlock: (request: ScheduledTaskBlockMoveRequest) => Promise<boolean>;
  unscheduleTaskBlock: (blockId: string) => Promise<boolean>;
}
