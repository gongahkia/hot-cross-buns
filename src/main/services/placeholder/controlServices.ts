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
        hasClientSecret: false,
        accounts: []
      }),
      saveOAuthClient: () => ({
        oauthClientConfigured: false,
        clientId: null,
        hasClientSecret: false,
        accounts: []
      }),
      beginOAuth: () => {
        throw new Error("Google OAuth is unavailable in placeholder services.");
      },
      disconnect: () => ({
        oauthClientConfigured: false,
        clientId: null,
        hasClientSecret: false,
        accounts: []
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
      exportHcbVault: (request) => ({
        path: request.out ?? "",
        exportedAt: new Date().toISOString(),
        manifest: {}
      }) as never,
      importHcbVault: () => ({
        importedAt: new Date().toISOString(),
        backupPath: "",
        manifest: {}
      }) as never,
      hcbVaultRemoteStatus: () => ({
        endpoint: "",
        remote: {}
      }) as never,
      pushHcbVaultRemote: () => ({
        endpoint: "",
        exportedAt: new Date().toISOString(),
        path: "",
        manifest: {},
        remote: {}
      }) as never,
      pullHcbVaultRemote: () => ({
        endpoint: "",
        importedAt: new Date().toISOString(),
        backupPath: "",
        manifest: {},
        remote: {}
      }) as never,
      hcbVaultRemoteCredentialStatus: () => ({
        endpoint: null,
        configured: false,
        secretStore: {
          ok: false,
          state: "unsupported",
          message: "Placeholder credential storage is unavailable."
        }
      }),
      saveHcbVaultRemoteCredentials: () => ({
        endpoint: null,
        configured: false,
        secretStore: {
          ok: false,
          state: "unsupported",
          message: "Placeholder credential storage is unavailable."
        }
      }),
      deleteHcbVaultRemoteCredentials: () => ({
        endpoint: null,
        configured: false,
        secretStore: {
          ok: false,
          state: "unsupported",
          message: "Placeholder credential storage is unavailable."
        }
      }),
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
          stateFile: "hot-cross-buns-state.json" as const,
          stateSha256: "0".repeat(64),
          attachmentDirectory: "Attachments" as const,
          attachments: [],
          skippedPointers: [],
          notes: ["Placeholder portable archive."]
        };

        return {
          path: "/tmp/hot-cross-buns-placeholder.hcbexport",
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
        attachments: { bundled: 0, missing: 0, corrupt: 0, skipped: 0 },
        items: { tasks: [], events: [], calendars: [], taskLists: [] }
      }),
      importPortableArchive: (request) => ({
        importedAt: new Date().toISOString(),
        backupPath: "/tmp/hot-cross-buns-placeholder-backup.sqlite3",
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
          attachments: { bundled: 0, missing: 0, corrupt: 0, skipped: 0 },
          items: { tasks: [], events: [], calendars: [], taskLists: [] }
        }
      }),
      listLocalPointers: () => ({ items: [], totalKnown: 0 }),
      repairLocalPointer: (request) => ({
        pointer: request.pointer,
        replacementPointer: request.replacementPath,
        updated: 0,
        queued: false,
        revision: new Date().toISOString()
      }),
      customizationStatus: () => placeholderCustomizationStatus(),
      reloadCustomization: () => placeholderCustomizationStatus(),
      setSnippetEnabled: () => placeholderCustomizationStatus(),
      setExtensionEnabled: () => placeholderCustomizationStatus(),
      logExtensionMessage: () => placeholderCustomizationStatus(),
      listAttachments: () => ({ items: [] }),
      addAttachment: () => ({ items: [], queued: false, revision: new Date().toISOString() }),
      removeAttachment: () => ({ items: [], queued: false, revision: new Date().toISOString() }),
      openAttachment: (request) => ({ path: request.pointer, message: "Placeholder attachment open." }),
      downloadAttachment: (request) => ({ path: request.pointer, message: "Placeholder attachment download." }),
      importIcs: (request) => ({
        calendarId: "placeholder:ics",
        calendarTitle: request.calendarTitle ?? request.fileName,
        importedEventCount: 0,
        skippedEventCount: 0,
        revision: new Date().toISOString()
      }),
      listIcsSubscriptions: () => ({ items: [] }),
      subscribeIcs: () => ({ items: [] }),
      refreshIcsSubscription: () => ({ items: [] }),
      deleteIcsSubscription: () => ({ items: [] }),
      exportLocalReport: (request) => ({
        path: "/tmp/hot-cross-buns-placeholder-report.txt",
        format: request.format ?? "markdown",
        generatedAt: new Date().toISOString(),
        itemCount: 0
      })
    },
    searchModels: {
      listModels: () => ({
        models: state.settings.semanticSearchModels,
        selectedModelId: state.settings.embeddingModelId,
        enabled: state.settings.semanticSearchEnabled
      }),
      installModel: (request) => {
        const now = new Date().toISOString();
        state.settings = {
          ...state.settings,
          semanticSearchEnabled: true,
          embeddingModelId: request.modelId,
          semanticSearchModels: state.settings.semanticSearchModels.map((model) =>
            model.id === request.modelId
              ? { ...model, installed: true, installState: "installed", lastError: null, updatedAt: now }
              : model
          )
        };
        const model = state.settings.semanticSearchModels.find((candidate) => candidate.id === request.modelId);

        if (!model) {
          throw new Error("Unknown semantic model.");
        }

        return {
          model,
          selectedModelId: state.settings.embeddingModelId,
          enabled: state.settings.semanticSearchEnabled
        };
      },
      uninstallModel: (request) => {
        const now = new Date().toISOString();
        state.settings = {
          ...state.settings,
          semanticSearchEnabled: false,
          embeddingModelId: "hcb-local-hash-384",
          semanticSearchModels: state.settings.semanticSearchModels.map((model) =>
            model.id === request.modelId
              ? { ...model, installed: false, installState: "not-installed", cachePath: null, lastError: null, updatedAt: now }
              : model
          )
        };
        const model = state.settings.semanticSearchModels.find((candidate) => candidate.id === request.modelId);

        if (!model) {
          throw new Error("Unknown semantic model.");
        }

        return {
          model,
          selectedModelId: state.settings.embeddingModelId,
          enabled: state.settings.semanticSearchEnabled
        };
      },
      rebuildIndex: (request) => ({
        modelId: request.modelId ?? state.settings.embeddingModelId,
        indexedCount: 0,
        staleCount: 0
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
    },
    hosters: {
      status: () => ({
        enabled: state.settings.localHostersEnabled,
        running: false,
        port: state.settings.localHosterPort,
        profiles: []
      }),
      create: (request) => ({
        id: "hoster:placeholder",
        profile: {
          id: "hoster:placeholder",
          name: request.name,
          capabilities: request.capabilities ?? ["host.info", "signal.send", "planner.read"],
          permissionMode: request.permissionMode ?? "confirm-writes",
          endpoint: "http://127.0.0.1:0/hcb/v1/signal",
          keyFingerprint: "0".repeat(64),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        message: "Local hoster profile created."
      }),
      export: (request) => ({
        id: request.id,
        path: request.out,
        message: `Local hoster exported to ${request.out}.`
      }),
      import: (request) => ({
        id: "hoster:placeholder",
        path: request.path,
        message: "Local hoster imported."
      }),
      remove: (request) => ({
        id: request.id,
        message: "Local hoster removed."
      }),
      test: (request) => ({
        id: request.id ?? "hoster:placeholder",
        message: "Local hoster signal encryption round-trip passed."
      })
    },
    agent: {
      listActions: (request) => ({
        items: [],
        page: { limit: request.limit ?? 50, totalKnown: 0 }
      }),
      applyAction: () => {
        throw new Error("Agent action was not found.");
      },
      rejectAction: () => {
        throw new Error("Agent action was not found.");
      },
      clearExpired: () => ({ cleared: 0 })
    },
    webhooks: {
      list: (request) => ({
        items: [],
        page: { limit: request.limit ?? 50, totalKnown: 0 }
      }),
      upsert: (request) => ({
        id: request.id ?? "webhook:placeholder",
        queued: false,
        revision: new Date().toISOString(),
        subscription: {
          id: request.id ?? "webhook:placeholder",
          url: request.url,
          events: request.events,
          enabled: request.enabled,
          includePrivateBodies: request.includePrivateBodies ?? false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lastDeliveryAt: null,
          lastError: null
        }
      }),
      delete: (request) => ({ id: request.id, queued: false, revision: new Date().toISOString() }),
      test: (request) => ({ id: request.id, queued: false, revision: new Date().toISOString() }),
      emit: () => undefined,
      drainDue: () => undefined
    }
  };
}

function placeholderCustomizationStatus() {
  return {
    configDirectory: "/tmp/hot-cross-buns",
    snippetsDirectory: "/tmp/hot-cross-buns/snippets",
    extensionsDirectory: "/tmp/hot-cross-buns/extensions",
    settingsJsonPath: "/tmp/hot-cross-buns/settings.json",
    keymapJsonPath: "/tmp/hot-cross-buns/keymap.json",
    snippets: [],
    externalSettings: {
      path: "/tmp/hot-cross-buns/settings.json",
      exists: false,
      valid: true,
      appliedKeys: [],
      conflicts: [],
      error: null
    },
    externalKeymap: {
      path: "/tmp/hot-cross-buns/keymap.json",
      exists: false,
      valid: true,
      appliedKeys: [],
      conflicts: [],
      error: null
    },
    extensions: [],
    safeMode: false
  };
}
