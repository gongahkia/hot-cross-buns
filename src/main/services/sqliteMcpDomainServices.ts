import packageJson from "../../../package.json";
import type {
  CalendarEventCreateRequest,
  CalendarEventCompletionScope,
  CalendarEventRecurrence,
  CalendarEventUpdateRequest,
  DiagnosticsLogLevel,
  NoteCreateRequest,
  NoteUpdateRequest,
  SearchQueryRequest,
  TaskCreateRequest,
  TaskMoveRequest,
  TaskPriority,
  TaskUpdateRequest
} from "@shared/ipc/contracts";
import { redactDiagnosticText } from "@shared/redaction";
import type {
  LocalHistoryRepository,
  LocalPlannerRepository,
  LocalSettingsRepository
} from "../data/localRepositories";
import { appLogger } from "../diagnostics/appLogger";
import type { GoogleSyncRepository } from "../sync/readSyncRepository";
import type { PendingGoogleMutation } from "../sync/readSyncRepository/types";
import type {
  DomainJsonObject,
  DomainJsonValue,
  MaybePromise,
  McpDomainServices,
  UndoDomainService
} from "./domainInterfaces";
import type { SyncStatusResponse } from "@shared/ipc/contracts";
import type { SyncRunNowRequest } from "@shared/ipc/contracts";
import { applyAutoTagRules } from "./autoTags";

export interface McpDomainServiceDependencies {
  plannerRepository: LocalPlannerRepository;
  settingsRepository: LocalSettingsRepository;
  syncRepository: GoogleSyncRepository;
  historyRepository?: LocalHistoryRepository;
  undo: UndoDomainService;
  syncStatus: () => MaybePromise<SyncStatusResponse>;
  syncRunNow: (request: SyncRunNowRequest) => MaybePromise<object>;
}

