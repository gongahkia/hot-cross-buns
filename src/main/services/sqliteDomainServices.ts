import type {
  AvailabilityExportRequest,
  CalendarListRequest,
  CalendarRangeRequest,
  CalendarScheduleSuggestRequest,
  EntityByIdRequest,
  GoogleBeginOAuthResponse,
  GoogleDisconnectRequest,
  GoogleSaveOAuthClientRequest,
  GoogleStatusResponse,
  McpSetEnabledRequest,
  McpStatusResponse,
  NativeCapabilitiesResponse,
  NativeNotificationPermissionResponse,
  NoteCreateRequest,
  NoteDeleteRequest,
  NoteUpdateRequest,
  SearchQueryRequest,
  ScheduledTaskBlockCreateRequest,
  ScheduledTaskBlockListRequest,
  ScheduledTaskBlockMoveRequest,
  ScheduledTaskBlockUnscheduleRequest,
  SettingsRecoveryActionRequest,
  SettingsSnapshot,
  SettingsUpdateRequest,
  SyncRunNowRequest,
  SyncRunNowResponse,
  SyncStatusResponse,
  TaskCompletionRequest,
  TaskCreateRequest,
  TaskDeleteRequest,
  TaskListCreateRequest,
  TaskListDeleteRequest,
  TaskListRenameRequest,
  TaskListsRequest,
  TaskListRequest,
  TaskMoveRequest,
  TaskPriority,
  TaskUpdateRequest
} from "@shared/ipc/contracts";
import { HcbPublicError } from "@shared/ipc/result";
import type {
  GoogleAccountConnectionStatusDto,
  GoogleCalendarWriteTransport,
  GoogleCalendarReadTransport,
  GoogleTasksReadTransport,
  GoogleTasksWriteTransport
} from "../google";
import { GooglePendingMutationWorker } from "../sync/mutationWorker";
import type {
  LocalHistoryRepository,
  LocalPlannerRepository,
  LocalSettingsRepository
} from "../data/localRepositories";
import { appLogger } from "../diagnostics/appLogger";
import { GoogleReadSyncService } from "../sync/readSyncService";
import type { GoogleSyncRepository } from "../sync/readSyncRepository";
import type { ReadSyncResource } from "../sync/types";
import {
  buildNativeCapabilityReport,
  capabilityDiagnostic,
  defaultNativeAppPaths,
  nativePlatform as detectNativePlatform
} from "../native/capabilityReport";
import type {
  AppDomainServices,
  DomainJsonObject,
  DomainJsonValue,
  McpDomainServices,
  SyncControlDomainService
} from "./domainInterfaces";
import { buildDaySchedule } from "./schedulingSuggestionService";

export interface SqliteDomainServiceOptions {
  plannerRepository: LocalPlannerRepository;
  settingsRepository: LocalSettingsRepository;
  syncRepository: GoogleSyncRepository;
  historyRepository?: LocalHistoryRepository;
  syncTasksTransport?: GoogleTasksReadTransport;
  syncCalendarTransport?: GoogleCalendarReadTransport;
  syncTasksWriteTransport?: GoogleTasksWriteTransport;
  syncCalendarWriteTransport?: GoogleCalendarWriteTransport;
}

type SyncStatusListener = (status: SyncStatusResponse) => void;

const noopTasksTransport: GoogleTasksReadTransport = {
  listTaskLists: async () => [],
  listTasks: async () => ({ tasks: [], serverDate: new Date().toISOString() })
};

const noopCalendarTransport: GoogleCalendarReadTransport = {
  listCalendarLists: async () => [],
  listEvents: async () => ({ events: [], nextSyncToken: null })
};

