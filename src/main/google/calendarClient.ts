import type { GoogleApiTransport } from "./transport";
import type {
  CalendarConference,
  CalendarConferenceCreateRequest,
  CalendarEventAttendee,
  CalendarEventReminder,
  CalendarEventTransparency,
  CalendarEventVisibility
} from "@shared/ipc/contracts";

export interface GoogleCalendarListMirror {
  id: string;
  summary: string;
  description?: string | null;
  timeZone?: string | null;
  backgroundColor?: string | null;
  foregroundColor?: string | null;
  accessRole?: string | null;
  isSelected: boolean;
  isHidden: boolean;
  isPrimary: boolean;
  etag?: string | null;
  updatedAt?: string | null;
}

export type GoogleCalendarEventStatus = "confirmed" | "tentative" | "cancelled";

export interface GoogleCalendarEventMirror {
  id: string;
  calendarId: string;
  hcbKind?: "birthday" | null;
  recurringEventId?: string | null;
  originalStartAt?: string | null;
  status: GoogleCalendarEventStatus;
  summary: string;
  description?: string | null;
  location?: string | null;
  startAt: string;
  startTimeZone?: string | null;
  endAt: string;
  endTimeZone?: string | null;
  isAllDay: boolean;
  recurrenceRule?: string | null;
  colorId?: string | null;
  transparency?: string | null;
  visibility?: string | null;
  attendeeEmails?: string[];
  attendees?: CalendarEventAttendee[];
  reminderMinutes?: number[];
  reminders?: CalendarEventReminder[];
  remindersUseDefault?: boolean;
  conference?: CalendarConference | null;
  etag?: string | null;
  sequence?: number | null;
  updatedAt?: string | null;
}

export interface GoogleCalendarEventsPage {
  events: readonly GoogleCalendarEventMirror[];
  nextSyncToken?: string | null;
}

export interface GoogleCalendarReadTransport {
  listCalendarLists(): Promise<readonly GoogleCalendarListMirror[]>;
  listEvents(request: {
    calendarId: string;
    syncToken?: string | null;
    timeMin?: string | null;
    defaultTimeZone?: string | null;
  }): Promise<GoogleCalendarEventsPage>;
}

export interface GoogleCalendarEventWriteInput {
  hcbKind?: "birthday" | null;
  summary: string;
  description?: string | null;
  location?: string | null;
  startAt: string;
  startTimeZone?: string | null;
  endAt: string;
  endTimeZone?: string | null;
  isAllDay: boolean;
  recurrenceRule?: string | null;
  colorId?: string | null;
  transparency?: CalendarEventTransparency | null;
  visibility?: CalendarEventVisibility | null;
  attendeeEmails?: readonly string[];
  reminderMinutes?: readonly number[];
  reminders?: readonly CalendarEventReminder[];
  remindersUseDefault?: boolean;
  conferenceCreateRequest?: CalendarConferenceCreateRequest | null;
}

export interface GoogleCalendarEventUpdateInput extends GoogleCalendarEventWriteInput {
  calendarId: string;
  eventId: string;
  ifMatch?: string | null;
}

export interface GoogleCalendarWriteTransport {
  insertEvent(
    calendarId: string,
    input: GoogleCalendarEventWriteInput
  ): Promise<GoogleCalendarEventMirror>;
  updateEvent(input: GoogleCalendarEventUpdateInput): Promise<GoogleCalendarEventMirror>;
  deleteEvent(request: {
    calendarId: string;
    eventId: string;
    ifMatch?: string | null;
  }): Promise<void>;
}

export type GoogleCalendarTransport = GoogleCalendarReadTransport & GoogleCalendarWriteTransport;

interface GoogleCalendarListResponse {
  items?: GoogleCalendarListItemDto[];
}

