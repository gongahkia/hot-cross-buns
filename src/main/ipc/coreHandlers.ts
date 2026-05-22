import {
  ipcContracts,
  type CalendarListRequest,
  type CalendarRangeRequest,
  type EntityByIdRequest,
  type McpSetEnabledRequest,
  type NoteCreateRequest,
  type NoteDeleteRequest,
  type NoteListRequest,
  type NoteUpdateRequest,
  type SearchQueryRequest,
  type SettingsUpdateRequest,
  type SyncRunNowRequest,
  type TaskListsRequest,
  type TaskListRequest
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
      contract: ipcContracts.calendar.listCalendars,
      handle: (request) => services.planner.listCalendars(request as CalendarListRequest)
    },
    {
      contract: ipcContracts.calendar.listEvents,
      handle: (request) => services.planner.listCalendarEvents(request as CalendarRangeRequest)
    },
    {
      contract: ipcContracts.notes.list,
      handle: (request) => services.planner.listNotes(request as NoteListRequest)
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
      contract: ipcContracts.settings.get,
      handle: () => services.settings.get()
    },
    {
      contract: ipcContracts.settings.update,
      handle: (request) => services.settings.update(request as SettingsUpdateRequest)
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
    }
  ];
}