export function createSqliteDomainServices(
  options: SqliteDomainServiceOptions
): AppDomainServices {
  const mutationWorker =
    options.syncTasksWriteTransport && options.syncCalendarWriteTransport
      ? new GooglePendingMutationWorker({
          repository: options.syncRepository,
          tasks: options.syncTasksWriteTransport,
          calendar: options.syncCalendarWriteTransport
        })
      : undefined;
  const sync = new LocalSyncControlService({
    repository: options.syncRepository,
    settingsRepository: options.settingsRepository,
    historyRepository: options.historyRepository,
    tasksTransport: options.syncTasksTransport ?? noopTasksTransport,
    calendarTransport: options.syncCalendarTransport ?? noopCalendarTransport,
    mutationWorker
  });
  const initialSettings = options.settingsRepository.get();
  const initialMcpTokenState = options.settingsRepository.mcpTokenState();
  const mcpState: McpStatusResponse = {
    enabled: initialSettings.mcpEnabled,
    running: false,
    readOnly: initialSettings.mcpPermissionMode === "read-only",
    confirmationRequired: initialSettings.mcpPermissionMode !== "allow-writes",
    permissionMode: initialSettings.mcpPermissionMode,
    port: initialSettings.mcpPort,
    tokenState: initialMcpTokenState.tokenState,
    ...(initialMcpTokenState.lastTokenResetAt === undefined
      ? {}
      : { lastTokenResetAt: initialMcpTokenState.lastTokenResetAt }),
    url: "http://127.0.0.1"
  };
  const mcpTools = createMcpDomainServices(options.plannerRepository);

  return {
    planner: {
      listTaskLists: (request: TaskListsRequest) =>
        options.plannerRepository.listTaskLists(request),
      listTasks: (request: TaskListRequest) => options.plannerRepository.listTasks(request),
      getTask: (request: EntityByIdRequest) => options.plannerRepository.getTask(request.id),
      createTask: (request) => options.plannerRepository.createTask(request),
      updateTask: (request) => options.plannerRepository.updateTask(request),
      completeTask: (request) => options.plannerRepository.completeTask(request),
      reopenTask: (request) => options.plannerRepository.reopenTask(request),
      moveTask: (request) => options.plannerRepository.moveTask(request),
      deleteTask: (request) => options.plannerRepository.deleteTask(request),
      createTaskList: (request) => options.plannerRepository.createTaskList(request),
      renameTaskList: (request) => options.plannerRepository.renameTaskList(request),
      deleteTaskList: (request) => options.plannerRepository.deleteTaskList(request),
      listCalendars: (request: CalendarListRequest) =>
        options.plannerRepository.listCalendars(request),
      listCalendarEvents: (request: CalendarRangeRequest) =>
        options.plannerRepository.listCalendarEvents(request),
      getCalendarEvent: (request: EntityByIdRequest) =>
        options.plannerRepository.getCalendarEvent(request.id),
      createCalendarEvent: (request) => options.plannerRepository.createCalendarEvent(request),
      updateCalendarEvent: (request) => options.plannerRepository.updateCalendarEvent(request),
      deleteCalendarEvent: (request) => options.plannerRepository.deleteCalendarEvent(request),
      listScheduledTaskBlocks: (request: ScheduledTaskBlockListRequest) =>
        options.plannerRepository.listScheduledTaskBlocks(request),
      scheduleTaskBlock: (request: ScheduledTaskBlockCreateRequest) =>
        options.plannerRepository.scheduleTaskBlock(request),
      moveScheduledTaskBlock: (request: ScheduledTaskBlockMoveRequest) =>
        options.plannerRepository.moveScheduledTaskBlock(request),
      unscheduleTaskBlock: (request: ScheduledTaskBlockUnscheduleRequest) =>
        options.plannerRepository.unscheduleTaskBlock(request),
      scheduleSuggest: (request: CalendarScheduleSuggestRequest) => {
        const start = `${request.date}T00:00:00.000Z`;
        const end = new Date(Date.parse(start) + 24 * 60 * 60 * 1000).toISOString();
        const events = options.plannerRepository.listCalendarEvents({
          start,
          end,
          limit: 500
        }).items;
        const tasks = options.plannerRepository.listTasks({
          status: "active",
          limit: 100
        }).items;

        return buildDaySchedule({
          date: request.date,
          events,
          tasks,
          capacityMinutes: request.capacityMinutes ?? 480,
          workingHours: {
            start: request.workingHours?.start ?? 6,
            end: request.workingHours?.end ?? 22
          }
        });
      },
      exportAvailability: (request: AvailabilityExportRequest) =>
        options.plannerRepository.exportAvailability(request),
      listNotes: (request) => options.plannerRepository.listNotes(request),
      getNote: (request) => options.plannerRepository.getNote(request.id),
      createNote: (request: NoteCreateRequest) => options.plannerRepository.createNote(request),
      updateNote: (request: NoteUpdateRequest) => options.plannerRepository.updateNote(request),
      deleteNote: (request: NoteDeleteRequest) => options.plannerRepository.deleteNote(request),
      suggestNoteLinks: (request) => options.plannerRepository.suggestLinkTargets(request),
      listBrokenNoteLinks: (request) => options.plannerRepository.listBrokenNoteLinks(request),
      search: (request: SearchQueryRequest) => options.plannerRepository.search(request)
    },
    sync,
    google: {
      status: (): GoogleStatusResponse => ({
        oauthClientConfigured: false,
        clientId: null,
        hasClientSecret: false,
        ...(options.syncRepository.latestAccountStatus() === null
          ? {}
          : { account: options.syncRepository.latestAccountStatus() as NonNullable<GoogleStatusResponse["account"]> })
      }),
      saveOAuthClient: (_request: GoogleSaveOAuthClientRequest): GoogleStatusResponse => {
        throw new HcbPublicError({
          code: "SERVICE_UNAVAILABLE",
          message: "Google OAuth runtime wiring is unavailable in this domain service.",
          recoverable: true
        });
      },
      beginOAuth: (): GoogleBeginOAuthResponse => {
        throw new HcbPublicError({
          code: "SERVICE_UNAVAILABLE",
          message: "Google OAuth browser handoff is unavailable in this domain service.",
          recoverable: true
        });
      },
      disconnect: (_request: GoogleDisconnectRequest): GoogleStatusResponse => {
        throw new HcbPublicError({
          code: "SERVICE_UNAVAILABLE",
          message: "Google OAuth disconnect is unavailable in this domain service.",
          recoverable: true
        });
      }
    },
    settings: {
      get: () => options.settingsRepository.get(),
      update: (request: SettingsUpdateRequest) => {
        const snapshot = options.settingsRepository.update(request);

        if (
          request.mcpEnabled !== undefined ||
          request.mcpPermissionMode !== undefined ||
          request.mcpPort !== undefined
        ) {
          applyMcpSettings(mcpState, snapshot);
        }

        return snapshot;
      },
      recoveryAction: async (request: SettingsRecoveryActionRequest) => {
        if (request.action === "refresh") {
          await sync.runNow({ resources: ["tasks", "calendar"], dryRun: false, full: false });
          return {
            action: request.action,
            accepted: true,
            destructive: false,
            requiresReload: false,
            message: "Refresh requested for selected Google resources."
          };
        }

        if (request.action === "forceFullResync") {
          requireRecoveryConfirmation(request, "FULL RESYNC");
          options.syncRepository.clearAllCheckpoints();
          await sync.runNow({ resources: ["tasks", "calendar"], dryRun: false, full: true });
          return {
            action: request.action,
            accepted: true,
            destructive: true,
            requiresReload: false,
            message: "Sync checkpoints were cleared and a full resync was requested."
          };
        }

        if (request.action === "clearGoogleCache") {
          requireRecoveryConfirmation(request, "CLEAR CACHE");
          options.syncRepository.clearLocalGoogleCache();
          return {
            action: request.action,
            accepted: true,
            destructive: true,
            requiresReload: true,
            message: "Local Google cache was cleared. Reload to render the empty cache before the next sync."
          };
        }

        if (request.action === "resetOnboarding") {
          options.settingsRepository.update({ setupCompletedAt: null });
          return {
            action: request.action,
            accepted: true,
            destructive: false,
            requiresReload: false,
            message: "Onboarding will be shown again without changing planner data."
          };
        }

        if (request.action === "backupNow") {
          const backup = options.settingsRepository.createLocalBackup();
          return {
            action: request.action,
            accepted: true,
            destructive: false,
            requiresReload: false,
            message: `Local backup created at ${backup.path}.`
          };
        }

        if (request.action === "exportPortableArchive") {
          const archive = options.settingsRepository.exportPortableArchive();
          return {
            action: request.action,
            accepted: true,
            destructive: false,
            requiresReload: false,
            message: `Portable archive exported to ${archive.path}.`
          };
        }

        if (request.action === "resetDuplicateDismissals") {
          options.settingsRepository.update({ dismissedDuplicateGroupIds: [] });
          return {
            action: request.action,
            accepted: true,
            destructive: false,
            requiresReload: false,
            message: "Duplicate dismissal history was reset."
          };
        }

        if (request.action === "checkForUpdates") {
          options.settingsRepository.update({ lastUpdateCheckAt: new Date().toISOString() });
          return {
            action: request.action,
            accepted: true,
            destructive: false,
            requiresReload: false,
            message: "Update check timestamp refreshed. GitHub release checks remain handled by the native updater status."
          };
        }

        requireRecoveryConfirmation(request, "RESET MCP TOKEN");
        const reset = options.settingsRepository.resetMcpTokenRevision();
        mcpState.tokenState = reset.tokenState;
        mcpState.lastTokenResetAt = reset.resetAt;

        return {
          action: request.action,
          accepted: true,
          destructive: true,
          requiresReload: false,
          message: "MCP bearer token was reset without exposing the new token value."
        };
      }
    },
    mcp: {
      status: () => ({ ...mcpState }),
      setEnabled: (request: McpSetEnabledRequest) => {
        const permissionMode =
          request.permissionMode ??
          (request.confirmationRequired === false
            ? "allow-writes"
            : mcpState.permissionMode);
        const snapshot = options.settingsRepository.update({
          mcpEnabled: request.enabled,
          mcpPermissionMode: permissionMode,
          ...(request.port === undefined ? {} : { mcpPort: request.port })
        });
        applyMcpSettings(mcpState, snapshot);

        return { ...mcpState };
      }
    },
    native: {
      capabilities: () => nativeCapabilities(),
      requestNotificationPermission: () => nativeNotificationPermission(),
      listFontFamilies: () => ({
        platform: detectNativePlatform(),
        families: []
      })
    },
    mcpTools
  };
}

