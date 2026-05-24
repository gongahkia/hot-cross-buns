import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { GoogleStatusResponse } from "@shared/ipc/contracts";
import type { CalendarEventViewModel, TaskViewModel } from "../coreViewModels";
import { emptySnapshot } from "./defaults";
import { loadCoreData } from "./loader";
import { unwrap } from "./result";
import { useSettingsMutations } from "./settingsMutations";
import { hasSnapshotData } from "./snapshot";
import { buildCoreViewModelSource } from "./sourceBuilder";
import { useTaskMutations } from "./taskMutations";
import type { CoreDataLoadState, CoreViewModelSource } from "./types";

const CoreDataContext = createContext<CoreViewModelSource | null>(null);

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

    void loadCoreData(settingsPromise).then(
      (snapshot) => {
        setLoadState((current) => ({
          appearanceReady: true,
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
    refreshSyncStatus
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

  return useMemo(
    () => buildCoreViewModelSource(loadState.snapshot, {
      appearanceReady: loadState.appearanceReady,
      state: loadState.state,
      errorMessage: loadState.errorMessage,
      refresh: load,
      refreshGoogleStatus,
      setGoogleStatus,
      taskViewModelCache: taskViewModelCache.current,
      calendarEventViewModelCache: calendarEventViewModelCache.current,
      taskMutation,
      settingsMutation,
      updateSettings,
      runRecoveryAction,
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
      load,
      loadState,
      moveTask,
      moveScheduledTaskBlock,
      refreshGoogleStatus,
      renameTaskList,
      retryLastTaskMutation,
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
