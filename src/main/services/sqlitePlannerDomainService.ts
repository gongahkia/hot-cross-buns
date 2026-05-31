import type { LocalPlannerRepository } from "../data/localRepositories";
import type { PlannerViewDomainService } from "./domainInterfaces";
import { buildDaySchedule } from "./schedulingSuggestionService";

export function createSqlitePlannerDomainService(
  repository: LocalPlannerRepository
): PlannerViewDomainService {
  return {
    listTaskLists: (request) => repository.listTaskLists(request),
    listTasks: (request) => repository.listTasks(request),
    getTask: (request) => repository.getTask(request.id),
    createTask: (request) => repository.createTask(request),
    updateTask: (request) => repository.updateTask(request),
    completeTask: (request) => repository.completeTask(request),
    reopenTask: (request) => repository.reopenTask(request),
    moveTask: (request) => repository.moveTask(request),
    deleteTask: (request) => repository.deleteTask(request),
    createTaskList: (request) => repository.createTaskList(request),
    renameTaskList: (request) => repository.renameTaskList(request),
    deleteTaskList: (request) => repository.deleteTaskList(request),
    listCalendars: (request) => repository.listCalendars(request),
    listCalendarEvents: (request) => repository.listCalendarEvents(request),
    getCalendarEvent: (request) => repository.getCalendarEvent(request.id),
    createCalendarEvent: (request) => repository.createCalendarEvent(request),
    updateCalendarEvent: (request) => repository.updateCalendarEvent(request),
    deleteCalendarEvent: (request) => repository.deleteCalendarEvent(request),
    listScheduledTaskBlocks: (request) => repository.listScheduledTaskBlocks(request),
    scheduleTaskBlock: (request) => repository.scheduleTaskBlock(request),
    moveScheduledTaskBlock: (request) => repository.moveScheduledTaskBlock(request),
    unscheduleTaskBlock: (request) => repository.unscheduleTaskBlock(request),
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
        events,
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
    createNoteList: (request) => repository.createNoteList(request),
    getNote: (request) => repository.getNote(request.id),
    createNote: (request) => repository.createNote(request),
    updateNote: (request) => repository.updateNote(request),
    deleteNote: (request) => repository.deleteNote(request),
    suggestNoteLinks: (request) => repository.suggestLinkTargets(request),
    listBrokenNoteLinks: (request) => repository.listBrokenNoteLinks(request),
    search: (request) => repository.search(request)
  };
}