class LocalSyncControlService implements SyncControlDomainService {
  private readonly repository: GoogleSyncRepository;
  private readonly settingsRepository: LocalSettingsRepository;
  private readonly historyRepository: LocalHistoryRepository | undefined;
  private readonly readSync: GoogleReadSyncService;
  private readonly mutationWorker: GooglePendingMutationWorker | undefined;
  private readonly listeners = new Set<SyncStatusListener>();
  private running = false;

  constructor(options: {
    repository: GoogleSyncRepository;
    settingsRepository: LocalSettingsRepository;
    historyRepository?: LocalHistoryRepository;
    tasksTransport: GoogleTasksReadTransport;
    calendarTransport: GoogleCalendarReadTransport;
    mutationWorker?: GooglePendingMutationWorker;
  }) {
    this.repository = options.repository;
    this.settingsRepository = options.settingsRepository;
    this.historyRepository = options.historyRepository;
    this.mutationWorker = options.mutationWorker;
    this.readSync = new GoogleReadSyncService({
      repository: options.repository,
      tasks: options.tasksTransport,
      calendar: options.calendarTransport
    });
  }

  status(): SyncStatusResponse {
    const account = this.repository.latestAccountStatus();
    const status = this.repository.syncStatus();
    const offline = account?.connectionState !== "connected";

    return {
      ...status,
      state: this.running ? "running" : status.state,
      offline,
      stale: isStale(status)
    };
  }

