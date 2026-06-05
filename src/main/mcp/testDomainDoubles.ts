import type { McpDomainServices } from "./domainServices";
import { McpToolError } from "./errors";
import type { JsonObject, JsonValue } from "./types";

interface TestDomainState {
  tasks: Map<string, JsonObject>;
  notes: Map<string, JsonObject>;
  events: Map<string, JsonObject>;
  taskLists: JsonObject[];
  noteLists: JsonObject[];
  calendars: JsonObject[];
  pendingMutations: JsonObject[];
  nextTaskId: number;
  nextNoteId: number;
  nextEventId: number;
  nextTaskListId: number;
  nextNoteListId: number;
  undoStatus: JsonObject;
}

export interface McpTestDomainServices extends McpDomainServices {
  readonly state: TestDomainState;
}

export function createMcpTestDomainServices(): McpTestDomainServices {
  const state: TestDomainState = {
    tasks: new Map([
      [
        "task-1",
        {
          kind: "task",
          id: "task-1",
          title: "Plan launch checklist",
          notes: "Private task notes",
          status: "needsAction",
          isCompleted: false,
          dueDate: "2026-05-22T00:00:00.000Z",
          taskListId: "list-inbox",
          taskListTitle: "Inbox",
          deepLink: "hotcrossbuns://task/task-1"
        }
      ]
    ]),
    notes: new Map([
      [
        "note-1",
        {
          kind: "note",
          id: "note-1",
          title: "Local note",
          body: "Only stored locally",
          deepLink: "hotcrossbuns://note/note-1"
        }
      ]
    ]),
    events: new Map([
      [
        "event-1",
        {
          kind: "event",
          id: "event-1",
          title: "Planning review",
          details: "Calendar event details",
          startDate: "2026-05-22T09:00:00.000Z",
          endDate: "2026-05-22T10:00:00.000Z",
          isAllDay: false,
          calendarId: "cal-primary",
          calendarTitle: "Primary",
          location: "Office",
          deepLink: "hotcrossbuns://event/event-1"
        }
      ]
    ]),
    taskLists: [
      {
        kind: "taskList",
        id: "list-inbox",
        title: "Inbox"
      }
    ],
    noteLists: [
      {
        kind: "noteList",
        id: "note-list:default",
        title: "Local notes",
        noteCount: 1,
        updatedAt: "2026-05-22T00:00:00.000Z"
      }
    ],
    calendars: [
      {
        kind: "calendar",
        id: "cal-primary",
        summary: "Primary",
        isSelected: true,
        accessRole: "owner"
      }
    ],
    pendingMutations: [
      {
        kind: "mutation",
        id: "mutation-1",
        resourceType: "task",
        resourceId: "task-1",
        operation: "update",
        status: "pending",
        attemptCount: 0,
        nextRetryAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        createdAt: "2026-05-22T00:00:00.000Z",
        updatedAt: "2026-05-22T00:00:00.000Z"
      }
    ],
    nextTaskId: 2,
    nextNoteId: 2,
    nextEventId: 2,
    nextTaskListId: 2,
    nextNoteListId: 2,
    undoStatus: {
      kind: "undoStatus",
      canUndo: true,
      canRedo: true,
      undoLabel: "Edit task",
      redoLabel: "Edit note"
    }
  };

  return {
    state,
    planning: {
      search: ({ query, limit = 20 }) => {
        const normalized = query.toLowerCase();
        const all = [
          ...state.tasks.values(),
          ...state.notes.values(),
          ...state.events.values(),
          ...state.taskLists,
          ...state.noteLists,
          ...state.calendars
        ];

        return all
          .filter((item) => JSON.stringify(item).toLowerCase().includes(normalized))
          .slice(0, Math.max(1, Math.min(100, limit)))
          .map(cloneObject);
      },
      today: () => ({
        date: "2026-05-22",
        tasks: [...state.tasks.values()].map(cloneObject),
        notes: [...state.notes.values()].map(cloneObject),
        events: [...state.events.values()].map(cloneObject)
      }),
      week: ({ startDate }) => ({
        startDate: startDate ?? "2026-05-22",
        endDate: "2026-05-29",
        tasks: [...state.tasks.values()].map(cloneObject),
        events: [...state.events.values()].map(cloneObject)
      })
    },
    tasks: {
      getTask: (id) => cloneExisting(state.tasks, id, "Task"),
      listTaskLists: () => state.taskLists.map(cloneObject),
      previewCreateTaskList: (input) =>
        compactObject({
          kind: "taskList",
          title: requiredText(input, "title")
        }),
      createTaskList: (input) => {
        const id = `task-list-${state.nextTaskListId}`;
        state.nextTaskListId += 1;
        const taskList = compactObject({
          kind: "taskList",
          id,
          title: requiredText(input, "title")
        });
        state.taskLists.push(taskList);
        return cloneObject(taskList);
      },
      previewRenameTaskList: (id, input) => ({
        ...cloneList(state.taskLists, id, "Task list"),
        title: requiredText(input, "title")
      }),
      renameTaskList: (id, input) => {
        const taskList = cloneList(state.taskLists, id, "Task list");
        const updated = {
          ...taskList,
          title: requiredText(input, "title")
        };
        const index = state.taskLists.findIndex((candidate) => candidate.id === id);
        state.taskLists[index] = updated;
        return cloneObject(updated);
      },
      previewDeleteTaskList: (id) => cloneList(state.taskLists, id, "Task list"),
      deleteTaskList: (id) => {
        const taskList = cloneList(state.taskLists, id, "Task list");
        const index = state.taskLists.findIndex((candidate) => candidate.id === id);
        state.taskLists.splice(index, 1);
        return cloneObject(taskList);
      },
      previewCreateTask: (input) =>
        compactObject({
          kind: "task",
          title: requiredText(input, "title"),
          notes: optionalText(input, "notes"),
          dueDate: optionalText(input, "dueDate"),
          taskListId: optionalText(input, "taskListId") ?? "list-inbox",
          parentId: nullableText(input, "parentId"),
          previousSiblingId: nullableText(input, "previousSiblingId"),
          priority: optionalText(input, "priority"),
          plannedStart: nullableText(input, "plannedStart"),
          plannedEnd: nullableText(input, "plannedEnd"),
          durationMinutes: optionalNumber(input, "durationMinutes"),
          lockedSchedule: optionalBoolean(input, "lockedSchedule"),
          snoozeUntil: nullableText(input, "snoozeUntil"),
          tags: arrayValue(input, "tags"),
          deepLink: "hotcrossbuns://task/preview"
        }),
      createTask: (input) => {
        const id = `task-${state.nextTaskId}`;
        state.nextTaskId += 1;
        const task = compactObject({
          kind: "task",
          id,
          title: requiredText(input, "title"),
          notes: optionalText(input, "notes"),
          status: "needsAction",
          isCompleted: false,
          dueDate: optionalText(input, "dueDate"),
          taskListId: optionalText(input, "taskListId") ?? "list-inbox",
          parentId: nullableText(input, "parentId"),
          previousSiblingId: nullableText(input, "previousSiblingId"),
          priority: optionalText(input, "priority"),
          plannedStart: nullableText(input, "plannedStart"),
          plannedEnd: nullableText(input, "plannedEnd"),
          durationMinutes: optionalNumber(input, "durationMinutes"),
          lockedSchedule: optionalBoolean(input, "lockedSchedule"),
          snoozeUntil: nullableText(input, "snoozeUntil"),
          tags: arrayValue(input, "tags"),
          deepLink: `hotcrossbuns://task/${id}`
        });
        state.tasks.set(id, task);
        return cloneObject(task);
      },
      previewUpdateTask: (id, patch) => ({
        ...cloneExisting(state.tasks, id, "Task"),
        patch: redactedPatch(patch)
      }),
      updateTask: (id, patch) => {
        const task = cloneExisting(state.tasks, id, "Task");
        const updated = compactObject({ ...task, ...patch });
        state.tasks.set(id, updated);
        return cloneObject(updated);
      },
      previewCompleteTask: (id) => ({
        ...cloneExisting(state.tasks, id, "Task"),
        targetStatus: "completed"
      }),
      completeTask: (id) => {
        const task = cloneExisting(state.tasks, id, "Task");
        const updated = { ...task, status: "completed", isCompleted: true };
        state.tasks.set(id, updated);
        return cloneObject(updated);
      },
      previewReopenTask: (id) => ({
        ...cloneExisting(state.tasks, id, "Task"),
        targetStatus: "needsAction"
      }),
      reopenTask: (id) => {
        const task = cloneExisting(state.tasks, id, "Task");
        const updated = { ...task, status: "needsAction", isCompleted: false };
        state.tasks.set(id, updated);
        return cloneObject(updated);
      },
      previewMoveTask: (id, input) => ({
        ...cloneExisting(state.tasks, id, "Task"),
        move: cloneObject(input)
      }),
      moveTask: (id, input) => {
        const task = cloneExisting(state.tasks, id, "Task");
        const updated = compactObject({
          ...task,
          taskListId: optionalText(input, "taskListId") ?? optionalText(input, "listId") ?? optionalText(task, "taskListId"),
          parentId: input.parentId === undefined ? task.parentId : input.parentId,
          previousSiblingId: input.previousSiblingId === undefined ? task.previousSiblingId : input.previousSiblingId
        });
        state.tasks.set(id, updated);
        return cloneObject(updated);
      },
      previewDeleteTask: (id) => cloneExisting(state.tasks, id, "Task"),
      deleteTask: (id) => {
        const task = cloneExisting(state.tasks, id, "Task");
        state.tasks.delete(id);
        return task;
      }
    },
    notes: {
      getNote: (id) => cloneExisting(state.notes, id, "Note"),
      listNoteLists: () => state.noteLists.map(cloneObject),
      previewCreateNoteList: (input) =>
        compactObject({
          kind: "noteList",
          title: requiredText(input, "title"),
          noteCount: 0,
          updatedAt: "2026-05-22T00:00:00.000Z"
        }),
      createNoteList: (input) => {
        const id = `note-list:${state.nextNoteListId}`;
        state.nextNoteListId += 1;
        const noteList = compactObject({
          kind: "noteList",
          id,
          title: requiredText(input, "title"),
          noteCount: 0,
          updatedAt: "2026-05-22T00:00:00.000Z"
        });
        state.noteLists.push(noteList);
        return cloneObject(noteList);
      },
      previewRenameNoteList: (id, input) => ({
        ...cloneList(state.noteLists, id, "Note list"),
        title: requiredText(input, "title")
      }),
      renameNoteList: (id, input) => {
        const noteList = cloneList(state.noteLists, id, "Note list");
        const updated = {
          ...noteList,
          title: requiredText(input, "title")
        };
        const index = state.noteLists.findIndex((candidate) => candidate.id === id);
        state.noteLists[index] = updated;
        return cloneObject(updated);
      },
      previewDeleteNoteList: (id) => cloneList(state.noteLists, id, "Note list"),
      deleteNoteList: (id) => {
        const noteList = cloneList(state.noteLists, id, "Note list");
        const index = state.noteLists.findIndex((candidate) => candidate.id === id);
        state.noteLists.splice(index, 1);
        return cloneObject(noteList);
      },
      previewCreateNote: (input) =>
        compactObject({
          kind: "note",
          title: requiredText(input, "title"),
          body: optionalText(input, "body") ?? optionalText(input, "notes"),
          listId: optionalText(input, "noteListId") ?? optionalText(input, "listId"),
          deepLink: "hotcrossbuns://note/preview"
        }),
      createNote: (input) => {
        const id = `note-${state.nextNoteId}`;
        state.nextNoteId += 1;
        const note = compactObject({
          kind: "note",
          id,
          title: requiredText(input, "title"),
          body: optionalText(input, "body") ?? optionalText(input, "notes"),
          listId: optionalText(input, "noteListId") ?? optionalText(input, "listId"),
          linkedTaskId: optionalText(input, "linkedTaskId"),
          linkedEventId: optionalText(input, "linkedEventId"),
          deepLink: `hotcrossbuns://note/${id}`
        });
        state.notes.set(id, note);
        return cloneObject(note);
      },
      previewUpdateNote: (id, patch) => ({
        ...cloneExisting(state.notes, id, "Note"),
        patch: redactedPatch(patch)
      }),
      updateNote: (id, patch) => {
        const note = cloneExisting(state.notes, id, "Note");
        const updated = compactObject({ ...note, ...patch });
        state.notes.set(id, updated);
        return cloneObject(updated);
      },
      previewDeleteNote: (id) => cloneExisting(state.notes, id, "Note"),
      deleteNote: (id) => {
        const note = cloneExisting(state.notes, id, "Note");
        state.notes.delete(id);
        return note;
      }
    },
    calendar: {
      getEvent: (id) => cloneExisting(state.events, id, "Event"),
      listCalendars: () => state.calendars.map(cloneObject),
      previewCreateEvent: (input) =>
        compactObject({
          kind: "event",
          title: requiredText(input, "title"),
          details: optionalText(input, "details") ?? optionalText(input, "notes"),
          startDate: requiredText(input, "startDate"),
          endDate: optionalText(input, "endDate"),
          calendarId: optionalText(input, "calendarId") ?? "cal-primary",
          guestEmails: arrayValue(input, "guestEmails"),
          reminderMinutes: arrayValue(input, "reminderMinutes"),
          colorId: nullableText(input, "colorId"),
          recurrence: objectValue(input, "recurrence"),
          deepLink: "hotcrossbuns://event/preview"
        }),
      createEvent: (input) => {
        const id = `event-${state.nextEventId}`;
        state.nextEventId += 1;
        const event = compactObject({
          kind: "event",
          id,
          title: requiredText(input, "title"),
          details: optionalText(input, "details") ?? optionalText(input, "notes"),
          startDate: requiredText(input, "startDate"),
          endDate: optionalText(input, "endDate") ?? requiredText(input, "startDate"),
          isAllDay: input.isAllDay === true,
          calendarId: optionalText(input, "calendarId") ?? "cal-primary",
          location: optionalText(input, "location"),
          guestEmails: arrayValue(input, "guestEmails"),
          reminderMinutes: arrayValue(input, "reminderMinutes"),
          colorId: nullableText(input, "colorId"),
          recurrence: objectValue(input, "recurrence"),
          deepLink: `hotcrossbuns://event/${id}`
        });
        state.events.set(id, event);
        return cloneObject(event);
      },
      previewUpdateEvent: (id, patch) => ({
        ...cloneExisting(state.events, id, "Event"),
        patch: redactedPatch(patch)
      }),
      updateEvent: (id, patch) => {
        const event = cloneExisting(state.events, id, "Event");
        const updated = compactObject({ ...event, ...patch });
        state.events.set(id, updated);
        return cloneObject(updated);
      },
      previewCompleteEvent: (id, input) =>
        compactObject({
          ...cloneExisting(state.events, id, "Event"),
          scope: optionalText(input, "scope") ?? "occurrence",
          targetStatus: "completed"
        }),
      completeEvent: (id, input) => {
        const event = cloneExisting(state.events, id, "Event");
        const updated = compactObject({
          ...event,
          completedAt: "2026-05-22T00:00:00.000Z",
          completionScopeApplied: optionalText(input, "scope") ?? "occurrence"
        });
        state.events.set(id, updated);
        return cloneObject(updated);
      },
      previewReopenEvent: (id, input) =>
        compactObject({
          ...cloneExisting(state.events, id, "Event"),
          scope: optionalText(input, "scope") ?? "occurrence",
          targetStatus: "open"
        }),
      reopenEvent: (id, input) => {
        const event = cloneExisting(state.events, id, "Event");
        const updated = compactObject({
          ...event,
          completedAt: null,
          completionScopeApplied: optionalText(input, "scope") ?? "occurrence"
        });
        state.events.set(id, updated);
        return cloneObject(updated);
      },
      previewDeleteEvent: (id) => cloneExisting(state.events, id, "Event"),
      deleteEvent: (id) => {
        const event = cloneExisting(state.events, id, "Event");
        state.events.delete(id);
        return event;
      },
      previewScheduleTaskBlock: (input) =>
        compactObject({
          kind: "scheduledTaskBlock",
          taskId: requiredText(input, "taskId"),
          calendarId: requiredText(input, "calendarId"),
          startsAt: requiredText(input, "startDate"),
          durationMinutes: optionalNumber(input, "durationMinutes") ?? 30
        }),
      scheduleTaskBlock: (input) =>
        compactObject({
          kind: "scheduledTaskBlock",
          id: "scheduled-task-block-1",
          taskId: requiredText(input, "taskId"),
          calendarId: requiredText(input, "calendarId"),
          startsAt: requiredText(input, "startDate"),
          durationMinutes: optionalNumber(input, "durationMinutes") ?? 30
        })
    },
    diagnostics: {
      status: () => ({
        kind: "diagnosticsStatus",
        generatedAt: "2026-05-22T00:00:00.000Z",
        account: {
          state: "connected",
          grantedScopeCount: 2,
          missingScopeCount: 0
        },
        sync: {
          state: "idle",
          pendingMutationCount: 1,
          mode: "manual"
        },
        cache: {
          taskListCount: state.taskLists.length,
          taskCount: state.tasks.size,
          calendarCount: state.calendars.length,
          eventCount: state.events.size,
          noteCount: state.notes.size
        },
        pendingMutations: {
          totalCount: 1,
          pendingCount: 1,
          applyingCount: 0,
          failedCount: 0,
          retryableCount: 0,
          authPausedCount: 0,
          byResourceType: [{ resourceType: "task", count: 1 }]
        },
        mcp: {
          enabled: true,
          permissionMode: "read-only",
          configuredPort: 4777
        }
      }),
      logs: ({ limit = 50 }) =>
        [
          {
            kind: "log",
            id: "log-1",
            timestamp: "2026-05-22T00:00:00.000Z",
            level: "info",
            category: "mcp",
            message: "MCP fixture log",
            formattedLine: "[2026-05-22T00:00:00.000Z] [INFO] [mcp] MCP fixture log"
          }
        ].slice(0, Math.max(1, Math.min(100, limit))),
      diff: () => state.pendingMutations.map(cloneObject),
      show: ({ kind, id }) => {
        if (kind === "diagnostics") {
          const diagnostics: JsonObject = {
            kind: "diagnosticsStatus",
            generatedAt: "2026-05-22T00:00:00.000Z"
          };

          return diagnostics;
        }

        if (kind === "mutation" && id === "mutation-1") {
          const mutation: JsonObject = {
            kind: "mutation",
            id,
            resourceType: "task",
            resourceId: "task-1",
            operation: "update",
            status: "pending"
          };

          return mutation;
        }

        throw new McpToolError("NOT_FOUND", "Diagnostics item was not found.");
      }
    },
    undo: {
      status: () => cloneObject(state.undoStatus),
      undo: () => {
        if (state.undoStatus.canUndo !== true) {
          throw new McpToolError("INVALID_ARGUMENTS", "Nothing to undo.");
        }

        state.undoStatus = {
          kind: "undoStatus",
          canUndo: false,
          canRedo: true,
          redoLabel: "Edit task"
        };
        return {
          kind: "undoAction",
          action: "undo",
          applied: true,
          title: "Edit task",
          label: "Edit task",
          resourceKind: "task",
          resourceId: "task-1"
        };
      },
      redo: () => {
        if (state.undoStatus.canRedo !== true) {
          throw new McpToolError("INVALID_ARGUMENTS", "Nothing to redo.");
        }

        state.undoStatus = {
          kind: "undoStatus",
          canUndo: true,
          canRedo: false,
          undoLabel: "Edit note"
        };
        return {
          kind: "undoAction",
          action: "redo",
          applied: true,
          title: "Edit note",
          label: "Edit note",
          resourceKind: "note",
          resourceId: "note-1"
        };
      }
    },
    syncQueue: {
      previewRunNow: (input) => ({
        kind: "syncRun",
        accepted: true,
        dryRun: true,
        resources: syncResources(input),
        full: input.full === true
      }),
      runNow: (input) => ({
        kind: "syncRun",
        accepted: true,
        dryRun: false,
        resources: syncResources(input),
        full: input.full === true
      }),
      pendingMutations: ({ limit = 100 }) =>
        state.pendingMutations.slice(0, Math.max(1, Math.min(200, limit))).map(cloneObject),
      previewRetryMutation: (id) => ({
        ...cloneMutation(state, id),
        kind: "mutationAction",
        action: "retry",
        status: "pending"
      }),
      retryMutation: (id) => {
        const mutation = cloneMutation(state, id);
        mutation.status = "pending";
        mutation.updatedAt = "2026-06-04T00:00:00.000Z";
        return {
          kind: "mutationAction",
          action: "retry",
          id,
          status: "pending",
          updatedAt: mutation.updatedAt
        };
      },
      previewCancelMutation: (id) => ({
        ...cloneMutation(state, id),
        kind: "mutationAction",
        action: "cancel",
        status: "cancelled"
      }),
      cancelMutation: (id) => {
        const mutation = cloneMutation(state, id);
        state.pendingMutations = state.pendingMutations.filter((candidate) => candidate.id !== id);
        return {
          kind: "mutationAction",
          action: "cancel",
          id,
          status: "cancelled",
          updatedAt: "2026-06-04T00:00:00.000Z",
          resourceType: mutation.resourceType,
          resourceId: mutation.resourceId
        };
      }
    }
  };
}

