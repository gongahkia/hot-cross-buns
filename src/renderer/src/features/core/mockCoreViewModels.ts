import type {
  CalendarDayViewModel,
  CalendarEventViewModel,
  CalendarMonthWeekViewModel,
  NoteViewModel,
  SearchBucketViewModel,
  SearchViewModel,
  SettingsSectionViewModel,
  TaskFilterId,
  TaskFilterViewModel,
  TaskViewModel
} from "./coreViewModels";

export type {
  CalendarDayViewModel,
  CalendarEventViewModel,
  CalendarMonthWeekViewModel,
  CorePriority,
  NoteViewModel,
  SearchBucketViewModel,
  SearchSource,
  SearchViewModel,
  SettingsSectionId,
  SettingsSectionViewModel,
  TaskFilterId,
  TaskFilterViewModel,
  TaskGroupViewModel,
  TaskStatus,
  TaskSubtaskViewModel,
  TaskViewModel
} from "./coreViewModels";

const inboxTasks: TaskViewModel[] = [
  {
    id: "task-inbox-rules",
    title: "Draft inbox triage rules",
    detail: "Define keyboard-first review states before sync writes exist.",
    list: "Inbox",
    dueLabel: "Today",
    priority: "high",
    status: "open",
    subtasks: [
      { id: "subtask-inbox-shortcuts", title: "Map shortcut states", completed: true },
      { id: "subtask-inbox-empty", title: "Name empty views", completed: false }
    ]
  },
  {
    id: "task-calendar-fixtures",
    title: "Review calendar fixture shape",
    detail: "Keep visible rows stable for future agenda virtualization.",
    list: "Inbox",
    dueLabel: "Today",
    priority: "medium",
    status: "open",
    subtasks: [
      { id: "subtask-calendar-agenda", title: "Agenda rows", completed: true },
      { id: "subtask-calendar-month", title: "Month grid shell", completed: false }
    ]
  }
];

const planningTasks: TaskViewModel[] = [
  {
    id: "task-offline-copy",
    title: "Tighten offline banner copy",
    detail: "Make retry and cache state explicit without exposing service details.",
    list: "Planning",
    dueLabel: "Tomorrow",
    priority: "low",
    status: "open",
    subtasks: [
      { id: "subtask-offline-retry", title: "Retry copy", completed: false },
      { id: "subtask-offline-redaction", title: "Redaction note", completed: true }
    ]
  },
  {
    id: "task-settings-states",
    title: "Map settings empty and error states",
    detail: "Prepare rows for OAuth, hotkeys, diagnostics, MCP, and local data.",
    list: "Planning",
    dueLabel: "Friday",
    priority: "none",
    status: "open",
    subtasks: [
      { id: "subtask-settings-sections", title: "Required sections", completed: true },
      { id: "subtask-settings-conflict", title: "Shortcut conflict", completed: false }
    ]
  }
];

const completedTasks: TaskViewModel[] = [
  {
    id: "task-shell-visible",
    title: "Report shell-visible timing",
    detail: "Mock-only diagnostics call is already available through preload.",
    list: "Performance",
    dueLabel: "Done",
    priority: "low",
    status: "completed",
    subtasks: [
      { id: "subtask-shell-mark", title: "Mark first paint", completed: true },
      { id: "subtask-shell-health", title: "Health status", completed: true }
    ]
  },
  {
    id: "task-command-palette",
    title: "Keep command palette cheap to mount",
    detail: "Command registry stays in memory and does not wait for cache hydration.",
    list: "Performance",
    dueLabel: "Done",
    priority: "medium",
    status: "completed",
    subtasks: [
      { id: "subtask-command-filter", title: "Filter commands", completed: true },
      { id: "subtask-command-navigate", title: "Navigate sections", completed: true }
    ]
  }
];

const hiddenTasks: TaskViewModel[] = [
  {
    id: "task-hidden-legacy-import",
    title: "Legacy import comparison",
    detail: "Hidden until local data migrations exist.",
    list: "Backlog",
    dueLabel: "Hidden",
    priority: "none",
    status: "hidden",
    subtasks: [{ id: "subtask-hidden-scope", title: "Keep reference-only", completed: false }]
  }
];