  async runNow(request: SyncRunNowRequest): Promise<SyncRunNowResponse> {
    const settings = this.settingsRepository.get();
    const resources = normalizedResources(request.resources).filter((resource) => {
      if (resource === "tasks") {
        return settings.syncTasksEnabled;
      }

      return settings.syncCalendarEventsEnabled;
    });

    if (request.dryRun) {
      return {
        accepted: true,
        dryRun: true,
        resources
      };
    }

    if (this.running) {
      return {
        accepted: false,
        dryRun: false,
        resources
      };
    }

    this.running = true;
    this.emit();

    try {
      const mutationRun = await this.mutationWorker?.drainDue();

      if (mutationRun) {
        appLogger.info("mutation drain completed", "mutation", mutationRun);
      }
      if (resources.length > 0) {
        const result = await this.readSync.runReadSync({
          account: this.repository.latestAccountStatus() ?? signedOutAccount(),
          resources,
          full: request.full ?? false,
          eventRetentionDaysBack: settings.eventRetentionDaysBack,
          completedTaskRetentionDaysBack: settings.completedTaskRetentionDaysBack
        });
        this.recordSyncHistory(result.summaries, result.ok);
      }
    } finally {
      this.running = false;
      this.emit();
    }

    return {
      accepted: true,
      dryRun: false,
      resources
    };
  }