function syncResources(input: JsonObject): string[] {
  const resources = Array.isArray(input.resources)
    ? input.resources.filter((item): item is string => item === "tasks" || item === "calendar")
    : [];
  return resources.length === 0 ? ["tasks", "calendar"] : resources;
}

function cloneMutation(state: TestDomainState, id: string): JsonObject {
  const mutation = state.pendingMutations.find((candidate) => candidate.id === id);

  if (!mutation) {
    throw new McpToolError("NOT_FOUND", "Pending mutation was not found.");
  }

  return cloneObject(mutation);
}

function cloneExisting(source: Map<string, JsonObject>, id: string, label: string): JsonObject {
  const item = source.get(id);

  if (!item) {
    throw new McpToolError("NOT_FOUND", `${label} was not found.`);
  }

  return cloneObject(item);
}

function cloneList(source: JsonObject[], id: string, label: string): JsonObject {
  const item = source.find((candidate) => candidate.id === id);

  if (!item) {
    throw new McpToolError("NOT_FOUND", `${label} was not found.`);
  }

  return cloneObject(item);
}

function cloneObject<T extends JsonObject>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function compactObject(input: Record<string, JsonValue | undefined>): JsonObject {
  const output: JsonObject = {};

  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) {
      output[key] = value;
    }
  }

  return output;
}