const deletedTasks: TaskViewModel[] = [
  {
    id: "task-deleted-stale-demo",
    title: "Remove stale demo row",
    detail: "Deleted task shell for trash filters and recovery copy.",
    list: "Backlog",
    dueLabel: "Deleted",
    priority: "low",
    status: "deleted",
    subtasks: [{ id: "subtask-deleted-audit", title: "Audit mutation", completed: true }]
  }
];

export const largeTaskWindow: TaskViewModel[] = Array.from({ length: 96 }, (_, index) => ({
  id: `task-generated-${index + 1}`,
  title: `Generated planning task ${String(index + 1).padStart(2, "0")}`,
  detail: "Virtualized placeholder row for large local cache testing.",
  list: index % 2 === 0 ? "Inbox" : "Planning",
  dueLabel: index % 3 === 0 ? "This week" : "Later",
  priority: index % 5 === 0 ? "high" : index % 3 === 0 ? "medium" : "none",
  status: "open",
  subtasks: []
}));

export const taskFilterViewModels: TaskFilterViewModel[] = [
  {
    id: "open",
    label: "Open",
    countLabel: "4",
    groups: [
      {
        id: "inbox-open",
        title: "Inbox",
        description: "Precomputed open tasks due today",
        countLabel: "2 tasks",
        tasks: inboxTasks
      },
      {
        id: "planning-open",
        title: "Planning",
        description: "Precomputed open planning tasks",
        countLabel: "2 tasks",
        tasks: planningTasks
      }
    ]
  },
  {
    id: "completed",
    label: "Completed",
    countLabel: "2",
    groups: [
      {
        id: "completed-history",
        title: "Completed history",
        description: "Finished rows from the local mock cache",
        countLabel: "2 tasks",
        tasks: completedTasks
      }
    ]
  },
  {
    id: "hidden",
    label: "Hidden",
    countLabel: "1",
    groups: [
      {
        id: "hidden",
        title: "Hidden",
        description: "Rows excluded from the default planner",
        countLabel: "1 task",
        tasks: hiddenTasks
      }
    ]
  },
  {
    id: "deleted",
    label: "Deleted",
    countLabel: "1",
    groups: [
      {
        id: "deleted",
        title: "Deleted",
        description: "Trash shell for recover or purge flows",
        countLabel: "1 task",
        tasks: deletedTasks
      }
    ]
  },
  {
    id: "empty",
    label: "Empty",
    countLabel: "0",
    groups: [],
    state: "empty"
  },
  {
    id: "error",
    label: "Error",
    countLabel: "!",
    groups: [],
    state: "error"
  }
];

export const todayViewModel = {
  metrics: [
    { id: "open", label: "Open tasks", value: "4" },
    { id: "events", label: "Events today", value: "5" },
    { id: "notes", label: "Local notes", value: "3" },
    { id: "cache", label: "Cache mode", value: "Mock" }
  ],
  focusTasks: [...inboxTasks, planningTasks[0]],
  timelineRows: [
    { kind: "event" as const, itemId: "event-standup" },
    { kind: "task" as const, itemId: "task-inbox-rules" },
    { kind: "event" as const, itemId: "event-focus" },
    { kind: "task" as const, itemId: "task-calendar-fixtures" },
    { kind: "event" as const, itemId: "event-review" }
  ]
};

export const calendarEventsById: Record<string, CalendarEventViewModel> = {
  "event-standup": {
    id: "event-standup",
    title: "Planner shell standup",
    calendar: "Product",
    timeLabel: "09:30",
    rangeLabel: "09:30-09:50",
    location: "Local mock room",
    notes: "Review Today and Tasks shape."
  },
  "event-focus": {
    id: "event-focus",
    title: "Focused implementation block",
    calendar: "Engineering",
    timeLabel: "11:00",
    rangeLabel: "11:00-13:00",
    location: "Desk",
    notes: "Renderer-only feature work."
  },
  "event-sync-review": {
    id: "event-sync-review",
    title: "Sync contract review",
    calendar: "Engineering",
    timeLabel: "14:00",
    rangeLabel: "14:00-14:45",
    location: "Video",
    notes: "Confirm missing preload contracts."
  },
  "event-review": {
    id: "event-review",
    title: "Renderer acceptance review",
    calendar: "QA",
    timeLabel: "15:30",
    rangeLabel: "15:30-16:15",
    location: "Codex",
    notes: "Check screen coverage and tests."
  },
  "event-notes": {
    id: "event-notes",
    title: "Notes local state pass",
    calendar: "Product",
    timeLabel: "17:00",
    rangeLabel: "17:00-17:25",
    location: "Local mock room",
    notes: "Exercise create, edit, delete state."
  }
};