interface GoogleCalendarListItemDto {
  id: string;
  summary?: string;
  description?: string;
  timeZone?: string;
  backgroundColor?: string;
  foregroundColor?: string;
  selected?: boolean;
  hidden?: boolean;
  primary?: boolean;
  accessRole?: string;
  etag?: string;
  updated?: string;
}

interface GoogleEventsResponse {
  items?: GoogleEventDto[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

interface GoogleEventDto {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  status?: string;
  start?: GoogleEventDateDto;
  end?: GoogleEventDateDto;
  recurrence?: string[];
  colorId?: string;
  recurringEventId?: string;
  originalStartTime?: GoogleEventDateDto;
  etag?: string;
  updated?: string;
  sequence?: number;
  transparency?: string;
  visibility?: string;
  attendees?: GoogleEventAttendeeDto[];
  reminders?: GoogleEventRemindersDto;
  hangoutLink?: string;
  conferenceData?: GoogleEventConferenceDataDto;
  eventType?: string;
  birthdayProperties?: GoogleEventBirthdayPropertiesDto;
}

interface GoogleEventBirthdayPropertiesDto {
  type?: string;
  customTypeName?: string;
  contact?: string;
}

interface GoogleEventDateDto {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

interface GoogleEventAttendeeDto {
  email?: string;
  displayName?: string;
  responseStatus?: string;
  self?: boolean;
  resource?: boolean;
}

interface GoogleEventRemindersDto {
  useDefault?: boolean;
  overrides?: Array<{ method?: string; minutes?: number }>;
}

interface GoogleEventConferenceDataDto {
  conferenceSolution?: {
    name?: string;
  };
  entryPoints?: GoogleEventConferenceEntryPointDto[];
}

interface GoogleEventConferenceEntryPointDto {
  entryPointType?: string;
  uri?: string;
  label?: string;
  pin?: string;
  accessCode?: string;
  meetingCode?: string;
  passcode?: string;
  password?: string;
}

interface GoogleEventMutationDto {
  summary: string;
  description?: string | null;
  location?: string | null;
  eventType?: "birthday";
  start: GoogleEventDateDto;
  end: GoogleEventDateDto;
  recurrence?: string[];
  transparency?: string;
  visibility?: string;
  attendees?: Array<{ email: string }>;
  reminders?: {
    useDefault: boolean;
    overrides?: Array<{ method: "popup" | "email"; minutes: number }>;
  };
  colorId?: string | null;
  conferenceData?: {
    createRequest: {
      requestId: string;
      conferenceSolutionKey: {
        type: "hangoutsMeet";
      };
    };
  };
}

const CALENDAR_LIST_FIELDS =
  "items(id,summary,description,timeZone,backgroundColor,foregroundColor,selected,hidden,primary,accessRole,etag)";
const EVENTS_FIELDS =
  "nextPageToken,nextSyncToken,items(id,summary,description,location,status,start,end,recurrence,colorId,recurringEventId,originalStartTime,etag,updated,sequence,transparency,visibility,eventType,birthdayProperties(type,customTypeName,contact),attendees(email,displayName,responseStatus,self,resource),reminders(useDefault,overrides(method,minutes)),hangoutLink,conferenceData(conferenceSolution(name),entryPoints(entryPointType,uri,label,pin,accessCode,meetingCode,passcode,password)))";

export class GoogleCalendarHttpAdapter implements GoogleCalendarTransport {
  private readonly transport: GoogleApiTransport;

  constructor(transport: GoogleApiTransport) {
    this.transport = transport;
  }

  async listCalendarLists(): Promise<readonly GoogleCalendarListMirror[]> {
    const response = await this.transport.getJson<GoogleCalendarListResponse>({
      path: "/calendar/v3/users/me/calendarList",
      query: {
        fields: CALENDAR_LIST_FIELDS
      }
    });

    return (response.items ?? []).map((item) => ({
      id: item.id,
      summary: item.summary ?? "Untitled calendar",
      description: item.description ?? null,
      timeZone: item.timeZone ?? null,
      backgroundColor: item.backgroundColor ?? null,
      foregroundColor: item.foregroundColor ?? null,
      accessRole: item.accessRole ?? null,
      isSelected: item.selected ?? true,
      isHidden: item.hidden ?? false,
      isPrimary: item.primary ?? item.id === "primary",
      etag: item.etag ?? null,
      updatedAt: normalizeIsoDateTime(item.updated)
    }));
  }

  async listEvents(request: {
    calendarId: string;
    syncToken?: string | null;
    timeMin?: string | null;
    defaultTimeZone?: string | null;
  }): Promise<GoogleCalendarEventsPage> {
    let pageToken: string | undefined;
    let nextSyncToken: string | null = null;
    const events: GoogleCalendarEventMirror[] = [];

    do {
      const response = await this.transport.getJson<GoogleEventsResponse>({
        path: `/calendar/v3/calendars/${encodeGooglePathComponent(request.calendarId)}/events`,
        query: {
          singleEvents: "true",
          showDeleted: "true",
          maxResults: "2500",
          fields: EVENTS_FIELDS,
          syncToken: request.syncToken ?? undefined,
          timeMin:
            request.syncToken === undefined || request.syncToken === null
              ? request.timeMin ?? undefined
              : undefined,
          pageToken
        }
      });

      events.push(
        ...(response.items ?? []).map((item) =>
          mapEvent(item, request.calendarId, request.defaultTimeZone ?? null)
        )
      );
      nextSyncToken = response.nextSyncToken ?? nextSyncToken;
      pageToken = response.nextPageToken;
    } while (pageToken !== undefined && pageToken.length > 0);

    return {
      events,
      nextSyncToken
    };
  }

  async insertEvent(
    calendarId: string,
    input: GoogleCalendarEventWriteInput
  ): Promise<GoogleCalendarEventMirror> {
    const response = await this.transport.getJson<GoogleEventDto>({
      method: "POST",
      path: `/calendar/v3/calendars/${encodeGooglePathComponent(calendarId)}/events`,
      query: {
        fields: "id,summary,description,location,status,start,end,recurrence,colorId,recurringEventId,originalStartTime,etag,updated,sequence,transparency,visibility,eventType,birthdayProperties(type,customTypeName,contact),attendees(email,displayName,responseStatus,self,resource),reminders(useDefault,overrides(method,minutes)),hangoutLink,conferenceData(conferenceSolution(name),entryPoints(entryPointType,uri,label,pin,accessCode,meetingCode,passcode,password))",
        conferenceDataVersion: input.conferenceCreateRequest ? "1" : undefined
      },
      body: eventMutationBody(input, { includeEventType: true })
    });

    return mapEvent(response, calendarId, input.startTimeZone ?? null);
  }

  async updateEvent(input: GoogleCalendarEventUpdateInput): Promise<GoogleCalendarEventMirror> {
    const response = await this.transport.getJson<GoogleEventDto>({
      method: "PATCH",
      path: `/calendar/v3/calendars/${encodeGooglePathComponent(input.calendarId)}/events/${encodeGooglePathComponent(input.eventId)}`,
      query: {
        fields: "id,summary,description,location,status,start,end,recurrence,colorId,recurringEventId,originalStartTime,etag,updated,sequence,transparency,visibility,eventType,birthdayProperties(type,customTypeName,contact),attendees(email,displayName,responseStatus,self,resource),reminders(useDefault,overrides(method,minutes)),hangoutLink,conferenceData(conferenceSolution(name),entryPoints(entryPointType,uri,label,pin,accessCode,meetingCode,passcode,password))",
        conferenceDataVersion: input.conferenceCreateRequest ? "1" : undefined
      },
      body: eventMutationBody(input, { includeEventType: false }),
      ifMatch: input.ifMatch ?? undefined
    });

    return mapEvent(response, input.calendarId, input.startTimeZone ?? null);
  }

  async deleteEvent(request: {
    calendarId: string;
    eventId: string;
    ifMatch?: string | null;
  }): Promise<void> {
    await this.transport.send({
      method: "DELETE",
      path: `/calendar/v3/calendars/${encodeGooglePathComponent(request.calendarId)}/events/${encodeGooglePathComponent(request.eventId)}`,
      ifMatch: request.ifMatch ?? undefined
    });
  }
}

function mapEvent(
  item: GoogleEventDto,
  calendarId: string,
  defaultTimeZone: string | null
): GoogleCalendarEventMirror {
  const fallback = normalizeIsoDateTime(item.updated) ?? new Date(0).toISOString();
  const isAllDay = item.start?.date !== undefined;
  const startAt = eventDateToIso(item.start, fallback);
  const endAt = eventDateToIso(item.end, startAt);
  const startTimeZone = item.start?.timeZone ?? defaultTimeZone;
  const endTimeZone = item.end?.timeZone ?? startTimeZone;

  return {
    id: item.id,
    calendarId,
    hcbKind: item.eventType === "birthday" || item.birthdayProperties !== undefined ? "birthday" : null,
    recurringEventId: item.recurringEventId ?? null,
    originalStartAt: item.originalStartTime === undefined ? null : eventDateToIso(item.originalStartTime, startAt),
    status: normalizeEventStatus(item.status),
    summary: item.summary ?? "Untitled event",
    description: normalizeDescription(item.description),
    location: item.location ?? null,
    startAt,
    startTimeZone,
    endAt,
    endTimeZone,
    isAllDay,
    recurrenceRule: item.recurrence?.join("\n") ?? null,
    colorId: item.colorId ?? null,
    transparency: item.transparency ?? null,
    visibility: item.visibility ?? null,
    attendeeEmails: normalizeAttendeeEmails(item.attendees),
    attendees: normalizeAttendees(item.attendees),
    reminderMinutes: normalizeReminderMinutes(item.reminders),
    reminders: normalizeReminders(item.reminders),
    remindersUseDefault: item.reminders?.useDefault === true,
    conference: normalizeConference(item),
    etag: item.etag ?? null,
    sequence: item.sequence ?? null,
    updatedAt: normalizeIsoDateTime(item.updated)
  };
}

function normalizeConference(item: GoogleEventDto): CalendarConference | null {
  const video = item.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === "video");
  const phone = item.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === "phone");
  const more = item.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === "more");
  const videoUri = textValue(video?.uri) ?? textValue(item.hangoutLink);
  const phoneUri = textValue(phone?.uri);
  const moreUri = textValue(more?.uri);
  const conference: CalendarConference = {
    ...(textValue(item.conferenceData?.conferenceSolution?.name) ? { solutionName: textValue(item.conferenceData?.conferenceSolution?.name) } : {}),
    ...(videoUri ? { videoUri } : {}),
    ...(textValue(video?.label) ? { videoLabel: textValue(video?.label) } : {}),
    ...(phoneUri ? { phoneUri } : {}),
    ...(textValue(phone?.label) ? { phoneLabel: textValue(phone?.label) } : {}),
    ...(conferenceAccessCode(phone) ? { phonePin: conferenceAccessCode(phone) } : {}),
    ...(moreUri ? { moreUri } : {}),
    ...(textValue(more?.label) ? { moreLabel: textValue(more?.label) } : {})
  };

