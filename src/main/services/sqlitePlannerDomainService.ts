import type { JsonValue } from "@shared/domain/localData";
import type { LocalPlannerRepository } from "../data/localRepositories";
import type { LocalUndoRepository } from "../data/localRepositories";
import type { PlannerViewDomainService } from "./domainInterfaces";
import { buildDaySchedule } from "./schedulingSuggestionService";

export function createSqlitePlannerDomainService(
  repository: LocalPlannerRepository,
  undoRepository?: LocalUndoRepository
): PlannerViewDomainService {
  function recordUndo(input: {
    actionKind: string;
    label: string;
    resourceKind: Parameters<LocalUndoRepository["recordChange"]>[0]["resourceKind"];
    resourceId: string;
    before: unknown;
    after: unknown;
  }): void {
    undoRepository?.recordChange({
      actionKind: input.actionKind,
      label: input.label,
      resourceKind: input.resourceKind,
      resourceId: input.resourceId,
      before: jsonValue(input.before),
      after: jsonValue(input.after)
    });
  }

  return {
    listTaskLists: (request) => repository.listTaskLists(request),
    listTasks: (request) => repository.listTasks(request),
    getTask: (request) => repository.getTask(request.id),
    createTask: (request) => {
      const created = repository.createTask(request);
      recordUndo({
        actionKind: "task.create",
        label: "Create task",
        resourceKind: "task",
        resourceId: created.id,
        before: null,
        after: undoRepository?.taskSnapshot(created.id)
      });
      return created;
    },
    updateTask: (request) => {
      const before = undoRepository?.taskSnapshot(request.id) ?? null;
      const updated = repository.updateTask(request);
      recordUndo({
        actionKind: "task.update",
        label: "Edit task",
        resourceKind: "task",
        resourceId: request.id,
        before,
        after: undoRepository?.taskSnapshot(request.id)
      });
      return updated;
    },
    completeTask: (request) => {
      const before = undoRepository?.taskSnapshot(request.id) ?? null;
      const completed = repository.completeTask(request);
      recordUndo({
        actionKind: "task.complete",
        label: "Complete task",
        resourceKind: "task",
        resourceId: request.id,
        before,
        after: undoRepository?.taskSnapshot(request.id)
      });
      return completed;
    },
    reopenTask: (request) => {
      const before = undoRepository?.taskSnapshot(request.id) ?? null;
      const reopened = repository.reopenTask(request);
      recordUndo({
        actionKind: "task.reopen",
        label: "Reopen task",
        resourceKind: "task",
        resourceId: request.id,
        before,
        after: undoRepository?.taskSnapshot(request.id)
      });
      return reopened;
    },
    moveTask: (request) => {
      const before = undoRepository?.taskSnapshot(request.id) ?? null;
      const moved = repository.moveTask(request);
      recordUndo({
        actionKind: "task.move",
        label: "Move task",
        resourceKind: "task",
        resourceId: request.id,
        before,
        after: undoRepository?.taskSnapshot(request.id)
      });
      return moved;
    },
    deleteTask: (request) => {
      const before = undoRepository?.taskSnapshot(request.id) ?? null;
      const deleted = repository.deleteTask(request);
      recordUndo({
        actionKind: "task.delete",
        label: "Delete task",
        resourceKind: "task",
        resourceId: request.id,
        before,
        after: null
      });
      return deleted;
    },
    createTaskList: (request) => {
      const created = repository.createTaskList(request);
      recordUndo({
        actionKind: "task_list.create",
        label: "Create task list",
        resourceKind: "taskList",
        resourceId: created.id,
        before: null,
        after: undoRepository?.taskListSnapshot(created.id)
      });
      return created;
    },
    renameTaskList: (request) => {
      const before = undoRepository?.taskListSnapshot(request.id) ?? null;
      const renamed = repository.renameTaskList(request);
      recordUndo({
        actionKind: "task_list.rename",
        label: "Rename task list",
        resourceKind: "taskList",
        resourceId: request.id,
        before,
        after: undoRepository?.taskListSnapshot(request.id)
      });
      return renamed;
    },
    deleteTaskList: (request) => {
      const before = undoRepository?.taskListSnapshot(request.id) ?? null;
      const deleted = repository.deleteTaskList(request);
      recordUndo({
        actionKind: "task_list.delete",
        label: "Delete task list",
        resourceKind: "taskList",
        resourceId: request.id,
        before,
        after: null
      });
      return deleted;
    },
    listCalendars: (request) => repository.listCalendars(request),
    listCalendarEvents: (request) => repository.listCalendarEvents(request),
    getCalendarEvent: (request) => repository.getCalendarEvent(request.id),
    createCalendarEvent: (request) => {
      const created = repository.createCalendarEvent(request);
      recordUndo({
        actionKind: "calendar.events.create",
        label: "Create event",
        resourceKind: "calendarEvent",
        resourceId: created.id,
        before: null,
        after: undoRepository?.calendarEventSnapshot(created.id)
      });
      return created;
    },
    updateCalendarEvent: (request) => {
      const before = undoRepository?.calendarEventSnapshot(request.id) ?? null;
      const updated = repository.updateCalendarEvent(request);
      recordUndo({
        actionKind: "calendar.events.update",
        label: "Edit event",
        resourceKind: "calendarEvent",
        resourceId: updated.id,
        before,
        after: undoRepository?.calendarEventSnapshot(updated.id)
      });
      return updated;
    },
    completeCalendarEvent: (request) => {
      const beforeDetail = repository.getCalendarEvent(request.id);
      const before = undoRepository?.calendarEventSnapshot(beforeDetail.eventId) ?? null;
      const completed = repository.completeCalendarEvent(request);
      recordUndo({
        actionKind: "calendar.events.complete",
        label: "Complete event",
        resourceKind: "calendarEvent",
        resourceId: completed.eventId,
        before,
        after: undoRepository?.calendarEventSnapshot(completed.eventId)
      });
      return completed;
    },
    reopenCalendarEvent: (request) => {
      const beforeDetail = repository.getCalendarEvent(request.id);
      const before = undoRepository?.calendarEventSnapshot(beforeDetail.eventId) ?? null;
      const reopened = repository.reopenCalendarEvent(request);
      recordUndo({
        actionKind: "calendar.events.reopen",
        label: "Reopen event",
        resourceKind: "calendarEvent",
        resourceId: reopened.eventId,
        before,
        after: undoRepository?.calendarEventSnapshot(reopened.eventId)
      });
      return reopened;
    },
    deleteCalendarEvent: (request) => {
      const before = undoRepository?.calendarEventSnapshot(request.id) ?? null;
      const deleted = repository.deleteCalendarEvent(request);
      recordUndo({
        actionKind: "calendar.events.delete",
        label: "Delete event",
        resourceKind: "calendarEvent",
        resourceId: deleted.id,
        before,
        after: null
      });
      return deleted;
    },
    listScheduledTaskBlocks: (request) => repository.listScheduledTaskBlocks(request),
    scheduleTaskBlock: (request) => {
      const scheduled = repository.scheduleTaskBlock(request);
      recordUndo({
        actionKind: "scheduled_task_block.create",
        label: "Schedule task",
        resourceKind: "scheduledTaskBlock",
        resourceId: scheduled.id,
        before: null,
        after: undoRepository?.scheduledTaskBlockSnapshot(scheduled.id)
      });
      return scheduled;
    },
    moveScheduledTaskBlock: (request) => {
      const before = undoRepository?.scheduledTaskBlockSnapshot(request.id) ?? null;
      const moved = repository.moveScheduledTaskBlock(request);
      recordUndo({
        actionKind: "scheduled_task_block.move",
        label: "Move scheduled task",
        resourceKind: "scheduledTaskBlock",
        resourceId: request.id,
        before,
        after: undoRepository?.scheduledTaskBlockSnapshot(request.id)
      });
      return moved;
    },
    unscheduleTaskBlock: (request) => {
      const before = undoRepository?.scheduledTaskBlockSnapshot(request.id) ?? null;
      const unscheduled = repository.unscheduleTaskBlock(request);
      recordUndo({
        actionKind: "scheduled_task_block.delete",
        label: "Unschedule task",
        resourceKind: "scheduledTaskBlock",
        resourceId: request.id,
        before,
        after: null
      });
      return unscheduled;
    },
    scheduleSuggest: (request) => {
      const start = `${request.date}T00:00:00.000Z`;
      const end = new Date(Date.parse(start) + 24 * 60 * 60 * 1000).toISOString();
      const events = repository.listCalendarEvents({
        start,
        end,
        limit: 500
      }).items;
      const tasks = repository.listTasks({
        status: "active",
        limit: 100
      }).items;

      return buildDaySchedule({
        date: request.date,
        events: events.filter((event) => event.completedAt === null || event.completedAt === undefined),
        tasks,
        capacityMinutes: request.capacityMinutes ?? 480,
        workingHours: {
          start: request.workingHours?.start ?? 6,
          end: request.workingHours?.end ?? 22
        }
      });
    },
    exportAvailability: (request) => repository.exportAvailability(request),
    listNotes: (request) => repository.listNotes(request),
    createNoteList: (request) => {
      const created = repository.createNoteList(request);
      recordUndo({
        actionKind: "note_list.create",
        label: "Create note list",
        resourceKind: "noteList",
        resourceId: created.id,
        before: null,
        after: undoRepository?.noteListSnapshot(created.id)
      });
      return created;
    },
    renameNoteList: (request) => {
      const before = undoRepository?.noteListSnapshot(request.id) ?? null;
      const renamed = repository.renameNoteList(request);
      recordUndo({
        actionKind: "note_list.rename",
        label: "Rename note list",
        resourceKind: "noteList",
        resourceId: request.id,
        before,
        after: undoRepository?.noteListSnapshot(request.id)
      });
      return renamed;
    },
    deleteNoteList: (request) => {
      const before = undoRepository?.noteListSnapshot(request.id) ?? null;
      const deleted = repository.deleteNoteList(request);
      recordUndo({
        actionKind: "note_list.delete",
        label: "Delete note list",
        resourceKind: "noteList",
        resourceId: request.id,
        before,
        after: null
      });
      return deleted;
    },
    getNote: (request) => repository.getNote(request.id),
    createNote: (request) => {
      const created = repository.createNote(request);
      recordUndo({
        actionKind: "note.create",
        label: "Create note",
        resourceKind: "note",
        resourceId: created.id,
        before: null,
        after: undoRepository?.noteSnapshot(created.id)
      });
      return created;
    },
    updateNote: (request) => {
      const before = undoRepository?.noteSnapshot(request.id) ?? null;
      const updated = repository.updateNote(request);
      recordUndo({
        actionKind: "note.update",
        label: "Edit note",
        resourceKind: "note",
        resourceId: request.id,
        before,
        after: undoRepository?.noteSnapshot(request.id)
      });
      return updated;
    },
    deleteNote: (request) => {
      const before = undoRepository?.noteSnapshot(request.id) ?? null;
      const deleted = repository.deleteNote(request);
      recordUndo({
        actionKind: "note.delete",
        label: "Delete note",
        resourceKind: "note",
        resourceId: request.id,
        before,
        after: null
      });
      return deleted;
    },
    suggestNoteLinks: (request) => repository.suggestLinkTargets(request),
    listBrokenNoteLinks: (request) => repository.listBrokenNoteLinks(request),
    search: (request) => repository.search(request)
  };
}

function jsonValue(value: unknown): JsonValue {
  return value === undefined ? null : value as JsonValue;
}
