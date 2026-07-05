export const GOOGLE_READONLY_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/tasks.readonly",
  "https://www.googleapis.com/auth/calendar.readonly"
] as const;

export interface ExtensionSettings {
  googleClientId: string;
}

export interface StoredAccessToken {
  accessToken: string;
  expiresAt: number;
  scope: string;
  accountEmail?: string;
}

export interface AuthStatus {
  configured: boolean;
  signedIn: boolean;
  redirectUri: string;
  expiresAt?: number;
  accountEmail?: string;
}

export interface PlannerTaskList {
  id: string;
  title: string;
  updatedAt?: string;
}

export interface PlannerTask {
  id: string;
  listId: string;
  listTitle: string;
  title: string;
  notes?: string;
  status?: string;
  dueAt?: string;
  completedAt?: string;
  updatedAt?: string;
  sourceUrl: string;
}

export interface PlannerCalendar {
  id: string;
  title: string;
  primary: boolean;
  selected: boolean;
  backgroundColor?: string;
  timeZone?: string;
}

export interface PlannerEvent {
  id: string;
  calendarId: string;
  calendarTitle: string;
  title: string;
  description?: string;
  location?: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  updatedAt?: string;
  sourceUrl?: string;
}

export interface PlannerCache {
  fetchedAt: string;
  windowStart: string;
  windowEnd: string;
  accountEmail?: string;
  taskLists: PlannerTaskList[];
  calendars: PlannerCalendar[];
  tasks: PlannerTask[];
  events: PlannerEvent[];
}

export type SearchFilter = "all" | "tasks" | "events" | "today" | "upcoming";

export interface SearchResult {
  id: string;
  kind: "task" | "event";
  title: string;
  subtitle: string;
  snippet?: string;
  startsAt?: string;
  dueAt?: string;
  sourceUrl?: string;
  score: number;
}

export interface CacheSummary {
  fetchedAt?: string;
  taskCount: number;
  eventCount: number;
  windowStart?: string;
  windowEnd?: string;
  accountEmail?: string;
}