export const calendarAgendaEvents: CalendarEventViewModel[] = [
  calendarEventsById["event-standup"],
  calendarEventsById["event-focus"],
  calendarEventsById["event-sync-review"],
  calendarEventsById["event-review"],
  calendarEventsById["event-notes"],
  ...Array.from({ length: 42 }, (_, index) => ({
    id: `event-generated-${index + 1}`,
    title: `Generated agenda event ${String(index + 1).padStart(2, "0")}`,
    calendar: index % 2 === 0 ? "Product" : "Engineering",
    timeLabel: `${String(8 + (index % 10)).padStart(2, "0")}:15`,
    rangeLabel: `${String(8 + (index % 10)).padStart(2, "0")}:15-${String(8 + (index % 10)).padStart(2, "0")}:45`,
    location: "Mock calendar",
    notes: "Virtualized agenda placeholder."
  }))
];

export const calendarDayView: CalendarDayViewModel = {
  id: "day-2026-05-22",
  weekday: "Friday",
  dateLabel: "May 22",
  isToday: true,
  events: [
    calendarEventsById["event-standup"],
    calendarEventsById["event-focus"],
    calendarEventsById["event-sync-review"],
    calendarEventsById["event-review"],
    calendarEventsById["event-notes"]
  ]
};

export const calendarWeekDays: CalendarDayViewModel[] = [
  {
    id: "week-mon",
    weekday: "Mon",
    dateLabel: "18",
    events: [calendarEventsById["event-standup"]]
  },
  {
    id: "week-tue",
    weekday: "Tue",
    dateLabel: "19",
    events: []
  },
  {
    id: "week-wed",
    weekday: "Wed",
    dateLabel: "20",
    events: [calendarEventsById["event-focus"]]
  },
  {
    id: "week-thu",
    weekday: "Thu",
    dateLabel: "21",
    events: [calendarEventsById["event-sync-review"]]
  },
  {
    id: "week-fri",
    weekday: "Fri",
    dateLabel: "22",
    isToday: true,
    events: [calendarEventsById["event-review"], calendarEventsById["event-notes"]]
  },
  {
    id: "week-sat",
    weekday: "Sat",
    dateLabel: "23",
    events: []
  },
  {
    id: "week-sun",
    weekday: "Sun",
    dateLabel: "24",
    events: []
  }
];

