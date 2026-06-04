import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type {
  CalendarEventSummary,
  CalendarRangeRequest,
  CalendarRangeResponse,
  GoogleStatusResponse,
  ScheduledTaskBlockListRequest,
  ScheduledTaskBlockListResponse,
  ScheduledTaskBlockSummary
} from "@shared/ipc/contracts";
import type { CalendarEventViewModel, TaskViewModel } from "../coreViewModels";
import { emptySnapshot } from "./defaults";
import { visibleCalendarRange } from "./dateFormat";
import { loadAllPages, loadCoreData } from "./loader";
import { unwrap } from "./result";
import { useSettingsMutations } from "./settingsMutations";
import { hasSnapshotData } from "./snapshot";
import { buildCoreViewModelSource } from "./sourceBuilder";
import { useTaskMutations } from "./taskMutations";
import type { CalendarRangeLoadRequest, CoreDataLoadState, CoreViewModelSource } from "./types";

const CoreDataContext = createContext<CoreViewModelSource | null>(null);

function normalizedCalendarRange(range: CalendarRangeLoadRequest): CalendarRangeLoadRequest | null {
  const startMs = Date.parse(range.start);
  const endMs = Date.parse(range.end);

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return null;
  }

  return {
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString()
  };
}

function calendarRangeLoaded(
  loadedRanges: readonly CalendarRangeLoadRequest[],
  range: CalendarRangeLoadRequest
): boolean {
  return loadedRanges.some((loadedRange) =>
    loadedRange.start <= range.start && loadedRange.end >= range.end
  );
}

function mergedCalendarRanges(
  ranges: readonly CalendarRangeLoadRequest[]
): CalendarRangeLoadRequest[] {
  const sorted = [...ranges].sort((left, right) => left.start.localeCompare(right.start));
  const merged: CalendarRangeLoadRequest[] = [];

  for (const range of sorted) {
    const previous = merged.at(-1);

    if (!previous || range.start > previous.end) {
      merged.push({ ...range });
      continue;
    }

    if (range.end > previous.end) {
      previous.end = range.end;
    }
  }

  return merged;
}

function mergeById<T extends { id: string }>(current: readonly T[], next: readonly T[]): T[] {
  const merged = new Map(current.map((item) => [item.id, item]));

  for (const item of next) {
    merged.set(item.id, item);
  }

  return [...merged.values()];
}

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