  subscribeStatus(listener: SyncStatusListener): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    const status = this.status();

    for (const listener of this.listeners) {
      listener(status);
    }
  }

  private recordSyncHistory(
    summaries: ReadonlyArray<{ resource: ReadSyncResource; itemCount: number; listCount: number; durationMs: number }>,
    ok: boolean
  ): void {
    for (const summary of summaries) {
      this.historyRepository?.record({
        kind: summary.resource === "tasks" ? "sync.task" : "sync.event",
        summary: ok ? "Synced Google resource" : "Google resource sync failed",
        metadata: {
          resource: summary.resource,
          itemCount: summary.itemCount,
          listCount: summary.listCount,
          durationMs: summary.durationMs
        }
      });
    }
  }
}

function createMcpDomainServices(repository: LocalPlannerRepository): McpDomainServices {
  return {
    planning: {
      search: ({ query, scope, limit }) =>
        repository
          .search({
            query,
            domains: searchDomainsForScope(scope),
            limit: Math.max(1, Math.min(50, limit ?? 20))
          })
          .items.map((item) => jsonObject({
            kind: item.domain,
            id: item.id,
            title: item.title,
            snippet: item.snippet ?? "",
            updatedAt: item.updatedAt ?? "",
            deepLink: `hotcrossbuns://${item.domain}/${item.id}`
          })),
      today: () => {
        const now = new Date();
        const start = startOfUtcDay(now);
        const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

        return jsonObject({
          date: start.toISOString().slice(0, 10),
          tasks: repository.listTasks({ status: "active", limit: 20 }).items.map(jsonObject),
          events: repository
            .listCalendarEvents({
              start: start.toISOString(),
              end: end.toISOString(),
              limit: 20
            })
            .items.map(jsonObject),
          notes: repository.listNotes({ limit: 10 }).items.map(jsonObject)
        });
      },
      week: ({ startDate }) => {
        const start = startDate === undefined ? startOfUtcDay(new Date()) : startOfUtcDay(new Date(startDate));
        const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);

        return jsonObject({
          startDate: start.toISOString(),
          tasks: repository.listTasks({ status: "active", limit: 50 }).items.map(jsonObject),
          events: repository
            .listCalendarEvents({
              start: start.toISOString(),
              end: end.toISOString(),
              limit: 100
            })
            .items.map(jsonObject)
        });
      }
    },
    tasks: {
      getTask: (id) => jsonObject(repository.getTask(id)),
      listTaskLists: () => repository.listTaskLists({ limit: 100 }).items.map(jsonObject),
      previewCreateTask: (input) =>
        jsonObject({
          kind: "task",
          title: requiredText(input, "title"),
          notes: optionalText(input, "notes") ?? "",
          dueDate: dateOnlyFromInput(optionalText(input, "dueDate")),
          taskListId: optionalText(input, "taskListId") ?? firstTaskListId(repository),
          parentId: optionalText(input, "parentId") ?? null,
          priority: priorityFromInput(optionalText(input, "priority")),
          deepLink: "hotcrossbuns://task/preview"
        }),
      createTask: (input) =>
        jsonObject({
          kind: "task",
          ...repository.createTask({
            title: requiredText(input, "title"),
            notes: optionalText(input, "notes") ?? "",
            dueDate: dateOnlyFromInput(optionalText(input, "dueDate")),
            listId: optionalText(input, "taskListId") ?? firstTaskListId(repository),
            parentId: optionalText(input, "parentId") ?? null,
            priority: priorityFromInput(optionalText(input, "priority"))
          })
        }),
      previewUpdateTask: (id, patch) => jsonObject({ ...repository.getTask(id), patch }),
      updateTask: (id, patch) =>
        jsonObject({
          kind: "task",
          ...repository.updateTask(taskUpdateFromPatch(id, patch))
        }),
      previewCompleteTask: (id) => jsonObject({ ...repository.getTask(id), targetStatus: "completed" }),
      completeTask: (id) => jsonObject({ kind: "task", ...repository.completeTask({ id }) }),
      previewReopenTask: (id) => jsonObject({ ...repository.getTask(id), targetStatus: "active" }),
      reopenTask: (id) => jsonObject({ kind: "task", ...repository.reopenTask({ id }) }),
      previewMoveTask: (id, taskListId) =>
        jsonObject({ ...repository.getTask(id), targetTaskListId: taskListId }),
      moveTask: (id, taskListId) =>
        jsonObject({ kind: "task", ...repository.moveTask({ id, listId: taskListId }) }),
      previewDeleteTask: (id) => jsonObject(repository.getTask(id)),
      deleteTask: (id) => jsonObject({ kind: "task", ...repository.deleteTask({ id }) })
    },
    notes: {
      getNote: (id) => jsonObject(repository.getNote(id)),
      previewCreateNote: (input) =>
        jsonObject({
          kind: "note",
          title: requiredText(input, "title"),
          body: optionalText(input, "body") ?? "",
          deepLink: "hotcrossbuns://note/preview"
        }),
      createNote: (input) =>
        jsonObject({
          kind: "note",
          ...repository.createNote({
            title: requiredText(input, "title"),
            body: optionalText(input, "body") ?? ""
          })
        }),
      previewUpdateNote: (id, patch) =>
        jsonObject({
          ...repository.getNote(id),
          patch
        }),
      updateNote: (id, patch) =>
        jsonObject({
          kind: "note",
          ...repository.updateNote({
            id,
            ...(optionalText(patch, "title") === undefined
              ? {}
              : { title: optionalText(patch, "title") }),
            ...(optionalText(patch, "body") === undefined
              ? {}
              : { body: optionalText(patch, "body") })
          })
        }),
      previewDeleteNote: (id) => jsonObject(repository.getNote(id)),
      deleteNote: (id) => jsonObject(repository.deleteNote({ id }))
    },
    calendar: {
      getEvent: (id) => repository.getCalendarEvent(id),
      listCalendars: () => repository.listCalendars({ limit: 100 }).items.map(jsonObject),
      previewCreateEvent: (input) =>
        jsonObject({
          kind: "event",
          ...calendarEventRequestFromJson(repository, input),
          deepLink: "hotcrossbuns://event/preview"
        }),
      createEvent: (input) =>
        jsonObject({
          kind: "event",
          ...repository.createCalendarEvent(calendarEventRequestFromJson(repository, input))
        }),
      previewUpdateEvent: (id, patch) =>
        jsonObject({
          ...repository.getCalendarEvent(id),
          patch
        }),
      updateEvent: (id, patch) =>
        jsonObject({
          kind: "event",
          ...repository.updateCalendarEvent({
            id,
            ...calendarEventPatchFromJson(patch)
          })
        }),
      previewDeleteEvent: (id) => jsonObject(repository.getCalendarEvent(id)),
      deleteEvent: (id) => jsonObject(repository.deleteCalendarEvent({ id }))
    }
  };
}

