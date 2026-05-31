import type { SectionId } from "../data/mockPlanner";

export type PlannerActionId =
  | "quickAdd.open"
  | "task.create"
  | "task.quickCapture"
  | "task.completeSelected"
  | "task.deleteSelected"
  | "calendar.create"
  | "calendar.view.agenda"
  | "calendar.view.day"
  | "calendar.view.multiDay"
  | "calendar.view.week"
  | "calendar.view.month"
  | "note.create"
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
  calendarAction?: "new-event" | "agenda" | "day" | "multiDay" | "week" | "month";
  noteAction?: "new-note";
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
    id: "quickAdd.open",
    label: "Quick add",
    description: "Create from natural language",
    category: "Create",
    keywords: ["quick", "add", "natural", "language", "event", "task", "note", "birthday"],
    sectionId: "calendar"
  },
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
    description: "Create a Google Calendar event",
    category: "Create",
    keywords: ["calendar", "event"],
    sectionId: "calendar",
    calendarAction: "new-event"
  },
  {
    id: "note.create",
    label: "New note",
    description: "Start a note",
    category: "Create",
    keywords: ["note"],
    sectionId: "notes",
    noteAction: "new-note"
  },
  {
    id: "task.quickCapture",
    label: "Quick capture",
    description: "Open the task capture surface",
    category: "Create",
    keywords: ["capture", "inbox"],
    sectionId: "tasks",
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
    description: "Delete the selected task through the mutation path",
    category: "Task",
    keywords: ["delete", "remove", "selected", "task"],
    sectionId: "tasks"
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
    description: "Show the month calendar",
    category: "Navigate",
    keywords: ["calendar", "agenda", "events"],
    sectionId: "calendar",
    calendarAction: "month"
  },
  {
    id: "calendar.view.agenda",
    label: "Calendar agenda view",
    description: "Show the event agenda",
    category: "Calendar",
    keywords: ["calendar", "agenda", "events"],
    sectionId: "calendar",
    calendarAction: "agenda"
  },
  {
    id: "calendar.view.day",
    label: "Calendar day view",
    description: "Show one day of events",
    category: "Calendar",
    keywords: ["calendar", "day", "today"],
    sectionId: "calendar",
    calendarAction: "day"
  },
  {
    id: "calendar.view.multiDay",
    label: "Calendar multi-day view",
    description: "Show a bounded multi-day calendar range",
    category: "Calendar",
    keywords: ["calendar", "multi-day", "range"],
    sectionId: "calendar",
    calendarAction: "multiDay"
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
    description: "Show undated Google Tasks",
    category: "Navigate",
    keywords: ["notes", "tasks", "undated"],
    sectionId: "notes"
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
    description: "Refresh planner data and diagnostics",
    category: "Sync",
    keywords: ["sync", "refresh"],
    sectionId: "calendar"
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
  if (action.id === "quickAdd.open" && !context.hasTaskLists && !context.hasCalendars) {
    return {
      enabled: false,
      reason: "No destinations"
    };
  }

  if ((action.id === "task.create" || action.id === "task.quickCapture") && !context.hasTaskLists) {
    return {
      enabled: false,
      reason: "No task lists"
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
      reason: "No calendars"
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
