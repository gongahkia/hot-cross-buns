import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type {
  CalendarEventSummary,
  CalendarListSummary,
  CalendarScheduleSuggestResponse,
  DiagnosticsHealthResponse,
  DiagnosticsSummaryResponse,
  GoogleStatusResponse,
  NativeCapabilitiesResponse,
  NoteDetail,
  NoteSummary,
  SearchResultItem,
  ScheduledTaskBlockCreateRequest,
  ScheduledTaskBlockMoveRequest,
  ScheduledTaskBlockSummary,
  SettingsRecoveryActionRequest,
  SettingsRecoveryActionResponse,
  SettingsSnapshot,
  SettingsUpdateRequest,
  SyncStatusResponse,
  TaskDetail,
  TaskCreateRequest,
  TaskListCreateRequest,
  TaskListRenameRequest,
  TaskMoveRequest,
  TaskListSummary,
  TaskSummary,
  TaskUpdateRequest
} from "@shared/ipc/contracts";
import type { HcbResult } from "@shared/ipc/result";
import {
  parseLocalSearchQuery,
  type ParsedLocalSearchQuery
} from "@shared/search/localSearch";
import { reportRendererTiming } from "../../hooks/useRenderTiming";
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
  TaskGroupViewModel,
  TaskViewModel
} from "./coreViewModels";
import { getTaskById as getMockTaskById } from "./mockCoreViewModels";