function normalizedResources(resources: SyncRunNowRequest["resources"]): ReadSyncResource[] {
  return [...new Set(resources ?? ["tasks", "calendar"])] as ReadSyncResource[];
}

function applyMcpSettings(mcpState: McpStatusResponse, settings: SettingsSnapshot): void {
  mcpState.enabled = settings.mcpEnabled;
  mcpState.permissionMode = settings.mcpPermissionMode;
  mcpState.readOnly = settings.mcpPermissionMode === "read-only";
  mcpState.confirmationRequired = settings.mcpPermissionMode !== "allow-writes";
  mcpState.port = settings.mcpPort;
}

function requireRecoveryConfirmation(
  request: SettingsRecoveryActionRequest,
  phrase: string
): void {
  if (request.confirmation?.accepted === true && request.confirmation.phrase === phrase) {
    return;
  }

  throw new HcbPublicError({
    code: "VALIDATION_ERROR",
    message: `Type ${phrase} to confirm this destructive recovery action.`,
    recoverable: true
  });
}

function signedOutAccount(): GoogleAccountConnectionStatusDto {
  const now = new Date().toISOString();

  return {
    accountId: "local-google-account",
    connectionState: "signed_out",
    grantedScopes: [],
    missingScopes: [
      "https://www.googleapis.com/auth/tasks",
      "https://www.googleapis.com/auth/calendar"
    ],
    updatedAt: now
  };
}

function isStale(status: SyncStatusResponse): boolean {
  if (status.lastCompletedAt === undefined) {
    return true;
  }

  return Date.now() - Date.parse(status.lastCompletedAt) > 15 * 60 * 1000;
}