export function createMcpDomainServices(dependencies: McpDomainServiceDependencies): McpDomainServices {
  const repository = dependencies.plannerRepository;
  const settingsRepository = dependencies.settingsRepository;

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
      previewCreateTaskList: (input) =>
        jsonObject({
          kind: "taskList",
          title: requiredText(input, "title")
        }),
      createTaskList: (input) =>
        jsonObject({
          kind: "taskList",
          ...repository.createTaskList({
            title: requiredText(input, "title")
          })
        }),
      previewRenameTaskList: (id, input) =>
        jsonObject({
          ...taskListById(repository, id),
          kind: "taskList",
          id,
          title: requiredText(input, "title")
        }),
      renameTaskList: (id, input) =>
        jsonObject({
          kind: "taskList",
          ...repository.renameTaskList({
            id,
            title: requiredText(input, "title")
          })
        }),
      previewDeleteTaskList: (id) => jsonObject(taskListById(repository, id)),
      deleteTaskList: (id) =>
        jsonObject({
          kind: "taskList",
          ...repository.deleteTaskList({ id })
        }),
      previewCreateTask: (input) =>
        jsonObject({
          kind: "task",
          ...autoTaggedMcpTaskCreate(repository, settingsRepository, input),
          deepLink: "hotcrossbuns://task/preview"
        }),
      createTask: (input) =>
        jsonObject({
          kind: "task",
          ...repository.createTask(autoTaggedMcpTaskCreate(repository, settingsRepository, input))
        }),
      previewUpdateTask: (id, patch) =>
        jsonObject({ ...repository.getTask(id), patch: autoTaggedMcpTaskUpdate(repository, settingsRepository, id, patch) }),
      updateTask: (id, patch) =>
        jsonObject({
          kind: "task",
          ...repository.updateTask(autoTaggedMcpTaskUpdate(repository, settingsRepository, id, patch))
        }),
      previewCompleteTask: (id) => jsonObject({ ...repository.getTask(id), targetStatus: "completed" }),
      completeTask: (id) => jsonObject({ kind: "task", ...repository.completeTask({ id }) }),
      previewReopenTask: (id) => jsonObject({ ...repository.getTask(id), targetStatus: "active" }),
      reopenTask: (id) => jsonObject({ kind: "task", ...repository.reopenTask({ id }) }),
      previewMoveTask: (id, input) =>
        jsonObject({ ...repository.getTask(id), move: taskMoveFromJson(id, input) }),
      moveTask: (id, input) =>
        jsonObject({ kind: "task", ...repository.moveTask(taskMoveFromJson(id, input)) }),
      previewDeleteTask: (id) => jsonObject(repository.getTask(id)),
      deleteTask: (id) => jsonObject({ kind: "task", ...repository.deleteTask({ id }) })
    },
    notes: {
      getNote: (id) => jsonObject(repository.getNote(id)),
      listNoteLists: () => repository.listNotes({ limit: 1 }).lists.map(jsonObject),
      previewCreateNoteList: (input) =>
        jsonObject({
          kind: "noteList",
          title: requiredText(input, "title"),
          noteCount: 0
        }),
      createNoteList: (input) =>
        jsonObject({
          kind: "noteList",
          ...repository.createNoteList({
            title: requiredText(input, "title")
          })
        }),
      previewRenameNoteList: (id, input) =>
        jsonObject({
          ...noteListById(repository, id),
          kind: "noteList",
          id,
          title: requiredText(input, "title")
        }),
      renameNoteList: (id, input) =>
        jsonObject({
          kind: "noteList",
          ...repository.renameNoteList({
            id,
            title: requiredText(input, "title")
          })
        }),
      previewDeleteNoteList: (id) => jsonObject(noteListById(repository, id)),
      deleteNoteList: (id) =>
        jsonObject({
          kind: "noteList",
          ...repository.deleteNoteList({ id })
        }),
      previewCreateNote: (input) =>
        jsonObject({
          kind: "note",
          ...autoTaggedMcpNoteCreate(settingsRepository, input),
          deepLink: "hotcrossbuns://note/preview"
        }),
      createNote: (input) =>
        jsonObject({
          kind: "note",
          ...repository.createNote(autoTaggedMcpNoteCreate(settingsRepository, input))
        }),
      previewUpdateNote: (id, patch) =>
        jsonObject({
          ...repository.getNote(id),
          patch: autoTaggedMcpNoteUpdate(repository, settingsRepository, id, patch)
        }),
      updateNote: (id, patch) =>
        jsonObject({
          kind: "note",
          ...repository.updateNote(autoTaggedMcpNoteUpdate(repository, settingsRepository, id, patch))
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
          ...autoTaggedMcpEventCreate(repository, settingsRepository, input),
          deepLink: "hotcrossbuns://event/preview"
        }),
      createEvent: (input) =>
        jsonObject({
          kind: "event",
          ...repository.createCalendarEvent(autoTaggedMcpEventCreate(repository, settingsRepository, input))
        }),
      previewUpdateEvent: (id, patch) =>
        jsonObject({
          ...repository.getCalendarEvent(id),
          patch: autoTaggedMcpEventUpdate(repository, settingsRepository, id, patch)
        }),
      updateEvent: (id, patch) =>
        jsonObject({
          kind: "event",
          ...repository.updateCalendarEvent(autoTaggedMcpEventUpdate(repository, settingsRepository, id, patch))
        }),
      previewCompleteEvent: (id, input) =>
        jsonObject({
          ...repository.getCalendarEvent(id),
          targetStatus: "completed",
          scope: eventCompletionScopeFromJson(input)
        }),
      completeEvent: (id, input) =>
        jsonObject({
          kind: "event",
          ...repository.completeCalendarEvent({
            id,
            scope: eventCompletionScopeFromJson(input)
          })
        }),
      previewReopenEvent: (id, input) =>
        jsonObject({
          ...repository.getCalendarEvent(id),
          targetStatus: "open",
          scope: eventCompletionScopeFromJson(input)
        }),
      reopenEvent: (id, input) =>
        jsonObject({
          kind: "event",
          ...repository.reopenCalendarEvent({
            id,
            scope: eventCompletionScopeFromJson(input)
          })
        }),
      previewDeleteEvent: (id) => jsonObject(repository.getCalendarEvent(id)),
      deleteEvent: (id) => jsonObject(repository.deleteCalendarEvent({ id })),
      previewScheduleTaskBlock: (input) => previewScheduleTaskBlock(repository, input),
      scheduleTaskBlock: (input) =>
        jsonObject({
          kind: "scheduledTaskBlock",
          ...repository.scheduleTaskBlock(scheduledTaskBlockFromJson(input))
        })
    },
    diagnostics: {
      status: async () => {
        const settings = dependencies.settingsRepository.get();
        const sync = await dependencies.syncStatus();
        const account = dependencies.syncRepository.latestAccountStatus();
        const pendingMutations = dependencies.syncRepository.pendingMutationDiagnostics();

        return jsonObject({
          kind: "diagnosticsStatus",
          generatedAt: new Date().toISOString(),
          account: {
            state: account?.connectionState ?? "signed_out",
            grantedScopeCount: account?.grantedScopes.length ?? 0,
            missingScopeCount: account?.missingScopes.length ?? 0,
            updatedAt: account?.updatedAt ?? null
          },
          sync: {
            ...sync,
            mode: settings.syncMode
          },
          cache: dependencies.syncRepository.cacheDiagnostics(),
          pendingMutations,
          mcp: {
            enabled: settings.mcpEnabled,
            permissionMode: settings.mcpPermissionMode,
            configuredPort: settings.mcpPort
          },
          build: {
            appName: packageJson.name,
            version: packageJson.version,
            nodeVersion: process.versions.node
          }
        });
      },
      logs: ({ limit, level }) => {
        const minimumLevel = diagnosticsLogLevel(level);

        return appLogger
          .recentEntries(limit ?? 50, minimumLevel)
          .map((entry) => jsonObject(entry));
      },
      diff: ({ limit }) =>
        dependencies.syncRepository
          .listActivePendingMutations({ limit: limit ?? 100 })
          .map((mutation) => jsonObject(pendingMutationView(mutation))),
      show: async ({ kind, id }) => {
        if (kind === "diagnostics") {
          return await thisDiagnosticsStatus(dependencies);
        }

        if (kind !== "mutation") {
          throw new Error("Diagnostics show only supports mutation or diagnostics.");
        }

        if (!id) {
          throw new Error("Mutation id is required.");
        }

        const mutation = dependencies.syncRepository.pendingMutationById(id);

        if (!mutation) {
          throw new Error("Mutation was not found.");
        }

        return jsonObject(pendingMutationView(mutation));
      }
    },
    undo: {
      status: async () => jsonObject({
        kind: "undoStatus",
        ...(await dependencies.undo.status())
      }),
      undo: async () => undoActionObject(await dependencies.undo.undo()),
      redo: async () => undoActionObject(await dependencies.undo.redo())
    },
    syncQueue: {
      previewRunNow: (input) =>
        jsonObject({
          kind: "syncRun",
          ...syncRunNowRequestFromJson(input),
          dryRun: true,
          accepted: true
        }),
      runNow: async (input) =>
        jsonObject({
          kind: "syncRun",
          ...(await dependencies.syncRunNow(syncRunNowRequestFromJson(input)))
        }),
      pendingMutations: ({ limit }) =>
        dependencies.syncRepository
          .listActivePendingMutations({ limit: limit ?? 100 })
          .map((mutation) => jsonObject(pendingMutationView(mutation))),
      previewRetryMutation: (id) => mutationActionPreview(dependencies, id, "retry"),
      retryMutation: (id) => retryMutation(dependencies, id),
      previewCancelMutation: (id) => mutationActionPreview(dependencies, id, "cancel"),
      cancelMutation: (id) => cancelMutation(dependencies, id)
    }
  };
}