export const calendarMonthWeeks: CalendarMonthWeekViewModel[] = [
  {
    id: "month-week-1",
    days: [
      { id: "month-apr-27", weekday: "Mon", dateLabel: "27", isOutsideMonth: true, events: [] },
      { id: "month-apr-28", weekday: "Tue", dateLabel: "28", isOutsideMonth: true, events: [] },
      { id: "month-apr-29", weekday: "Wed", dateLabel: "29", isOutsideMonth: true, events: [] },
      { id: "month-apr-30", weekday: "Thu", dateLabel: "30", isOutsideMonth: true, events: [] },
      { id: "month-may-1", weekday: "Fri", dateLabel: "1", events: [] },
      { id: "month-may-2", weekday: "Sat", dateLabel: "2", events: [] },
      { id: "month-may-3", weekday: "Sun", dateLabel: "3", events: [] }
    ]
  },
  {
    id: "month-week-2",
    days: [
      { id: "month-may-4", weekday: "Mon", dateLabel: "4", events: [] },
      { id: "month-may-5", weekday: "Tue", dateLabel: "5", events: [] },
      { id: "month-may-6", weekday: "Wed", dateLabel: "6", events: [] },
      { id: "month-may-7", weekday: "Thu", dateLabel: "7", events: [] },
      { id: "month-may-8", weekday: "Fri", dateLabel: "8", events: [] },
      { id: "month-may-9", weekday: "Sat", dateLabel: "9", events: [] },
      { id: "month-may-10", weekday: "Sun", dateLabel: "10", events: [] }
    ]
  },
  {
    id: "month-week-3",
    days: [
      { id: "month-may-11", weekday: "Mon", dateLabel: "11", events: [] },
      { id: "month-may-12", weekday: "Tue", dateLabel: "12", events: [] },
      { id: "month-may-13", weekday: "Wed", dateLabel: "13", events: [] },
      { id: "month-may-14", weekday: "Thu", dateLabel: "14", events: [] },
      { id: "month-may-15", weekday: "Fri", dateLabel: "15", events: [] },
      { id: "month-may-16", weekday: "Sat", dateLabel: "16", events: [] },
      { id: "month-may-17", weekday: "Sun", dateLabel: "17", events: [] }
    ]
  },
  {
    id: "month-week-4",
    days: [
      { id: "month-may-18", weekday: "Mon", dateLabel: "18", events: [calendarEventsById["event-standup"]] },
      { id: "month-may-19", weekday: "Tue", dateLabel: "19", events: [] },
      { id: "month-may-20", weekday: "Wed", dateLabel: "20", events: [calendarEventsById["event-focus"]] },
      { id: "month-may-21", weekday: "Thu", dateLabel: "21", events: [calendarEventsById["event-sync-review"]] },
      {
        id: "month-may-22",
        weekday: "Fri",
        dateLabel: "22",
        isToday: true,
        events: [calendarEventsById["event-review"], calendarEventsById["event-notes"]]
      },
      { id: "month-may-23", weekday: "Sat", dateLabel: "23", events: [] },
      { id: "month-may-24", weekday: "Sun", dateLabel: "24", events: [] }
    ]
  },
  {
    id: "month-week-5",
    days: [
      { id: "month-may-25", weekday: "Mon", dateLabel: "25", events: [] },
      { id: "month-may-26", weekday: "Tue", dateLabel: "26", events: [] },
      { id: "month-may-27", weekday: "Wed", dateLabel: "27", events: [] },
      { id: "month-may-28", weekday: "Thu", dateLabel: "28", events: [] },
      { id: "month-may-29", weekday: "Fri", dateLabel: "29", events: [] },
      { id: "month-may-30", weekday: "Sat", dateLabel: "30", events: [] },
      { id: "month-may-31", weekday: "Sun", dateLabel: "31", events: [] }
    ]
  }
];

export const initialNotes: NoteViewModel[] = [
  {
    id: "note-cache-first",
    title: "Cache-first startup",
    body: "Renderer should paint a useful shell before Google, SQLite, or MCP work is wired.",
    preview: "Renderer should paint a useful shell before Google, SQLite, or MCP work is wired.",
    updatedLabel: "Updated 8m ago"
  },
  {
    id: "note-command-surface",
    title: "Command palette surface",
    body: "Commands stay in memory and execute the same future services as visible controls.",
    preview: "Commands stay in memory and execute the same future services as visible controls.",
    updatedLabel: "Updated 21m ago"
  },
  {
    id: "note-density",
    title: "Compact density checks",
    body: "Use 13px body text, stable toolbar controls, and visible focus rings.",
    preview: "Use 13px body text, stable toolbar controls, and visible focus rings.",
    updatedLabel: "Updated yesterday"
  }
];

export const searchBuckets: SearchBucketViewModel[] = [
  {
    id: "tasks",
    label: "Task matches",
    matchTerms: ["task", "tasks", "inbox", "triage", "calendar fixture", "offline", "settings"],
    results: [
      {
        id: "search-task-inbox-rules",
        source: "task",
        title: "Draft inbox triage rules",
        detail: "Inbox task due today with two subtasks.",
        deepLinkLabel: "Tasks / Inbox"
      },
      {
        id: "search-task-calendar-fixtures",
        source: "task",
        title: "Review calendar fixture shape",
        detail: "Planning task for stable agenda virtualization rows.",
        deepLinkLabel: "Tasks / Planning"
      }
    ]
  },
  {
    id: "events",
    label: "Event matches",
    matchTerms: ["event", "events", "agenda", "calendar", "review", "standup", "sync"],
    results: [
      {
        id: "search-event-review",
        source: "event",
        title: "Renderer acceptance review",
        detail: "QA calendar event at 15:30.",
        deepLinkLabel: "Calendar / Agenda"
      },
      {
        id: "search-event-sync",
        source: "event",
        title: "Sync contract review",
        detail: "Engineering calendar event at 14:00.",
        deepLinkLabel: "Calendar / Day"
      }
    ]
  },
  {
    id: "notes",
    label: "Note matches",
    matchTerms: ["note", "notes", "local", "cache", "command", "density"],
    results: [
      {
        id: "search-note-command",
        source: "note",
        title: "Command palette surface",
        detail: "Local note updated 21m ago.",
        deepLinkLabel: "Notes / Local"
      },
      {
        id: "search-note-cache",
        source: "note",
        title: "Cache-first startup",
        detail: "Local-only note about shell visibility.",
        deepLinkLabel: "Notes / Local"
      }
    ]
  }
];

