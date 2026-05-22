export type CorePriority = "none" | "low" | "medium" | "high";
export type TaskStatus = "open" | "completed" | "hidden" | "deleted";
export type TaskFilterId = "open" | "completed" | "hidden" | "deleted" | "empty" | "error";
export type CalendarViewId = "agenda" | "day" | "week" | "month";
export type SearchSource = "task" | "event" | "note";
export type SettingsSectionId =
  | "google"
  | "sync"
  | "appearance"
  | "hotkeys"
  | "tray"
  | "notifications"
  | "mcp"
  | "diagnostics";

export interface TaskSubtaskViewModel {
  id: string;
  title: string;
  completed: boolean;
}

export interface TaskViewModel {
  id: string;
  title: string;
  detail: string;
  list: string;
  dueLabel: string;
  priority: CorePriority;
  status: TaskStatus;
  subtasks: TaskSubtaskViewModel[];
}

export interface TaskGroupViewModel {
  id: string;
  title: string;
  description: string;
  countLabel: string;
  tasks: TaskViewModel[];
}

export interface TaskFilterViewModel {
  id: TaskFilterId;
  label: string;
  countLabel: string;
  groups: TaskGroupViewModel[];
  state?: "ready" | "empty" | "error";
}

export interface CalendarEventViewModel {
  id: string;
  title: string;
  calendar: string;
  timeLabel: string;
  rangeLabel: string;
  location: string;
  notes: string;
}

export interface CalendarDayViewModel {
  id: string;
  weekday: string;
  dateLabel: string;
  isToday?: boolean;
  isOutsideMonth?: boolean;
  events: CalendarEventViewModel[];
}

export interface CalendarMonthWeekViewModel {
  id: string;
  days: CalendarDayViewModel[];
}

export interface NoteViewModel {
  id: string;
  title: string;
  body: string;
  preview: string;
  updatedLabel: string;
}

export interface SearchResultViewModel {
  id: string;
  source: SearchSource;
  title: string;
  detail: string;
  deepLinkLabel: string;
}

export interface SearchBucketViewModel {
  id: string;
  label: string;
  matchTerms: string[];
  results: SearchResultViewModel[];
}

export interface SearchViewModel {
  state: "idle" | "results" | "empty";
  summary: string;
  results: SearchResultViewModel[];
}

export interface SettingsSectionViewModel {
  id: SettingsSectionId;
  title: string;
  status: string;
  detail: string;
  rows: Array<{
    id: string;
    label: string;
    value: string;
  }>;
}