function undoActionObject(value: {
  action: "undo" | "redo";
  applied: boolean;
  label?: string;
  resourceKind?: string;
  resourceId?: string;
}): DomainJsonObject {
  return jsonObject({
    kind: "undoAction",
    title: value.label ?? value.action,
    ...value
  });
}

function syncRunNowRequestFromJson(input: DomainJsonObject): SyncRunNowRequest {
  const resourceValues = optionalTextArray(input, "resources");
  const resources = resourceValues
    ?.filter((resource): resource is "tasks" | "calendar" =>
      resource === "tasks" || resource === "calendar"
    );

  return {
    ...(resources === undefined || resources.length === 0 ? {} : { resources }),
    full: optionalBoolean(input, "full") ?? false,
    dryRun: optionalBoolean(input, "dryRun") ?? false
  };
}

function mutationActionPreview(
  dependencies: McpDomainServiceDependencies,
  id: string,
  action: "retry" | "cancel"
): DomainJsonObject {
  const mutation = dependencies.syncRepository.pendingMutationById(id);

  if (!mutation) {
    throw new Error("Pending mutation was not found.");
  }

  return jsonObject({
    kind: "mutationAction",
    action,
    id: mutation.id,
    resourceType: mutation.resourceType,
    resourceId: mutation.resourceId,
    operation: mutation.operation,
    status: action === "retry" ? "pending" : "cancelled"
  });
}

