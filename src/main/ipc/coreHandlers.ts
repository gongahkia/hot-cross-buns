import {
  ipcContracts,
  type AvailabilityExportRequest,
  type CalendarEventCompletionRequest,
  type CalendarListRequest,
  type CalendarEventCreateRequest,
  type CalendarEventDeleteRequest,
  type CalendarEventUpdateRequest,
  type CalendarRangeRequest,
  type CalendarScheduleSuggestRequest,
  type EntityByIdRequest,
  type GoogleDisconnectRequest,
  type GoogleSaveOAuthClientRequest,
  type McpSetEnabledRequest,
  type NoteBrokenLinksRequest,
  type NoteCreateRequest,
  type NoteDeleteRequest,
  type NoteLinkSuggestRequest,
  type NoteListCreateRequest,
  type NoteListDeleteRequest,
  type NoteListRequest,
  type NoteListRenameRequest,
  type NoteUpdateRequest,
  type SearchQueryRequest,
  type ScheduledTaskBlockCreateRequest,
  type ScheduledTaskBlockListRequest,
  type ScheduledTaskBlockMoveRequest,
  type ScheduledTaskBlockUnscheduleRequest,
  type SettingsRecoveryActionRequest,
  type SettingsUpdateRequest,
  type SyncRunNowRequest,
  type TaskCompletionRequest,
  type TaskCreateRequest,
  type TaskDeleteRequest,
  type TaskListCreateRequest,
  type TaskListDeleteRequest,
  type TaskListRenameRequest,
  type TaskListsRequest,
  type TaskListRequest,
  type TaskMoveRequest,
  type TaskUpdateRequest
} from "@shared/ipc/contracts";
import type { AppDomainServices } from "../services/domainInterfaces";
import type { IpcHandlerDefinition } from "./registry";