function requiredText(input: JsonObject, key: string): string {
  const value = optionalText(input, key);

  if (!value) {
    throw new McpToolError("INVALID_ARGUMENTS", `Missing required string argument '${key}'.`);
  }

  return value;
}

function optionalText(input: JsonObject, key: string): string | undefined {
  const value = input[key];

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function nullableText(input: JsonObject, key: string): string | null | undefined {
  const value = input[key];

  if (value === null) {
    return null;
  }

  return optionalText(input, key);
}

function optionalNumber(input: JsonObject, key: string): number | undefined {
  const value = input[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalBoolean(input: JsonObject, key: string): boolean | undefined {
  const value = input[key];
  return typeof value === "boolean" ? value : undefined;
}

function arrayValue(input: JsonObject, key: string): JsonValue[] | undefined {
  const value = input[key];
  return Array.isArray(value) ? value : undefined;
}

function objectValue(input: JsonObject, key: string): JsonObject | undefined {
  const value = input[key];
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? cloneObject(value as JsonObject)
    : undefined;
}

function redactedPatch(patch: JsonObject): JsonObject {
  const output: JsonObject = {};

  for (const key of Object.keys(patch).sort()) {
    output[key] = sensitiveKey(key) ? "[redacted]" : patch[key];
  }

  return output;
}

function sensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return (
    normalized.includes("token") ||
    normalized.includes("secret") ||
    normalized.includes("password") ||
    normalized.includes("credential")
  );
}