function nativeCapabilities(): NativeCapabilitiesResponse {
  const platform = detectNativePlatform();
  const report = buildNativeCapabilityReport({
    platform,
    adapterId: "domain-fallback",
    appPaths: defaultNativeAppPaths(),
    flags: {
      supportsAppPaths: true,
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
      supportsDiagnosticsCollection: true,
      supportsCredentialStorage: false,
      supportsOAuthLoopback: true,
      supportsMcpLoopback: true,
      requiresSignedBuildForNotifications: platform === "win32",
      ...(platform === "linux"
        ? {
            hasWaylandSession: process.env.XDG_SESSION_TYPE === "wayland",
            hasPortalShortcutSupport: false
          }
        : {})
    },
    capabilityOverrides: {
      oauthLoopback: {
        state: "pending",
        message: "OAuth loopback is shared code; platform browser handoff is not verified by the fallback service."
      },
      mcpLoopback: {
        state: "pending",
        message: "MCP loopback is shared code; native lifecycle is not owned by the fallback service."
      }
    },
    diagnostics: [
      capabilityDiagnostic(
        "packaging",
        "warning",
        "Native capability status is from the fallback domain service, not a platform adapter."
      )
    ]
  });

  return {
    platform,
    notifications: false,
    globalShortcuts: false,
    tray: false,
    deepLinks: false,
    trayStatus: {
      state: "unsupported",
      message: "Tray/menu bar is unavailable through the fallback domain service."
    },
    quickCaptureShortcut: {
      accelerator: null,
      registered: false,
      state: "unsupported",
      message: "Global shortcuts are unavailable through the fallback domain service."
    },
    notificationsStatus: {
      permission: "unsupported",
      scheduledCount: 0,
      state: "unsupported",
      message: "Notifications are unavailable through the fallback domain service."
    },
    deepLinkStatus: {
      scheme: "hotcrossbuns",
      registered: false,
      state: "unsupported",
      message: "Deep links are unavailable through the fallback domain service."
    },
    updaterStatus: {
      state: "unsupported",
      message: "Preview update checks are not configured for this build."
    },
    mcpStatus: {
      state: "disabled",
      message: "MCP local agent access is disabled."
    },
    capabilityReport: report,
    deferredStartup: {
      state: "pending"
    }
  };
}

function nativeNotificationPermission(): NativeNotificationPermissionResponse {
  return {
    state: "unsupported"
  };
}

function searchDomainsForScope(scope: string | undefined): SearchQueryRequest["domains"] {
  if (scope === "tasks" || scope === "lists") {
    return ["tasks"];
  }

  if (scope === "events" || scope === "calendars") {
    return ["calendar"];
  }

  if (scope === "notes") {
    return ["notes"];
  }

  return undefined;
}

function calendarEventRequestFromJson(
  repository: LocalPlannerRepository,
  input: DomainJsonObject
) {
  const startsAt = optionalText(input, "startsAt") ?? requiredText(input, "startDate");
  const endsAt = optionalText(input, "endsAt") ?? optionalText(input, "endDate") ?? startsAt;

  return {
    title: requiredText(input, "title"),
    calendarId: optionalText(input, "calendarId") ?? defaultCalendarId(repository),
    startsAt,
    endsAt,
    allDay: optionalBoolean(input, "allDay") ?? optionalBoolean(input, "isAllDay") ?? false,
    location: optionalText(input, "location") ?? "",
    notes: optionalText(input, "notes") ?? optionalText(input, "details") ?? "",
    guestEmails: optionalTextArray(input, "guestEmails") ?? optionalTextArray(input, "attendeeEmails") ?? [],
    reminderMinutes: optionalNumberArray(input, "reminderMinutes") ?? []
  };
}