function retryMutation(dependencies: McpDomainServiceDependencies, id: string): DomainJsonObject {
  const now = new Date().toISOString();
  const mutation = dependencies.syncRepository.retryPendingMutation(id, now);

  if (!mutation) {
    throw new Error("Pending mutation could not be retried.");
  }

  dependencies.historyRepository?.record({
    kind: "mutation.retry",
    resourceId: mutation.id,
    summary: "Retried pending mutation",
    metadata: { operation: mutation.operation }
  });

  return jsonObject({
    kind: "mutationAction",
    action: "retry",
    id: mutation.id,
    status: "pending",
    updatedAt: mutation.updatedAt
  });
}

function cancelMutation(dependencies: McpDomainServiceDependencies, id: string): DomainJsonObject {
  const now = new Date().toISOString();
  const mutation = dependencies.syncRepository.cancelPendingMutation(id, now);

  if (!mutation) {
    throw new Error("Pending mutation could not be cancelled.");
  }

  dependencies.historyRepository?.record({
    kind: "mutation.cancel",
    resourceId: mutation.id,
    summary: "Cancelled pending mutation",
    metadata: { operation: mutation.operation }
  });

  return jsonObject({
    kind: "mutationAction",
    action: "cancel",
    id: mutation.id,
    status: "cancelled",
    updatedAt: mutation.updatedAt
  });
}

async function thisDiagnosticsStatus(dependencies: McpDomainServiceDependencies): Promise<DomainJsonObject> {
  const settings = dependencies.settingsRepository.get();
  const sync = await dependencies.syncStatus();
  const account = dependencies.syncRepository.latestAccountStatus();
  const pendingMutations = dependencies.syncRepository.pendingMutationDiagnostics();

  return jsonObject({
    kind: "diagnosticsStatus",
    generatedAt: new Date().toISOString(),
    account: {
      state: account?.connectionState ?? "signed_out",
      grantedScopeCount: account?.grantedScopes.length ?? 0,
      missingScopeCount: account?.missingScopes.length ?? 0,
      updatedAt: account?.updatedAt ?? null
    },
    sync: {
      ...sync,
      mode: settings.syncMode
    },
    cache: dependencies.syncRepository.cacheDiagnostics(),
    pendingMutations,
    mcp: {
      enabled: settings.mcpEnabled,
      permissionMode: settings.mcpPermissionMode,
      configuredPort: settings.mcpPort
    },
    build: {
      appName: packageJson.name,
      version: packageJson.version,
      nodeVersion: process.versions.node
    }
  });
}

function diagnosticsLogLevel(value: string | undefined): DiagnosticsLogLevel {
  return value === "debug" || value === "warn" || value === "error" ? value : "info";
}

function pendingMutationView(mutation: PendingGoogleMutation) {
  return {
    kind: "mutation",
    id: mutation.id,
    resourceType: mutation.resourceType,
    resourceId: mutation.resourceId,
    operation: mutation.operation,
    status: mutation.status,
    attemptCount: mutation.attemptCount,
    nextRetryAt: mutation.nextRetryAt,
    lastErrorCode: mutation.lastErrorCode,
    lastErrorMessage:
      mutation.lastErrorMessage === null
        ? null
        : redactDiagnosticText(mutation.lastErrorMessage),
    createdAt: mutation.createdAt,
    updatedAt: mutation.updatedAt
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
    reminderMinutes: optionalNumberArray(input, "reminderMinutes") ?? [],
    ...(optionalNullableText(input, "colorId") === undefined
      ? {}
      : { colorId: optionalNullableText(input, "colorId") }),
    ...(optionalText(input, "timeZone") === undefined ? {} : { timeZone: optionalText(input, "timeZone") }),
    ...(optionalRecurrence(input) === undefined ? {} : { recurrence: optionalRecurrence(input) })
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
    ...(optionalNumberArray(patch, "reminderMinutes") === undefined ? {} : { reminderMinutes: optionalNumberArray(patch, "reminderMinutes") }),
    ...(optionalNullableText(patch, "colorId") === undefined
      ? {}
      : { colorId: optionalNullableText(patch, "colorId") }),
    ...(optionalText(patch, "timeZone") === undefined ? {} : { timeZone: optionalText(patch, "timeZone") }),
    ...(optionalRecurrence(patch) === undefined ? {} : { recurrence: optionalRecurrence(patch) })
  };
}