export interface CoreViewModelSource {
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
  isOffline: boolean;
  isStale: boolean;
  largeTaskWindow: TaskViewModel[];
  refresh: () => void;
  refreshGoogleStatus: () => void;
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

export type CoreDataState = "loading" | "ready" | "empty" | "error" | "offline" | "stale";

interface CoreDataSnapshot {
  taskLists: TaskListSummary[];
  tasks: TaskSummary[];
  calendars: CalendarListSummary[];
  events: CalendarEventSummary[];
  scheduledTaskBlocks: ScheduledTaskBlockSummary[];
  scheduleSuggestion: CalendarScheduleSuggestResponse;
  notes: NoteSummary[];
  settings: SettingsSnapshot;
  syncStatus: SyncStatusResponse;
  googleStatus: GoogleStatusResponse;
  health?: DiagnosticsHealthResponse;
  native: NativeCapabilitiesResponse;
  diagnosticsSummary?: DiagnosticsSummaryResponse;
}

interface CoreDataLoadState {
  snapshot: CoreDataSnapshot;
  state: CoreDataState;
  errorMessage?: string;
}

interface SearchHookState {
  viewModel: SearchViewModel;
  state: "idle" | "loading" | "results" | "empty" | "error" | "offline" | "stale" | "invalid";
  parsed: ParsedLocalSearchQuery;
  errorMessage?: string;
  latencyMs?: number;
}

interface TaskMutationUiState {
  pending: boolean;
  error?: string;
}

type SettingsMutationUiState = TaskMutationUiState;

interface CalendarEventDayIndex {
  eventsByDay: Map<string, CalendarEventViewModel[]>;
}

const CoreDataContext = createContext<CoreViewModelSource | null>(null);

const emptySyncStatus: SyncStatusResponse = {
  state: "idle",
  pendingMutationCount: 0,
  offline: true,
  stale: true
};

const emptyGoogleStatus: GoogleStatusResponse = {
  oauthClientConfigured: false,
  clientId: null,
  hasClientSecret: false
};
const LOCAL_SEARCH_DEBOUNCE_MS = 24;

const emptySettings: SettingsSnapshot = {
  theme: "system",
  startOnLogin: false,
  selectedTaskListIds: [],
  selectedCalendarIds: [],
  setupCompletedAt: null,
  syncMode: "balanced",
  quickCaptureShortcut: "Ctrl+Space",
  showTrayIcon: true,
  trayClickAction: "open-menu",
  menuBarPanelStyle: "adaptive",
  showMenuBarBadge: true,
  notificationsEnabled: false,
  notificationLeadMinutes: 10,
  mcpEnabled: false,
  mcpPermissionMode: "confirm-writes",
  mcpPort: 0,
  defaultTimeZone: "UTC",
  todayCapacityMinutes: 480,
  todayWorkingHoursStart: 6,
  todayWorkingHoursEnd: 22,
  diagnosticsIncludePerformance: true,
  savedSearchViews: [],
  savedTaskViews: []
};

const emptyCapabilityReport: NativeCapabilitiesResponse["capabilityReport"] = {
  platform: "unknown",
  adapterId: "unavailable",
  packageFormat: "development",
  flags: {
    supportsAppPaths: false,
    supportsTray: false,
    supportsAppMenu: false,
    supportsGlobalShortcut: false,
    supportsNotifications: false,
    supportsNotificationPermissionQuery: false,
    supportsProtocolRegistration: false,
    supportsProtocolRegistrationCheck: false,
    supportsAutostart: false,
    supportsInPlaceAutoUpdate: false,
    supportsInstallerMetadata: false,
    supportsExternalUrlOpen: false,
    supportsDiagnosticsCollection: false,
    supportsCredentialStorage: false,
    supportsOAuthLoopback: false,
    supportsMcpLoopback: false,
    requiresSignedBuildForNotifications: false
  },
  paths: [],
  capabilities: [],
  diagnostics: []
};

const emptyNativeCapabilities: NativeCapabilitiesResponse = {
  platform: "unknown",
  notifications: false,
  globalShortcuts: false,
  tray: false,
  deepLinks: false,
  trayStatus: {
    state: "unsupported",
    message: "Native shell is unavailable."
  },
  quickCaptureShortcut: {
    accelerator: null,
    registered: false,
    state: "unsupported",
    message: "Global shortcuts are unavailable."
  },
  notificationsStatus: {
    permission: "unsupported",
    scheduledCount: 0,
    state: "unsupported",
    message: "Notifications are unavailable."
  },
  deepLinkStatus: {
    scheme: "hotcrossbuns",
    registered: false,
    state: "unsupported",
    message: "Deep links are unavailable."
  },
  updaterStatus: {
    state: "unsupported",
    message: "Preview update checks are not configured."
  },
  mcpStatus: {
    state: "disabled",
    message: "MCP local agent access is disabled."
  },
  capabilityReport: emptyCapabilityReport,
  deferredStartup: {
    state: "pending"
  }
};

const emptySnapshot: CoreDataSnapshot = {
  taskLists: [],
  tasks: [],
  calendars: [],
  events: [],
  scheduledTaskBlocks: [],
  scheduleSuggestion: {
    slots: [],
    unscheduled: [],
    overloadMinutes: 0
  },
  notes: [],
  settings: emptySettings,
  syncStatus: emptySyncStatus,
  googleStatus: emptyGoogleStatus,
  native: emptyNativeCapabilities
};

export function CoreDataProvider({ children }: { children: ReactNode }): JSX.Element {
  const source = usePreloadCoreSource();

  return <CoreDataContext.Provider value={source}>{children}</CoreDataContext.Provider>;
}

export function useCoreViewModelSource(): CoreViewModelSource {
  const source = useContext(CoreDataContext);

  if (!source) {
    throw new Error("CoreDataProvider is missing.");
  }

  return source;
}

export function useLocalSearch(query: string): SearchHookState {
  const parsed = useMemo(() => parseLocalSearchQuery(query), [query]);
  const [state, setState] = useState<SearchHookState>({
    viewModel: idleSearchViewModel(),
    state: "idle",
    parsed
  });

  useEffect(() => {
    const trimmed = query.trim();

    if (!trimmed) {
      setState({
        viewModel: idleSearchViewModel(),
        state: "idle",
        parsed
      });
      return;
    }

    if (parsed.errors.length > 0) {
      setState((current) => ({
        viewModel:
          current.viewModel.state === "results"
            ? current.viewModel
            : emptySearchViewModel("Fix the query syntax to search local data."),
        state: "invalid",
        parsed,
        errorMessage: parsed.errors[0]?.message ?? "Invalid search query."
      }));
      return;
    }

    if (!window.hcb) {
      setState({
        viewModel: emptySearchViewModel("Search is unavailable while the preload bridge is offline."),
        state: "offline",
        parsed,
        errorMessage: "Preload bridge is unavailable."
      });
      return;
    }

    let cancelled = false;
    const debounce = window.setTimeout(() => {
      const startedAt = performance.now();

      setState((current) => ({
        viewModel: current.viewModel,
        state: current.viewModel.state === "results" ? "stale" : "loading",
        parsed
      }));

      window.hcb?.search
        .query({
          query: trimmed,
          limit: 30
        })
        .then((result) => unwrap(result, "Search failed"))
        .then((response) => {
          if (cancelled) {
            return;
          }

          const viewModel = searchViewModelFromResults(trimmed, response.items);

          setState({
            viewModel,
            state: viewModel.state,
            parsed,
            latencyMs: Math.max(0, Math.round(performance.now() - startedAt))
          });
          reportRendererTiming("search.query", performance.now() - startedAt, {
            resultCount: response.items.length,
            state: viewModel.state
          });
        })
        .catch((error: unknown) => {
          if (cancelled) {
            return;
          }

          setState({
            viewModel: emptySearchViewModel("Local search could not read the cache."),
            state: "error",
            parsed,
            errorMessage: error instanceof Error ? error.message : "Local search failed."
          });
        });
    }, LOCAL_SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(debounce);
    };
  }, [query, parsed]);

  return state;
}

function usePreloadCoreSource(): CoreViewModelSource {
  const [loadState, setLoadState] = useState<CoreDataLoadState>({
    snapshot: emptySnapshot,
    state: "loading"
  });
  const [taskMutation, setTaskMutation] = useState<TaskMutationUiState>({ pending: false });
  const [settingsMutation, setSettingsMutation] = useState<SettingsMutationUiState>({
    pending: false
  });
  const cachedDataReported = useRef(false);
  const googleStatusRequested = useRef(false);
  const retryTaskMutation = useRef<() => void>(() => undefined);
  const taskViewModelCache = useRef(new Map<string, { signature: string; viewModel: TaskViewModel }>());

  const setTasksSnapshot = useCallback((updater: (tasks: TaskSummary[]) => TaskSummary[]) => {
    setLoadState((current) => ({
      ...current,
      snapshot: {
        ...current.snapshot,
        tasks: updater(current.snapshot.tasks)
      }
    }));
  }, []);

  const setScheduledBlocksSnapshot = useCallback(
    (updater: (blocks: ScheduledTaskBlockSummary[]) => ScheduledTaskBlockSummary[]) => {
      setLoadState((current) => ({
        ...current,
        snapshot: {
          ...current.snapshot,
          scheduledTaskBlocks: updater(current.snapshot.scheduledTaskBlocks)
        }
      }));
    },
    []
  );

  const setTaskListsSnapshot = useCallback(
    (updater: (taskLists: TaskListSummary[]) => TaskListSummary[]) => {
      setLoadState((current) => ({
        ...current,
        snapshot: {
          ...current.snapshot,
          taskLists: updater(current.snapshot.taskLists)
        }
      }));
    },
    []
  );

  const refreshSyncStatus = useCallback(() => {
    void window.hcb?.sync.status().then((result) => {
      if (!result?.ok) {
        return;
      }

      setLoadState((current) => ({
        ...current,
        snapshot: {
          ...current.snapshot,
          syncStatus: result.data
        }
      }));
    });
  }, []);

  const beginTaskMutation = useCallback(() => {
    setTaskMutation({ pending: true });
    setLoadState((current) => ({
      ...current,
      snapshot: {
        ...current.snapshot,
        syncStatus: {
          ...current.snapshot.syncStatus,
          pendingMutationCount: current.snapshot.syncStatus.pendingMutationCount + 1
        }
      }
    }));
  }, []);

  const failTaskMutation = useCallback((message: string, retry: () => void) => {
    retryTaskMutation.current = retry;
    setTaskMutation({ pending: false, error: message });
    refreshSyncStatus();
  }, [refreshSyncStatus]);

  const finishTaskMutation = useCallback(() => {
    setTaskMutation({ pending: false });
    refreshSyncStatus();
  }, [refreshSyncStatus]);

  const refreshDiagnosticsSummary = useCallback(() => {
    void window.hcb?.diagnostics.summary().then((result) => {
      if (!result?.ok) {
        return;
      }

      setLoadState((current) => ({
        ...current,
        snapshot: {
          ...current.snapshot,
          diagnosticsSummary: result.data
        }
      }));
    });
  }, []);

  const setGoogleStatus = useCallback((googleStatus: GoogleStatusResponse) => {
    setLoadState((current) => ({
      ...current,
      snapshot: {
        ...current.snapshot,
        googleStatus
      }
    }));
  }, []);

  const refreshGoogleStatus = useCallback(() => {
    void window.hcb?.google.status().then((result) => {
      if (!result?.ok) {
        return;
      }

      setGoogleStatus(result.data);
    });
  }, [setGoogleStatus]);

  const updateSettings = useCallback(
    async (request: SettingsUpdateRequest): Promise<boolean> => {
      if (!window.hcb) {
        setSettingsMutation({
          pending: false,
          error: "Settings require the preload bridge."
        });
        return false;
      }

      setSettingsMutation({ pending: true });
      const result = await window.hcb.settings.update(request);

      if (result.ok) {
        const nativeResult = await window.hcb.native.capabilities();
        setLoadState((current) => ({
          ...current,
          snapshot: {
            ...current.snapshot,
            settings: result.data,
            ...(nativeResult.ok ? { native: nativeResult.data } : {})
          }
        }));
        setSettingsMutation({ pending: false });
        refreshDiagnosticsSummary();
        return true;
      }

      setSettingsMutation({
        pending: false,
        error: result.error.message
      });
      return false;
    },
    [refreshDiagnosticsSummary]
  );

  const createTask = useCallback(
    async (request: TaskCreateRequest): Promise<boolean> => {
      if (!window.hcb) {
        failTaskMutation("Task writes require the preload bridge.", () => void createTask(request));
        return false;
      }

      const optimisticId = `optimistic:task:${Date.now()}:${Math.random().toString(36).slice(2)}`;
      const now = new Date().toISOString();
      const optimisticTask: TaskSummary = {
        id: optimisticId,
        listId: request.listId,
        title: request.title,
        status: "active",
        dueAt: request.dueDate ? `${request.dueDate}T00:00:00.000Z` : null,
        updatedAt: now,
        notes: request.notes ?? "",
        parentId: request.parentId ?? null,
        priority: request.priority ?? "none",
        plannedStart: request.plannedStart ?? null,
        plannedEnd: request.plannedEnd ?? null,
        durationMinutes: request.durationMinutes ?? null,
        lockedSchedule: request.lockedSchedule ?? false,
        snoozeUntil: request.snoozeUntil ?? null,
        tags: request.tags ?? [],
        mutationState: "queued"
      };

      beginTaskMutation();
      setTasksSnapshot((tasks) => [optimisticTask, ...tasks]);

      const result = await window.hcb.tasks.create(request);

      if (result.ok) {
        setTasksSnapshot((tasks) =>
          tasks.map((task) => (task.id === optimisticId ? result.data : task))
        );
        finishTaskMutation();
        return true;
      }

      setTasksSnapshot((tasks) => tasks.filter((task) => task.id !== optimisticId));
      failTaskMutation(result.error.message, () => void createTask(request));
      return false;
    },
    [beginTaskMutation, failTaskMutation, finishTaskMutation, setTasksSnapshot]
  );

  const updateTask = useCallback(
    async (request: TaskUpdateRequest): Promise<boolean> => {
      if (!window.hcb) {
        failTaskMutation("Task writes require the preload bridge.", () => void updateTask(request));
        return false;
      }

      let previousTasks: TaskSummary[] = [];
      beginTaskMutation();
      setTasksSnapshot((tasks) => {
        previousTasks = tasks;
        return tasks.map((task) => (task.id === request.id ? optimisticTaskPatch(task, request) : task));
      });

      const result = await window.hcb.tasks.update(request);

      if (result.ok) {
        setTasksSnapshot((tasks) => tasks.map((task) => (task.id === request.id ? result.data : task)));
        finishTaskMutation();
        return true;
      }

      setTasksSnapshot(() => previousTasks);
      failTaskMutation(result.error.message, () => void updateTask(request));
      return false;
    },
    [beginTaskMutation, failTaskMutation, finishTaskMutation, setTasksSnapshot]
  );

  const completeTask = useCallback(
    async (taskId: string): Promise<boolean> => {
      if (!window.hcb) {
        failTaskMutation("Task writes require the preload bridge.", () => void completeTask(taskId));
        return false;
      }

      let previousTasks: TaskSummary[] = [];
      beginTaskMutation();
      setTasksSnapshot((tasks) => {
        previousTasks = tasks;
        return tasks.map((task) =>
          task.id === taskId
            ? { ...task, status: "completed", mutationState: "queued", updatedAt: new Date().toISOString() }
            : task
        );
      });

      const result = await window.hcb.tasks.complete({ id: taskId });

      if (result.ok) {
        setTasksSnapshot((tasks) => tasks.map((task) => (task.id === taskId ? result.data : task)));
        finishTaskMutation();
        return true;
      }

      setTasksSnapshot(() => previousTasks);
      failTaskMutation(result.error.message, () => void completeTask(taskId));
      return false;
    },
    [beginTaskMutation, failTaskMutation, finishTaskMutation, setTasksSnapshot]
  );

  const reopenTask = useCallback(
    async (taskId: string): Promise<boolean> => {
      if (!window.hcb) {
        failTaskMutation("Task writes require the preload bridge.", () => void reopenTask(taskId));
        return false;
      }

      let previousTasks: TaskSummary[] = [];
      beginTaskMutation();
      setTasksSnapshot((tasks) => {
        previousTasks = tasks;
        return tasks.map((task) =>
          task.id === taskId
            ? { ...task, status: "active", mutationState: "queued", updatedAt: new Date().toISOString() }
            : task
        );
      });

      const result = await window.hcb.tasks.reopen({ id: taskId });

      if (result.ok) {
        setTasksSnapshot((tasks) => tasks.map((task) => (task.id === taskId ? result.data : task)));
        finishTaskMutation();
        return true;
      }

      setTasksSnapshot(() => previousTasks);
      failTaskMutation(result.error.message, () => void reopenTask(taskId));
      return false;
    },
    [beginTaskMutation, failTaskMutation, finishTaskMutation, setTasksSnapshot]
  );

  const moveTask = useCallback(
    async (request: TaskMoveRequest): Promise<boolean> => {
      if (!window.hcb) {
        failTaskMutation("Task writes require the preload bridge.", () => void moveTask(request));
        return false;
      }

      let previousTasks: TaskSummary[] = [];
      beginTaskMutation();
      setTasksSnapshot((tasks) => {
        previousTasks = tasks;
        return tasks.map((task) =>
          task.id === request.id
            ? optimisticTaskPatch(task, {
                id: request.id,
                ...(request.listId === undefined ? {} : { listId: request.listId }),
                ...(request.parentId === undefined ? {} : { parentId: request.parentId })
              })
            : task
        );
      });

      const result = await window.hcb.tasks.move(request);

      if (result.ok) {
        setTasksSnapshot((tasks) => tasks.map((task) => (task.id === request.id ? result.data : task)));
        finishTaskMutation();
        return true;
      }

      setTasksSnapshot(() => previousTasks);
      failTaskMutation(result.error.message, () => void moveTask(request));
      return false;
    },
    [beginTaskMutation, failTaskMutation, finishTaskMutation, setTasksSnapshot]
  );

  const deleteTask = useCallback(
    async (taskId: string): Promise<boolean> => {
      if (!window.hcb) {
        failTaskMutation("Task writes require the preload bridge.", () => void deleteTask(taskId));
        return false;
      }

      let previousTasks: TaskSummary[] = [];
      beginTaskMutation();
      setTasksSnapshot((tasks) => {
        previousTasks = tasks;
        return tasks.filter((task) => task.id !== taskId);
      });

      const result = await window.hcb.tasks.delete({ id: taskId });

      if (result.ok) {
        finishTaskMutation();
        return true;
      }

      setTasksSnapshot(() => previousTasks);
      failTaskMutation(result.error.message, () => void deleteTask(taskId));
      return false;
    },
    [beginTaskMutation, failTaskMutation, finishTaskMutation, setTasksSnapshot]
  );

  const createTaskList = useCallback(
    async (request: TaskListCreateRequest): Promise<boolean> => {
      if (!window.hcb) {
        failTaskMutation("Task list writes require the preload bridge.", () => void createTaskList(request));
        return false;
      }

      const optimisticId = `optimistic:list:${Date.now()}`;
      const now = new Date().toISOString();

      beginTaskMutation();
      setTaskListsSnapshot((taskLists) => [
        ...taskLists,
        { id: optimisticId, title: request.title, updatedAt: now, taskCount: 0, activeTaskCount: 0 }
      ]);

      const result = await window.hcb.tasks.createTaskList(request);

      if (result.ok) {
        setTaskListsSnapshot((taskLists) =>
          taskLists.map((taskList) => (taskList.id === optimisticId ? result.data : taskList))
        );
        finishTaskMutation();
        return true;
      }

      setTaskListsSnapshot((taskLists) => taskLists.filter((taskList) => taskList.id !== optimisticId));
      failTaskMutation(result.error.message, () => void createTaskList(request));
      return false;
    },
    [beginTaskMutation, failTaskMutation, finishTaskMutation, setTaskListsSnapshot]
  );

  const renameTaskList = useCallback(
    async (request: TaskListRenameRequest): Promise<boolean> => {
      if (!window.hcb) {
        failTaskMutation("Task list writes require the preload bridge.", () => void renameTaskList(request));
        return false;
      }

      let previousTaskLists: TaskListSummary[] = [];
      beginTaskMutation();
      setTaskListsSnapshot((taskLists) => {
        previousTaskLists = taskLists;
        return taskLists.map((taskList) =>
          taskList.id === request.id ? { ...taskList, title: request.title } : taskList
        );
      });

      const result = await window.hcb.tasks.renameTaskList(request);

      if (result.ok) {
        setTaskListsSnapshot((taskLists) =>
          taskLists.map((taskList) => (taskList.id === request.id ? result.data : taskList))
        );
        finishTaskMutation();
        return true;
      }

      setTaskListsSnapshot(() => previousTaskLists);
      failTaskMutation(result.error.message, () => void renameTaskList(request));
      return false;
    },
    [beginTaskMutation, failTaskMutation, finishTaskMutation, setTaskListsSnapshot]
  );

  const deleteTaskList = useCallback(
    async (taskListId: string): Promise<boolean> => {
      if (!window.hcb) {
        failTaskMutation("Task list writes require the preload bridge.", () => void deleteTaskList(taskListId));
        return false;
      }

      let previousTaskLists: TaskListSummary[] = [];
      let previousTasks: TaskSummary[] = [];
      beginTaskMutation();
      setTaskListsSnapshot((taskLists) => {
        previousTaskLists = taskLists;
        return taskLists.filter((taskList) => taskList.id !== taskListId);
      });
      setTasksSnapshot((tasks) => {
        previousTasks = tasks;
        return tasks.filter((task) => task.listId !== taskListId);
      });

      const result = await window.hcb.tasks.deleteTaskList({ id: taskListId });

      if (result.ok) {
        finishTaskMutation();
        return true;
      }

      setTaskListsSnapshot(() => previousTaskLists);
      setTasksSnapshot(() => previousTasks);
      failTaskMutation(result.error.message, () => void deleteTaskList(taskListId));
      return false;
    },
    [beginTaskMutation, failTaskMutation, finishTaskMutation, setTaskListsSnapshot, setTasksSnapshot]
  );

  const scheduleTaskBlock = useCallback(
    async (request: ScheduledTaskBlockCreateRequest): Promise<boolean> => {
      if (!window.hcb) {
        failTaskMutation("Task scheduling requires the preload bridge.", () => void scheduleTaskBlock(request));
        return false;
      }

      beginTaskMutation();
      const result = await window.hcb.calendar.scheduleTaskBlock(request);

      if (result.ok) {
        setScheduledBlocksSnapshot((blocks) => [result.data, ...blocks]);
        finishTaskMutation();
        return true;
      }

      failTaskMutation(result.error.message, () => void scheduleTaskBlock(request));
      return false;
    },
    [beginTaskMutation, failTaskMutation, finishTaskMutation, setScheduledBlocksSnapshot]
  );

  const moveScheduledTaskBlock = useCallback(
    async (request: ScheduledTaskBlockMoveRequest): Promise<boolean> => {
      if (!window.hcb) {
        failTaskMutation("Scheduled task moves require the preload bridge.", () => void moveScheduledTaskBlock(request));
        return false;
      }

      let previousBlocks: ScheduledTaskBlockSummary[] = [];
      beginTaskMutation();
      setScheduledBlocksSnapshot((blocks) => {
        previousBlocks = blocks;
        return blocks.map((block) =>
          block.id === request.id ? optimisticScheduledBlockPatch(block, request) : block
        );
      });

      const result = await window.hcb.calendar.moveScheduledTaskBlock(request);

      if (result.ok) {
        setScheduledBlocksSnapshot((blocks) =>
          blocks.map((block) => (block.id === request.id ? result.data : block))
        );
        finishTaskMutation();
        return true;
      }

      setScheduledBlocksSnapshot(() => previousBlocks);
      failTaskMutation(result.error.message, () => void moveScheduledTaskBlock(request));
      return false;
    },
    [beginTaskMutation, failTaskMutation, finishTaskMutation, setScheduledBlocksSnapshot]
  );

  const unscheduleTaskBlock = useCallback(
    async (blockId: string): Promise<boolean> => {
      if (!window.hcb) {
        failTaskMutation("Unscheduling requires the preload bridge.", () => void unscheduleTaskBlock(blockId));
        return false;
      }

      let previousBlocks: ScheduledTaskBlockSummary[] = [];
      let previousEvents: CalendarEventSummary[] = [];
      let removedEventId: string | null = null;
      beginTaskMutation();
      setScheduledBlocksSnapshot((blocks) => {
        previousBlocks = blocks;
        removedEventId = blocks.find((block) => block.id === blockId)?.calendarEventId ?? null;
        return blocks.filter((block) => block.id !== blockId);
      });
      if (removedEventId) {
        setLoadState((current) => ({
          ...current,
          snapshot: {
            ...current.snapshot,
            events: (() => {
              previousEvents = current.snapshot.events;
              return current.snapshot.events.filter(
                (event) => (event.eventId ?? event.id) !== removedEventId
              );
            })()
          }
        }));
      }

      const result = await window.hcb.calendar.unscheduleTaskBlock({
        id: blockId,
        deleteCalendarEvent: true
      });

      if (result.ok) {
        finishTaskMutation();
        return true;
      }

      setScheduledBlocksSnapshot(() => previousBlocks);
      if (previousEvents.length > 0) {
        setLoadState((current) => ({
          ...current,
          snapshot: {
            ...current.snapshot,
            events: previousEvents
          }
        }));
      }
      failTaskMutation(result.error.message, () => void unscheduleTaskBlock(blockId));
      return false;
    },
    [beginTaskMutation, failTaskMutation, finishTaskMutation, setScheduledBlocksSnapshot]
  );

  const load = useCallback(() => {
    if (!window.hcb) {
      setLoadState({
        snapshot: emptySnapshot,
        state: "offline",
        errorMessage: "Preload bridge is unavailable."
      });
      return;
    }

    setLoadState((current) => ({
      ...current,
      state: hasSnapshotData(current.snapshot) ? "stale" : "loading",
      errorMessage: undefined
    }));

    void loadCoreData().then(
      (snapshot) => {
        setLoadState((current) => ({
          snapshot: {
            ...snapshot,
            googleStatus: current.snapshot.googleStatus
          },
          state: hasSnapshotData(snapshot) ? "ready" : "empty"
        }));
      },
      (error: unknown) => {
        setLoadState((current) => ({
          ...current,
          state: hasSnapshotData(current.snapshot) ? "stale" : "error",
          errorMessage: error instanceof Error ? error.message : "Local cache read failed."
        }));
      }
    );
  }, []);

  const runRecoveryAction = useCallback(
    async (
      request: SettingsRecoveryActionRequest
    ): Promise<SettingsRecoveryActionResponse | null> => {
      if (!window.hcb) {
        setSettingsMutation({
          pending: false,
          error: "Recovery actions require the preload bridge."
        });
        return null;
      }

      setSettingsMutation({ pending: true });
      const result = await window.hcb.settings.recoveryAction(request);

      if (result.ok) {
        setSettingsMutation({ pending: false });
        refreshSyncStatus();
        refreshDiagnosticsSummary();
        if (
          request.action === "clearGoogleCache" ||
          request.action === "forceFullResync" ||
          request.action === "resetOnboarding"
        ) {
          load();
        }
        return result.data;
      }

      setSettingsMutation({
        pending: false,
        error: result.error.message
      });
      return null;
    },
    [load, refreshDiagnosticsSummary, refreshSyncStatus]
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (
      loadState.snapshot.diagnosticsSummary ||
      (loadState.state !== "ready" && loadState.state !== "empty")
    ) {
      return;
    }

    const timeout = window.setTimeout(() => {
      refreshDiagnosticsSummary();
    }, 5_000);

    return () => window.clearTimeout(timeout);
  }, [loadState.snapshot.diagnosticsSummary, loadState.state, refreshDiagnosticsSummary]);

