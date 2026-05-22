import {
  CalendarDays,
  ListTodo,
  Search,
  Settings,
  StickyNote,
  SunMedium
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type SectionId = "today" | "tasks" | "calendar" | "notes" | "search" | "settings";
export type Priority = "none" | "low" | "medium" | "high";

export interface PlannerSection {
  id: SectionId;
  label: string;
  title: string;
  subtitle: string;
  metric: string;
  icon: LucideIcon;
}

export interface MockTask {
  id: string;
  title: string;
  detail: string;
  list: string;
  dueLabel: string;
  priority: Priority;
  completed: boolean;
}

export interface MockCalendarEvent {
  id: string;
  title: string;
  calendar: string;
  timeLabel: string;
  location: string;
}

export interface MockNote {
  id: string;
  title: string;
  preview: string;
  updatedLabel: string;
}

export interface MockSearchResult {
  id: string;
  type: "task" | "event" | "note" | "setting";
  title: string;
  detail: string;
}

export interface MockSetting {
  id: string;
  title: string;
  detail: string;
  status: string;
}

export interface MockCommand {
  id: string;
  label: string;
  description: string;
  category: string;
  keywords: string[];
  sectionId?: SectionId;
}

export const plannerSections: PlannerSection[] = [
  {
    id: "today",
    label: "Today",
    title: "Today",
    subtitle: "Daily agenda from local mock cache",
    metric: "9 items",
    icon: SunMedium
  },
  {
    id: "tasks",
    label: "Tasks",
    title: "Tasks",
    subtitle: "Task lists, priorities, and queued mutations",
    metric: "4 open",
    icon: ListTodo
  },
  {
    id: "calendar",
    label: "Calendar",
    title: "Calendar",
    subtitle: "Agenda and calendar previews",
    metric: "5 events",
    icon: CalendarDays
  },
  {
    id: "notes",
    label: "Notes",
    title: "Notes",
    subtitle: "Local-only notes and planning scratchpads",
    metric: "3 notes",
    icon: StickyNote
  },
  {
    id: "search",
    label: "Search",
    title: "Search",
    subtitle: "Local-first search shell",
    metric: "mock",
    icon: Search
  },
  {
    id: "settings",
    label: "Settings",
    title: "Settings",
    subtitle: "App preferences and diagnostics",
    metric: "8 areas",
    icon: Settings
  }
];

export const mockTasks: MockTask[] = [
  {
    id: "task-inbox-rules",
    title: "Draft inbox triage rules",
    detail: "Define keyboard-first review states before sync writes exist.",
    list: "Inbox",
    dueLabel: "Today",
    priority: "high",
    completed: false
  },
  {
    id: "task-calendar-fixtures",
    title: "Review calendar fixture shape",
    detail: "Keep visible rows stable for future agenda virtualization.",
    list: "Planning",
    dueLabel: "Today",
    priority: "medium",
    completed: false
  },
  {
    id: "task-offline-copy",
    title: "Tighten offline banner copy",
    detail: "Make retry and cache state explicit without exposing service details.",
    list: "Polish",
    dueLabel: "Tomorrow",
    priority: "low",
    completed: false
  },
  {
    id: "task-settings-states",
    title: "Map settings empty and error states",
    detail: "Prepare rows for OAuth, hotkeys, diagnostics, MCP, and local data.",
    list: "Settings",
    dueLabel: "Friday",
    priority: "none",
    completed: false
  },
  {
    id: "task-shell-visible",
    title: "Report shell-visible timing",
    detail: "Mock-only diagnostics call is already available through preload.",
    list: "Performance",
    dueLabel: "Done",
    priority: "low",
    completed: true
  }
];

export const mockEvents: MockCalendarEvent[] = [
  {
    id: "event-standup",
    title: "Planner shell standup",
    calendar: "Product",
    timeLabel: "09:30",
    location: "Local mock"
  },
  {
    id: "event-focus",
    title: "Focused implementation block",
    calendar: "Engineering",
    timeLabel: "11:00",
    location: "Desk"
  },
  {
    id: "event-review",
    title: "Renderer acceptance review",
    calendar: "QA",
    timeLabel: "15:30",
    location: "Codex"
  }
];

export const mockNotes: MockNote[] = [
  {
    id: "note-cache-first",
    title: "Cache-first startup",
    preview: "Renderer should paint a useful shell before Google, SQLite, or MCP work is wired.",
    updatedLabel: "Updated 8m ago"
  },
  {
    id: "note-command-surface",
    title: "Command palette surface",
    preview: "Commands stay in memory and execute the same future services as visible controls.",
    updatedLabel: "Updated 21m ago"
  },
  {
    id: "note-density",
    title: "Compact density checks",
    preview: "Use 13px body text, stable toolbar controls, and visible focus rings.",
    updatedLabel: "Updated yesterday"
  }
];

export const mockSettings: MockSetting[] = [
  {
    id: "google",
    title: "Google account",
    detail: "OAuth setup placeholder; no tokens are present in the renderer.",
    status: "Disconnected"
  },
  {
    id: "lists",
    title: "Lists and calendars",
    detail: "Selection UI shell for future task list and calendar sources.",
    status: "Not selected"
  },
  {
    id: "sync",
    title: "Sync mode",
    detail: "Local cache first, background refresh later.",
    status: "Mock only"
  },
  {
    id: "appearance",
    title: "Appearance",
    detail: "Semantic CSS variables support dark and light themes.",
    status: "System"
  },
  {
    id: "hotkeys",
    title: "Hotkeys",
    detail: "Quick capture shortcut conflict is represented as a recoverable error.",
    status: "Needs review"
  },
  {
    id: "diagnostics",
    title: "Diagnostics",
    detail: "Copyable summaries will be sanitized before leaving app services.",
    status: "Ready"
  }
];

export const mockSearchResults: MockSearchResult[] = [
  {
    id: "search-task-inbox-rules",
    type: "task",
    title: "Draft inbox triage rules",
    detail: "Task in Inbox due today"
  },
  {
    id: "search-event-review",
    type: "event",
    title: "Renderer acceptance review",
    detail: "Calendar event at 15:30"
  },
  {
    id: "search-note-command",
    type: "note",
    title: "Command palette surface",
    detail: "Local note updated 21m ago"
  },
  {
    id: "search-setting-hotkeys",
    type: "setting",
    title: "Hotkeys",
    detail: "Settings area with recoverable conflict"
  }
];

export const mockCommands: MockCommand[] = [
  {
    id: "new-task",
    label: "New task",
    description: "Open the future task composer",
    category: "Create",
    keywords: ["task", "todo", "inbox"]
  },
  {
    id: "new-event",
    label: "New event",
    description: "Open the future calendar composer",
    category: "Create",
    keywords: ["calendar", "event"]
  },
  {
    id: "new-note",
    label: "New note",
    description: "Start a local-only note",
    category: "Create",
    keywords: ["note", "local"]
  },
  {
    id: "quick-capture",
    label: "Quick capture",
    description: "Open the capture surface",
    category: "Create",
    keywords: ["capture", "inbox"]
  },
  {
    id: "go-today",
    label: "Go to Today",
    description: "Show the daily planner",
    category: "Navigate",
    keywords: ["today", "planner"],
    sectionId: "today"
  },
  {
    id: "go-tasks",
    label: "Go to Tasks",
    description: "Show all task lists",
    category: "Navigate",
    keywords: ["tasks", "todo"],
    sectionId: "tasks"
  },
  {
    id: "go-calendar",
    label: "Go to Calendar",
    description: "Show the agenda preview",
    category: "Navigate",
    keywords: ["calendar", "agenda", "events"],
    sectionId: "calendar"
  },
  {
    id: "go-notes",
    label: "Go to Notes",
    description: "Show local notes",
    category: "Navigate",
    keywords: ["notes", "local"],
    sectionId: "notes"
  },
  {
    id: "open-settings",
    label: "Open Settings",
    description: "Show app preferences",
    category: "Navigate",
    keywords: ["settings", "preferences"],
    sectionId: "settings"
  },
  {
    id: "refresh",
    label: "Refresh",
    description: "Queue a future sync refresh",
    category: "Sync",
    keywords: ["sync", "refresh"]
  },
  {
    id: "force-resync",
    label: "Force full resync",
    description: "Reset checkpoints in the future sync service",
    category: "Sync",
    keywords: ["sync", "reset", "checkpoint"]
  },
  {
    id: "toggle-mcp",
    label: "Toggle MCP server",
    description: "Switch future local agent access",
    category: "Agent",
    keywords: ["mcp", "agent", "server"]
  },
  {
    id: "copy-diagnostics",
    label: "Copy diagnostics summary",
    description: "Copy a sanitized diagnostics snapshot",
    category: "Diagnostics",
    keywords: ["diagnostics", "copy", "logs"]
  }
];

export function getPlannerSection(sectionId: SectionId): PlannerSection {
  return plannerSections.find((section) => section.id === sectionId) ?? plannerSections[0];
}

export function priorityLabel(priority: Priority): string {
  if (priority === "none") {
    return "No priority";
  }

  return `${priority[0].toUpperCase()}${priority.slice(1)} priority`;
}

export function buildTodayRows(): Array<MockTask | MockCalendarEvent> {
  return [
    mockEvents[0],
    mockTasks[0],
    mockEvents[1],
    mockTasks[1],
    mockEvents[2],
    mockTasks[2]
  ];
}

export function isMockEvent(item: MockTask | MockCalendarEvent): item is MockCalendarEvent {
  return "calendar" in item;
}
