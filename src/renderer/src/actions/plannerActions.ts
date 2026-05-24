import type { SectionId } from "../data/mockPlanner";

export type PlannerActionId =
  | "task.create"
  | "task.quickCapture"
  | "task.completeSelected"
  | "task.deleteSelected"
  | "calendar.create"
  | "calendar.view.agenda"
  | "calendar.view.day"
  | "calendar.view.week"
  | "calendar.view.month"
  | "note.create"
  | "search.open"
  | "search.syntax"
  | "navigation.today"
  | "navigation.tasks"
  | "navigation.calendar"
  | "navigation.notes"
  | "navigation.settings"
  | "sync.refresh"
  | "sync.forceFullResync"
  | "mcp.toggle"
  | "diagnostics.copy";

export type PlannerActionCategory =
  | "Create"
  | "Navigate"
  | "Task"
  | "Calendar"
  | "Search"
  | "Sync"
  | "Agent"
  | "Diagnostics";

export interface PlannerAction {
  id: PlannerActionId;
  label: string;
  description: string;
  category: PlannerActionCategory;
  keywords: string[];
  sectionId?: SectionId;
  calendarAction?: "new-event" | "agenda" | "day" | "week" | "month";
  noteAction?: "new-note";
  searchQuery?: string;
  taskCommand?: "task.create" | "task.quickCapture";
}

export interface PlannerActionContext {
  hasTaskLists: boolean;
  hasCalendars: boolean;
  hasSelectedTask: boolean;
  canWriteTasks: boolean;
  canWriteEvents: boolean;
}

export interface PlannerActionAvailability {
  enabled: boolean;
  reason?: string;
}