  return Object.keys(conference).length > 0 ? conference : null;
}

function conferenceAccessCode(entry: GoogleEventConferenceEntryPointDto | undefined): string | undefined {
  return textValue(entry?.pin) ??
    textValue(entry?.accessCode) ??
    textValue(entry?.meetingCode) ??
    textValue(entry?.passcode) ??
    textValue(entry?.password);
}

function textValue(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeAttendeeEmails(attendees: GoogleEventAttendeeDto[] | undefined): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const attendee of attendees ?? []) {
    const email = attendee.email?.trim().toLowerCase();

    if (email === undefined || email.length === 0 || seen.has(email)) {
      continue;
    }

    seen.add(email);
    result.push(email);
  }

  return result;
}

function normalizeAttendees(attendees: GoogleEventAttendeeDto[] | undefined): CalendarEventAttendee[] {
  const seen = new Set<string>();
  const result: CalendarEventAttendee[] = [];

  for (const attendee of attendees ?? []) {
    const email = attendee.email?.trim().toLowerCase();

    if (email === undefined || email.length === 0 || seen.has(email)) {
      continue;
    }

    seen.add(email);
    result.push({
      email,
      ...(textValue(attendee.displayName) ? { displayName: textValue(attendee.displayName) } : {}),
      ...(attendee.responseStatus === "needsAction" ||
      attendee.responseStatus === "declined" ||
      attendee.responseStatus === "tentative" ||
      attendee.responseStatus === "accepted"
        ? { responseStatus: attendee.responseStatus }
        : {}),
      ...(attendee.self === undefined ? {} : { self: attendee.self }),
      ...(attendee.resource === undefined ? {} : { resource: attendee.resource })
    });
  }

  return result;
}

