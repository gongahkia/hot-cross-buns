import {
  DEFAULT_LIST_LIMIT,
  DEFAULT_RANGE_LIMIT,
  DEFAULT_SEARCH_LIMIT,
  MAX_LIST_LIMIT,
  MAX_RANGE_LIMIT,
  MAX_SEARCH_LIMIT,
  type CalendarEventSummary,
  type GoogleStatusResponse,
  type McpStatusResponse,
  type NativeCapabilitiesResponse,
  type NoteDetail,
  type NoteSummary,
  type SearchResultItem,
  type ScheduledTaskBlockSummary,
  type SettingsSnapshot,
  type SettingsUpdateRequest,
  type SyncRunNowResponse,
  type SyncStatusResponse,
  type TaskDetail,
  type TaskSummary
} from "@shared/ipc/contracts";
import type {
  AppDomainServices,
  DomainJsonObject,
  DomainJsonValue,
  McpDomainServices
} from "./domainInterfaces";
import {
  buildNativeCapabilityReport,
  capabilityDiagnostic,
  defaultNativeAppPaths,
  nativePlatform as detectNativePlatform
} from "../native/capabilityReport";

type TaskRecord = TaskDetail & {
  listTitle: string;
};

type CalendarRecord = CalendarEventSummary & {
  calendarTitle: string;
  location?: string;
  notes?: string;
  guestEmails?: string[];
  reminderMinutes?: number[];
};

type SearchDomain = SearchResultItem["domain"];
type PlaceholderTaskStatus = TaskSummary["status"];

interface PlaceholderState {
  tasks: TaskRecord[];
  taskLists: Array<{ id: string; title: string }>;
  calendarEvents: CalendarRecord[];
  calendars: Array<{ id: string; title: string; selected: boolean }>;
  scheduledTaskBlocks: ScheduledTaskBlockSummary[];
  notes: NoteDetail[];
  settings: SettingsSnapshot;
  sync: SyncStatusResponse;
  mcp: McpStatusResponse;
}

interface PageWindow<T> {
  items: T[];
  page: {
    limit: number;
    nextCursor?: string;
    totalKnown: number;
  };
}

const nowIso = "2026-05-22T02:00:00.000Z";