export function createCoreIpcHandlers(services: AppDomainServices): IpcHandlerDefinition[] {
  return [
    {
      contract: ipcContracts.tasks.listTaskLists,
      handle: (request) => services.planner.listTaskLists(request as TaskListsRequest)
    },
    {
      contract: ipcContracts.tasks.list,
      handle: (request) => services.planner.listTasks(request as TaskListRequest)
    },
    {
      contract: ipcContracts.tasks.get,
      handle: (request) => services.planner.getTask(request as EntityByIdRequest)
    },
    {
      contract: ipcContracts.tasks.create,
      handle: (request) => services.planner.createTask(request as TaskCreateRequest)
    },
    {
      contract: ipcContracts.tasks.update,
      handle: (request) => services.planner.updateTask(request as TaskUpdateRequest)
    },
    {
      contract: ipcContracts.tasks.complete,
      handle: (request) => services.planner.completeTask(request as TaskCompletionRequest)
    },
    {
      contract: ipcContracts.tasks.reopen,
      handle: (request) => services.planner.reopenTask(request as TaskCompletionRequest)
    },
    {
      contract: ipcContracts.tasks.move,
      handle: (request) => services.planner.moveTask(request as TaskMoveRequest)
    },
    {
      contract: ipcContracts.tasks.delete,
      handle: (request) => services.planner.deleteTask(request as TaskDeleteRequest)
    },
    {
      contract: ipcContracts.tasks.createTaskList,
      handle: (request) => services.planner.createTaskList(request as TaskListCreateRequest)
    },
    {
      contract: ipcContracts.tasks.renameTaskList,
      handle: (request) => services.planner.renameTaskList(request as TaskListRenameRequest)
    },
    {
      contract: ipcContracts.tasks.deleteTaskList,
      handle: (request) => services.planner.deleteTaskList(request as TaskListDeleteRequest)
    },
    {
      contract: ipcContracts.calendar.listCalendars,
      handle: (request) => services.planner.listCalendars(request as CalendarListRequest)
    },
    {
      contract: ipcContracts.calendar.listEvents,
      handle: (request) => services.planner.listCalendarEvents(request as CalendarRangeRequest)
    },
    {
      contract: ipcContracts.calendar.get,
      handle: (request) => services.planner.getCalendarEvent(request as EntityByIdRequest)
    },
    {
      contract: ipcContracts.calendar.create,
      handle: (request) => services.planner.createCalendarEvent(request as CalendarEventCreateRequest)
    },
    {
      contract: ipcContracts.calendar.update,
      handle: (request) => services.planner.updateCalendarEvent(request as CalendarEventUpdateRequest)
    },
    {
      contract: ipcContracts.calendar.complete,
      handle: (request) => services.planner.completeCalendarEvent(request as CalendarEventCompletionRequest)
    },
    {
      contract: ipcContracts.calendar.reopen,
      handle: (request) => services.planner.reopenCalendarEvent(request as CalendarEventCompletionRequest)
    },
    {
      contract: ipcContracts.calendar.delete,
      handle: (request) => services.planner.deleteCalendarEvent(request as CalendarEventDeleteRequest)
    },
    {
      contract: ipcContracts.calendar.listScheduledTaskBlocks,
      handle: (request) =>
        services.planner.listScheduledTaskBlocks(request as ScheduledTaskBlockListRequest)
    },
    {
      contract: ipcContracts.calendar.scheduleTaskBlock,
      handle: (request) =>
        services.planner.scheduleTaskBlock(request as ScheduledTaskBlockCreateRequest)
    },
    {
      contract: ipcContracts.calendar.moveScheduledTaskBlock,
      handle: (request) =>
        services.planner.moveScheduledTaskBlock(request as ScheduledTaskBlockMoveRequest)
    },
    {
      contract: ipcContracts.calendar.unscheduleTaskBlock,
      handle: (request) =>
        services.planner.unscheduleTaskBlock(request as ScheduledTaskBlockUnscheduleRequest)
    },
    {
      contract: ipcContracts.calendar.scheduleSuggest,
      handle: (request) =>
        services.planner.scheduleSuggest(request as CalendarScheduleSuggestRequest)
    },
    {
      contract: ipcContracts.calendar.exportAvailability,
      handle: (request) =>
        services.planner.exportAvailability(request as AvailabilityExportRequest)
    },
    {
      contract: ipcContracts.notes.list,
      handle: (request) => services.planner.listNotes(request as NoteListRequest)
    },
    {
      contract: ipcContracts.notes.createList,
      handle: (request) => services.planner.createNoteList(request as NoteListCreateRequest)
    },
    {
      contract: ipcContracts.notes.renameList,
      handle: (request) => services.planner.renameNoteList(request as NoteListRenameRequest)
    },
    {
      contract: ipcContracts.notes.deleteList,
      handle: (request) => services.planner.deleteNoteList(request as NoteListDeleteRequest)
    },
    {
      contract: ipcContracts.notes.get,
      handle: (request) => services.planner.getNote(request as EntityByIdRequest)
    },
    {
      contract: ipcContracts.notes.create,
      handle: (request) => services.planner.createNote(request as NoteCreateRequest)
    },
    {
      contract: ipcContracts.notes.update,
      handle: (request) => services.planner.updateNote(request as NoteUpdateRequest)
    },
    {
      contract: ipcContracts.notes.delete,
      handle: (request) => services.planner.deleteNote(request as NoteDeleteRequest)
    },
    {
      contract: ipcContracts.notes.linkSuggest,
      handle: (request) => services.planner.suggestNoteLinks(request as NoteLinkSuggestRequest)
    },
    {
      contract: ipcContracts.notes.listBrokenLinks,
      handle: (request) => services.planner.listBrokenNoteLinks(request as NoteBrokenLinksRequest)
    },
    {
      contract: ipcContracts.search.query,
      handle: (request) => services.planner.search(request as SearchQueryRequest)
    },
    {
      contract: ipcContracts.sync.status,
      handle: () => services.sync.status()
    },
    {
      contract: ipcContracts.sync.runNow,
      handle: (request) => services.sync.runNow(request as SyncRunNowRequest)
    },
    {
      contract: ipcContracts.google.status,
      handle: () => services.google.status()
    },
    {
      contract: ipcContracts.google.saveOAuthClient,
      handle: (request) =>
        services.google.saveOAuthClient(request as GoogleSaveOAuthClientRequest)
    },
    {
      contract: ipcContracts.google.beginOAuth,
      handle: () => services.google.beginOAuth()
    },
    {
      contract: ipcContracts.google.disconnect,
      handle: (request) => services.google.disconnect(request as GoogleDisconnectRequest)
    },
    {
      contract: ipcContracts.settings.get,
      handle: () => services.settings.get()
    },
    {
      contract: ipcContracts.settings.update,
      handle: (request) => services.settings.update(request as SettingsUpdateRequest)
    },
    {
      contract: ipcContracts.settings.recoveryAction,
      handle: (request) =>
        services.settings.recoveryAction(request as SettingsRecoveryActionRequest)
    },
    {
      contract: ipcContracts.undo.status,
      handle: () => services.undo.status()
    },
    {
      contract: ipcContracts.undo.undo,
      handle: () => services.undo.undo()
    },
    {
      contract: ipcContracts.undo.redo,
      handle: () => services.undo.redo()
    },
    {
      contract: ipcContracts.mcp.status,
      handle: () => services.mcp.status()
    },
    {
      contract: ipcContracts.mcp.setEnabled,
      handle: (request) => services.mcp.setEnabled(request as McpSetEnabledRequest)
    },
    {
      contract: ipcContracts.native.capabilities,
      handle: () => services.native.capabilities()
    },
    {
      contract: ipcContracts.native.requestNotificationPermission,
      handle: () => services.native.requestNotificationPermission()
    },
    {
      contract: ipcContracts.native.listFontFamilies,
      handle: () => services.native.listFontFamilies()
    }
  ];
}
