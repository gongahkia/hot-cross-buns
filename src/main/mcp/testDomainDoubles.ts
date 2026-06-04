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
  nextTaskId: number;
  nextNoteId: number;
  nextEventId: number;
  nextTaskListId: number;
  nextNoteListId: number;
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
    nextTaskId: 2,
    nextNoteId: 2,
    nextEventId: 2,
    nextTaskListId: 2,
    nextNoteListId: 2
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
      previewCreateTask: (input) =>
        compactObject({
          kind: "task",
          title: requiredText(input, "title"),
          notes: optionalText(input, "notes"),
          dueDate: optionalText(input, "dueDate"),
          taskListId: optionalText(input, "taskListId") ?? "list-inbox",
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
      previewMoveTask: (id, taskListId) => ({
        ...cloneExisting(state.tasks, id, "Task"),
        targetTaskListId: taskListId
      }),
      moveTask: (id, taskListId) => {
        const task = cloneExisting(state.tasks, id, "Task");
        const updated = { ...task, taskListId };
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
      previewCreateNote: (input) =>
        compactObject({
          kind: "note",
          title: requiredText(input, "title"),
          body: optionalText(input, "body") ?? optionalText(input, "notes"),
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
      previewDeleteEvent: (id) => cloneExisting(state.events, id, "Event"),
      deleteEvent: (id) => {
        const event = cloneExisting(state.events, id, "Event");
        state.events.delete(id);
        return event;
      }
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
      diff: () => [
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
    }
  };
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