function normalizeReminderMinutes(reminders: GoogleEventRemindersDto | undefined): number[] {
  const seen = new Set<number>();
  const result: number[] = [];

  for (const reminder of reminders?.overrides ?? []) {
    if (reminder.method !== "popup" && reminder.method !== "email") {
      continue;
    }

    const minutes = reminder.minutes;

    if (
      minutes === undefined ||
      !Number.isInteger(minutes) ||
      minutes < 0 ||
      minutes > 28 * 24 * 60 ||
      seen.has(minutes)
    ) {
      continue;
    }

    seen.add(minutes);
    result.push(minutes);
  }

  return result.sort((left, right) => left - right);
}

function normalizeReminders(reminders: GoogleEventRemindersDto | undefined): CalendarEventReminder[] {
  const seen = new Set<string>();
  const result: CalendarEventReminder[] = [];

  for (const reminder of reminders?.overrides ?? []) {
    const method = reminder.method;
    const minutes = reminder.minutes;
    const key = `${method}:${minutes}`;

    if (
      (method !== "popup" && method !== "email") ||
      minutes === undefined ||
      !Number.isInteger(minutes) ||
      minutes < 0 ||
      minutes > 28 * 24 * 60 ||
      seen.has(key)
    ) {
      continue;
    }

    seen.add(key);
    result.push({ method, minutes });
  }

  return result.sort((left, right) => left.minutes - right.minutes || left.method.localeCompare(right.method));
}

