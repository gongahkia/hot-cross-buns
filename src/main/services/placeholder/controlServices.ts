import type {
  GoogleStatusResponse,
  SyncRunNowResponse
} from "@shared/ipc/contracts";
import type { AppDomainServices } from "../domainInterfaces";
import type { PlaceholderState } from "./state";
import {
  definedSettingsPatch,
  recoveryMessage,
  recoveryPhrase
} from "./utils";

type PlaceholderControlServices = Omit<AppDomainServices, "planner" | "native" | "mcpTools">;

export function createPlaceholderControlServices(
  state: PlaceholderState
): PlaceholderControlServices {
  return {
    sync: {
      status: () => ({ ...state.sync }),
      runNow: (request) => {
        const drainOnly = request.drainOnly ?? false;
        const resources = drainOnly
          ? []
          : [...new Set(request.resources ?? ["tasks", "calendar"])] as Array<
              "tasks" | "calendar"
            >;

        if (!request.dryRun) {
          state.sync = {
            state: "idle",
            pendingMutationCount: 0,
            lastCompletedAt: new Date().toISOString()
          };
        }

        return {
          accepted: true,
          dryRun: request.dryRun ?? false,
          drainOnly,
          resources
        } satisfies SyncRunNowResponse;
      }
    },
    google: {
      status: (): GoogleStatusResponse => ({
        oauthClientConfigured: false,
        clientId: null,
        hasClientSecret: false
      }),
      saveOAuthClient: () => ({
        oauthClientConfigured: false,
        clientId: null,
        hasClientSecret: false
      }),
      beginOAuth: () => {
        throw new Error("Google OAuth is unavailable in placeholder services.");
      },
      disconnect: () => ({
        oauthClientConfigured: false,
        clientId: null,
        hasClientSecret: false
      })
    },
    settings: {
      get: () => ({ ...state.settings }),
      update: (request) => {
        state.settings = {
          ...state.settings,
          ...definedSettingsPatch(request)
        };

        if (request.mcpEnabled !== undefined) {
          state.mcp = {
            ...state.mcp,
            enabled: request.mcpEnabled
          };
        }

        if (request.mcpPermissionMode !== undefined) {
          state.mcp = {
            ...state.mcp,
            permissionMode: request.mcpPermissionMode,
            readOnly: request.mcpPermissionMode === "read-only",
            confirmationRequired: request.mcpPermissionMode !== "allow-writes"
          };
        }

        if (request.mcpPort !== undefined) {
          state.mcp = {
            ...state.mcp,
            port: request.mcpPort
          };
        }

        return { ...state.settings };
      },
      recoveryAction: (request) => {
        if (request.action !== "refresh" && request.action !== "resetOnboarding") {
          const phrase = recoveryPhrase(request.action);

          if (
            request.confirmation?.accepted !== true ||
            request.confirmation.phrase !== phrase
          ) {
            throw new Error(`Type ${phrase} to confirm this destructive recovery action.`);
          }
        }

        if (request.action === "resetMcpToken") {
          state.mcp = {
            ...state.mcp,
            tokenState: "rotated",
            lastTokenResetAt: new Date().toISOString()
          };
        }

        if (request.action === "resetOnboarding") {
          state.settings = {
            ...state.settings,
            setupCompletedAt: null
          };
        }

        return {
          action: request.action,
          accepted: true,
          destructive: request.action !== "refresh" && request.action !== "resetOnboarding",
          requiresReload: request.action === "clearGoogleCache",
          message: recoveryMessage(request.action)
        };
      },
      exportPortableArchive: () => {
        const exportedAt = new Date().toISOString();
        const manifest = {
          formatVersion: 1 as const,
          exportedAt,
          appVersion: "0.0.0",
          stateFile: "hot-cross-buns-2-state.json" as const,
          stateSha256: "0".repeat(64),
          attachmentDirectory: "Attachments" as const,
          attachments: [],
          skippedPointers: [],
          notes: ["Placeholder portable archive."]
        };

        return {
          path: "/tmp/hot-cross-buns-2-placeholder.hcbexport",
          exportedAt,
          manifest
        };
      },
      previewPortableImport: (request) => ({
        path: request.path,
        exportedAt: new Date().toISOString(),
        formatVersion: 1 as const,
        destructive: true as const,
        tasks: { added: 0, removed: 0, changed: 0 },
        events: { added: 0, removed: 0, changed: 0 },
        calendars: { added: 0, removed: 0, changed: 0 },
        taskLists: { added: 0, removed: 0, changed: 0 },
        settingsWillChange: false,
        queuedMutationCount: 0,
        attachments: { bundled: 0, missing: 0, corrupt: 0, skipped: 0 }
      }),
      importPortableArchive: (request) => ({
        importedAt: new Date().toISOString(),
        backupPath: "/tmp/hot-cross-buns-2-placeholder-backup.sqlite3",
        preview: {
          path: request.path,
          exportedAt: new Date().toISOString(),
          formatVersion: 1 as const,
          destructive: true as const,
          tasks: { added: 0, removed: 0, changed: 0 },
          events: { added: 0, removed: 0, changed: 0 },
          calendars: { added: 0, removed: 0, changed: 0 },
          taskLists: { added: 0, removed: 0, changed: 0 },
          settingsWillChange: false,
          queuedMutationCount: 0,
          attachments: { bundled: 0, missing: 0, corrupt: 0, skipped: 0 }
        }
      })
    },
    undo: {
      status: () => ({
        canUndo: false,
        canRedo: false
      }),
      undo: () => ({
        action: "undo",
        applied: false
      }),
      redo: () => ({
        action: "redo",
        applied: false
      })
    },
    mcp: {
      status: () => ({ ...state.mcp }),
      setEnabled: (request) => {
        const permissionMode =
          request.permissionMode ??
          (request.confirmationRequired === false ? "allow-writes" : state.mcp.permissionMode);
        state.mcp = {
          ...state.mcp,
          enabled: request.enabled,
          permissionMode,
          readOnly: permissionMode === "read-only",
          confirmationRequired:
            request.confirmationRequired ?? permissionMode !== "allow-writes",
          port: request.port ?? state.mcp.port
        };
        state.settings = {
          ...state.settings,
          mcpEnabled: request.enabled,
          mcpPermissionMode: permissionMode,
          mcpPort: request.port ?? state.settings.mcpPort
        };

        return { ...state.mcp };
      }
    }
  };
}