export const plannerActions: PlannerAction[] = [
  {
    id: "task.create",
    label: "New task",
    description: "Create a task in the selected local task list",
    category: "Create",
    keywords: ["task", "todo", "inbox"],
    sectionId: "tasks",
    taskCommand: "task.create"
  },
  {
    id: "calendar.create",
    label: "New event",
    description: "Create a cached Google Calendar event",
    category: "Create",
    keywords: ["calendar", "event"],
    sectionId: "calendar",
    calendarAction: "new-event"
  },
  {
    id: "note.create",
    label: "New note",
    description: "Start a local-only note",
    category: "Create",
    keywords: ["note", "local"],
    sectionId: "notes",
    noteAction: "new-note"
  },
  {
    id: "task.quickCapture",
    label: "Quick capture",
    description: "Open the task capture surface",
    category: "Create",
    keywords: ["capture", "inbox"],
    sectionId: "today",
    taskCommand: "task.quickCapture"
  },
  {
    id: "task.completeSelected",
    label: "Complete selected task",
    description: "Complete or reopen the selected task",
    category: "Task",
    keywords: ["complete", "reopen", "selected", "task"],
    sectionId: "tasks"
  },
  {
    id: "task.deleteSelected",
    label: "Delete selected task",
    description: "Delete the selected task through the local mutation path",
    category: "Task",
    keywords: ["delete", "remove", "selected", "task"],
    sectionId: "tasks"
  },
  {
    id: "navigation.today",
    label: "Go to Today",
    description: "Show the daily planner",
    category: "Navigate",
    keywords: ["today", "planner"],
    sectionId: "today"
  },
  {
    id: "navigation.tasks",
    label: "Go to Tasks",
    description: "Show all task lists",
    category: "Navigate",
    keywords: ["tasks", "todo"],
    sectionId: "tasks"
  },
  {
    id: "navigation.calendar",
    label: "Go to Calendar",
    description: "Show the agenda preview",
    category: "Navigate",
    keywords: ["calendar", "agenda", "events"],
    sectionId: "calendar",
    calendarAction: "agenda"
  },
  {
    id: "calendar.view.agenda",
    label: "Calendar agenda view",
    description: "Show the cached event agenda",
    category: "Calendar",
    keywords: ["calendar", "agenda", "events"],
    sectionId: "calendar",
    calendarAction: "agenda"
  },
  {
    id: "calendar.view.day",
    label: "Calendar day view",
    description: "Show one day of cached events",
    category: "Calendar",
    keywords: ["calendar", "day", "today"],
    sectionId: "calendar",
    calendarAction: "day"
  },
  {
    id: "calendar.view.week",
    label: "Calendar week view",
    description: "Show the visible event week",
    category: "Calendar",
    keywords: ["calendar", "week"],
    sectionId: "calendar",
    calendarAction: "week"
  },
  {
    id: "calendar.view.month",
    label: "Calendar month view",
    description: "Show the month event grid",
    category: "Calendar",
    keywords: ["calendar", "month"],
    sectionId: "calendar",
    calendarAction: "month"
  },
  {
    id: "navigation.notes",
    label: "Go to Notes",
    description: "Show local notes",
    category: "Navigate",
    keywords: ["notes", "local"],
    sectionId: "notes"
  },
  {
    id: "search.open",
    label: "Go to Search",
    description: "Search the local cache",
    category: "Navigate",
    keywords: ["search", "find", "local", "cache"],
    sectionId: "search"
  },
  {
    id: "search.syntax",
    label: "Search filter syntax",
    description: "Open Search with local filter examples",
    category: "Search",
    keywords: [
      "search",
      "filter",
      "source:tasks",
      "domain:calendar",
      "status:active",
      "due:today",
      "start:today",
      "priority:high",
      "list",
      "calendar",
      "notes:yes",
      "body:no"
    ],
    sectionId: "search",
    searchQuery: "source:tasks status:active due:today"
  },
  {
    id: "navigation.settings",
    label: "Open Settings",
    description: "Show app preferences",
    category: "Navigate",
    keywords: ["settings", "preferences"],
    sectionId: "settings"
  },
  {
    id: "sync.refresh",
    label: "Refresh",
    description: "Refresh local cache and diagnostics",
    category: "Sync",
    keywords: ["sync", "refresh"],
    sectionId: "today"
  },
  {
    id: "sync.forceFullResync",
    label: "Force full resync",
    description: "Reset checkpoints in the future sync service",
    category: "Sync",
    keywords: ["sync", "reset", "checkpoint"],
    sectionId: "settings"
  },
  {
    id: "mcp.toggle",
    label: "Toggle MCP server",
    description: "Switch future local agent access",
    category: "Agent",
    keywords: ["mcp", "agent", "server"],
    sectionId: "settings"
  },
  {
    id: "diagnostics.copy",
    label: "Copy diagnostics summary",
    description: "Copy a sanitized diagnostics snapshot",
    category: "Diagnostics",
    keywords: ["diagnostics", "copy", "logs"],
    sectionId: "settings"
  }
];

export function getPlannerAction(id: PlannerActionId): PlannerAction {
  return plannerActions.find((action) => action.id === id) ?? plannerActions[0];
}

export function plannerActionAvailability(
  action: PlannerAction,
  context: PlannerActionContext
): PlannerActionAvailability {
  if ((action.id === "task.create" || action.id === "task.quickCapture") && !context.hasTaskLists) {
    return {
      enabled: false,
      reason: "No cached task lists"
    };
  }

  if (action.id === "task.completeSelected" || action.id === "task.deleteSelected") {
    return context.hasSelectedTask
      ? { enabled: context.canWriteTasks, reason: context.canWriteTasks ? undefined : "Task write pending" }
      : { enabled: false, reason: "No selected task" };
  }

  if (action.id === "calendar.create" && !context.hasCalendars) {
    return {
      enabled: false,
      reason: "No cached calendars"
    };
  }

  if (action.id === "calendar.create" && !context.canWriteEvents) {
    return {
      enabled: false,
      reason: "Calendar write pending"
    };
  }

  return { enabled: true };
}