  useEffect(() => {
    if (
      googleStatusRequested.current ||
      (loadState.state !== "ready" && loadState.state !== "empty")
    ) {
      return;
    }

    googleStatusRequested.current = true;
    const timeout = window.setTimeout(() => {
      refreshGoogleStatus();
    }, 1_000);

    return () => window.clearTimeout(timeout);
  }, [loadState.state, refreshGoogleStatus]);

  useEffect(() => {
    return window.hcb?.sync.subscribeStatus((syncStatus) => {
      setLoadState((current) => ({
        ...current,
        snapshot: {
          ...current.snapshot,
          syncStatus
        }
      }));
    });
  }, []);

  useEffect(() => {
    if (
      cachedDataReported.current ||
      (loadState.state !== "ready" && loadState.state !== "empty")
    ) {
      return;
    }

    cachedDataReported.current = true;
    void window.hcb?.diagnostics.markCachedDataRendered();
  }, [loadState.state]);

  return useMemo(
    () => buildCoreViewModelSource(loadState.snapshot, {
      state: loadState.state,
      errorMessage: loadState.errorMessage,
      refresh: load,
      refreshGoogleStatus,
      setGoogleStatus,
      taskViewModelCache: taskViewModelCache.current,
      taskMutation,
      settingsMutation,
      updateSettings,
      runRecoveryAction,
      clearTaskMutationError: () => setTaskMutation((current) => ({ ...current, error: undefined })),
      retryLastTaskMutation: () => retryTaskMutation.current(),
      createTask,
      updateTask,
      completeTask,
      reopenTask,
      moveTask,
      deleteTask,
      createTaskList,
      renameTaskList,
      deleteTaskList,
      scheduleTaskBlock,
      moveScheduledTaskBlock,
      unscheduleTaskBlock
    }),
    [
      completeTask,
      createTask,
      createTaskList,
      deleteTask,
      deleteTaskList,
      load,
      loadState,
      moveTask,
      moveScheduledTaskBlock,
      renameTaskList,
      refreshGoogleStatus,
      runRecoveryAction,
      reopenTask,
      setGoogleStatus,
      settingsMutation,
      scheduleTaskBlock,
      taskMutation,
      unscheduleTaskBlock,
      updateSettings,
      updateTask
    ]
  );
}