function eventMutationBody(
  input: GoogleCalendarEventWriteInput,
  options: { includeEventType: boolean }
): GoogleEventMutationDto {
  if (input.hcbKind === "birthday") {
    return birthdayMutationBody(input, options);
  }

  const attendeeEmails = normalizeAttendeeEmails(
    (input.attendeeEmails ?? []).map((email) => ({ email }))
  );
  const reminderMinutes = normalizeReminderMinutes({
    overrides: (input.reminderMinutes ?? []).map((minutes) => ({ method: "popup", minutes }))
  });
  const reminders = normalizeReminders({
    overrides: input.reminders !== undefined && input.reminders.length > 0
      ? [...input.reminders]
      : input.reminderMinutes === undefined
        ? undefined
        : input.reminderMinutes.map((minutes) => ({ method: "popup", minutes }))
  });

  return {
    summary: input.summary,
    description: input.description ?? null,
    location: input.location ?? null,
    start: eventMutationDate(input.startAt, input.startTimeZone ?? null, input.isAllDay),
    end: eventMutationDate(input.endAt, input.endTimeZone ?? null, input.isAllDay),
    ...(input.recurrenceRule?.trim()
      ? { recurrence: [input.recurrenceRule.trim()] }
      : {}),
    ...(input.colorId === undefined ? {} : { colorId: input.colorId }),
    ...(input.transparency === "opaque" || input.transparency === "transparent"
      ? { transparency: input.transparency }
      : {}),
    ...(input.visibility === "default" || input.visibility === "public" || input.visibility === "private"
      ? { visibility: input.visibility }
      : {}),
    ...(attendeeEmails.length === 0
      ? {}
      : { attendees: attendeeEmails.map((email) => ({ email })) }),
    ...googleReminderMutation(input, reminders, reminderMinutes),
    ...(input.conferenceCreateRequest?.type === "hangoutsMeet"
      ? {
          conferenceData: {
            createRequest: {
              requestId: `hcb-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
              conferenceSolutionKey: { type: "hangoutsMeet" as const }
            }
          }
        }
      : {})
  };
}

function birthdayMutationBody(
  input: GoogleCalendarEventWriteInput,
  options: { includeEventType: boolean }
): GoogleEventMutationDto {
  const reminderMinutes = normalizeReminderMinutes({
    overrides: (input.reminderMinutes ?? []).map((minutes) => ({ method: "popup", minutes }))
  });
  const reminders = normalizeReminders({
    overrides: input.reminders !== undefined && input.reminders.length > 0
      ? [...input.reminders]
      : input.reminderMinutes === undefined
        ? undefined
        : input.reminderMinutes.map((minutes) => ({ method: "popup", minutes }))
  });

  return {
    ...(options.includeEventType ? { eventType: "birthday" as const } : {}),
    summary: input.summary,
    start: eventMutationDate(input.startAt, null, true),
    end: eventMutationDate(input.endAt, null, true),
    recurrence: ["RRULE:FREQ=YEARLY"],
    transparency: "transparent",
    visibility: "private",
    ...(input.colorId === undefined ? {} : { colorId: input.colorId }),
    ...googleReminderMutation(input, reminders, reminderMinutes)
  };
}

function googleReminderMutation(
  input: GoogleCalendarEventWriteInput,
  reminders: CalendarEventReminder[],
  reminderMinutes: number[]
): Pick<GoogleEventMutationDto, "reminders"> {
  if (input.remindersUseDefault === true) {
    return { reminders: { useDefault: true } };
  }

  if (input.reminders !== undefined || input.reminderMinutes !== undefined || input.remindersUseDefault === false) {
    return {
      reminders: {
        useDefault: false,
        overrides: reminders.length > 0
          ? reminders
          : reminderMinutes.map((minutes) => ({ method: "popup" as const, minutes }))
      }
    };
  }

  return {};
}

function eventMutationDate(
  isoDateTime: string,
  timeZone: string | null,
  allDay: boolean
): GoogleEventDateDto {
  if (allDay) {
    return {
      date: isoDateTime.slice(0, 10)
    };
  }

  return {
    dateTime: isoDateTime,
    ...(timeZone === null ? {} : { timeZone })
  };
}

function eventDateToIso(value: GoogleEventDateDto | undefined, fallback: string): string {
  if (value?.dateTime !== undefined) {
    return normalizeIsoDateTime(value.dateTime) ?? fallback;
  }

  if (value?.date !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(value.date)) {
    return `${value.date}T00:00:00.000Z`;
  }

  return fallback;
}

function normalizeEventStatus(status: string | undefined): GoogleCalendarEventStatus {
  if (status === "tentative" || status === "cancelled") {
    return status;
  }

  return "confirmed";
}

function normalizeIsoDateTime(value: string | undefined): string | null {
  if (value === undefined || value.length === 0) {
    return null;
  }

  const parsed = Date.parse(value);

  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function normalizeDescription(value: string | undefined): string | null {
  if (value === undefined || value.length === 0) {
    return null;
  }

  const normalizedLineEndings = value.replace(/\r\n?/g, "\n");
  const markdown = /<\/?[a-z][\s\S]*>/i.test(normalizedLineEndings)
    ? htmlDescriptionToMarkdown(normalizedLineEndings)
    : decodeHtmlEntities(normalizedLineEndings);
  const trimmed = markdown
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return trimmed.length === 0 ? null : trimmed;
}

function htmlDescriptionToMarkdown(value: string): string {
  let markdown = value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");

  markdown = markdown.replace(/<ol\b[^>]*>([\s\S]*?)<\/ol>/gi, (_match, content: string) =>
    markdownList(content, true)
  );
  markdown = markdown.replace(/<ul\b[^>]*>([\s\S]*?)<\/ul>/gi, (_match, content: string) =>
    markdownList(content, false)
  );
  markdown = markdown
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|header|footer|h[1-6]|tr|table)>/gi, "\n\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/li>/gi, "\n");
  markdown = markdownInlineHtml(markdown);
  markdown = markdown.replace(/<[^>]+>/g, "");

  return decodeHtmlEntities(markdown);
}

function markdownList(content: string, ordered: boolean): string {
  const items: string[] = [];
  let index = 1;

  content.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_match, item: string) => {
    const marker = ordered ? `${index}.` : "-";
    const text = markdownInlineHtml(item)
      .replace(/<[^>]+>/g, "")
      .replace(/\s*\n+\s*/g, " ")
      .trim();

    if (text.length > 0) {
      items.push(`${marker} ${decodeHtmlEntities(text)}`);
      index += 1;
    }

    return "";
  });

  return items.length === 0 ? "\n" : `\n\n${items.join("\n")}\n\n`;
}

function markdownInlineHtml(value: string): string {
  let markdown = value;

  markdown = markdown.replace(
    /<a\b[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi,
    (_match, _quote: string, href: string, label: string) => {
      const normalizedLabel = markdownInlineHtml(label).replace(/<[^>]+>/g, "").trim();
      const normalizedHref = decodeHtmlEntities(href).trim();

      if (!normalizedLabel || !normalizedHref) {
        return normalizedLabel;
      }

      return `[${normalizedLabel.replace(/([\]\\])/g, "\\$1")}](${normalizedHref.replace(/\)/g, "%29")})`;
    }
  );
  markdown = markdown.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_match, _tag: string, content: string) =>
    `**${markdownInlineHtml(content).replace(/<[^>]+>/g, "").trim()}**`
  );
  markdown = markdown.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_match, _tag: string, content: string) =>
    `_${markdownInlineHtml(content).replace(/<[^>]+>/g, "").trim()}_`
  );
  markdown = markdown.replace(/<(s|strike|del)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_match, _tag: string, content: string) =>
    `~~${markdownInlineHtml(content).replace(/<[^>]+>/g, "").trim()}~~`
  );
  markdown = markdown.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_match, content: string) =>
    `\`${markdownInlineHtml(content).replace(/<[^>]+>/g, "").trim().replace(/`/g, "\\`")}\``
  );

  return markdown;
}

function decodeHtmlEntities(value: string): string {
  const entities: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: "\""
  };

  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, body: string) => {
    const key = body.toLowerCase();

    if (key.startsWith("#x")) {
      const codePoint = Number.parseInt(key.slice(2), 16);

      return isValidCodePoint(codePoint) ? String.fromCodePoint(codePoint) : entity;
    }

    if (key.startsWith("#")) {
      const codePoint = Number.parseInt(key.slice(1), 10);

      return isValidCodePoint(codePoint) ? String.fromCodePoint(codePoint) : entity;
    }

    return entities[key] ?? entity;
  });
}

function isValidCodePoint(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0x10ffff;
}

function encodeGooglePathComponent(value: string): string {
  return encodeURIComponent(value).replace(/%40/g, "@");
}
