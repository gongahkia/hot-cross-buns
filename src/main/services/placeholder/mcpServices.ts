import type { NoteDetail } from "@shared/ipc/contracts";
import type { DomainJsonObject, McpDomainServices } from "../domainInterfaces";
import {
  calendarJson,
  noteJson,
  taskJson
} from "./serializers";
import type {
  CalendarRecord,
  PlaceholderState,
  TaskRecord
} from "./state";
import {
  compactJsonObject,
  eventPatch,
  optionalText,
  preview,
  requiredById,
  requiredText,
  taskPatch,
  textMatches
} from "./utils";

export function createMcpDomainServices(state: PlaceholderState): McpDomainServices {
  return {
    planning: {
      search: ({ query, limit = 20 }) => {
        const normalized = query.trim().toLowerCase();
        const results = [
          ...state.tasks
            .filter((task) => textMatches(normalized, task.title, task.notes, task.listTitle))
            .map(taskJson),
          ...state.calendarEvents
            .filter((event) =>
              textMatches(normalized, event.title, event.location, event.notes, event.calendarTitle)
            )
            .map(calendarJson),
          ...state.notes
            .filter((note) => textMatches(normalized, note.title, note.preview, note.body))
            .map(noteJson)
        ];

        return results.slice(0, Math.max(1, Math.min(100, limit)));
      },
      today: () => ({
        date: "2026-05-22",
        tasks: state.tasks.slice(0, 10).map(taskJson),
        events: state.calendarEvents.slice(0, 10).map(calendarJson),
        notes: state.notes.slice(0, 5).map(noteJson)
      }),
      week: ({ startDate }) => ({
        startDate: startDate ?? "2026-05-22",
        tasks: state.tasks.slice(0, 20).map(taskJson),
        events: state.calendarEvents.slice(0, 20).map(calendarJson)
      })
    },
    tasks: {
      getTask: (id) => taskJson(requiredById(state.tasks, id, "Task")),
      listTaskLists: () =>
        state.taskLists.map((taskList) => ({
          kind: "taskList",
          id: taskList.id,
          title: taskList.title
        })),
      previewCreateTask: (input) => compactJsonObject({
        kind: "task",
        title: requiredText(input, "title"),
        notes: optionalText(input, "notes"),
        taskListId: optionalText(input, "taskListId") ?? "list-inbox",
        deepLink: "hotcrossbuns://task/preview"
      }),
      createTask: (input) => {
        const id = `task-local-${state.tasks.length + 1}`;
        const task: TaskRecord = {
          id,
          listId: optionalText(input, "taskListId") ?? "list-inbox",
          listTitle: "Inbox",
          title: requiredText(input, "title"),
          status: "active",
          dueAt: optionalText(input, "dueDate") ?? null,
          updatedAt: new Date().toISOString(),
          notes: optionalText(input, "notes"),
          parentId: null,
          priority: "none"
        };

        state.tasks.unshift(task);
        state.sync.pendingMutationCount += 1;

        return taskJson(task);
      },
      previewUpdateTask: (id, patch) => ({ ...taskJson(requiredById(state.tasks, id, "Task")), patch }),
      updateTask: (id, patch) => {
        const task = requiredById(state.tasks, id, "Task");
        Object.assign(task, taskPatch(patch), { updatedAt: new Date().toISOString() });
        state.sync.pendingMutationCount += 1;
        return taskJson(task);
      },
      previewCompleteTask: (id) => ({ ...taskJson(requiredById(state.tasks, id, "Task")), targetStatus: "completed" }),
      completeTask: (id) => {
        const task = requiredById(state.tasks, id, "Task");
        task.status = "completed";
        task.updatedAt = new Date().toISOString();
        state.sync.pendingMutationCount += 1;
        return taskJson(task);
      },
      previewReopenTask: (id) => ({ ...taskJson(requiredById(state.tasks, id, "Task")), targetStatus: "active" }),
      reopenTask: (id) => {
        const task = requiredById(state.tasks, id, "Task");
        task.status = "active";
        task.updatedAt = new Date().toISOString();
        state.sync.pendingMutationCount += 1;
        return taskJson(task);
      },
      previewMoveTask: (id, taskListId) => ({ ...taskJson(requiredById(state.tasks, id, "Task")), targetTaskListId: taskListId }),
      moveTask: (id, taskListId) => {
        const task = requiredById(state.tasks, id, "Task");
        const taskList = state.taskLists.find((candidate) => candidate.id === taskListId);
        task.listId = taskListId;
        task.listTitle = taskList?.title ?? task.listTitle;
        task.updatedAt = new Date().toISOString();
        state.sync.pendingMutationCount += 1;
        return taskJson(task);
      },
      previewDeleteTask: (id) => taskJson(requiredById(state.tasks, id, "Task")),
      deleteTask: (id) => {
        const index = state.tasks.findIndex((candidate) => candidate.id === id);

        if (index < 0) {
          throw new Error("Task was not found.");
        }

        const [task] = state.tasks.splice(index, 1);
        state.sync.pendingMutationCount += 1;
        return taskJson(task);
      }
    },
    notes: {
      getNote: (id) => noteJson(requiredById(state.notes, id, "Note")),
      listNoteLists: () => noteListsFromState(state),
      previewCreateNote: (input) => compactJsonObject({
        kind: "note",
        title: requiredText(input, "title"),
        body: optionalText(input, "body"),
        deepLink: "hotcrossbuns://note/preview"
      }),
      createNote: (input) => {
        const id = `note-local-${state.notes.length + 1}`;
        const body = optionalText(input, "body") ?? "";
        const note: NoteDetail = {
          id,
          listId: "note-list:default",
          listTitle: "Local notes",
          title: requiredText(input, "title"),
          preview: preview(body),
          body,
          updatedAt: new Date().toISOString()
        };

        state.notes.unshift(note);
        return noteJson(note);
      },
      previewUpdateNote: (id, patch) => ({ ...noteJson(requiredById(state.notes, id, "Note")), patch }),
      updateNote: (id, patch) => {
        const note = requiredById(state.notes, id, "Note");
        const title = optionalText(patch, "title");
        const body = optionalText(patch, "body");

        if (title !== undefined) {
          note.title = title;
        }

        if (body !== undefined) {
          note.body = body;
          note.preview = preview(body);
        }

        note.updatedAt = new Date().toISOString();
        return noteJson(note);
      },
      previewDeleteNote: (id) => noteJson(requiredById(state.notes, id, "Note")),
      deleteNote: (id) => {
        const index = state.notes.findIndex((candidate) => candidate.id === id);

        if (index < 0) {
          throw new Error("Note was not found.");
        }

        const [note] = state.notes.splice(index, 1);
        return noteJson(note);
      }
    },
    calendar: {
      getEvent: (id) => calendarJson(requiredById(state.calendarEvents, id, "Event")),
      listCalendars: () =>
        state.calendars.map((calendar) => ({
          kind: "calendar",
          id: calendar.id,
          title: calendar.title,
          selected: calendar.selected
        })),
      previewCreateEvent: (input) => compactJsonObject({
        kind: "event",
        title: requiredText(input, "title"),
        startDate: requiredText(input, "startDate"),
        endDate: optionalText(input, "endDate"),
        calendarId: optionalText(input, "calendarId") ?? "cal-product",
        deepLink: "hotcrossbuns://event/preview"
      }),
      createEvent: (input) => {
        const id = `event-local-${state.calendarEvents.length + 1}`;
        const calendarId = optionalText(input, "calendarId") ?? "cal-product";
        const calendar = state.calendars.find((candidate) => candidate.id === calendarId);
        const event: CalendarRecord = {
          id,
          calendarId,
          calendarTitle: calendar?.title ?? "Calendar",
          title: requiredText(input, "title"),
          startsAt: requiredText(input, "startDate"),
          endsAt: optionalText(input, "endDate") ?? requiredText(input, "startDate"),
          allDay: input.isAllDay === true,
          updatedAt: new Date().toISOString(),
          location: optionalText(input, "location"),
          notes: optionalText(input, "details")
        };

        state.calendarEvents.unshift(event);
        state.sync.pendingMutationCount += 1;
        return calendarJson(event);
      },
      previewUpdateEvent: (id, patch) => ({ ...calendarJson(requiredById(state.calendarEvents, id, "Event")), patch }),
      updateEvent: (id, patch) => {
        const event = requiredById(state.calendarEvents, id, "Event");
        Object.assign(event, eventPatch(patch), { updatedAt: new Date().toISOString() });
        state.sync.pendingMutationCount += 1;
        return calendarJson(event);
      },
      previewDeleteEvent: (id) => calendarJson(requiredById(state.calendarEvents, id, "Event")),
      deleteEvent: (id) => {
        const index = state.calendarEvents.findIndex((candidate) => candidate.id === id);

        if (index < 0) {
          throw new Error("Event was not found.");
        }

        const [event] = state.calendarEvents.splice(index, 1);
        state.sync.pendingMutationCount += 1;
        return calendarJson(event);
      }
    },
    diagnostics: {
      status: () => ({
        kind: "diagnosticsStatus",
        generatedAt: new Date().toISOString(),
        account: {
          state: "signed_out",
          grantedScopeCount: 0,
          missingScopeCount: 2
        },
        sync: state.sync,
        cache: {
          taskListCount: state.taskLists.length,
          taskCount: state.tasks.length,
          calendarCount: state.calendars.length,
          eventCount: state.calendarEvents.length,
          noteCount: state.notes.length
        },
        pendingMutations: {
          totalCount: state.sync.pendingMutationCount,
          pendingCount: state.sync.pendingMutationCount,
          applyingCount: 0,
          failedCount: 0,
          retryableCount: 0,
          authPausedCount: 0,
          byResourceType: []
        },
        mcp: state.mcp
      }),
      logs: () => [],
      diff: () => [],
      show: ({ kind }) => {
        if (kind === "diagnostics") {
          return {
            kind: "diagnosticsStatus",
            generatedAt: new Date().toISOString(),
            sync: state.sync
          };
        }

        throw new Error("Placeholder diagnostics item was not found.");
      }
    }
  };
}

function noteListsFromState(state: PlaceholderState): DomainJsonObject[] {
  const lists = new Map<string, DomainJsonObject>();

  for (const note of state.notes) {
    const existing = lists.get(note.listId);

    if (existing) {
      const count = typeof existing.noteCount === "number" ? existing.noteCount : 0;
      const updatedAt = typeof existing.updatedAt === "string" && existing.updatedAt > note.updatedAt
        ? existing.updatedAt
        : note.updatedAt;
      existing.noteCount = count + 1;
      existing.updatedAt = updatedAt;
      continue;
    }

    lists.set(note.listId, compactJsonObject({
      kind: "noteList",
      id: note.listId,
      title: note.listTitle,
      noteCount: 1,
      updatedAt: note.updatedAt
    }));
  }

  if (!lists.has("note-list:default")) {
    lists.set("note-list:default", compactJsonObject({
      kind: "noteList",
      id: "note-list:default",
      title: "Local notes",
      noteCount: 0,
      updatedAt: ""
    }));
  }

  return [...lists.values()];
}