async function loadCoreData(): Promise<CoreDataSnapshot> {
  if (!window.hcb) {
    throw new Error("Preload bridge is unavailable.");
  }

  const range = visibleCalendarRange();
  const [
    taskLists,
    tasks,
    hiddenTasks,
    deletedTasks,
    calendars,
    events,
    scheduledTaskBlocks,
    notes,
    settings,
    syncStatus,
    health,
    native
  ] = await Promise.all([
    window.hcb.tasks.listTaskLists({ limit: 100 }).then((result) => unwrap(result, "Task lists failed")),
    window.hcb.tasks.list({ status: "all", limit: 100 }).then((result) => unwrap(result, "Tasks failed")),
    window.hcb.tasks
      .list({ status: "hidden", limit: 100 })
      .then((result) => unwrap(result, "Hidden tasks failed")),
    window.hcb.tasks
      .list({ status: "deleted", limit: 100 })
      .then((result) => unwrap(result, "Deleted tasks failed")),
    window.hcb.calendar
      .listCalendars({ limit: 100 })
      .then((result) => unwrap(result, "Calendars failed")),
    window.hcb.calendar
      .listEvents({ start: range.start, end: range.end, limit: 250 })
      .then((result) => unwrap(result, "Calendar events failed")),
    window.hcb.calendar
      .listScheduledTaskBlocks({ start: range.start, end: range.end, limit: 250 })
      .then((result) => unwrap(result, "Scheduled task blocks failed")),
    window.hcb.notes.list({ limit: 50 }).then((result) => unwrap(result, "Notes failed")),
    window.hcb.settings.get().then((result) => unwrap(result, "Settings failed")),
    window.hcb.sync.status().then((result) => unwrap(result, "Sync status failed")),
    window.hcb.diagnostics.health().then((result) => unwrap(result, "Diagnostics failed")),
    window.hcb.native.capabilities().then((result) => unwrap(result, "Native status failed"))
  ]);
  const scheduleDate = dateOnlyFromLocalDate(new Date());
  const scheduleSuggestion = await window.hcb.calendar
    .scheduleSuggest({
      date: scheduleDate,
      capacityMinutes: settings.todayCapacityMinutes,
      workingHours: {
        start: settings.todayWorkingHoursStart,
        end: settings.todayWorkingHoursEnd
      }
    })
    .then((result) => unwrap(result, "Schedule suggestion failed"));

  return {
    taskLists: taskLists.items,
    tasks: uniqueTasks([...tasks.items, ...hiddenTasks.items, ...deletedTasks.items]),
    calendars: calendars.items,
    events: events.items,
    scheduledTaskBlocks: scheduledTaskBlocks.items,
    scheduleSuggestion,
    notes: notes.items,
    settings,
    syncStatus,
    googleStatus: emptyGoogleStatus,
    health,
    native
  };
}

