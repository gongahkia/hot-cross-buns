import type {
  PlannerCache,
  PlannerCalendar,
  PlannerEvent,
  PlannerTask,
  PlannerTaskList
} from "./types";

interface GoogleListResponse<T> {
  items?: T[];
  nextPageToken?: string;
}

interface GoogleTaskList {
  id?: string;
  title?: string;
  updated?: string;
}

interface GoogleTask {
  id?: string;
  title?: string;
  notes?: string;
  status?: string;
  due?: string;
  completed?: string;
  updated?: string;
}

interface GoogleCalendarListEntry {
  id?: string;
  summary?: string;
  primary?: boolean;
  selected?: boolean;
  backgroundColor?: string;
  timeZone?: string;
}

interface GoogleCalendarEvent {
  id?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  updated?: string;
  htmlLink?: string;
  status?: string;
}

export class GoogleApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export async function fetchPlannerCache(
  accessToken: string,
  options: {
    now?: Date;
    fetchImpl?: typeof fetch;
  } = {}
): Promise<PlannerCache> {
  const now = options.now ?? new Date();
  const fetchImpl = options.fetchImpl ?? fetch;
  const windowStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const windowEnd = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000).toISOString();
  const [taskLists, calendars] = await Promise.all([
    fetchTaskLists(accessToken, fetchImpl),
    fetchCalendars(accessToken, fetchImpl)
  ]);
  const tasks: PlannerTask[] = [];
  const events: PlannerEvent[] = [];

  for (const list of taskLists) {
    tasks.push(...await fetchTasksForList(accessToken, list, fetchImpl));
  }

  for (const calendar of selectedCalendars(calendars)) {
    events.push(...await fetchEventsForCalendar(accessToken, calendar, windowStart, windowEnd, fetchImpl));
  }

  return {
    fetchedAt: now.toISOString(),
    windowStart,
    windowEnd,
    taskLists,
    calendars,
    tasks,
    events
  };
}

export async function fetchTaskLists(accessToken: string, fetchImpl: typeof fetch = fetch): Promise<PlannerTaskList[]> {
  const lists = await fetchPaged<GoogleTaskList>(
    "https://tasks.googleapis.com/tasks/v1/users/@me/lists",
    accessToken,
    fetchImpl,
    { maxResults: "100" }
  );
  return lists.flatMap(mapTaskList);
}

export async function fetchCalendars(accessToken: string, fetchImpl: typeof fetch = fetch): Promise<PlannerCalendar[]> {
  const calendars = await fetchPaged<GoogleCalendarListEntry>(
    "https://www.googleapis.com/calendar/v3/users/me/calendarList",
    accessToken,
    fetchImpl,
    { maxResults: "250" }
  );
  return calendars.flatMap(mapCalendar);
}

export function mapTaskList(input: GoogleTaskList): PlannerTaskList[] {
  if (!input.id || !input.title) {
    return [];
  }

  return [{
    id: input.id,
    title: input.title,
    ...(input.updated === undefined ? {} : { updatedAt: input.updated })
  }];
}

export function mapCalendar(input: GoogleCalendarListEntry): PlannerCalendar[] {
  if (!input.id || !input.summary) {
    return [];
  }

  return [{
    id: input.id,
    title: input.summary,
    primary: input.primary === true,
    selected: input.selected === true,
    ...(input.backgroundColor === undefined ? {} : { backgroundColor: input.backgroundColor }),
    ...(input.timeZone === undefined ? {} : { timeZone: input.timeZone })
  }];
}

export function mapTask(input: GoogleTask, list: PlannerTaskList): PlannerTask[] {
  if (!input.id || !input.title) {
    return [];
  }

  return [{
    id: input.id,
    listId: list.id,
    listTitle: list.title,
    title: input.title,
    sourceUrl: "https://tasks.google.com/",
    ...(input.notes === undefined ? {} : { notes: input.notes }),
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.due === undefined ? {} : { dueAt: input.due }),
    ...(input.completed === undefined ? {} : { completedAt: input.completed }),
    ...(input.updated === undefined ? {} : { updatedAt: input.updated })
  }];
}

export function mapEvent(input: GoogleCalendarEvent, calendar: PlannerCalendar): PlannerEvent[] {
  if (!input.id || input.status === "cancelled") {
    return [];
  }

  const startsAt = input.start?.dateTime ?? input.start?.date;
  const endsAt = input.end?.dateTime ?? input.end?.date;

  if (!startsAt || !endsAt) {
    return [];
  }

  return [{
    id: input.id,
    calendarId: calendar.id,
    calendarTitle: calendar.title,
    title: input.summary?.trim() || "(untitled event)",
    startsAt,
    endsAt,
    allDay: input.start?.dateTime === undefined,
    ...(input.description === undefined ? {} : { description: input.description }),
    ...(input.location === undefined ? {} : { location: input.location }),
    ...(input.updated === undefined ? {} : { updatedAt: input.updated }),
    ...(input.htmlLink === undefined ? {} : { sourceUrl: input.htmlLink })
  }];
}

function selectedCalendars(calendars: PlannerCalendar[]): PlannerCalendar[] {
  const selected = calendars.filter((calendar) => calendar.selected || calendar.primary);
  return selected.length > 0 ? selected : calendars.slice(0, 1);
}

async function fetchTasksForList(
  accessToken: string,
  list: PlannerTaskList,
  fetchImpl: typeof fetch
): Promise<PlannerTask[]> {
  const tasks = await fetchPaged<GoogleTask>(
    `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(list.id)}/tasks`,
    accessToken,
    fetchImpl,
    {
      maxResults: "100",
      showCompleted: "true",
      showDeleted: "false",
      showHidden: "false"
    }
  );
  return tasks.flatMap((task) => mapTask(task, list));
}

async function fetchEventsForCalendar(
  accessToken: string,
  calendar: PlannerCalendar,
  timeMin: string,
  timeMax: string,
  fetchImpl: typeof fetch
): Promise<PlannerEvent[]> {
  const events = await fetchPaged<GoogleCalendarEvent>(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.id)}/events`,
    accessToken,
    fetchImpl,
    {
      maxResults: "2500",
      singleEvents: "true",
      orderBy: "startTime",
      showDeleted: "false",
      timeMin,
      timeMax
    }
  );
  return events.flatMap((event) => mapEvent(event, calendar));
}

async function fetchPaged<T>(
  baseUrl: string,
  accessToken: string,
  fetchImpl: typeof fetch,
  params: Record<string, string>
): Promise<T[]> {
  const items: T[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(baseUrl);

    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }

    const page = await fetchGoogleJson<GoogleListResponse<T>>(url.toString(), accessToken, fetchImpl);
    items.push(...(page.items ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);

  return items;
}

async function fetchGoogleJson<T>(url: string, accessToken: string, fetchImpl: typeof fetch): Promise<T> {
  const response = await fetchImpl(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    const message = await errorMessage(response);
    throw new GoogleApiError(response.status, message);
  }

  return await response.json() as T;
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const payload = await response.json() as { error?: { message?: string } };
    return payload.error?.message ?? `Google API request failed with ${response.status}.`;
  } catch {
    return `Google API request failed with ${response.status}.`;
  }
}