export const settingsSections: SettingsSectionViewModel[] = [
  {
    id: "google",
    title: "Google",
    status: "Disconnected",
    detail: "OAuth setup shell only. The renderer never receives tokens or client secrets.",
    rows: [
      { id: "account", label: "Account", value: "Not connected" },
      { id: "scopes", label: "Scopes", value: "Tasks and Calendar pending" }
    ]
  },
  {
    id: "sync",
    title: "Sync",
    status: "Mock only",
    detail: "Local cache first, with future background refresh and full-resync controls.",
    rows: [
      { id: "mode", label: "Mode", value: "Cache first" },
      { id: "queue", label: "Mutation queue", value: "Idle" }
    ]
  },
  {
    id: "appearance",
    title: "Appearance",
    status: "System",
    detail: "Theme and density controls backed by semantic renderer tokens.",
    rows: [
      { id: "theme", label: "Theme", value: "System" },
      { id: "density", label: "Density", value: "Compact" }
    ]
  },
  {
    id: "hotkeys",
    title: "Hotkeys",
    status: "Conflict",
    detail: "Quick capture shortcut state remains recoverable and visible.",
    rows: [
      { id: "capture", label: "Quick capture", value: "Conflict: Ctrl+Space" },
      { id: "palette", label: "Command palette", value: "Ctrl+K" }
    ]
  },
  {
    id: "tray",
    title: "Tray",
    status: "Enabled shell",
    detail: "Menu bar visibility and quick actions will be handled by native adapters.",
    rows: [
      { id: "show", label: "Show menu bar icon", value: "On" },
      { id: "click", label: "Primary click", value: "Show or hide window" }
    ]
  },
  {
    id: "notifications",
    title: "Notifications",
    status: "Not requested",
    detail: "Local notification scheduling and permission status shell.",
    rows: [
      { id: "permission", label: "Permission", value: "Not requested" },
      { id: "schedule", label: "Task reminders", value: "Local only" }
    ]
  },
  {
    id: "mcp",
    title: "MCP",
    status: "Off",
    detail: "Local agent access is opt-in and must stay on 127.0.0.1.",
    rows: [
      { id: "server", label: "Server", value: "Off" },
      { id: "writes", label: "Writes", value: "Confirm before apply" }
    ]
  },
  {
    id: "diagnostics",
    title: "Diagnostics",
    status: "Ready",
    detail: "Copyable summaries are sanitized before leaving app services.",
    rows: [
      { id: "redaction", label: "Redaction", value: "Enabled" },
      { id: "profiling", label: "Renderer profiling", value: "Off by default" }
    ]
  }
];

export function getTaskFilterViewModel(filterId: TaskFilterId): TaskFilterViewModel {
  return taskFilterViewModels.find((filter) => filter.id === filterId) ?? taskFilterViewModels[0];
}

export function getPrecomputedSearchViewModel(query: string): SearchViewModel {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return {
      state: "idle",
      summary: "Search waits for a local query",
      results: []
    };
  }

  const bucket = searchBuckets.find((candidate) =>
    candidate.matchTerms.some((term) => term.includes(normalizedQuery) || normalizedQuery.includes(term))
  );

  if (!bucket) {
    return {
      state: "empty",
      summary: "No capped mock results",
      results: []
    };
  }

  return {
    state: "results",
    summary: `${bucket.results.length} ${bucket.label.toLowerCase()}`,
    results: bucket.results
  };
}

export function getTaskById(taskId: string): TaskViewModel {
  const allTasks = [
    ...inboxTasks,
    ...planningTasks,
    ...completedTasks,
    ...hiddenTasks,
    ...deletedTasks,
    ...largeTaskWindow
  ];

  return allTasks.find((task) => task.id === taskId) ?? inboxTasks[0];
}