function buildCoreViewModelSource(
  snapshot: CoreDataSnapshot,
  options: {
    state: CoreDataState;
    errorMessage?: string;
    refresh: () => void;
    refreshGoogleStatus: () => void;
    setGoogleStatus: (status: GoogleStatusResponse) => void;
    taskViewModelCache: Map<string, { signature: string; viewModel: TaskViewModel }>;
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
): CoreViewModelSource {
  const taskListsById = Object.fromEntries(snapshot.taskLists.map((list) => [list.id, list]));
  const childTasksByParentId = groupChildTasks(snapshot.tasks);
  const tasks = snapshot.tasks.map((task) =>
    stableTaskViewModel(
      task,
      taskListsById[task.listId]?.title,
      childTasksByParentId.get(task.id) ?? [],
      options.taskViewModelCache
    )
  );
  const taskById = Object.fromEntries(tasks.map((task) => [task.id, task]));
  const calendarTitleById = Object.fromEntries(
    snapshot.calendars.map((calendar) => [calendar.id, calendar.title])
  );
  const calendarTimeZoneById = Object.fromEntries(
    snapshot.calendars.map((calendar) => [calendar.id, calendar.timeZone])
  );
  const events = snapshot.events.map((event) =>
    calendarEventViewModel(
      event,
      calendarTitleById[event.calendarId],
      calendarTimeZoneById[event.calendarId] ?? null,
      snapshot.settings.defaultTimeZone
    )
  );
  const eventsById = Object.fromEntries(events.map((event) => [event.id, event]));
  const scheduledEventIds = new Set(snapshot.scheduledTaskBlocks.map((block) => block.calendarEventId));
  const conflictTitlesByBlockId = scheduledTaskBlockConflicts(
    snapshot.scheduledTaskBlocks,
    events,
    scheduledEventIds
  );
  const baseScheduledTaskBlocks = snapshot.scheduledTaskBlocks.map((block) =>
    scheduledTaskBlockViewModel(
      block,
      calendarTitleById[block.calendarId],
      conflictTitlesByBlockId.get(block.id) ?? []
    )
  );
  const scheduledTaskIds = new Set(baseScheduledTaskBlocks.map((block) => block.taskId));
  const eventDayIndex = buildCalendarEventDayIndex(events, snapshot.events);
  const notes = snapshot.notes.map(noteViewModel);
  const rootTasks = tasks.filter((task) => task.parentId === null);
  const openTasks = rootTasks.filter((task) => task.status === "open");
  const unscheduledOpenTasks = openTasks.filter((task) => !scheduledTaskIds.has(task.id));
  const completedTasks = rootTasks.filter((task) => task.status === "completed");
  const hiddenTasks = rootTasks.filter((task) => task.status === "hidden");
  const deletedTasks = rootTasks.filter((task) => task.status === "deleted");
  const now = new Date();
  const today = startOfUtcDay(now);
  const todayKey = dayKey(today);
  const todayEvents = eventsForDate(eventDayIndex, today).filter(
    (event) => !scheduledEventIds.has(event.eventId) && !scheduledEventIds.has(event.id)
  );
  const baseTodayScheduledBlocks = baseScheduledTaskBlocks
    .filter((block) => block.startsAt.slice(0, 10) === todayKey)
    .sort(
      (left, right) =>
        left.startsAt.localeCompare(right.startsAt) ||
        left.endsAt.localeCompare(right.endsAt) ||
        left.id.localeCompare(right.id)
    );
  const nextUp = nextUpTimelineItem(todayEvents, baseTodayScheduledBlocks, now);
  const scheduledTaskBlocks = baseScheduledTaskBlocks.map((block) => ({
    ...block,
    isNextUp: nextUp?.kind === "scheduledTaskBlock" && nextUp.itemId === block.id
  }));
  const scheduledTaskBlocksById = Object.fromEntries(
    scheduledTaskBlocks.map((block) => [block.id, block])
  );
  const todayScheduledBlocks = scheduledTaskBlocks
    .filter((block) => block.startsAt.slice(0, 10) === todayKey)
    .sort(
      (left, right) =>
        left.startsAt.localeCompare(right.startsAt) ||
        left.endsAt.localeCompare(right.endsAt) ||
        left.id.localeCompare(right.id)
    );
  const taskFilterViewModels = taskFilters(
    openTasks,
    completedTasks,
    hiddenTasks,
    deletedTasks,
    snapshot.taskLists
  );
  const todayTimedRows = [
    ...todayEvents.map((event) => ({
      kind: "event" as const,
      itemId: event.id,
      startsAt: event.startsAt,
      endsAt: event.endsAt
    })),
    ...todayScheduledBlocks.map((block) => ({
      kind: "scheduledTaskBlock" as const,
      itemId: block.id,
      startsAt: block.startsAt,
      endsAt: block.endsAt
    }))
  ].sort(compareTimelineRows);
  const todayTimelineRows = [
    ...todayTimedRows.slice(0, 10).map(({ kind, itemId }) => ({ kind, itemId })),
    ...unscheduledOpenTasks.slice(0, 5).map((task) => ({ kind: "task" as const, itemId: task.id }))
  ].slice(0, 15);
  const conflictCount = scheduledTaskBlocks.filter((block) => block.conflictCount > 0).length;

  return {
    calendarAgendaEvents: events,
    calendarDayView: dayView(eventDayIndex),
    calendarEventsById: eventsById,
    calendarMonthWeeks: monthWeeks(eventDayIndex),
    calendarSources: snapshot.calendars,
    calendarWeekDays: weekDays(eventDayIndex),
    dataState: options.state,
    errorMessage: options.errorMessage,
    getSearchViewModel: () => idleSearchViewModel(),
    getScheduledTaskBlockById: (blockId) => scheduledTaskBlocksById[blockId] ?? null,
    getTaskById: (taskId) => taskById[taskId] ?? missingTask(taskId),
    getTaskFilterViewModel: (filterId) =>
      taskFilterViewModels.find((filter) => filter.id === filterId) ?? taskFilterViewModels[0],
    hasCachedData: hasSnapshotData(snapshot),
    initialNotes: notes,
    isOffline: options.state === "offline" || snapshot.syncStatus.offline === true,
    isStale: options.state === "stale" || snapshot.syncStatus.stale === true,
    largeTaskWindow: tasks,
    refresh: options.refresh,
    refreshGoogleStatus: options.refreshGoogleStatus,
    setGoogleStatus: options.setGoogleStatus,
    settings: snapshot.settings,
    diagnosticsSummary: snapshot.diagnosticsSummary,
    googleStatus: snapshot.googleStatus,
    native: snapshot.native,
    settingsMutationError: options.settingsMutation.error,
    settingsMutationPending: options.settingsMutation.pending,
    updateSettings: options.updateSettings,
    runRecoveryAction: options.runRecoveryAction,
    taskMutationError: options.taskMutation.error,
    taskMutationPending: options.taskMutation.pending,
    clearTaskMutationError: options.clearTaskMutationError,
    retryLastTaskMutation: options.retryLastTaskMutation,
    createTask: options.createTask,
    updateTask: options.updateTask,
    completeTask: options.completeTask,
    reopenTask: options.reopenTask,
    moveTask: options.moveTask,
    deleteTask: options.deleteTask,
    createTaskList: options.createTaskList,
    renameTaskList: options.renameTaskList,
    deleteTaskList: options.deleteTaskList,
    scheduleTaskBlock: options.scheduleTaskBlock,
    moveScheduledTaskBlock: options.moveScheduledTaskBlock,
    unscheduleTaskBlock: options.unscheduleTaskBlock,
    scheduledTaskBlocks,
    settingsSections: settingsSections(snapshot),
    syncStatus: snapshot.syncStatus,
    taskFilterViewModels,
    taskLists: snapshot.taskLists,
    todayViewModel: {
      metrics: [
        { id: "open", label: "Open tasks", value: String(openTasks.length) },
        { id: "scheduled", label: "Scheduled", value: String(scheduledTaskBlocks.length) },
        { id: "conflicts", label: "Conflicts", value: String(conflictCount) },
        { id: "events", label: "Events", value: String(events.length) },
        { id: "sync", label: "Sync", value: syncLabel(snapshot.syncStatus) }
      ],
      focusTasks: unscheduledOpenTasks.slice(0, 6),
      currentTimeLabel: timeLabel(now.toISOString(), snapshot.settings.defaultTimeZone),
      conflictCount,
      schedule: snapshot.scheduleSuggestion,
      nextUp,
      timelineRows: todayTimelineRows
    }
  };
}

function taskFilters(
  openTasks: TaskViewModel[],
  completedTasks: TaskViewModel[],
  hiddenTasks: TaskViewModel[],
  deletedTasks: TaskViewModel[],
  taskLists: TaskListSummary[]
): TaskFilterViewModel[] {
  return [
    {
      id: "open",
      label: "Open",
      countLabel: String(openTasks.length),
      groups: taskGroups(openTasks, "open", taskLists),
      state: openTasks.length === 0 ? "empty" : "ready"
    },
    {
      id: "completed",
      label: "Completed",
      countLabel: String(completedTasks.length),
      groups: taskGroups(completedTasks, "completed", taskLists),
      state: completedTasks.length === 0 ? "empty" : "ready"
    },
    {
      id: "hidden",
      label: "Hidden",
      countLabel: String(hiddenTasks.length),
      groups: taskGroups(hiddenTasks, "hidden", taskLists),
      state: hiddenTasks.length === 0 ? "empty" : "ready"
    },
    {
      id: "deleted",
      label: "Deleted",
      countLabel: String(deletedTasks.length),
      groups: taskGroups(deletedTasks, "deleted", taskLists),
      state: deletedTasks.length === 0 ? "empty" : "ready"
    },
    {
      id: "empty",
      label: "Empty",
      countLabel: "0",
      groups: [],
      state: "empty"
    },
    {
      id: "error",
      label: "Error",
      countLabel: "!",
      groups: [],
      state: "error"
    }
  ];
}

function taskGroups(
  tasks: TaskViewModel[],
  state: "open" | "completed" | "hidden" | "deleted",
  taskLists: TaskListSummary[]
): TaskGroupViewModel[] {
  const byList = new Map<string, TaskViewModel[]>();
  const listOrder = new Map(taskLists.map((list, index) => [list.title, index]));

  for (const task of tasks) {
    const listTasks = byList.get(task.list) ?? [];
    listTasks.push(task);
    byList.set(task.list, listTasks);
  }

  return Array.from(byList, ([list, listTasks]) => ({
    id: `${state}-${slugId(list)}`,
    title: list,
    description: `${taskStateLabel(state)} tasks cached locally`,
    countLabel: `${listTasks.length} ${listTasks.length === 1 ? "task" : "tasks"}`,
    tasks: listTasks
  })).sort(
    (left, right) =>
      (listOrder.get(left.title) ?? Number.MAX_SAFE_INTEGER) -
        (listOrder.get(right.title) ?? Number.MAX_SAFE_INTEGER) ||
      left.title.localeCompare(right.title)
  );
}

function taskStateLabel(state: "open" | "completed" | "hidden" | "deleted"): string {
  if (state === "completed") {
    return "Completed";
  }

  if (state === "hidden") {
    return "Hidden";
  }

  if (state === "deleted") {
    return "Deleted";
  }

  return "Open";
}

function groupChildTasks(tasks: TaskSummary[]): Map<string, TaskSummary[]> {
  const byParent = new Map<string, TaskSummary[]>();

  for (const task of tasks) {
    if (!task.parentId) {
      continue;
    }

    const children = byParent.get(task.parentId) ?? [];
    children.push(task);
    byParent.set(task.parentId, children);
  }

  for (const children of byParent.values()) {
    children.sort(
      (left, right) =>
        (left.sortOrder ?? 0) - (right.sortOrder ?? 0) ||
        left.updatedAt.localeCompare(right.updatedAt) ||
        left.id.localeCompare(right.id)
    );
  }

  return byParent;
}

function settingsSections(snapshot: CoreDataSnapshot): SettingsSectionViewModel[] {
  const sync = snapshot.syncStatus;
  const summary = snapshot.diagnosticsSummary;
  const build = summary?.build ?? snapshot.health?.build;
  const account = snapshot.googleStatus.account;
  const selectedTaskListCount =
    summary?.selectedResources.taskLists.filter((resource) => resource.selected).length ??
    snapshot.settings.selectedTaskListIds.length;
  const selectedCalendarCount =
    summary?.selectedResources.calendars.filter((resource) => resource.selected).length ??
    snapshot.settings.selectedCalendarIds.length;
  const capabilityReport = snapshot.native.capabilityReport;
  const platformBlockerCount = capabilityReport.diagnostics.filter(
    (diagnostic) => diagnostic.severity === "blocker"
  ).length;

  return [
    {
      id: "google",
      title: "Google",
      status: account?.connectionState === "connected" ? "Connected" : "Disconnected",
      detail: "Google account connection state",
      rows: [
        { id: "client", label: "OAuth client", value: snapshot.googleStatus.oauthClientConfigured ? "Configured" : "Missing" },
        { id: "state", label: "State", value: account?.connectionState ?? "signed_out" },
        {
          id: "account",
          label: "Account",
          value: account?.connectionState === "connected" ? account.email ?? "Connected account" : "Not connected"
        },
        {
          id: "scopes",
          label: "Missing scopes",
          value: String(account?.missingScopes.length ?? 2)
        }
      ]
    },
    {
      id: "resources",
      title: "Resources",
      status: `${selectedTaskListCount}/${selectedCalendarCount}`,
      detail: "Selected task lists and calendars",
      rows: [
        { id: "task-lists", label: "Selected task lists", value: String(selectedTaskListCount) },
        { id: "calendars", label: "Selected calendars", value: String(selectedCalendarCount) },
        { id: "default-time-zone", label: "Default timezone", value: snapshot.settings.defaultTimeZone },
        { id: "today-capacity", label: "Today capacity", value: `${snapshot.settings.todayCapacityMinutes} min` },
        {
          id: "today-hours",
          label: "Today hours",
          value: `${snapshot.settings.todayWorkingHoursStart}:00-${snapshot.settings.todayWorkingHoursEnd}:00`
        }
      ]
    },
    {
      id: "sync",
      title: "Sync",
      status: syncLabel(sync),
      detail: "Read sync state",
      rows: [
        { id: "mode", label: "Mode", value: snapshot.settings.syncMode },
        { id: "pending", label: "Pending mutations", value: String(sync.pendingMutationCount) },
        { id: "completed", label: "Last completed", value: sync.lastCompletedAt ?? "Never" },
        { id: "error", label: "Last error", value: sync.lastErrorCode ?? "None" }
      ]
    },
    {
      id: "appearance",
      title: "Appearance",
      status: snapshot.settings.theme,
      detail: "Theme preference",
      rows: [{ id: "theme", label: "Theme", value: snapshot.settings.theme }]
    },
    {
      id: "hotkeys",
      title: "Hotkeys",
      status: nativeStateLabel(snapshot.native.quickCaptureShortcut.state),
      detail: "Quick capture shortcut",
      rows: [
        {
          id: "quick-capture",
          label: "Quick capture",
          value: snapshot.native.quickCaptureShortcut.accelerator ?? "Not configured"
        },
        {
          id: "registration",
          label: "Registration",
          value: snapshot.native.quickCaptureShortcut.message ?? "No native status reported"
        }
      ]
    },
    {
      id: "tray",
      title: "Tray",
      status: nativeStateLabel(snapshot.native.trayStatus.state),
      detail: "Menu bar state",
      rows: [
        { id: "icon", label: "Show icon", value: snapshot.settings.showTrayIcon ? "Yes" : "No" },
        { id: "click", label: "Click action", value: snapshot.settings.trayClickAction },
        { id: "panel", label: "Panel style", value: snapshot.settings.menuBarPanelStyle },
        { id: "badge", label: "Overdue badge", value: snapshot.settings.showMenuBarBadge ? "On" : "Off" },
        { id: "native", label: "Native state", value: snapshot.native.trayStatus.message ?? "No native status reported" }
      ]
    },
    {
      id: "notifications",
      title: "Notifications",
      status: nativeStateLabel(snapshot.native.notificationsStatus.state),
      detail: "Notification permission",
      rows: [
        { id: "enabled", label: "Local notifications", value: snapshot.settings.notificationsEnabled ? "On" : "Off" },
        { id: "lead", label: "Lead time", value: `${snapshot.settings.notificationLeadMinutes} min` },
        { id: "permission", label: "Permission", value: snapshot.native.notificationsStatus.permission },
        { id: "scheduled", label: "Scheduled", value: String(snapshot.native.notificationsStatus.scheduledCount) }
      ]
    },
    {
      id: "localData",
      title: "Local data",
      status: summary ? "Ready" : "Pending",
      detail: "Cache, checkpoint, and pending mutation state",
      rows: [
        { id: "cache", label: "Cached items", value: String((summary?.cache.taskCount ?? 0) + (summary?.cache.eventCount ?? 0)) },
        { id: "checkpoints", label: "Checkpoints", value: String(summary?.checkpoints.totalCount ?? 0) },
        { id: "pending", label: "Pending mutations", value: String(summary?.pendingMutations.totalCount ?? sync.pendingMutationCount) }
      ]
    },
    {
      id: "mcp",
      title: "MCP",
      status: snapshot.settings.mcpEnabled
        ? nativeStateLabel(snapshot.native.mcpStatus.state)
        : "Disabled",
      detail: "Local agent access",
      rows: [
        { id: "enabled", label: "Enabled", value: snapshot.settings.mcpEnabled ? "Yes" : "No" },
        { id: "mode", label: "Permission mode", value: snapshot.settings.mcpPermissionMode },
        { id: "token", label: "Token state", value: summary?.mcp.tokenState ?? "not_configured" },
        { id: "startup", label: "Startup", value: snapshot.native.mcpStatus.message ?? "No native status reported" }
      ]
    },
    {
      id: "platform",
      title: "Platform",
      status: platformBlockerCount > 0 ? `${platformBlockerCount} blocker${platformBlockerCount === 1 ? "" : "s"}` : "Ready",
      detail: "Adapter capability report",
      rows: [
        { id: "platform", label: "Runtime", value: capabilityReport.platform },
        { id: "adapter", label: "Adapter", value: capabilityReport.adapterId },
        { id: "package", label: "Package", value: capabilityReport.packageFormat },
        { id: "tray", label: "Tray", value: capabilityReport.flags.supportsTray ? "Supported" : "Unsupported" },
        {
          id: "hotkeys",
          label: "Global shortcuts",
          value: capabilityReport.flags.supportsGlobalShortcut ? "Supported" : "Unsupported"
        },
        {
          id: "credentials",
          label: "Credential storage",
          value: capabilityReport.flags.supportsCredentialStorage ? "Supported" : "Blocked"
        },
        {
          id: "updater",
          label: "In-place updater",
          value: capabilityReport.flags.supportsInPlaceAutoUpdate ? "Supported" : "Unsupported"
        }
      ]
    },
    {
      id: "diagnostics",
      title: "Diagnostics",
      status: "Ready",
      detail: "Sanitized local diagnostics",
      rows: [
        { id: "version", label: "Version", value: build?.version ?? snapshot.health?.version ?? "Unknown" },
        { id: "environment", label: "Environment", value: build?.environment ?? snapshot.health?.environment ?? "Unknown" },
        { id: "commit", label: "Build commit", value: build?.commit ?? "Not recorded" },
        { id: "build-date", label: "Build date", value: build?.buildDate ?? "Not recorded" },
        { id: "package-tool", label: "Package tool", value: build?.packageTool ?? "Not recorded" },
        {
          id: "database",
          label: "Database ready",
          value: snapshot.health?.startup.databaseReadyMs === undefined
            ? "Not marked"
            : `${snapshot.health.startup.databaseReadyMs}ms`
        }
      ]
    }
  ];
}

function nativeStateLabel(state: NativeCapabilitiesResponse["trayStatus"]["state"]): string {
  if (state === "ready") {
    return "Ready";
  }

  if (state === "conflict") {
    return "Conflict";
  }

  if (state === "error") {
    return "Error";
  }

  if (state === "unsupported") {
    return "Unsupported";
  }

  if (state === "disabled") {
    return "Disabled";
  }

  return "Pending";
}

function stableTaskViewModel(
  task: TaskSummary,
  listTitle: string | undefined,
  children: TaskSummary[],
  cache: Map<string, { signature: string; viewModel: TaskViewModel }>
): TaskViewModel {
  const fixtureTask = getMockTaskById(task.id);
  const hasFixtureTask = fixtureTask.id === task.id;
  const subtasks = children.length > 0
    ? children.map((child) => ({
        id: child.id,
        title: child.title,
        completed: child.status === "completed"
      }))
    : hasFixtureTask
      ? fixtureTask.subtasks
      : [];
  const viewModel: TaskViewModel = {
    id: task.id,
    listId: task.listId,
    parentId: task.parentId ?? null,
    title: task.title,
    detail: task.notes || (hasFixtureTask ? fixtureTask.detail : "Task cached locally"),
    list: listTitle ?? task.listId,
    dueDate: task.dueAt ? task.dueAt.slice(0, 10) : null,
    dueLabel: task.status === "completed" ? "Done" : dueLabel(task.dueAt),
    updatedAt: task.updatedAt,
    plannedStart: task.plannedStart ?? null,
    plannedEnd: task.plannedEnd ?? null,
    durationMinutes: task.durationMinutes ?? null,
    lockedSchedule: task.lockedSchedule ?? false,
    snoozeUntil: task.snoozeUntil ?? null,
    tags: task.tags ?? [],
    priority: task.priority ?? (hasFixtureTask ? fixtureTask.priority : "none"),
    status: taskStatusViewModel(task.status),
    mutationState: task.mutationState,
    subtasks
  };
  const signature = JSON.stringify(viewModel);
  const cached = cache.get(task.id);

  if (cached?.signature === signature) {
    return cached.viewModel;
  }

  cache.set(task.id, { signature, viewModel });
  return viewModel;
}

function taskStatusViewModel(status: TaskSummary["status"]): TaskViewModel["status"] {
  if (status === "completed" || status === "hidden" || status === "deleted") {
    return status;
  }

  return "open";
}

function optimisticTaskPatch(task: TaskSummary, request: TaskUpdateRequest): TaskSummary {
  return {
    ...task,
    ...(request.title === undefined ? {} : { title: request.title }),
    ...(request.notes === undefined ? {} : { notes: request.notes }),
    ...(request.dueDate === undefined
      ? {}
      : { dueAt: request.dueDate ? `${request.dueDate}T00:00:00.000Z` : null }),
    ...(request.listId === undefined ? {} : { listId: request.listId }),
    ...(request.parentId === undefined ? {} : { parentId: request.parentId }),
    ...(request.priority === undefined ? {} : { priority: request.priority }),
    ...(request.plannedStart === undefined ? {} : { plannedStart: request.plannedStart }),
    ...(request.plannedEnd === undefined ? {} : { plannedEnd: request.plannedEnd }),
    ...(request.durationMinutes === undefined ? {} : { durationMinutes: request.durationMinutes }),
    ...(request.lockedSchedule === undefined ? {} : { lockedSchedule: request.lockedSchedule }),
    ...(request.snoozeUntil === undefined ? {} : { snoozeUntil: request.snoozeUntil }),
    ...(request.tags === undefined ? {} : { tags: request.tags }),
    updatedAt: new Date().toISOString(),
    mutationState: "queued"
  };
}

function optimisticScheduledBlockPatch(
  block: ScheduledTaskBlockSummary,
  request: ScheduledTaskBlockMoveRequest
): ScheduledTaskBlockSummary {
  const startsAt = request.startsAt ?? block.startsAt;
  const durationMinutes = request.durationMinutes ?? block.durationMinutes;

  return {
    ...block,
    ...(request.calendarId === undefined ? {} : { calendarId: request.calendarId }),
    startsAt,
    endsAt: new Date(Date.parse(startsAt) + durationMinutes * 60 * 1000).toISOString(),
    durationMinutes,
    mutationState: "queued" as const,
    updatedAt: new Date().toISOString()
  };
}

function uniqueTasks(tasks: TaskSummary[]): TaskSummary[] {
  return Array.from(new Map(tasks.map((task) => [task.id, task])).values());
}

function calendarEventViewModel(
  event: CalendarEventSummary,
  calendarTitle: string | undefined,
  calendarTimeZone: string | null | undefined,
  defaultTimeZone: string
): CalendarEventViewModel {
  const timeZone = event.timeZone?.trim() || calendarTimeZone?.trim() || defaultTimeZone || "UTC";

  return {
    id: event.id,
    eventId: event.eventId ?? event.id,
    calendarId: event.calendarId,
    title: event.title,
    calendar: calendarTitle ?? event.calendarId,
    timeLabel: event.allDay ? "All day" : timeLabel(event.startsAt, timeZone),
    rangeLabel: event.allDay
      ? allDayRangeLabel(event.startsAt, event.endsAt)
      : `${timeLabel(event.startsAt, timeZone)}-${timeLabel(event.endsAt, timeZone)}`,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    timeZone,
    allDay: event.allDay,
    location: event.location?.trim() || (event.allDay ? "All day" : "Scheduled"),
    notes: event.notes?.trim() || "Calendar cache",
    guestEmails: event.guestEmails ?? [],
    reminderMinutes: event.reminderMinutes ?? [],
    mutationState: event.mutationState,
    recurrenceRule: event.recurrenceRule ?? null
  };
}

function scheduledTaskBlockViewModel(
  block: ScheduledTaskBlockSummary,
  calendarTitle: string | undefined,
  conflictTitles: string[] = []
): ScheduledTaskBlockViewModel {
  return {
    id: block.id,
    taskId: block.taskId,
    calendarEventId: block.calendarEventId,
    calendarId: block.calendarId,
    title: block.title,
    calendar: calendarTitle ?? block.calendarId,
    timeLabel: timeLabel(block.startsAt),
    rangeLabel: `${timeLabel(block.startsAt)}-${timeLabel(block.endsAt)}`,
    startsAt: block.startsAt,
    endsAt: block.endsAt,
    durationMinutes: block.durationMinutes,
    status: block.status,
    mutationState: block.mutationState,
    conflictCount: conflictTitles.length,
    conflictTitles
  };
}

function scheduledTaskBlockConflicts(
  blocks: ScheduledTaskBlockSummary[],
  events: CalendarEventViewModel[],
  scheduledEventIds: Set<string>
): Map<string, string[]> {
  const timedEvents = events.filter(
    (event) =>
      !event.allDay &&
      !scheduledEventIds.has(event.eventId) &&
      !scheduledEventIds.has(event.id)
  );
  const conflicts = new Map<string, string[]>();

  for (const block of blocks) {
    const titles = new Set<string>();

    for (const event of timedEvents) {
      if (dateRangesOverlap(block.startsAt, block.endsAt, event.startsAt, event.endsAt)) {
        titles.add(event.title);
      }
    }

    for (const otherBlock of blocks) {
      if (
        otherBlock.id !== block.id &&
        dateRangesOverlap(block.startsAt, block.endsAt, otherBlock.startsAt, otherBlock.endsAt)
      ) {
        titles.add(otherBlock.title);
      }
    }

    conflicts.set(block.id, Array.from(titles).slice(0, 3));
  }

  return conflicts;
}

function nextUpTimelineItem(
  events: CalendarEventViewModel[],
  blocks: ScheduledTaskBlockViewModel[],
  now: Date
): {
  kind: "event" | "scheduledTaskBlock";
  itemId: string;
  title: string;
  detail: string;
} | null {
  const nowMs = now.getTime();
  const candidates = [
    ...events
      .filter((event) => !event.allDay && Date.parse(event.endsAt) > nowMs)
      .map((event) => ({
        kind: "event" as const,
        itemId: event.id,
        title: event.title,
        detail: `${event.rangeLabel} - ${event.calendar}`,
        startsAt: event.startsAt,
        endsAt: event.endsAt
      })),
    ...blocks
      .filter((block) => Date.parse(block.endsAt) > nowMs)
      .map((block) => ({
        kind: "scheduledTaskBlock" as const,
        itemId: block.id,
        title: block.title,
        detail: `${block.rangeLabel} - ${block.calendar}`,
        startsAt: block.startsAt,
        endsAt: block.endsAt
      }))
  ].sort(compareTimelineRows);

  const [next] = candidates;

  if (!next) {
    return null;
  }

  return {
    kind: next.kind,
    itemId: next.itemId,
    title: next.title,
    detail: next.detail
  };
}

function compareTimelineRows(
  left: { startsAt: string; endsAt: string; itemId: string },
  right: { startsAt: string; endsAt: string; itemId: string }
): number {
  return (
    left.startsAt.localeCompare(right.startsAt) ||
    left.endsAt.localeCompare(right.endsAt) ||
    left.itemId.localeCompare(right.itemId)
  );
}

function dateRangesOverlap(
  leftStart: string,
  leftEnd: string,
  rightStart: string,
  rightEnd: string
): boolean {
  return Date.parse(leftStart) < Date.parse(rightEnd) && Date.parse(leftEnd) > Date.parse(rightStart);
}

function noteViewModel(note: NoteDetail | NoteSummary): NoteViewModel {
  return {
    id: note.id,
    title: note.title,
    body: "body" in note ? note.body : "",
    preview: note.preview,
    updatedLabel: shortDateTime(note.updatedAt)
  };
}

function buildCalendarEventDayIndex(
  events: CalendarEventViewModel[],
  summaries: CalendarEventSummary[]
): CalendarEventDayIndex {
  const eventById = new Map(events.map((event) => [event.id, event]));
  const eventsByDay = new Map<string, CalendarEventViewModel[]>();

  for (const summary of summaries) {
    const event = eventById.get(summary.id);

    if (!event) {
      continue;
    }

    const start = new Date(summary.startsAt);
    const end = new Date(summary.endsAt);

    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
      continue;
    }

    const cursor = startOfUtcDay(start);
    const lastDay = startOfUtcDay(new Date(end.getTime() - 1));

    while (cursor.getTime() <= lastDay.getTime()) {
      const key = dayKey(cursor);
      const dayEvents = eventsByDay.get(key) ?? [];
      dayEvents.push(event);
      eventsByDay.set(key, dayEvents);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }

  for (const dayEvents of eventsByDay.values()) {
    dayEvents.sort(
      (left, right) =>
        left.startsAt.localeCompare(right.startsAt) ||
        left.endsAt.localeCompare(right.endsAt) ||
        left.id.localeCompare(right.id)
    );
  }

  return { eventsByDay };
}

function eventsForDate(index: CalendarEventDayIndex, date: Date): CalendarEventViewModel[] {
  return index.eventsByDay.get(dayKey(date)) ?? [];
}

function dayView(index: CalendarEventDayIndex): CalendarDayViewModel {
  const today = startOfUtcDay(new Date());

  return {
    id: `day-${today.toISOString().slice(0, 10)}`,
    weekday: weekdayLabel(today),
    dateLabel: monthDayLabel(today),
    isToday: true,
    events: eventsForDate(index, today)
  };
}

function weekDays(index: CalendarEventDayIndex): CalendarDayViewModel[] {
  const today = startOfUtcDay(new Date());
  const sunday = new Date(today);
  sunday.setUTCDate(today.getUTCDate() - today.getUTCDay());

  return Array.from({ length: 7 }, (_, dayOffset) => {
    const date = new Date(sunday);
    date.setUTCDate(sunday.getUTCDate() + dayOffset);

    return {
      id: `week-${date.toISOString().slice(0, 10)}`,
      weekday: weekdayLabel(date).slice(0, 3),
      dateLabel: String(date.getUTCDate()),
      isToday: date.getTime() === today.getTime(),
      events: eventsForDate(index, date)
    };
  });
}

function monthWeeks(index: CalendarEventDayIndex): CalendarMonthWeekViewModel[] {
  const today = startOfUtcDay(new Date());
  const first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const gridStart = new Date(first);
  gridStart.setUTCDate(first.getUTCDate() - first.getUTCDay());

  return Array.from({ length: 6 }, (_, weekIndex) => ({
    id: `month-week-${weekIndex}`,
    days: Array.from({ length: 7 }, (_, dayIndex) => {
      const date = new Date(gridStart);
      date.setUTCDate(gridStart.getUTCDate() + weekIndex * 7 + dayIndex);

      return {
        id: `month-${date.toISOString().slice(0, 10)}`,
        weekday: weekdayLabel(date).slice(0, 3),
        dateLabel: String(date.getUTCDate()),
        isToday: date.getTime() === today.getTime(),
        isOutsideMonth: date.getUTCMonth() !== today.getUTCMonth(),
        events: eventsForDate(index, date)
      };
    })
  }));
}

function searchViewModelFromResults(query: string, items: SearchResultItem[]): SearchViewModel {
  if (items.length === 0) {
    return {
      state: "empty",
      summary: "0 results",
      results: []
    };
  }

  return {
    state: "results",
    summary: `${items.length} ${items.length === 1 ? "result" : "results"}`,
    results: items.map((item) => ({
      id: `${item.domain}-${item.id}`,
      source: item.domain === "calendar" ? "event" : item.domain === "tasks" ? "task" : "note",
      title: item.title,
      detail: item.snippet ?? `Matched "${query}"`,
      deepLinkLabel: `hotcrossbuns://${item.domain}/${item.id}`
    }))
  };
}

function idleSearchViewModel(): SearchViewModel {
  return {
    state: "idle",
    summary: "Local cache",
    results: []
  };
}

function emptySearchViewModel(summary: string): SearchViewModel {
  return {
    state: "empty",
    summary,
    results: []
  };
}

function missingTask(taskId: string): TaskViewModel {
  return {
    id: taskId,
    listId: "unknown",
    parentId: null,
    title: "Missing task",
    detail: "The cached task is no longer available.",
    list: "Unknown",
    dueDate: null,
    dueLabel: "Unknown",
    priority: "none",
    status: "open",
    subtasks: []
  };
}

function hasSnapshotData(snapshot: CoreDataSnapshot): boolean {
  return (
    snapshot.taskLists.length > 0 ||
    snapshot.tasks.length > 0 ||
    snapshot.calendars.length > 0 ||
    snapshot.events.length > 0 ||
    snapshot.scheduledTaskBlocks.length > 0 ||
    snapshot.notes.length > 0
  );
}

async function unwrap<T>(result: HcbResult<T>, label: string): Promise<T> {
  if (result.ok) {
    return result.data;
  }

  throw new Error(`${label}: ${result.error.message}`);
}

function visibleCalendarRange(): { start: string; end: string } {
  const start = startOfUtcDay(new Date());
  start.setUTCDate(start.getUTCDate() - 7);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 45);

  return {
    start: start.toISOString(),
    end: end.toISOString()
  };
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addUtcDays(value: Date, days: number): Date {
  const date = new Date(value.getTime());

  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dateOnlyFromLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function dueLabel(value: string | null | undefined): string {
  if (!value) {
    return "No date";
  }

  const due = startOfUtcDay(new Date(value));
  const today = startOfUtcDay(new Date());

  if (due.getTime() === today.getTime()) {
    return "Today";
  }

  return due.toISOString().slice(0, 10);
}

function timeLabel(value: string, timeZone = "UTC"): string {
  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    return "Unknown";
  }

  try {
    return new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      hourCycle: "h23",
      minute: "2-digit",
      timeZone
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      hourCycle: "h23",
      minute: "2-digit",
      timeZone: "UTC"
    }).format(date);
  }
}

