import type { JsonObject, MaybePromise } from "./types";

export interface SearchDomainInput {
  query: string;
  scope?: string;
  limit?: number;
}

export interface WeekDomainInput {
  startDate?: string;
}

export interface PlanningReadDomainService {
  search: (input: SearchDomainInput) => MaybePromise<JsonObject[]>;
  today: () => MaybePromise<JsonObject>;
  week: (input: WeekDomainInput) => MaybePromise<JsonObject>;
}

export interface TaskDomainService {
  getTask: (id: string) => MaybePromise<JsonObject>;
  listTaskLists: () => MaybePromise<JsonObject[]>;
  previewCreateTask: (input: JsonObject) => MaybePromise<JsonObject>;
  createTask: (input: JsonObject) => MaybePromise<JsonObject>;
  previewUpdateTask: (id: string, patch: JsonObject) => MaybePromise<JsonObject>;
  updateTask: (id: string, patch: JsonObject) => MaybePromise<JsonObject>;
  previewCompleteTask: (id: string) => MaybePromise<JsonObject>;
  completeTask: (id: string) => MaybePromise<JsonObject>;
  previewReopenTask: (id: string) => MaybePromise<JsonObject>;
  reopenTask: (id: string) => MaybePromise<JsonObject>;
  previewMoveTask: (id: string, taskListId: string) => MaybePromise<JsonObject>;
  moveTask: (id: string, taskListId: string) => MaybePromise<JsonObject>;
  previewDeleteTask: (id: string) => MaybePromise<JsonObject>;
  deleteTask: (id: string) => MaybePromise<JsonObject>;
}

export interface NoteDomainService {
  getNote: (id: string) => MaybePromise<JsonObject>;
  previewCreateNote: (input: JsonObject) => MaybePromise<JsonObject>;
  createNote: (input: JsonObject) => MaybePromise<JsonObject>;
  previewUpdateNote: (id: string, patch: JsonObject) => MaybePromise<JsonObject>;
  updateNote: (id: string, patch: JsonObject) => MaybePromise<JsonObject>;
  previewDeleteNote: (id: string) => MaybePromise<JsonObject>;
  deleteNote: (id: string) => MaybePromise<JsonObject>;
}

export interface CalendarDomainService {
  getEvent: (id: string) => MaybePromise<JsonObject>;
  listCalendars: () => MaybePromise<JsonObject[]>;
  previewCreateEvent: (input: JsonObject) => MaybePromise<JsonObject>;
  createEvent: (input: JsonObject) => MaybePromise<JsonObject>;
  previewUpdateEvent: (id: string, patch: JsonObject) => MaybePromise<JsonObject>;
  updateEvent: (id: string, patch: JsonObject) => MaybePromise<JsonObject>;
  previewDeleteEvent: (id: string) => MaybePromise<JsonObject>;
  deleteEvent: (id: string) => MaybePromise<JsonObject>;
}

export interface McpDomainServices {
  planning: PlanningReadDomainService;
  tasks: TaskDomainService;
  notes: NoteDomainService;
  calendar: CalendarDomainService;
}
