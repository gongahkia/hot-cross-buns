import { beginSyncProgress } from "../../shell/syncProgress";
import { useCallback, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type {
  SettingsRecoveryActionRequest,
  SettingsRecoveryActionResponse,
  SettingsUpdateRequest
} from "@shared/ipc/contracts";
import { loadAllPages } from "./loader";
import { unwrap } from "./result";
import type { CoreDataLoadState, SettingsMutationUiState } from "./types";

interface UseSettingsMutationsOptions {
  load: () => void;
  refreshDiagnosticsSummary: () => void;
  refreshSyncStatus: () => void;
  setLoadState: Dispatch<SetStateAction<CoreDataLoadState>>;
}

export function useSettingsMutations({
  load,
  refreshDiagnosticsSummary,
  refreshSyncStatus,
  setLoadState
}: UseSettingsMutationsOptions): {
  settingsMutation: SettingsMutationUiState;
  updateSettings: (request: SettingsUpdateRequest) => Promise<boolean>;
  runRecoveryAction: (
    request: SettingsRecoveryActionRequest
  ) => Promise<SettingsRecoveryActionResponse | null>;
} {
  const [settingsMutation, setSettingsMutation] = useState<SettingsMutationUiState>({
    pending: false
  });

  const settingsQueue = useRef<Promise<unknown>>(Promise.resolve());
  const performSettingsUpdate = useCallback(
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
        const [nativeResult, taskLists] = await Promise.all([
          window.hcb.native.capabilities(),
          request.starredTaskIds === undefined ? Promise.resolve(null) : loadAllPages({ limit: 1000, cursor: undefined as string | undefined },
            (page) => window.hcb!.tasks.listTaskLists(page).then((result) => unwrap(result, "Task list counts failed"))).catch(() => null)
        ]);
        setLoadState((current) => ({
          ...current,
          snapshot: {
            ...current.snapshot,
            settings: result.data,
            ...(taskLists ? { taskLists: taskLists.items } : {}),
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
    [refreshDiagnosticsSummary, setLoadState]
  );

  const updateSettings = useCallback((request: SettingsUpdateRequest): Promise<boolean> => {
    const pending = settingsQueue.current.then(() => performSettingsUpdate(request), () => performSettingsUpdate(request));
    settingsQueue.current = pending;
    return pending;
  }, [performSettingsUpdate]);

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
      const finishProgress = request.action === "forceFullResync" ? beginSyncProgress() : undefined;
      let progressError: string | undefined;
      try {
        const result = await window.hcb.settings.recoveryAction(request);

        if (result.ok) {
          const [settingsResult, nativeResult] = await Promise.all([
            window.hcb.settings.get(),
            window.hcb.native.capabilities()
          ]);
          setLoadState((current) => ({
            ...current,
            snapshot: {
              ...current.snapshot,
              ...(settingsResult.ok ? { settings: settingsResult.data } : {}),
              ...(nativeResult.ok ? { native: nativeResult.data } : {})
            }
          }));
          setSettingsMutation({ pending: false });
          refreshSyncStatus();
          refreshDiagnosticsSummary();
          if (
            request.action === "refresh" ||
            request.action === "restoreLocalNotes" ||
            request.action === "clearGoogleCache" ||
            request.action === "forceFullResync" ||
            request.action === "resetOnboarding"
          ) {
            load();
          }
          return result.data;
        }

        progressError = result.error.message;
        setSettingsMutation({
          pending: false,
          error: result.error.message
        });
        return null;
      } catch (error) {
        progressError = error instanceof Error ? error.message : "Resync could not complete.";
        setSettingsMutation({ pending: false, error: progressError });
        return null;
      } finally { finishProgress?.(progressError); }

    },
    [load, refreshDiagnosticsSummary, refreshSyncStatus, setLoadState]
  );

  return {
    settingsMutation,
    updateSettings,
    runRecoveryAction
  };
}
