import {
  DEFAULT_LIST_LIMIT,
  DEFAULT_RANGE_LIMIT,
  DEFAULT_SEARCH_LIMIT,
  MAX_LIST_LIMIT,
  MAX_RANGE_LIMIT,
  MAX_SEARCH_LIMIT,
  type NoteDetail,
  type SearchResultItem,
  type ScheduledTaskBlockSummary
} from "@shared/ipc/contracts";
import type { PlannerViewDomainService } from "../domainInterfaces";
import { buildDaySchedule } from "../schedulingSuggestionService";
import {
  calendarDetail,
  calendarSummary,
  noteSummary,
  recurrenceRuleFromRequest,
  taskDetail,
  taskSummary
} from "./serializers";
import type {
  CalendarRecord,
  PlaceholderState,
  TaskRecord
} from "./state";
import { nowIso } from "./state";
import {
  clone,
  pageItems,
  preview,
  requiredById,
  textMatches
} from "./utils";

type SearchDomain = SearchResultItem["domain"];

export function createPlaceholderPlannerViewService(
  state: PlaceholderState
): PlannerViewDomainService {
  return {
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
    listTags: (request) => {
      const counts = new Map<string, { taskCount: number; eventCount: number; noteCount: number }>();
      for (const task of state.tasks) {
        for (const tag of task.tags ?? []) {
          const entry = counts.get(tag) ?? { taskCount: 0, eventCount: 0, noteCount: 0 };
          entry.taskCount += 1;
          counts.set(tag, entry);
        }
      }
      for (const event of state.calendarEvents) {
        for (const tag of event.tags ?? []) {
          const entry = counts.get(tag) ?? { taskCount: 0, eventCount: 0, noteCount: 0 };
          entry.eventCount += 1;
          counts.set(tag, entry);
        }
      }
      for (const note of state.notes) {
        for (const tag of note.tags ?? []) {
          const entry = counts.get(tag) ?? { taskCount: 0, eventCount: 0, noteCount: 0 };
          entry.noteCount += 1;
          counts.set(tag, entry);
        }
      }
      const query = request.query?.trim().toLocaleLowerCase() ?? "";
      const items = [...counts.entries()]
        .filter(([name]) => !query || name.toLocaleLowerCase().includes(query))
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, countsByKind]) => ({
          id: `tag:${name.toLocaleLowerCase()}`,
          name,
          color: null,
          createdAt: nowIso,
          updatedAt: nowIso,
          ...countsByKind,
          totalCount: countsByKind.taskCount + countsByKind.eventCount + countsByKind.noteCount
        }));
      return pageItems(items, request.cursor, request.limit, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
    },
    createTag: (request) => ({
      id: `tag:${request.name.trim().toLocaleLowerCase()}`,
      queued: false,
      revision: nowIso,
      tag: {
        id: `tag:${request.name.trim().toLocaleLowerCase()}`,
        name: request.name.trim(),
        color: request.color ?? null,
        createdAt: nowIso,
        updatedAt: nowIso,
        taskCount: 0,
        eventCount: 0,
        noteCount: 0,
        totalCount: 0
      }
    }),
    updateTag: (request) => ({
      id: request.id,
      queued: false,
      revision: nowIso,
      tag: {
        id: request.id,
        name: request.name ?? request.id.replace(/^tag:/, ""),
        color: request.color ?? null,
        createdAt: nowIso,
        updatedAt: nowIso,
        taskCount: 0,
        eventCount: 0,
        noteCount: 0,
        totalCount: 0
      }
    }),
    deleteTag: (request) => ({ id: request.id, queued: false, revision: nowIso }),
    mergeTags: (request) => ({ id: request.targetId, queued: false, revision: nowIso }),
    bulkApplyTags: (request) => ({ id: request.tagIds[0] ?? "tags", queued: false, revision: nowIso }),
    previewAutoTagReapply: (request) => ({
      kind: request.kind,
      scope: "all",
      scanned: 0,
      changed: 0,
      skipped: 0,
      failed: 0,
      blocked: false,
      message: "No cached placeholder items to reapply.",
      sample: []
    }),
    applyAutoTagReapply: (request) => ({
      kind: request.kind,
      scope: "all",
      scanned: 0,
      changed: 0,
      skipped: 0,
      failed: 0,
      blocked: false,
      message: "No cached placeholder items to reapply.",
      sample: [],
      queued: false,
      revision: nowIso
    }),
    tagAnalytics: () => ({
      totalTags: 0,
      unusedTags: 0,
      linkedEntities: 0,
      topTags: [],
      staleTags: []
    }),
    cleanupDuplicates: (request) => ({
      id: request.winnerId,
      kind: request.kind,
      loserIds: request.loserIds,
      queued: true,
      revision: nowIso
    }),
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
    bulkRescheduleTasks: (request) => {
      const ids = [...new Set(request.taskIds)];
      const now = new Date().toISOString();

      for (const id of ids) {
        const task = requiredById(state.tasks, id, "Task");
        task.dueAt = request.dueDate === null ? null : `${request.dueDate}T00:00:00.000Z`;
        task.updatedAt = now;
      }

      state.sync.pendingMutationCount += ids.length;
      return { ids, updatedCount: ids.length, queued: true, revision: now };
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
        timeZone: state.settings.defaultTimeZone,
        recurrenceRule: recurrenceRuleFromRequest(request.recurrence ?? null),
        guestEmails: request.guestEmails ?? [],
        reminderMinutes: request.reminderMinutes ?? [],
        reminders: request.reminders ?? request.reminderMinutes?.map((minutes) => ({ method: "popup", minutes })),
        remindersUseDefault: request.remindersUseDefault ?? false,
        transparency: request.transparency ?? null,
        visibility: request.visibility ?? null
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
        ...(request.reminders === undefined ? {} : { reminders: request.reminders }),
        ...(request.remindersUseDefault === undefined ? {} : { remindersUseDefault: request.remindersUseDefault }),
        ...(request.transparency === undefined ? {} : { transparency: request.transparency }),
        ...(request.visibility === undefined ? {} : { visibility: request.visibility }),
        ...(request.recurrence === undefined
          ? {}
          : { recurrenceRule: recurrenceRuleFromRequest(request.recurrence) }),
        updatedAt: new Date().toISOString()
      });
      state.sync.pendingMutationCount += 1;
      return calendarDetail(event);
    },
    completeCalendarEvent: (request) => {
      const event = state.calendarEvents.find((candidate) => candidate.id === request.id);

      if (!event) {
        throw new Error("Calendar event was not found.");
      }

      event.completedAt = new Date().toISOString();
      event.updatedAt = event.completedAt;
      return {
        ...calendarDetail(event),
        completionScopeApplied: request.scope ?? "occurrence"
      };
    },
    reopenCalendarEvent: (request) => {
      const event = state.calendarEvents.find((candidate) => candidate.id === request.id);

      if (!event) {
        throw new Error("Calendar event was not found.");
      }

      event.completedAt = null;
      event.updatedAt = new Date().toISOString();
      return {
        ...calendarDetail(event),
        completionScopeApplied: request.scope ?? "occurrence"
      };
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
      const durationMinutes = request.durationMinutes ?? 30;
      const endsAt = new Date(Date.parse(request.startsAt) + durationMinutes * 60 * 1000).toISOString();
      const existingBlock = state.scheduledTaskBlocks.find((block) => block.taskId === task.id);

      if (existingBlock) {
        if (
          existingBlock.status === "scheduled" &&
          existingBlock.calendarId === request.calendarId &&
          existingBlock.startsAt === request.startsAt &&
          existingBlock.endsAt === endsAt
        ) {
          return clone(existingBlock);
        }

        throw new Error("Task already has a scheduled block.");
      }

      const eventId = `event-task-block-${state.scheduledTaskBlocks.length + 1}`;
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
        durationMinutes,
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
      let event = state.calendarEvents.find((candidate) => candidate.id === block.calendarEventId);
      const now = new Date().toISOString();
      const durationMinutes = request.durationMinutes ?? block.durationMinutes;
      const startsAt = request.startsAt ?? block.startsAt;
      const endsAt = new Date(Date.parse(startsAt) + durationMinutes * 60 * 1000).toISOString();
      const calendarId = request.calendarId ?? block.calendarId;

      if (!event) {
        const task = requiredById(state.tasks, block.taskId, "Task");
        const calendar = state.calendars.find((candidate) => candidate.id === calendarId);
        event = {
          id: `event-task-block-repair-${state.calendarEvents.length + 1}`,
          calendarId,
          calendarTitle: calendar?.title ?? "Calendar",
          title: task.title,
          startsAt,
          endsAt,
          allDay: false,
          updatedAt: now,
          location: "Scheduled task",
          notes: task.notes ?? "",
          guestEmails: [],
          reminderMinutes: []
        };
        state.calendarEvents.unshift(event);
        block.calendarEventId = event.id;
      }

      Object.assign(block, {
        calendarId,
        startsAt,
        endsAt,
        durationMinutes,
        status: "scheduled" as const,
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
    scheduleSuggest: (request) => {
      const start = `${request.date}T00:00:00.000Z`;
      const end = new Date(Date.parse(start) + 24 * 60 * 60 * 1000).toISOString();
      const events = state.calendarEvents.filter(
        (event) => event.startsAt < end && event.endsAt > start && event.completedAt == null
      );

      return buildDaySchedule({
        date: request.date,
        events,
        tasks: state.tasks.map(taskSummary),
        capacityMinutes: request.capacityMinutes ?? 480,
        workingHours: {
          start: request.workingHours?.start ?? 6,
          end: request.workingHours?.end ?? 22
        }
      });
    },
    smartReschedule: (request) => {
      const start = `${request.date}T00:00:00.000Z`;
      const end = new Date(Date.parse(start) + 24 * 60 * 60 * 1000).toISOString();
      const schedule = buildDaySchedule({
        date: request.date,
        events: state.calendarEvents.filter(
          (event) => event.calendarId === request.calendarId && event.startsAt < end && event.endsAt > start
        ),
        tasks: state.tasks,
        capacityMinutes: request.capacityMinutes ?? 480,
        workingHours: {
          start: request.workingHours?.start ?? 6,
          end: request.workingHours?.end ?? 22
        }
      });
      const suggestions = schedule.slots.flatMap((slot) => {
        if (!slot.taskId) {
          return [];
        }

        const task = state.tasks.find((candidate) => candidate.id === slot.taskId);
        const existing = state.scheduledTaskBlocks.find((block) => block.taskId === slot.taskId);

        return [{
          taskId: slot.taskId,
          calendarId: request.calendarId,
          ...(existing ? { scheduledTaskBlockId: existing.id } : {}),
          action: existing ? "move" as const : "create" as const,
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          durationMinutes: Math.max(5, Math.round((Date.parse(slot.endsAt) - Date.parse(slot.startsAt)) / 60_000)),
          reason: task?.dueAt && task.dueAt < start ? "Overdue task scheduled before newer work." : "Task placed in the first open slot."
        }];
      }).slice(0, 200);

      if (!(request.apply ?? false)) {
        return {
          suggestions,
          skipped: schedule.unscheduled.map((task) => ({ taskId: task.id, reason: "No free slot inside working hours." })),
          applied: false,
          appliedBlocks: []
        };
      }

      const appliedBlocks = suggestions.map((suggestion) => {
        const existing = state.scheduledTaskBlocks.find((block) => block.taskId === suggestion.taskId);
        const block = existing ?? {
          id: `block-smart-${state.scheduledTaskBlocks.length + 1}`,
          taskId: suggestion.taskId,
          calendarEventId: `event-smart-${state.calendarEvents.length + 1}`,
          calendarId: request.calendarId,
          title: state.tasks.find((task) => task.id === suggestion.taskId)?.title ?? "Scheduled task",
          startsAt: suggestion.startsAt,
          endsAt: suggestion.endsAt,
          durationMinutes: suggestion.durationMinutes,
          status: "scheduled" as const,
          updatedAt: new Date().toISOString()
        };

        Object.assign(block, {
          calendarId: request.calendarId,
          startsAt: suggestion.startsAt,
          endsAt: suggestion.endsAt,
          durationMinutes: suggestion.durationMinutes,
          status: "scheduled",
          updatedAt: new Date().toISOString()
        });

        if (!existing) {
          state.scheduledTaskBlocks.unshift(block);
        }

        return block;
      });

      state.sync.pendingMutationCount += appliedBlocks.length;
      return {
        suggestions,
        skipped: schedule.unscheduled.map((task) => ({ taskId: task.id, reason: "No free slot inside working hours." })),
        applied: true,
        appliedBlocks
      };
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
      const busyEvents = events.filter((event) => event.completedAt == null);
      const busyLines = busyEvents.map(
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
        busyBlockCount: busyEvents.length
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
    listNotes: (request) => ({
      ...pageItems(
        state.notes.map(noteSummary),
        request.cursor,
        request.limit,
        DEFAULT_LIST_LIMIT,
        MAX_LIST_LIMIT
      ),
      lists: [
        {
          id: "list-inbox",
          title: "Inbox",
          noteCount: state.notes.length,
          updatedAt: nowIso
        }
      ]
    }),
    getNote: ({ id }) => {
      const note = state.notes.find((candidate) => candidate.id === id);

      if (!note) {
        throw new Error("Note was not found.");
      }

      return clone(note);
    },
    createNoteList: (request) => ({
      id: `note-list:${request.title.trim().toLowerCase().replaceAll(" ", "-") || state.notes.length + 1}`,
      title: request.title.trim(),
      noteCount: 0,
      updatedAt: new Date().toISOString()
    }),
    renameNoteList: (request) => ({
      id: request.id,
      title: request.title.trim(),
      noteCount: state.notes.filter((note) => note.listId === request.id).length,
      updatedAt: new Date().toISOString()
    }),
    deleteNoteList: (request) => {
      for (const note of state.notes) {
        if (note.listId === request.id) {
          note.listId = "list-inbox";
          note.listTitle = "Inbox";
        }
      }

      return {
        id: request.id,
        queued: false,
        revision: new Date().toISOString()
      };
    },
    createNote: (request) => {
      const now = new Date().toISOString();
      const body = request.body ?? "";
      const note: NoteDetail = {
        id: `note-local-${state.notes.length + 1}`,
        listId: request.listId ?? "list-inbox",
        listTitle: "Inbox",
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

      if (request.listId !== undefined) {
        note.listId = request.listId;
        note.listTitle = "Inbox";
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
    suggestNoteLinks: (request) => {
      const query = request.query.trim().toLowerCase();
      const kinds = new Set(request.kinds ?? ["note", "task", "event"]);
      const limit = request.limit ?? 8;
      const items = [
        ...(kinds.has("note")
          ? state.notes
              .filter((note) => note.title.toLowerCase().includes(query))
              .map((note) => ({ kind: "note" as const, id: note.id, label: note.title }))
          : []),
        ...(kinds.has("task")
          ? state.tasks
              .filter((task) => task.title.toLowerCase().includes(query))
              .map((task) => ({ kind: "task" as const, id: task.id, label: task.title }))
          : []),
        ...(kinds.has("event")
          ? state.calendarEvents
              .filter((event) => event.title.toLowerCase().includes(query))
              .map((event) => ({ kind: "event" as const, id: event.id, label: event.title }))
          : [])
      ];

      return { items: items.slice(0, limit) };
    },
    listBrokenNoteLinks: (request) => {
      const note = state.notes.find((candidate) => candidate.id === request.noteId);

      if (!note) {
        throw new Error("Note was not found.");
      }

      const linkTexts = Array.from(note.body.matchAll(/\[\[([^\]]{1,160})\]\]/g))
        .map((match) => match[1]?.trim() ?? "")
        .filter((linkText) => {
          if (!linkText || linkText.includes(":")) {
            return false;
          }

          return !state.notes.some((candidate) => candidate.title.toLowerCase() === linkText.toLowerCase());
        });

      return { items: Array.from(new Set(linkTexts)).map((linkText) => ({ linkText })) };
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

      const response = pageItems(results, undefined, request.limit, DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT);
      return request.mode && request.mode !== "lexical"
        ? {
            ...response,
            diagnostics: {
              mode: request.mode,
              semanticEnabled: true,
              indexedCount: results.length,
              staleCount: 0,
              modelId: "placeholder"
            }
          }
        : response;
    }
  };
}