function calendarEventPatchFromJson(patch: DomainJsonObject) {
  return {
    ...(optionalText(patch, "title") === undefined ? {} : { title: optionalText(patch, "title") }),
    ...(optionalText(patch, "calendarId") === undefined ? {} : { calendarId: optionalText(patch, "calendarId") }),
    ...(optionalText(patch, "startsAt") === undefined ? {} : { startsAt: optionalText(patch, "startsAt") }),
    ...(optionalText(patch, "startDate") === undefined ? {} : { startsAt: optionalText(patch, "startDate") }),
    ...(optionalText(patch, "endsAt") === undefined ? {} : { endsAt: optionalText(patch, "endsAt") }),
    ...(optionalText(patch, "endDate") === undefined ? {} : { endsAt: optionalText(patch, "endDate") }),
    ...(optionalBoolean(patch, "allDay") === undefined ? {} : { allDay: optionalBoolean(patch, "allDay") }),
    ...(optionalBoolean(patch, "isAllDay") === undefined ? {} : { allDay: optionalBoolean(patch, "isAllDay") }),
    ...(optionalText(patch, "location") === undefined ? {} : { location: optionalText(patch, "location") }),
    ...(optionalText(patch, "notes") === undefined ? {} : { notes: optionalText(patch, "notes") }),
    ...(optionalText(patch, "details") === undefined ? {} : { notes: optionalText(patch, "details") }),
    ...(optionalTextArray(patch, "guestEmails") === undefined ? {} : { guestEmails: optionalTextArray(patch, "guestEmails") }),
    ...(optionalTextArray(patch, "attendeeEmails") === undefined ? {} : { guestEmails: optionalTextArray(patch, "attendeeEmails") }),
    ...(optionalNumberArray(patch, "reminderMinutes") === undefined ? {} : { reminderMinutes: optionalNumberArray(patch, "reminderMinutes") })
  };
}

function defaultCalendarId(repository: LocalPlannerRepository): string {
  const calendar = repository.listCalendars({ limit: 1 }).items[0];

  if (calendar === undefined) {
    throw new Error("No writable calendar is available.");
  }

  return calendar.id;
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function firstTaskListId(repository: LocalPlannerRepository): string {
  const taskList = repository.listTaskLists({ limit: 1 }).items[0];

  if (taskList === undefined) {
    throw new Error("No task list is available.");
  }

  return taskList.id;
}

function dateOnlyFromInput(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const parsed = Date.parse(value);

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return new Date(parsed).toISOString().slice(0, 10);
}

function priorityFromInput(value: string | undefined): TaskPriority {
  return value === "low" || value === "medium" || value === "high" ? value : "none";
}

function taskUpdateFromPatch(id: string, patch: DomainJsonObject): TaskUpdateRequest {
  return {
    id,
    ...(optionalText(patch, "title") === undefined ? {} : { title: optionalText(patch, "title") }),
    ...(optionalText(patch, "notes") === undefined ? {} : { notes: optionalText(patch, "notes") }),
    ...(optionalText(patch, "dueDate") === undefined
      ? {}
      : { dueDate: dateOnlyFromInput(optionalText(patch, "dueDate")) }),
    ...(optionalText(patch, "taskListId") === undefined
      ? {}
      : { listId: optionalText(patch, "taskListId") }),
    ...(optionalText(patch, "listId") === undefined ? {} : { listId: optionalText(patch, "listId") }),
    ...(optionalText(patch, "parentId") === undefined
      ? {}
      : { parentId: optionalText(patch, "parentId") }),
    ...(optionalText(patch, "priority") === undefined
      ? {}
      : { priority: priorityFromInput(optionalText(patch, "priority")) })
  };
}

function requiredText(input: DomainJsonObject, key: string): string {
  const value = optionalText(input, key);

  if (!value) {
    throw new Error(`Missing required string argument '${key}'.`);
  }

  return value;
}

function optionalText(input: DomainJsonObject, key: string): string | undefined {
  const value = input[key];

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function optionalBoolean(input: DomainJsonObject, key: string): boolean | undefined {
  const value = input[key];

  return typeof value === "boolean" ? value : undefined;
}

function optionalTextArray(input: DomainJsonObject, key: string): string[] | undefined {
  const value = input[key];

  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  return undefined;
}

function optionalNumberArray(input: DomainJsonObject, key: string): number[] | undefined {
  const value = input[key];

  if (Array.isArray(value)) {
    return value.filter((item): item is number => typeof item === "number");
  }

  if (typeof value === "number") {
    return [value];
  }

  return undefined;
}

function jsonObject(value: object): DomainJsonObject {
  const output: DomainJsonObject = {};

  for (const [key, child] of Object.entries(value)) {
    output[key] = jsonValue(child);
  }

  return output;
}

function jsonValue(value: unknown): DomainJsonValue {
  if (value === undefined) {
    return null;
  }

  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(jsonValue);
  }

  if (typeof value === "object") {
    return jsonObject(value);
  }

  return null;
}