export function createPlaceholderDomainServices(): AppDomainServices {
  const state: PlaceholderState = {
    taskLists: [
      { id: "list-inbox", title: "Inbox" },
      { id: "list-planning", title: "Planning" }
    ],
    tasks: [
      {
        id: "task-inbox-rules",
        listId: "list-inbox",
        listTitle: "Inbox",
        title: "Draft inbox triage rules",
        status: "active",
        dueAt: "2026-05-22T00:00:00.000Z",
        updatedAt: nowIso,
        notes: "Define keyboard-first review states before sync writes exist.",
        parentId: null,
        priority: "high"
      },
      {
        id: "task-calendar-fixtures",
        listId: "list-inbox",
        listTitle: "Inbox",
        title: "Review calendar fixture shape",
        status: "active",
        dueAt: "2026-05-22T00:00:00.000Z",
        updatedAt: nowIso,
        notes: "Keep visible rows stable for future agenda virtualization.",
        parentId: null,
        priority: "medium"
      },
      {
        id: "task-shell-visible",
        listId: "list-planning",
        listTitle: "Planning",
        title: "Report shell-visible timing",
        status: "completed",
        dueAt: null,
        updatedAt: "2026-05-21T08:00:00.000Z",
        notes: "Mock-only diagnostics call is already available through preload.",
        parentId: null,
        priority: "low"
      },
      ...Array.from({ length: 140 }, (_, index): TaskRecord => ({
        id: `task-window-${index + 1}`,
        listId: index % 2 === 0 ? "list-inbox" : "list-planning",
        listTitle: index % 2 === 0 ? "Inbox" : "Planning",
        title: `Generated cache task ${String(index + 1).padStart(3, "0")}`,
        status: "active",
        dueAt: index % 3 === 0 ? "2026-05-23T00:00:00.000Z" : null,
        updatedAt: nowIso,
        notes: "Placeholder row for paginated preload calls.",
        parentId: null,
        priority: "none"
      }))
    ],
    calendars: [
      { id: "cal-product", title: "Product", selected: true },
      { id: "cal-engineering", title: "Engineering", selected: true },
      { id: "cal-qa", title: "QA", selected: true }
    ],
    calendarEvents: [
      {
        id: "event-standup",
        calendarId: "cal-product",
        calendarTitle: "Product",
        title: "Planner shell standup",
        startsAt: "2026-05-22T01:30:00.000Z",
        endsAt: "2026-05-22T01:50:00.000Z",
        allDay: false,
        updatedAt: nowIso,
        location: "Local cache",
        notes: "Review Today and Tasks shape."
      },
      {
        id: "event-focus",
        calendarId: "cal-engineering",
        calendarTitle: "Engineering",
        title: "Focused implementation block",
        startsAt: "2026-05-22T03:00:00.000Z",
        endsAt: "2026-05-22T05:00:00.000Z",
        allDay: false,
        updatedAt: nowIso,
        location: "Desk",
        notes: "Renderer-only feature work."
      },
      ...Array.from({ length: 90 }, (_, index): CalendarRecord => {
        const hour = 8 + (index % 10);
        const day = 22 + Math.floor(index / 10);

        return {
          id: `event-window-${index + 1}`,
          calendarId: index % 2 === 0 ? "cal-product" : "cal-engineering",
          calendarTitle: index % 2 === 0 ? "Product" : "Engineering",
          title: `Generated cache event ${String(index + 1).padStart(3, "0")}`,
          startsAt: `2026-05-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:15:00.000Z`,
          endsAt: `2026-05-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:45:00.000Z`,
          allDay: false,
          updatedAt: nowIso,
          location: "Local cache",
          notes: "Placeholder event for range-windowed preload calls."
        };
      })
    ],
    scheduledTaskBlocks: [],
    notes: [
      {
        id: "note-cache-first",
        title: "Cache-first startup",
        preview: "Renderer should paint a useful shell before Google, SQLite, or MCP work is wired.",
        updatedAt: nowIso,
        body: "Renderer should paint a useful shell before Google, SQLite, or MCP work is wired."
      },
      {
        id: "note-command-surface",
        title: "Command palette surface",
        preview: "Commands stay in memory and execute future services as visible controls.",
        updatedAt: "2026-05-22T01:39:00.000Z",
        body: "Commands stay in memory and execute future services as visible controls."
      },
      ...Array.from({ length: 60 }, (_, index): NoteDetail => ({
        id: `note-window-${index + 1}`,
        title: `Generated local note ${String(index + 1).padStart(2, "0")}`,
        preview: "Placeholder note for paginated preload calls.",
        updatedAt: nowIso,
        body: "Placeholder note body for future local note repository data."
      }))
    ],
    settings: {
      theme: "system",
      startOnLogin: false,
      quickCaptureShortcut: "Ctrl+Space",
      selectedTaskListIds: ["list-inbox", "list-planning"],
      selectedCalendarIds: ["cal-product", "cal-engineering", "cal-qa"],
      setupCompletedAt: nowIso,
      syncMode: "balanced",
      showTrayIcon: true,
      trayClickAction: "open-menu",
      menuBarPanelStyle: "adaptive",
      showMenuBarBadge: true,
      notificationsEnabled: false,
      notificationLeadMinutes: 10,
      mcpEnabled: false,
      mcpPermissionMode: "confirm-writes",
      mcpPort: 0,
      diagnosticsIncludePerformance: true
    },
    sync: {
      state: "idle",
      pendingMutationCount: 0
    },
    mcp: {
      enabled: false,
      running: false,
      readOnly: false,
      confirmationRequired: true,
      permissionMode: "confirm-writes",
      port: 0,
      tokenState: "not_configured",
      url: "http://127.0.0.1"
    }
  };

  const mcpTools = createMcpDomainServices(state);

  return {
    planner: {
      listTaskLists: (request) =>
        pageItems(
          state.taskLists.map((taskList) => ({
            id: taskList.id,
            title: taskList.title,
            updatedAt: nowIso,
            taskCount: state.tasks.filter((task) => task.listId === taskList.id).length,
            activeTaskCount: state.tasks.filter(
              (task) => task.listId === taskList.id && task.status === "active"
            ).length
          })),
          request.cursor,
          request.limit,
          DEFAULT_LIST_LIMIT,
          MAX_LIST_LIMIT
        ),
      listTasks: (request) => {
        const status = request.status ?? "active";
        const filtered = state.tasks
          .filter((task) => {
            if (request.listId && task.listId !== request.listId) {
              return false;
            }

            if (status === "all") {
              return true;
            }

            return task.status === status;
          })
          .map(taskSummary);

        return pageItems(filtered, request.cursor, request.limit, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
      },
      getTask: ({ id }) => {
        const task = state.tasks.find((candidate) => candidate.id === id);

        if (!task) {
          throw new Error("Task was not found.");
        }

        return taskDetail(task);
      },
      createTask: (request) => {
        const id = `task-local-${state.tasks.length + 1}`;
        const list = state.taskLists.find((candidate) => candidate.id === request.listId);
        const task: TaskRecord = {
          id,
          listId: request.listId,
          listTitle: list?.title ?? "Inbox",
          title: request.title,
          status: "active",
          dueAt: request.dueDate === null || request.dueDate === undefined ? null : `${request.dueDate}T00:00:00.000Z`,
          updatedAt: new Date().toISOString(),
          notes: request.notes ?? "",
          parentId: request.parentId ?? null,
          priority: request.priority ?? "none"
        };

        state.tasks.unshift(task);
        state.sync.pendingMutationCount += 1;
        return taskDetail(task);
      },
      updateTask: (request) => {
        const task = requiredById(state.tasks, request.id, "Task");
        Object.assign(task, {
          ...(request.title === undefined ? {} : { title: request.title }),
          ...(request.notes === undefined ? {} : { notes: request.notes }),
          ...(request.dueDate === undefined
            ? {}
            : { dueAt: request.dueDate === null ? null : `${request.dueDate}T00:00:00.000Z` }),
          ...(request.listId === undefined ? {} : { listId: request.listId }),
          ...(request.parentId === undefined ? {} : { parentId: request.parentId }),
          updatedAt: new Date().toISOString()
        });
        state.sync.pendingMutationCount += 1;
        return taskDetail(task);
      },
      completeTask: ({ id }) => {
        const task = requiredById(state.tasks, id, "Task");
        task.status = "completed";
        task.updatedAt = new Date().toISOString();
        state.sync.pendingMutationCount += 1;
        return taskDetail(task);
      },
      reopenTask: ({ id }) => {
        const task = requiredById(state.tasks, id, "Task");
        task.status = "active";
        task.updatedAt = new Date().toISOString();
        state.sync.pendingMutationCount += 1;
        return taskDetail(task);
      },
      moveTask: (request) => {
        const task = requiredById(state.tasks, request.id, "Task");
        if (request.listId !== undefined) {
          const list = state.taskLists.find((candidate) => candidate.id === request.listId);
          task.listId = request.listId;
          task.listTitle = list?.title ?? task.listTitle;
        }
        if (request.parentId !== undefined) {
          task.parentId = request.parentId;
        }
        task.updatedAt = new Date().toISOString();
        state.sync.pendingMutationCount += 1;
        return taskDetail(task);
      },
      deleteTask: ({ id }) => {
        const index = state.tasks.findIndex((candidate) => candidate.id === id);
        if (index < 0) {
          throw new Error("Task was not found.");
        }
        state.tasks.splice(index, 1);
        state.sync.pendingMutationCount += 1;
        return { id, queued: true, revision: new Date().toISOString() };
      },
      createTaskList: (request) => {
        const list = { id: `list-local-${state.taskLists.length + 1}`, title: request.title };
        state.taskLists.push(list);
        state.sync.pendingMutationCount += 1;
        return {
          id: list.id,
          title: list.title,
          updatedAt: new Date().toISOString(),
          taskCount: 0,
          activeTaskCount: 0
        };
      },
      renameTaskList: (request) => {
        const list = requiredById(state.taskLists, request.id, "Task list");
        list.title = request.title;
        state.sync.pendingMutationCount += 1;
        return {
          id: list.id,
          title: list.title,
          updatedAt: new Date().toISOString(),
          taskCount: state.tasks.filter((task) => task.listId === list.id).length,
          activeTaskCount: state.tasks.filter((task) => task.listId === list.id && task.status === "active").length
        };
      },
      deleteTaskList: ({ id }) => {
        const index = state.taskLists.findIndex((candidate) => candidate.id === id);
        if (index < 0) {
          throw new Error("Task list was not found.");
        }
        state.taskLists.splice(index, 1);
        state.tasks = state.tasks.filter((task) => task.listId !== id);
        state.sync.pendingMutationCount += 1;
        return { id, queued: true, revision: new Date().toISOString() };
      },
      listCalendarEvents: (request) => {
        const startMs = Date.parse(request.start);
        const endMs = Date.parse(request.end);
        const calendarIds = new Set(request.calendarIds ?? []);
        const filtered = state.calendarEvents
          .filter((event) => {
            const startsAtMs = Date.parse(event.startsAt);

            return (
              startsAtMs >= startMs &&
              startsAtMs < endMs &&
              (calendarIds.size === 0 || calendarIds.has(event.calendarId))
            );
          })
          .map(calendarSummary);

        return pageItems(filtered, request.cursor, request.limit, DEFAULT_RANGE_LIMIT, MAX_RANGE_LIMIT);
      },
      getCalendarEvent: ({ id }) => {
        const event = state.calendarEvents.find((candidate) => candidate.id === id);

        if (!event) {
          throw new Error("Calendar event was not found.");
        }

        return calendarDetail(event);
      },
      createCalendarEvent: (request) => {
        const id = `event-local-${state.calendarEvents.length + 1}`;
        const calendar = state.calendars.find((candidate) => candidate.id === request.calendarId);
        const event: CalendarRecord = {
          id,
          calendarId: request.calendarId,
          calendarTitle: calendar?.title ?? "Calendar",
          title: request.title,
          startsAt: request.startsAt,
          endsAt: request.endsAt,
          allDay: request.allDay ?? false,
          updatedAt: new Date().toISOString(),
          location: request.location ?? "",
          notes: request.notes ?? "",
          guestEmails: request.guestEmails ?? [],
          reminderMinutes: request.reminderMinutes ?? []
        };

        state.calendarEvents.unshift(event);
        state.sync.pendingMutationCount += 1;
        return calendarDetail(event);
      },
      updateCalendarEvent: (request) => {
        const event = state.calendarEvents.find((candidate) => candidate.id === request.id);

        if (!event) {
          throw new Error("Calendar event was not found.");
        }

        Object.assign(event, {
          ...(request.title === undefined ? {} : { title: request.title }),
          ...(request.calendarId === undefined ? {} : { calendarId: request.calendarId }),
          ...(request.startsAt === undefined ? {} : { startsAt: request.startsAt }),
          ...(request.endsAt === undefined ? {} : { endsAt: request.endsAt }),
          ...(request.allDay === undefined ? {} : { allDay: request.allDay }),
          ...(request.location === undefined ? {} : { location: request.location }),
          ...(request.notes === undefined ? {} : { notes: request.notes }),
          ...(request.guestEmails === undefined ? {} : { guestEmails: request.guestEmails }),
          ...(request.reminderMinutes === undefined ? {} : { reminderMinutes: request.reminderMinutes }),
          updatedAt: new Date().toISOString()
        });
        state.sync.pendingMutationCount += 1;
        return calendarDetail(event);
      },
      deleteCalendarEvent: ({ id }) => {
        const index = state.calendarEvents.findIndex((candidate) => candidate.id === id);

        if (index < 0) {
          throw new Error("Calendar event was not found.");
        }

        state.calendarEvents.splice(index, 1);
        state.sync.pendingMutationCount += 1;
        return { id, queued: true, revision: new Date().toISOString() };
      },
      listScheduledTaskBlocks: (request) => {
        const startMs = Date.parse(request.start);
        const endMs = Date.parse(request.end);
        const calendarIds = new Set(request.calendarIds ?? []);
        const filtered = state.scheduledTaskBlocks.filter((block) => {
          const startsAtMs = Date.parse(block.startsAt);

          return (
            startsAtMs >= startMs &&
            startsAtMs < endMs &&
            (calendarIds.size === 0 || calendarIds.has(block.calendarId))
          );
        });

        return pageItems(filtered, request.cursor, request.limit, DEFAULT_RANGE_LIMIT, MAX_RANGE_LIMIT);
      },
      scheduleTaskBlock: (request) => {
        const task = requiredById(state.tasks, request.taskId, "Task");
        const calendar = state.calendars.find((candidate) => candidate.id === request.calendarId);
        const now = new Date().toISOString();
        const eventId = `event-task-block-${state.scheduledTaskBlocks.length + 1}`;
        const endsAt = new Date(Date.parse(request.startsAt) + request.durationMinutes * 60 * 1000).toISOString();
        const event: CalendarRecord = {
          id: eventId,
          calendarId: request.calendarId,
          calendarTitle: calendar?.title ?? "Calendar",
          title: task.title,
          startsAt: request.startsAt,
          endsAt,
          allDay: false,
          updatedAt: now,
          location: "Scheduled task",
          notes: task.notes ?? "",
          guestEmails: [],
          reminderMinutes: []
        };
        const block: ScheduledTaskBlockSummary = {
          id: `block-${state.scheduledTaskBlocks.length + 1}`,
          taskId: task.id,
          calendarEventId: eventId,
          calendarId: request.calendarId,
          title: task.title,
          startsAt: request.startsAt,
          endsAt,
          durationMinutes: request.durationMinutes,
          status: "scheduled",
          mutationState: "queued",
          updatedAt: now
        };

        state.calendarEvents.unshift(event);
        state.scheduledTaskBlocks.unshift(block);
        state.sync.pendingMutationCount += 1;
        return clone(block);
      },
      moveScheduledTaskBlock: (request) => {
        const block = requiredById(state.scheduledTaskBlocks, request.id, "Scheduled task block");
        const event = requiredById(state.calendarEvents, block.calendarEventId, "Calendar event");
        const now = new Date().toISOString();
        const durationMinutes = request.durationMinutes ?? block.durationMinutes;
        const startsAt = request.startsAt ?? block.startsAt;
        const endsAt = new Date(Date.parse(startsAt) + durationMinutes * 60 * 1000).toISOString();

        Object.assign(block, {
          ...(request.calendarId === undefined ? {} : { calendarId: request.calendarId }),
          startsAt,
          endsAt,
          durationMinutes,
          mutationState: "queued" as const,
          updatedAt: now
        });
        Object.assign(event, {
          calendarId: block.calendarId,
          startsAt,
          endsAt,
          updatedAt: now
        });
        state.sync.pendingMutationCount += 1;
        return clone(block);
      },
      unscheduleTaskBlock: (request) => {
        const index = state.scheduledTaskBlocks.findIndex((candidate) => candidate.id === request.id);

        if (index < 0) {
          throw new Error("Scheduled task block was not found.");
        }

        const [block] = state.scheduledTaskBlocks.splice(index, 1);

        if ((request.deleteCalendarEvent ?? true) && block) {
          state.calendarEvents = state.calendarEvents.filter((event) => event.id !== block.calendarEventId);
          state.sync.pendingMutationCount += 1;
        }

        return { id: request.id, queued: request.deleteCalendarEvent ?? true, revision: new Date().toISOString() };
      },
      exportAvailability: (request) => {
        const events = state.calendarEvents.filter((event) => {
          const startMs = Date.parse(event.startsAt);
          const calendarIds = new Set(request.calendarIds ?? []);

          return (
            startMs >= Date.parse(request.start) &&
            startMs < Date.parse(request.end) &&
            (calendarIds.size === 0 || calendarIds.has(event.calendarId))
          );
        });
        const busyLines = events.map(
          (event) => `- ${event.startsAt} to ${event.endsAt}: ${event.title}`
        );

        return {
          format: "text" as const,
          text: [
            `Availability from ${request.start} to ${request.end}`,
            busyLines.length === 0 ? "No busy blocks in selected calendars." : "Busy:",
            ...busyLines
          ].join("\n"),
          generatedAt: new Date().toISOString(),
          busyBlockCount: events.length
        };
      },
      listCalendars: (request) =>
        pageItems(
          state.calendars.map((calendar) => ({
            id: calendar.id,
            title: calendar.title,
            selected: calendar.selected,
            timeZone: "UTC",
            updatedAt: nowIso,
            eventCount: state.calendarEvents.filter((event) => event.calendarId === calendar.id).length
          })),
          request.cursor,
          request.limit,
          DEFAULT_LIST_LIMIT,
          MAX_LIST_LIMIT
        ),
      listNotes: (request) =>
        pageItems(
          state.notes.map(noteSummary),
          request.cursor,
          request.limit,
          DEFAULT_LIST_LIMIT,
          MAX_LIST_LIMIT
        ),
      getNote: ({ id }) => {
        const note = state.notes.find((candidate) => candidate.id === id);

        if (!note) {
          throw new Error("Note was not found.");
        }

        return clone(note);
      },
      createNote: (request) => {
        const now = new Date().toISOString();
        const body = request.body ?? "";
        const note: NoteDetail = {
          id: `note-local-${state.notes.length + 1}`,
          title: request.title,
          body,
          preview: preview(body),
          updatedAt: now
        };

        state.notes.unshift(note);

        return clone(note);
      },
      updateNote: (request) => {
        const note = state.notes.find((candidate) => candidate.id === request.id);

        if (!note) {
          throw new Error("Note was not found.");
        }

        if (request.title !== undefined) {
          note.title = request.title;
        }

        if (request.body !== undefined) {
          note.body = request.body;
          note.preview = preview(request.body);
        }

        note.updatedAt = new Date().toISOString();

        return clone(note);
      },
      deleteNote: (request) => {
        const index = state.notes.findIndex((candidate) => candidate.id === request.id);

        if (index < 0) {
          throw new Error("Note was not found.");
        }

        state.notes.splice(index, 1);

        return {
          id: request.id,
          queued: false,
          revision: new Date().toISOString()
        };
      },
      search: (request) => {
        const domains = new Set<SearchDomain>(request.domains ?? ["tasks", "calendar", "notes"]);
        const query = request.query.trim().toLowerCase();
        const results: SearchResultItem[] = [];

        if (domains.has("tasks")) {
          results.push(
            ...state.tasks
              .filter((task) => textMatches(query, task.title, task.notes, task.listTitle))
              .map((task) => ({
                id: task.id,
                domain: "tasks" as const,
                title: task.title,
                snippet: task.notes,
                updatedAt: task.updatedAt
              }))
          );
        }

        if (domains.has("calendar")) {
          results.push(
            ...state.calendarEvents
              .filter((event) =>
                textMatches(query, event.title, event.location, event.notes, event.calendarTitle)
              )
              .map((event) => ({
                id: event.id,
                domain: "calendar" as const,
                title: event.title,
                snippet: event.notes,
                updatedAt: event.updatedAt
              }))
          );
        }

        if (domains.has("notes")) {
          results.push(
            ...state.notes
              .filter((note) => textMatches(query, note.title, note.preview, note.body))
              .map((note) => ({
                id: note.id,
                domain: "notes" as const,
                title: note.title,
                snippet: note.preview,
                updatedAt: note.updatedAt
              }))
          );
        }

        return pageItems(results, undefined, request.limit, DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT);
      }
    },
    sync: {
      status: () => ({ ...state.sync }),
      runNow: (request) => {
        const resources = [...new Set(request.resources ?? ["tasks", "calendar"])] as Array<
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
      }
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
    native: {
      capabilities: () => nativeCapabilities(),
      requestNotificationPermission: () => ({
        state: "unsupported"
      })
    },
    mcpTools
  };
}

function nativeCapabilities(): NativeCapabilitiesResponse {
  const platform = detectNativePlatform();
  const report = buildNativeCapabilityReport({
    platform,
    adapterId: "placeholder",
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
        message: "OAuth loopback is shared code; platform browser handoff is not verified by placeholder data."
      },
      mcpLoopback: {
        state: "pending",
        message: "MCP loopback is shared code; native lifecycle is not owned by placeholder data."
      }
    },
    diagnostics: [
      capabilityDiagnostic(
        "packaging",
        "warning",
        "Native capability status is placeholder data and does not claim platform support."
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
      message: "Tray/menu bar is unavailable in placeholder data."
    },
    quickCaptureShortcut: {
      accelerator: null,
      registered: false,
      state: "unsupported",
      message: "Global shortcuts are unavailable in placeholder data."
    },
    notificationsStatus: {
      permission: "unsupported",
      scheduledCount: 0,
      state: "unsupported",
      message: "Notifications are unavailable in placeholder data."
    },
    deepLinkStatus: {
      scheme: "hotcrossbuns" as const,
      registered: false,
      state: "unsupported",
      message: "Deep links are unavailable in placeholder data."
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

function createMcpDomainServices(state: PlaceholderState): McpDomainServices {
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
    }
  };
}

function pageItems<T>(
  inputItems: T[],
  cursor: string | undefined,
  requestedLimit: number | undefined,
  defaultLimit: number,
  maxLimit: number
): PageWindow<T> {
  const limit = Math.max(1, Math.min(maxLimit, requestedLimit ?? defaultLimit));
  const start = parseCursor(cursor);
  const items = inputItems.slice(start, start + limit);
  const nextIndex = start + items.length;

  return {
    items,
    page: {
      limit,
      ...(nextIndex < inputItems.length ? { nextCursor: String(nextIndex) } : {}),
      totalKnown: inputItems.length
    }
  };
}

function parseCursor(cursor: string | undefined): number {
  if (!cursor) {
    return 0;
  }

  const parsed = Number.parseInt(cursor, 10);

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function taskSummary(task: TaskRecord): TaskSummary {
  return {
    id: task.id,
    listId: task.listId,
    title: task.title,
    status: task.status,
    dueAt: task.dueAt,
    updatedAt: task.updatedAt,
    notes: task.notes,
    parentId: task.parentId,
    priority: "none",
    mutationState: "synced"
  };
}

function taskDetail(task: TaskRecord): TaskDetail {
  return {
    ...taskSummary(task),
    notes: task.notes,
    parentId: task.parentId
  };
}

function calendarSummary(event: CalendarRecord): CalendarEventSummary {
  return {
    id: event.id,
    eventId: event.eventId ?? event.id,
    calendarId: event.calendarId,
    title: event.title,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    allDay: event.allDay,
    updatedAt: event.updatedAt,
    location: event.location ?? "",
    notes: event.notes ?? "",
    guestEmails: event.guestEmails ?? [],
    reminderMinutes: event.reminderMinutes ?? [],
    recurringEventId: event.recurringEventId ?? null,
    originalStartAt: event.originalStartAt ?? null
  };
}

function calendarDetail(event: CalendarRecord) {
  return {
    ...calendarSummary(event),
    calendarTitle: event.calendarTitle,
    deepLink: `hotcrossbuns://event/${event.id}`
  };
}

function noteSummary(note: NoteDetail): NoteSummary {
  return {
    id: note.id,
    title: note.title,
    preview: note.preview,
    updatedAt: note.updatedAt
  };
}

function taskJson(task: TaskRecord): DomainJsonObject {
  return {
    kind: "task",
    ...jsonObject(taskDetail(task)),
    listTitle: task.listTitle,
    deepLink: `hotcrossbuns://task/${task.id}`
  };
}

function calendarJson(event: CalendarRecord): DomainJsonObject {
  return {
    kind: "event",
    ...jsonObject(calendarSummary(event)),
    calendarTitle: event.calendarTitle,
    location: event.location ?? "",
    notes: event.notes ?? "",
    deepLink: `hotcrossbuns://event/${event.id}`
  };
}

function noteJson(note: NoteDetail): DomainJsonObject {
  return {
    kind: "note",
    ...jsonObject(note),
    deepLink: `hotcrossbuns://note/${note.id}`
  };
}

function jsonObject(value: Record<string, unknown>): DomainJsonObject {
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

  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(jsonValue);
  }

  if (typeof value === "object") {
    return jsonObject(value as Record<string, unknown>);
  }

  return null;
}

function requiredById<T extends { id: string }>(items: T[], id: string, label: string): T {
  const item = items.find((candidate) => candidate.id === id);

  if (!item) {
    throw new Error(`${label} was not found.`);
  }

  return item;
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

function taskPatch(patch: DomainJsonObject): Partial<TaskRecord> {
  return {
    ...(optionalText(patch, "title") === undefined ? {} : { title: optionalText(patch, "title") }),
    ...(optionalText(patch, "notes") === undefined ? {} : { notes: optionalText(patch, "notes") }),
    ...(optionalText(patch, "dueDate") === undefined ? {} : { dueAt: optionalText(patch, "dueDate") }),
    ...(optionalText(patch, "taskListId") === undefined ? {} : { listId: optionalText(patch, "taskListId") }),
    ...(taskStatus(patch.status) === undefined ? {} : { status: taskStatus(patch.status) })
  };
}

function eventPatch(patch: DomainJsonObject): Partial<CalendarRecord> {
  return {
    ...(optionalText(patch, "title") === undefined ? {} : { title: optionalText(patch, "title") }),
    ...(optionalText(patch, "details") === undefined ? {} : { notes: optionalText(patch, "details") }),
    ...(optionalText(patch, "startDate") === undefined ? {} : { startsAt: optionalText(patch, "startDate") }),
    ...(optionalText(patch, "endDate") === undefined ? {} : { endsAt: optionalText(patch, "endDate") }),
    ...(optionalText(patch, "calendarId") === undefined ? {} : { calendarId: optionalText(patch, "calendarId") }),
    ...(optionalText(patch, "location") === undefined ? {} : { location: optionalText(patch, "location") }),
    ...(typeof patch.isAllDay === "boolean" ? { allDay: patch.isAllDay } : {})
  };
}

function taskStatus(value: DomainJsonValue | undefined): PlaceholderTaskStatus | undefined {
  return value === "active" || value === "completed" ? value : undefined;
}

function compactJsonObject(input: Record<string, DomainJsonValue | undefined>): DomainJsonObject {
  const output: DomainJsonObject = {};

  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) {
      output[key] = value;
    }
  }

  return output;
}

function textMatches(query: string, ...values: Array<string | null | undefined>): boolean {
  return values.some((value) => value?.toLowerCase().includes(query));
}

function preview(body: string): string {
  const trimmed = body.trim();

  if (!trimmed) {
    return "Empty local note";
  }

  return trimmed.length > 120 ? `${trimmed.slice(0, 117)}...` : trimmed;
}

function definedSettingsPatch(request: SettingsUpdateRequest): Partial<SettingsSnapshot> {
  const patch: Partial<SettingsSnapshot> = {};

  if (request.theme !== undefined) {
    patch.theme = request.theme as SettingsSnapshot["theme"];
  }

  if (request.startOnLogin !== undefined) {
    patch.startOnLogin = request.startOnLogin;
  }

  if (request.quickCaptureShortcut !== undefined) {
    patch.quickCaptureShortcut = request.quickCaptureShortcut;
  }

  if (request.selectedTaskListIds !== undefined) {
    patch.selectedTaskListIds = [...new Set(request.selectedTaskListIds)];
  }

  if (request.selectedCalendarIds !== undefined) {
    patch.selectedCalendarIds = [...new Set(request.selectedCalendarIds)];
  }

  if (request.setupCompletedAt !== undefined) {
    patch.setupCompletedAt = request.setupCompletedAt;
  }

  if (request.syncMode !== undefined) {
    patch.syncMode = request.syncMode;
  }

  if (request.showTrayIcon !== undefined) {
    patch.showTrayIcon = request.showTrayIcon;
  }

  if (request.trayClickAction !== undefined) {
    patch.trayClickAction = request.trayClickAction;
  }

  if (request.menuBarPanelStyle !== undefined) {
    patch.menuBarPanelStyle = request.menuBarPanelStyle;
  }

  if (request.showMenuBarBadge !== undefined) {
    patch.showMenuBarBadge = request.showMenuBarBadge;
  }

  if (request.notificationsEnabled !== undefined) {
    patch.notificationsEnabled = request.notificationsEnabled;
  }

  if (request.notificationLeadMinutes !== undefined) {
    patch.notificationLeadMinutes = request.notificationLeadMinutes;
  }

  if (request.mcpEnabled !== undefined) {
    patch.mcpEnabled = request.mcpEnabled;
  }

  if (request.mcpPermissionMode !== undefined) {
    patch.mcpPermissionMode = request.mcpPermissionMode;
  }

  if (request.mcpPort !== undefined) {
    patch.mcpPort = request.mcpPort;
  }

  if (request.diagnosticsIncludePerformance !== undefined) {
    patch.diagnosticsIncludePerformance = request.diagnosticsIncludePerformance;
  }

  return patch;
}

function recoveryPhrase(
  action: "refresh" | "forceFullResync" | "clearGoogleCache" | "resetOnboarding" | "resetMcpToken"
): string {
  if (action === "forceFullResync") {
    return "FULL RESYNC";
  }

  if (action === "clearGoogleCache") {
    return "CLEAR CACHE";
  }

  if (action === "resetMcpToken") {
    return "RESET MCP TOKEN";
  }

  return "";
}

function recoveryMessage(
  action: "refresh" | "forceFullResync" | "clearGoogleCache" | "resetOnboarding" | "resetMcpToken"
): string {
  if (action === "forceFullResync") {
    return "Sync checkpoints were cleared and a full resync was requested.";
  }

  if (action === "clearGoogleCache") {
    return "Local Google cache was cleared.";
  }

  if (action === "resetMcpToken") {
    return "MCP bearer token was reset without exposing the new token value.";
  }

  if (action === "resetOnboarding") {
    return "Onboarding will be shown again without changing planner data.";
  }

  return "Refresh requested for selected Google resources.";
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