function allDayRangeLabel(startsAt: string, endsAt: string): string {
  const start = dateInputValue(startsAt);
  const exclusiveEnd = new Date(endsAt);
  exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() - 1);
  const end = dateInputValue(exclusiveEnd.toISOString());

  return start === end ? "All day" : `${start}-${end}`;
}

function dateInputValue(value: string): string {
  const parsed = new Date(value);

  if (!Number.isFinite(parsed.getTime())) {
    return "";
  }

  return parsed.toISOString().slice(0, 10);
}

function shortDateTime(value: string): string {
  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    return "Unknown";
  }

  return `${date.toISOString().slice(0, 10)} ${timeLabel(value)}`;
}

function weekdayLabel(date: Date): string {
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][
    date.getUTCDay()
  ];
}

function monthDayLabel(date: Date): string {
  return `${date.toLocaleString("en-US", { month: "short", timeZone: "UTC" })} ${date.getUTCDate()}`;
}

function slugId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "cache";
}

function syncLabel(status: SyncStatusResponse): string {
  if (status.state === "running") {
    return "Syncing";
  }

  if (status.state === "error") {
    return "Needs attention";
  }

  if (status.offline) {
    return "Offline";
  }

  if (status.stale) {
    return "Stale";
  }

  return "Ready";
}