function eventCompletionScopeFromJson(input: DomainJsonObject): CalendarEventCompletionScope {
  const scope = optionalText(input, "scope");

  if (scope === "seriesFuture" || scope === "seriesAll" || scope === "occurrence") {
    return scope;
  }

  return "occurrence";
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

function dateOnlyFromNullableInput(value: string | null | undefined): string | null {
  if (value === null) {
    return null;
  }

  return dateOnlyFromInput(value);
}

function priorityFromInput(value: string | undefined): TaskPriority {
  return value === "low" || value === "medium" || value === "high" ? value : "none";
}

function taskCreateFromJson(
  repository: LocalPlannerRepository,
  input: DomainJsonObject
): TaskCreateRequest {
  return {
    title: requiredText(input, "title"),
    notes: optionalText(input, "notes") ?? "",
    dueDate: dateOnlyFromNullableInput(optionalNullableText(input, "dueDate")),
    listId: optionalText(input, "taskListId") ?? optionalText(input, "listId") ?? firstTaskListId(repository),
    parentId: optionalNullableText(input, "parentId") ?? null,
    ...(optionalNullableText(input, "previousSiblingId") === undefined
      ? {}
      : { previousSiblingId: optionalNullableText(input, "previousSiblingId") }),
    priority: priorityFromInput(optionalText(input, "priority")),
    ...(optionalNullableText(input, "plannedStart") === undefined
      ? {}
      : { plannedStart: optionalNullableText(input, "plannedStart") }),
    ...(optionalNullableText(input, "plannedEnd") === undefined
      ? {}
      : { plannedEnd: optionalNullableText(input, "plannedEnd") }),
    ...(optionalNullableNumber(input, "durationMinutes") === undefined
      ? {}
      : { durationMinutes: optionalNullableNumber(input, "durationMinutes") }),
    ...(optionalBoolean(input, "lockedSchedule") === undefined
      ? {}
      : { lockedSchedule: optionalBoolean(input, "lockedSchedule") }),
    ...(optionalNullableText(input, "snoozeUntil") === undefined
      ? {}
      : { snoozeUntil: optionalNullableText(input, "snoozeUntil") }),
    ...(optionalTextArray(input, "tags") === undefined ? {} : { tags: optionalTextArray(input, "tags") })
  };
}

function taskUpdateFromPatch(id: string, patch: DomainJsonObject): TaskUpdateRequest {
  return {
    id,
    ...(optionalText(patch, "title") === undefined ? {} : { title: optionalText(patch, "title") }),
    ...(optionalText(patch, "notes") === undefined ? {} : { notes: optionalText(patch, "notes") }),
    ...(optionalNullableText(patch, "dueDate") === undefined
      ? {}
      : { dueDate: dateOnlyFromNullableInput(optionalNullableText(patch, "dueDate")) }),
    ...(optionalText(patch, "taskListId") === undefined
      ? {}
      : { listId: optionalText(patch, "taskListId") }),
    ...(optionalText(patch, "listId") === undefined ? {} : { listId: optionalText(patch, "listId") }),
    ...(optionalNullableText(patch, "parentId") === undefined
      ? {}
      : { parentId: optionalNullableText(patch, "parentId") }),
    ...(optionalNullableText(patch, "previousSiblingId") === undefined
      ? {}
      : { previousSiblingId: optionalNullableText(patch, "previousSiblingId") }),
    ...(optionalText(patch, "priority") === undefined
      ? {}
      : { priority: priorityFromInput(optionalText(patch, "priority")) }),
    ...(optionalNullableText(patch, "plannedStart") === undefined
      ? {}
      : { plannedStart: optionalNullableText(patch, "plannedStart") }),
    ...(optionalNullableText(patch, "plannedEnd") === undefined
      ? {}
      : { plannedEnd: optionalNullableText(patch, "plannedEnd") }),
    ...(optionalNullableNumber(patch, "durationMinutes") === undefined
      ? {}
      : { durationMinutes: optionalNullableNumber(patch, "durationMinutes") }),
    ...(optionalBoolean(patch, "lockedSchedule") === undefined
      ? {}
      : { lockedSchedule: optionalBoolean(patch, "lockedSchedule") }),
    ...(optionalNullableText(patch, "snoozeUntil") === undefined
      ? {}
      : { snoozeUntil: optionalNullableText(patch, "snoozeUntil") }),
    ...(optionalTextArray(patch, "tags") === undefined ? {} : { tags: optionalTextArray(patch, "tags") })
  };
}

function taskMoveFromJson(id: string, input: DomainJsonObject): TaskMoveRequest {
  const request: TaskMoveRequest = {
    id,
    ...(optionalText(input, "taskListId") === undefined && optionalText(input, "listId") === undefined
      ? {}
      : { listId: optionalText(input, "taskListId") ?? optionalText(input, "listId") }),
    ...(optionalNullableText(input, "parentId") === undefined
      ? {}
      : { parentId: optionalNullableText(input, "parentId") }),
    ...(optionalNullableText(input, "previousSiblingId") === undefined
      ? {}
      : { previousSiblingId: optionalNullableText(input, "previousSiblingId") })
  };

  if (
    request.listId === undefined &&
    request.parentId === undefined &&
    request.previousSiblingId === undefined
  ) {
    throw new Error("At least one task move field must be supplied.");
  }

  return request;
}

function scheduledTaskBlockFromJson(input: DomainJsonObject) {
  return {
    taskId: requiredText(input, "taskId"),
    calendarId: requiredText(input, "calendarId"),
    startsAt: optionalText(input, "startsAt") ?? requiredText(input, "startDate"),
    durationMinutes: optionalNumber(input, "durationMinutes") ?? 30
  };
}

function previewScheduleTaskBlock(
  repository: LocalPlannerRepository,
  input: DomainJsonObject
): DomainJsonObject {
  const request = scheduledTaskBlockFromJson(input);
  const task = repository.getTask(request.taskId);
  const calendar = repository.listCalendars({ limit: 100 }).items.find((item) => item.id === request.calendarId);
  const startsAtMs = Date.parse(request.startsAt);

  if (!calendar) {
    throw new Error("Calendar was not found.");
  }

  return jsonObject({
    kind: "scheduledTaskBlock",
    taskId: request.taskId,
    calendarId: request.calendarId,
    title: task.title,
    startsAt: request.startsAt,
    endsAt: new Date(startsAtMs + request.durationMinutes * 60_000).toISOString(),
    durationMinutes: request.durationMinutes,
    calendarTitle: calendar.title ?? calendar.id
  });
}

function taskListById(repository: LocalPlannerRepository, id: string): object {
  const taskList = repository.listTaskLists({ limit: 1_000 }).items.find((candidate) => candidate.id === id);

  if (!taskList) {
    throw new Error("Task list was not found.");
  }

  return taskList;
}

function noteListById(repository: LocalPlannerRepository, id: string): object {
  const noteList = repository.listNotes({ limit: 1 }).lists.find((candidate) => candidate.id === id);

  if (!noteList) {
    throw new Error("Note list was not found.");
  }

  return noteList;
}

function requiredText(input: DomainJsonObject, key: string): string {
  const value = optionalText(input, key);

  if (!value) {
    throw new Error(`Missing required string argument '${key}'.`);
  }

  return value;
}

function optionalNullableText(input: DomainJsonObject, key: string): string | null | undefined {
  const value = input[key];

  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed === "null" ? null : trimmed;
}

function optionalText(input: DomainJsonObject, key: string): string | undefined {
  const value = input[key];

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function optionalNumber(input: DomainJsonObject, key: string): number | undefined {
  const value = input[key];

  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalNullableNumber(input: DomainJsonObject, key: string): number | null | undefined {
  const value = input[key];

  if (value === null) {
    return null;
  }

  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
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

function optionalRecurrence(input: DomainJsonObject): CalendarEventRecurrence | null | undefined {
  const value = input.recurrence;

  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("recurrence must be an object or null.");
  }

  const object = value as DomainJsonObject;
  const frequency = optionalText(object, "frequency");
  const interval = optionalNumber(object, "interval") ?? 1;

  if (
    frequency !== "daily" &&
    frequency !== "weekly" &&
    frequency !== "monthly" &&
    frequency !== "yearly"
  ) {
    throw new Error("recurrence.frequency must be daily, weekly, monthly, or yearly.");
  }

  return {
    frequency,
    interval,
    ...(optionalNullableText(object, "endsOn") === undefined
      ? {}
      : { endsOn: optionalNullableText(object, "endsOn") }),
    ...(optionalNullableNumber(object, "count") === undefined
      ? {}
      : { count: optionalNullableNumber(object, "count") }),
    ...(optionalTextArray(object, "byDay") === undefined ? {} : { byDay: byDayArray(object) })
  };
}

function byDayArray(input: DomainJsonObject): CalendarEventRecurrence["byDay"] {
  return (optionalTextArray(input, "byDay") ?? []).filter(
    (day): day is NonNullable<CalendarEventRecurrence["byDay"]>[number] =>
      day === "SU" || day === "MO" || day === "TU" || day === "WE" || day === "TH" || day === "FR" || day === "SA"
  );
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