function usePreloadCoreSource(): CoreViewModelSource {
  const [loadState, setLoadState] = useState<CoreDataLoadState>({
    snapshot: emptySnapshot,
    appearanceReady: false,
    state: "loading"
  });
  const cachedDataReported = useRef(false);
  const googleStatusRequested = useRef(false);
  const loadedCalendarRanges = useRef<CalendarRangeLoadRequest[]>([]);
  const pendingCalendarRangeLoads = useRef(new Map<string, Promise<boolean>>());
  const taskViewModelCache = useRef(new Map<string, { signature: string; viewModel: TaskViewModel }>());
  const calendarEventViewModelCache = useRef(
    new Map<string, { signature: string; viewModel: CalendarEventViewModel }>()
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

  const refreshUndoStatus = useCallback(() => {
    void window.hcb?.undo.status().then((result) => {
      if (!result?.ok) {
        return;
      }

      setLoadState((current) => ({
        ...current,
        snapshot: {
          ...current.snapshot,
          undoStatus: result.data
        }
      }));
    });
  }, []);

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

  const load = useCallback(() => {
    if (!window.hcb) {
      setLoadState({
        snapshot: emptySnapshot,
        appearanceReady: true,
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

    const settingsPromise = window.hcb.settings
      .get()
      .then((result) => unwrap(result, "Settings failed"));

    void settingsPromise.then(
      (settings) => {
        setLoadState((current) => ({
          ...current,
          appearanceReady: true,
          snapshot: {
            ...current.snapshot,
            settings
          }
        }));
      },
      () => undefined
    );

    const initialCalendarRange = visibleCalendarRange();

    void loadCoreData(settingsPromise, initialCalendarRange).then(
      (snapshot) => {
        loadedCalendarRanges.current = [initialCalendarRange];
        pendingCalendarRangeLoads.current.clear();
        setLoadState(() => ({
          appearanceReady: true,
          snapshot,
          state: hasSnapshotData(snapshot) ? "ready" : "empty"
        }));
      },
      (error: unknown) => {
        setLoadState((current) => ({
          ...current,
          state: hasSnapshotData(current.snapshot) ? "stale" : "error",
          errorMessage: error instanceof Error ? error.message : "Planner data read failed."
        }));
      }
    );
  }, []);

  const ensureCalendarRange = useCallback((range: CalendarRangeLoadRequest): Promise<boolean> => {
    if (!window.hcb) {
      return Promise.resolve(false);
    }

    const normalized = normalizedCalendarRange(range);

    if (!normalized) {
      return Promise.resolve(false);
    }

    if (calendarRangeLoaded(loadedCalendarRanges.current, normalized)) {
      return Promise.resolve(true);
    }

    const key = `${normalized.start}|${normalized.end}`;
    const pending = pendingCalendarRangeLoads.current.get(key);

    if (pending) {
      return pending;
    }

    const loadPromise = Promise.all([
      loadAllPages<CalendarRangeRequest, CalendarRangeResponse>(
        { start: normalized.start, end: normalized.end, limit: 500 },
        (request) => window.hcb!.calendar
          .listEvents(request)
          .then((result) => unwrap(result, "Calendar events failed"))
      ),
      loadAllPages<ScheduledTaskBlockListRequest, ScheduledTaskBlockListResponse>(
        { start: normalized.start, end: normalized.end, limit: 500 },
        (request) => window.hcb!.calendar
          .listScheduledTaskBlocks(request)
          .then((result) => unwrap(result, "Scheduled task blocks failed"))
      )
    ])
      .then(([events, scheduledTaskBlocks]) => {
        loadedCalendarRanges.current = mergedCalendarRanges([
          ...loadedCalendarRanges.current,
          normalized
        ]);
        setLoadState((current) => ({
          ...current,
          snapshot: {
            ...current.snapshot,
            events: mergeById<CalendarEventSummary>(current.snapshot.events, events.items),
            scheduledTaskBlocks: mergeById<ScheduledTaskBlockSummary>(
              current.snapshot.scheduledTaskBlocks,
              scheduledTaskBlocks.items
            )
          }
        }));
        return true;
      })
      .catch(() => false)
      .finally(() => {
        pendingCalendarRangeLoads.current.delete(key);
      });

    pendingCalendarRangeLoads.current.set(key, loadPromise);
    return loadPromise;
  }, []);

  const {
    taskMutation,
    clearTaskMutationError,
    retryLastTaskMutation,
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
  } = useTaskMutations({
    setLoadState,
    refreshSyncStatus,
    refreshUndoStatus
  });

  const {
    settingsMutation,
    updateSettings,
    runRecoveryAction
  } = useSettingsMutations({
    load,
    refreshDiagnosticsSummary,
    refreshSyncStatus,
    setLoadState
  });

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

  const runUndo = useCallback(async () => {
    const result = await window.hcb?.undo.undo();

    if (!result?.ok) {
      return null;
    }

    load();
    return result.data;
  }, [load]);

  const runRedo = useCallback(async () => {
    const result = await window.hcb?.undo.redo();

    if (!result?.ok) {
      return null;
    }

    load();
    return result.data;
  }, [load]);

  return useMemo(
    () => buildCoreViewModelSource(loadState.snapshot, {
      appearanceReady: loadState.appearanceReady,
      state: loadState.state,
      errorMessage: loadState.errorMessage,
      refresh: load,
      refreshGoogleStatus,
      setGoogleStatus,
      ensureCalendarRange,
      taskViewModelCache: taskViewModelCache.current,
      calendarEventViewModelCache: calendarEventViewModelCache.current,
      taskMutation,
      settingsMutation,
      updateSettings,
      runRecoveryAction,
      undo: runUndo,
      redo: runRedo,
      refreshUndoStatus,
      clearTaskMutationError,
      retryLastTaskMutation,
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
      clearTaskMutationError,
      completeTask,
      createTask,
      createTaskList,
      deleteTask,
      deleteTaskList,
      ensureCalendarRange,
      load,
      loadState,
      moveTask,
      moveScheduledTaskBlock,
      refreshGoogleStatus,
      refreshUndoStatus,
      renameTaskList,
      retryLastTaskMutation,
      runRedo,
      runRecoveryAction,
      runUndo,
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
