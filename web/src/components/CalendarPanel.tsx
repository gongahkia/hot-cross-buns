import { Fragment, useEffect, useMemo, useRef, useState } from "react";

import { DriveAttachmentPicker } from "@/components/DriveAttachmentPicker";
import { ModalDialog } from "@/components/ModalDialog";
import {
  AvailabilityAssistant,
  CalendarManagerDialog,
  type AvailabilitySlot
} from "@/components/CalendarTools";
import type { BulkOperationResult, EventBulkOperation, EventConflict } from "@/features/useWorkspace";
import type {
  CalendarInput,
  CalendarEventInput,
  GoogleCalendar,
  GoogleCalendarEvent,
  GoogleDriveFile,
  GoogleEventAttachment,
  GoogleFreeBusyResponse,
  GoogleEventType,
  SendUpdates
} from "@/types";

type CalendarView = "day" | "week" | "month" | "agenda";
type RepeatFrequency = "none" | "daily" | "weekly" | "monthly" | "yearly" | "custom";
type RepeatEnd = "never" | "on-date" | "after-count";

export interface CalendarPanelCommand {
  readonly id: string;
  readonly type: "new-event" | "open-event" | "find-time" | "manage-calendars";
  readonly event?: GoogleCalendarEvent;
}

interface CalendarPanelProps {
  readonly calendars: readonly GoogleCalendar[];
  readonly events: readonly GoogleCalendarEvent[];
  readonly invitations?: readonly GoogleCalendarEvent[];
  readonly search: string;
  readonly command?: CalendarPanelCommand;
  readonly driveAuthorized: boolean;
  readonly visibleCalendarIds?: readonly string[];
  readonly eventConflict: EventConflict | undefined;
  createCalendar(input: CalendarInput): Promise<void>;
  subscribeCalendar(calendarId: string): Promise<void>;
  removeCalendarFromList(calendar: GoogleCalendar): Promise<void>;
  queryAvailability(calendarIds: readonly string[], timeMin: string, timeMax: string): Promise<GoogleFreeBusyResponse>;
  createEvent(calendarId: string, event: CalendarEventInput): Promise<void>;
  updateEvent(event: GoogleCalendarEvent, input: CalendarEventInput): Promise<"updated" | "conflict">;
  deleteEvent(event: GoogleCalendarEvent): Promise<"deleted" | "conflict">;
  getEvent(calendarId: string, eventId: string): Promise<GoogleCalendarEvent>;
  respondToEvent(event: GoogleCalendarEvent, responseStatus: "accepted" | "declined" | "tentative" | "needsAction", comment?: string): Promise<GoogleCalendarEvent>;
  loadCalendarRange(timeMin: string, timeMax: string): Promise<void>;
  resolveEventConflict(resolution: "keep-local" | "use-google"): Promise<void>;
  dismissEventConflict(): void;
  splitRecurringEvent?(series: GoogleCalendarEvent, firstChangedInstance: GoogleCalendarEvent, input: CalendarEventInput): Promise<void>;
  authorizeDrive(): Promise<void>;
  searchDrive(query: string): Promise<GoogleDriveFile[]>;
  bulkEvents?(events: readonly GoogleCalendarEvent[], operation: EventBulkOperation): Promise<BulkOperationResult>;
  saveVisibleCalendarIds?(calendarIds: readonly string[]): Promise<void>;
}

interface RecurrenceDraft {
  readonly frequency: RepeatFrequency;
  readonly interval: number;
  readonly weekdays: readonly string[];
  readonly end: RepeatEnd;
  readonly until: string;
  readonly count: string;
  readonly advanced: string;
}

interface AdvancedEventDraft {
  readonly colorId: string;
  readonly transparency: "opaque" | "transparent";
  readonly visibility: "default" | "public" | "private" | "confidential";
  readonly reminderMinutes: string;
  readonly useDefaultReminders: boolean;
  readonly guestsCanInviteOthers: boolean;
  readonly guestsCanModify: boolean;
  readonly guestsCanSeeOtherGuests: boolean;
  readonly sendUpdates: SendUpdates;
  readonly eventType: GoogleEventType;
  readonly focusAutoDecline: "declineNone" | "declineAllConflictingInvitations" | "declineOnlyNewConflictingInvitations";
  readonly focusChatStatus: "available" | "doNotDisturb";
  readonly declineMessage: string;
  readonly workingLocationType: "homeOffice" | "officeLocation" | "customLocation";
  readonly workingLocationLabel: string;
}

const weekDays = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;
const emptyCalendarIds: readonly string[] = [];
const weekDayLabels: Record<(typeof weekDays)[number], string> = {
  SU: "Sun",
  MO: "Mon",
  TU: "Tue",
  WE: "Wed",
  TH: "Thu",
  FR: "Fri",
  SA: "Sat"
};

/** Google Calendar Event color IDs, returned on each event resource. */
const googleEventColors: Readonly<Record<string, string>> = {
  "1": "#a4bdfc",
  "2": "#7ae7bf",
  "3": "#dbadff",
  "4": "#ff887c",
  "5": "#fbd75b",
  "6": "#ffb878",
  "7": "#46d6db",
  "8": "#e1e1e1",
  "9": "#5484ed",
  "10": "#51b749",
  "11": "#dc2127"
};

const timeZones = typeof Intl.supportedValuesOf === "function"
  ? Intl.supportedValuesOf("timeZone")
  : [Intl.DateTimeFormat().resolvedOptions().timeZone];

function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function addDays(value: Date, days: number): Date {
  const result = new Date(value);
  result.setDate(result.getDate() + days);
  return result;
}

function dateFromYmd(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function toYmd(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toLocalDateTime(value: Date): string {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
}

function localDateTime(minutesFromNow: number): string {
  return toLocalDateTime(new Date(Date.now() + minutesFromNow * 60_000));
}

function startOfWeek(value: Date): Date {
  const day = startOfDay(value);
  return addDays(day, -day.getDay());
}

function viewRange(anchor: Date, view: CalendarView): { readonly start: Date; readonly end: Date } {
  if (view === "day") {
    const start = startOfDay(anchor);
    return { start, end: addDays(start, 1) };
  }
  if (view === "week") {
    const start = startOfWeek(anchor);
    return { start, end: addDays(start, 7) };
  }
  if (view === "month") {
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const start = addDays(first, -first.getDay());
    return { start, end: addDays(start, 42) };
  }
  const start = startOfDay(anchor);
  return { start, end: addDays(start, 30) };
}

function eventStart(event: GoogleCalendarEvent): Date {
  return event.start.date ? dateFromYmd(event.start.date) : new Date(event.start.dateTime ?? 0);
}

function eventEnd(event: GoogleCalendarEvent): Date {
  return event.end.date ? dateFromYmd(event.end.date) : new Date(event.end.dateTime ?? 0);
}

function eventOverlapsDay(event: GoogleCalendarEvent, day: Date): boolean {
  const start = startOfDay(day).getTime();
  const end = addDays(startOfDay(day), 1).getTime();
  return eventEnd(event).getTime() > start && eventStart(event).getTime() < end;
}

function eventTimeLabel(event: GoogleCalendarEvent): string {
  if (event.start.date) {
    return "All day";
  }
  return eventStart(event).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function eventRangeLabel(event: GoogleCalendarEvent): string {
  if (event.start.date) {
    const end = addDays(eventEnd(event), -1);
    return event.start.date === toYmd(end)
      ? event.start.date
      : `${event.start.date} – ${toYmd(end)}`;
  }
  return `${eventStart(event).toLocaleString()} – ${eventEnd(event).toLocaleString()}`;
}

function sortEvents(left: GoogleCalendarEvent, right: GoogleCalendarEvent): number {
  return eventStart(left).getTime() - eventStart(right).getTime() || left.summary.localeCompare(right.summary);
}

function matchesEvent(event: GoogleCalendarEvent, query: string): boolean {
  return !query || `${event.summary} ${event.description ?? ""} ${event.location ?? ""}`.toLocaleLowerCase().includes(query);
}

function defaultRecurrence(): RecurrenceDraft {
  return { frequency: "none", interval: 1, weekdays: [], end: "never", until: "", count: "", advanced: "" };
}

function defaultAdvancedEvent(): AdvancedEventDraft {
  return {
    colorId: "",
    transparency: "opaque",
    visibility: "default",
    reminderMinutes: "10",
    useDefaultReminders: true,
    guestsCanInviteOthers: true,
    guestsCanModify: false,
    guestsCanSeeOtherGuests: true,
    sendUpdates: "all",
    eventType: "default",
    focusAutoDecline: "declineOnlyNewConflictingInvitations",
    focusChatStatus: "doNotDisturb",
    declineMessage: "",
    workingLocationType: "homeOffice",
    workingLocationLabel: ""
  };
}

function parseRecurrence(lines: readonly string[] | undefined): RecurrenceDraft {
  if (!lines || lines.length === 0) {
    return defaultRecurrence();
  }
  if (lines.length !== 1 || !lines[0].startsWith("RRULE:")) {
    return { ...defaultRecurrence(), frequency: "custom", advanced: lines.join("\n") };
  }
  const fields = new Map(lines[0].slice("RRULE:".length).split(";").map((value) => {
    const [key, ...rest] = value.split("=");
    return [key, rest.join("=")];
  }));
  const supportedFields = new Set(["FREQ", "INTERVAL", "BYDAY", "UNTIL", "COUNT"]);
  if ([...fields.keys()].some((field) => !supportedFields.has(field))) {
    return { ...defaultRecurrence(), frequency: "custom", advanced: lines.join("\n") };
  }
  const frequency = fields.get("FREQ")?.toLocaleLowerCase() as RepeatFrequency | undefined;
  if (!frequency || !["daily", "weekly", "monthly", "yearly"].includes(frequency)) {
    return { ...defaultRecurrence(), frequency: "custom", advanced: lines.join("\n") };
  }
  const until = fields.get("UNTIL");
  const formattedUntil = until && /^\d{8}/.test(until) ? `${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}` : "";
  return {
    frequency,
    interval: Math.max(1, Number(fields.get("INTERVAL") ?? "1") || 1),
    weekdays: fields.get("BYDAY")?.split(",").filter((day): day is (typeof weekDays)[number] => weekDays.includes(day as (typeof weekDays)[number])) ?? [],
    end: until ? "on-date" : fields.get("COUNT") ? "after-count" : "never",
    until: formattedUntil,
    count: fields.get("COUNT") ?? "",
    advanced: lines.join("\n")
  };
}

function recurrenceLines(draft: RecurrenceDraft): readonly string[] | undefined {
  if (draft.frequency === "none") {
    return undefined;
  }
  if (draft.frequency === "custom") {
    const lines = draft.advanced.split("\n").map((line) => line.trim()).filter(Boolean);
    if (!lines.every((line) => line.startsWith("RRULE:") || line.startsWith("EXDATE") || line.startsWith("RDATE"))) {
      throw new Error("Advanced schedules must use RFC 5545 RRULE, EXDATE, or RDATE lines");
    }
    return lines.length > 0 ? lines : undefined;
  }
  const fields = [`FREQ=${draft.frequency.toUpperCase()}`];
  if (draft.interval > 1) {
    fields.push(`INTERVAL=${draft.interval}`);
  }
  if (draft.frequency === "weekly" && draft.weekdays.length > 0) {
    fields.push(`BYDAY=${draft.weekdays.join(",")}`);
  }
  if (draft.end === "on-date") {
    if (!draft.until) {
      throw new Error("Choose the final repeat date");
    }
    fields.push(`UNTIL=${draft.until.replaceAll("-", "")}T235959Z`);
  }
  if (draft.end === "after-count") {
    const count = Number(draft.count);
    if (!Number.isInteger(count) || count < 1 || count > 999) {
      throw new Error("Choose a repeat count between 1 and 999");
    }
    fields.push(`COUNT=${count}`);
  }
  return [`RRULE:${fields.join(";")}`];
}

function eventInputFromDraft(
  title: string,
  description: string,
  location: string,
  allDay: boolean,
  start: string,
  end: string,
  timeZone: string,
  recurrence: RecurrenceDraft,
  attendeeText: string,
  attachments: readonly GoogleEventAttachment[],
  meet: boolean,
  advanced: AdvancedEventDraft
): CalendarEventInput {
  if (!title.trim()) {
    throw new Error("Enter an event title");
  }
  const attendees = attendeeText.split(/[\s,;]+/).map((email) => email.trim()).filter(Boolean).map((email) => ({ email }));
  const schedule = allDay
    ? (() => {
        if (!start || !end || dateFromYmd(end) < dateFromYmd(start)) {
          throw new Error("Choose an end date on or after the start date");
        }
        return { start: { date: start }, end: { date: toYmd(addDays(dateFromYmd(end), 1)) } };
      })()
    : (() => {
        const startDate = new Date(start);
        const endDate = new Date(end);
        if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate <= startDate) {
          throw new Error("Choose an end time after the start time");
        }
        return {
          start: { dateTime: startDate.toISOString(), timeZone },
          end: { dateTime: endDate.toISOString(), timeZone }
        };
      })();
  return {
    summary: title.trim(),
    description: description.trim(),
    location: location.trim(),
    ...schedule,
    recurrence: recurrenceLines(recurrence),
    attendees,
    attachments,
    createGoogleMeet: meet,
    colorId: advanced.colorId || undefined,
    transparency: advanced.transparency,
    visibility: advanced.visibility,
    reminders: advanced.useDefaultReminders ? { useDefault: true } : (() => {
      const minutes = Number(advanced.reminderMinutes);
      if (!Number.isInteger(minutes) || minutes < 0 || minutes > 40_320) {
        throw new Error("Popup reminder minutes must be between 0 and 40,320");
      }
      return { useDefault: false, overrides: [{ method: "popup" as const, minutes }] };
    })(),
    guestsCanInviteOthers: advanced.guestsCanInviteOthers,
    guestsCanModify: advanced.guestsCanModify,
    guestsCanSeeOtherGuests: advanced.guestsCanSeeOtherGuests,
    sendUpdates: advanced.sendUpdates,
    eventType: advanced.eventType,
    focusTimeProperties: advanced.eventType === "focusTime" ? { autoDeclineMode: advanced.focusAutoDecline, chatStatus: advanced.focusChatStatus, declineMessage: advanced.declineMessage.trim() || undefined } : undefined,
    outOfOfficeProperties: advanced.eventType === "outOfOffice" ? { autoDeclineMode: advanced.focusAutoDecline, declineMessage: advanced.declineMessage.trim() || undefined } : undefined,
    workingLocationProperties: advanced.eventType === "workingLocation" ? {
      type: advanced.workingLocationType,
      ...(advanced.workingLocationType === "customLocation" ? { customLocation: { label: advanced.workingLocationLabel.trim() || undefined } } : advanced.workingLocationType === "officeLocation" ? { officeLocation: { label: advanced.workingLocationLabel.trim() || undefined } } : {})
    } : undefined
  };
}

function eventInputFromExisting(event: GoogleCalendarEvent, start = event.start, end = event.end): CalendarEventInput {
  return {
    summary: event.summary,
    description: event.description,
    location: event.location,
    start,
    end,
    recurrence: event.recurrence,
    attendees: event.attendees?.map((attendee) => ({ email: attendee.email })),
    reminders: event.reminders,
    attachments: event.attachments,
    visibility: event.visibility,
    transparency: event.transparency,
    colorId: event.colorId,
    guestsCanInviteOthers: event.guestsCanInviteOthers,
    guestsCanModify: event.guestsCanModify,
    guestsCanSeeOtherGuests: event.guestsCanSeeOtherGuests,
    eventType: event.eventType,
    focusTimeProperties: event.focusTimeProperties,
    outOfOfficeProperties: event.outOfOfficeProperties,
    workingLocationProperties: event.workingLocationProperties
  };
}

function eventKey(event: GoogleCalendarEvent): string {
  return `${event.calendarId}:${event.id}`;
}

function eventColor(event: GoogleCalendarEvent, calendarColor?: string): string | undefined {
  return googleEventColors[event.colorId ?? ""] ?? calendarColor;
}

function eventTextColor(color: string | undefined): string | undefined {
  if (!color || !/^#[0-9a-f]{6}$/i.test(color)) return undefined;
  const [red, green, blue] = [color.slice(1, 3), color.slice(3, 5), color.slice(5, 7)].map((value) => Number.parseInt(value, 16));
  return ((red! * 299 + green! * 587 + blue! * 114) / 1000) < 145 ? "#fff" : "#202124";
}

function EventCard({ event, color, selected, select, open }: { readonly event: GoogleCalendarEvent; readonly color?: string; readonly selected: boolean; select(): void; open(): void }): React.JSX.Element {
  return (
    <div className="calendar-event-row"><input aria-label={`Select ${event.summary || "untitled event"}`} checked={selected} type="checkbox" onChange={select} /><button type="button" className="calendar-event" style={{ borderInlineStartColor: color, backgroundColor: color, color: eventTextColor(color) }} onClick={open}>
      {!event.start.date && <span>{eventTimeLabel(event)}</span>}
      <strong>{event.summary}</strong>
      {event.recurringEventId || event.recurrence ? <small>Repeats</small> : null}
    </button></div>
  );
}

function slotDate(day: Date, hour: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, 0, 0, 0);
}

function timedEventAt(event: GoogleCalendarEvent, day: Date, hour: number): boolean {
  if (event.start.date || !event.start.dateTime) return false;
  const start = eventStart(event);
  return start.getFullYear() === day.getFullYear() && start.getMonth() === day.getMonth() && start.getDate() === day.getDate() && start.getHours() === hour;
}

function TimeGrid({ days, events, colors, selected, select, create, move, resize, open }: {
  readonly days: readonly Date[];
  readonly events: readonly GoogleCalendarEvent[];
  readonly colors: ReadonlyMap<string, string | undefined>;
  readonly selected: ReadonlySet<string>;
  select(event: GoogleCalendarEvent): void;
  create(slot: AvailabilitySlot): void;
  move(event: GoogleCalendarEvent, start: Date): void;
  resize(event: GoogleCalendarEvent, end: Date): void;
  open(event: GoogleCalendarEvent): void;
}): React.JSX.Element {
  const hours = Array.from({ length: 24 }, (_, hour) => hour);
  const allDay = events.filter((event) => event.start.date);
  return (
    <div className="time-grid-wrap">
      <div className="all-day-lane" style={{ gridTemplateColumns: `3.75rem repeat(${days.length}, minmax(7rem, 1fr))` }}><strong>All day</strong>{days.map((day) => <div key={toYmd(day)}>{allDay.filter((event) => eventOverlapsDay(event, day)).map((event) => <EventCard key={eventKey(event)} event={event} color={eventColor(event, colors.get(event.calendarId))} selected={selected.has(eventKey(event))} select={() => select(event)} open={() => open(event)} />)}</div>)}</div>
      <div className="time-grid" role="grid" aria-label={days.length === 1 ? "Day time grid" : "Week time grid"} style={{ gridTemplateColumns: `4.25rem repeat(${days.length}, minmax(8rem, 1fr))` }}>
        <div role="columnheader" />
        {days.map((day) => <div key={toYmd(day)} role="columnheader" className="time-grid-day">{day.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}</div>)}
        {hours.map((hour) => <Fragment key={`hour-${hour}`}>
          <div key={`label-${hour}`} className="time-label" role="rowheader">{slotDate(days[0]!, hour).toLocaleTimeString([], { hour: "numeric" })}</div>
          {days.map((day) => {
            const start = slotDate(day, hour);
            const cellEvents = events.filter((event) => timedEventAt(event, day, hour));
            return <div key={`${toYmd(day)}-${hour}`} className="time-cell" role="gridcell" tabIndex={0} aria-label={`Create event ${toYmd(day)} ${String(hour).padStart(2, "0")}:00`} onClick={(event) => { if (event.currentTarget === event.target) create({ start: start.toISOString(), end: new Date(start.getTime() + 30 * 60_000).toISOString() }); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); create({ start: start.toISOString(), end: new Date(start.getTime() + 30 * 60_000).toISOString() }); } }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const key = event.dataTransfer.getData("application/x-hcb-event"); const moved = events.find((candidate) => eventKey(candidate) === key); if (moved) move(moved, start); }}>
              {cellEvents.map((calendarEvent) => <div key={eventKey(calendarEvent)} className="time-grid-event" draggable onDragStart={(event) => event.dataTransfer.setData("application/x-hcb-event", eventKey(calendarEvent))}><EventCard event={calendarEvent} color={eventColor(calendarEvent, colors.get(calendarEvent.calendarId))} selected={selected.has(eventKey(calendarEvent))} select={() => select(calendarEvent)} open={() => open(calendarEvent)} /><div className="time-grid-event-actions"><button type="button" aria-label={`Move ${calendarEvent.summary} 30 minutes later`} onClick={() => move(calendarEvent, new Date(eventStart(calendarEvent).getTime() + 30 * 60_000))}>↓</button><button type="button" aria-label={`Extend ${calendarEvent.summary} by 30 minutes`} onClick={() => resize(calendarEvent, new Date(eventEnd(calendarEvent).getTime() + 30 * 60_000))}>↘</button></div></div>)}
            </div>;
          })}
        </Fragment>)}
      </div>
    </div>
  );
}

function DayView({ day, events, colors, selected, select, create, move, resize, open }: {
  readonly day: Date;
  readonly events: readonly GoogleCalendarEvent[];
  readonly colors: ReadonlyMap<string, string | undefined>;
  readonly selected: ReadonlySet<string>;
  select(event: GoogleCalendarEvent): void;
  create(slot: AvailabilitySlot): void;
  move(event: GoogleCalendarEvent, start: Date): void;
  resize(event: GoogleCalendarEvent, end: Date): void;
  open(event: GoogleCalendarEvent): void;
}): React.JSX.Element {
  return (
    <div className="day-view">
      <h3>{day.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</h3>
      <TimeGrid days={[day]} events={events.filter((event) => eventOverlapsDay(event, day)).sort(sortEvents)} colors={colors} selected={selected} select={select} create={create} move={move} resize={resize} open={open} />
    </div>
  );
}

function WeekView({ start, events, colors, selected, select, create, move, resize, open }: {
  readonly start: Date;
  readonly events: readonly GoogleCalendarEvent[];
  readonly colors: ReadonlyMap<string, string | undefined>;
  readonly selected: ReadonlySet<string>;
  select(event: GoogleCalendarEvent): void;
  create(slot: AvailabilitySlot): void;
  move(event: GoogleCalendarEvent, start: Date): void;
  resize(event: GoogleCalendarEvent, end: Date): void;
  open(event: GoogleCalendarEvent): void;
}): React.JSX.Element {
  return (
    <TimeGrid days={Array.from({ length: 7 }, (_, index) => addDays(start, index))} events={events} colors={colors} selected={selected} select={select} create={create} move={move} resize={resize} open={open} />
  );
}

function MonthView({ anchor, events, colors, selected, select, open }: {
  readonly anchor: Date;
  readonly events: readonly GoogleCalendarEvent[];
  readonly colors: ReadonlyMap<string, string | undefined>;
  readonly selected: ReadonlySet<string>;
  select(event: GoogleCalendarEvent): void;
  open(event: GoogleCalendarEvent): void;
}): React.JSX.Element {
  const start = viewRange(anchor, "month").start;
  return (
    <div className="month-grid">
      {weekDays.map((day) => <strong key={day} className="month-label">{weekDayLabels[day]}</strong>)}
      {Array.from({ length: 42 }, (_, index) => {
        const day = addDays(start, index);
        const daily = events.filter((event) => eventOverlapsDay(event, day)).sort(sortEvents);
        return (
          <section key={toYmd(day)} className={day.getMonth() === anchor.getMonth() ? "month-day" : "month-day muted"}>
            <span>{day.getDate()}</span>
            {daily.slice(0, 3).map((event) => <EventCard key={eventKey(event)} event={event} color={eventColor(event, colors.get(event.calendarId))} selected={selected.has(eventKey(event))} select={() => select(event)} open={() => open(event)} />)}
            {daily.length > 3 && <small>+{daily.length - 3} more</small>}
          </section>
        );
      })}
    </div>
  );
}

function AgendaView({ events, colors, selected, select, open }: {
  readonly events: readonly GoogleCalendarEvent[];
  readonly colors: ReadonlyMap<string, string | undefined>;
  readonly selected: ReadonlySet<string>;
  select(event: GoogleCalendarEvent): void;
  open(event: GoogleCalendarEvent): void;
}): React.JSX.Element {
  return (
    <ol className="agenda-list">
      {events.map((event) => (
        <li key={`${event.calendarId}:${event.id}`}>
          <time dateTime={event.start.dateTime ?? event.start.date}>{eventRangeLabel(event)}</time>
          <div>
            <EventCard event={event} color={eventColor(event, colors.get(event.calendarId))} selected={selected.has(eventKey(event))} select={() => select(event)} open={() => open(event)} />
            {event.location && <small>{event.location}</small>}
            {event.description && <p>{event.description}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

function EventEditor({
  calendars,
  event,
  prefill,
  defaultCalendarId,
  driveAuthorized,
  createEvent,
  updateEvent,
  deleteEvent,
  getEvent,
  respondToEvent,
  authorizeDrive,
  searchDrive,
  splitRecurringEvent,
  close
}: {
  readonly calendars: readonly GoogleCalendar[];
  readonly event: GoogleCalendarEvent | undefined;
  readonly prefill: AvailabilitySlot | undefined;
  readonly defaultCalendarId: string;
  readonly driveAuthorized: boolean;
  createEvent(calendarId: string, input: CalendarEventInput): Promise<void>;
  updateEvent(event: GoogleCalendarEvent, input: CalendarEventInput): Promise<"updated" | "conflict">;
  deleteEvent(event: GoogleCalendarEvent): Promise<"deleted" | "conflict">;
  getEvent(calendarId: string, eventId: string): Promise<GoogleCalendarEvent>;
  respondToEvent(event: GoogleCalendarEvent, responseStatus: "accepted" | "declined" | "tentative" | "needsAction", comment?: string): Promise<GoogleCalendarEvent>;
  authorizeDrive(): Promise<void>;
  searchDrive(query: string): Promise<GoogleDriveFile[]>;
  splitRecurringEvent(series: GoogleCalendarEvent, firstChangedInstance: GoogleCalendarEvent, input: CalendarEventInput): Promise<void>;
  close(): void;
}): React.JSX.Element {
  const titleRef = useRef<HTMLInputElement>(null);
  const [editingEvent, setEditingEvent] = useState(event);
  const [scope, setScope] = useState<"instance" | "following" | "series">("instance");
  const [calendarId, setCalendarId] = useState(defaultCalendarId);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [start, setStart] = useState(() => localDateTime(30));
  const [end, setEnd] = useState(() => localDateTime(90));
  const [timeZone, setTimeZone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [attendeeText, setAttendeeText] = useState("");
  const [meet, setMeet] = useState(false);
  const [attachments, setAttachments] = useState<GoogleEventAttachment[]>([]);
  const [recurrence, setRecurrence] = useState<RecurrenceDraft>(defaultRecurrence);
  const [advanced, setAdvanced] = useState<AdvancedEventDraft>(defaultAdvancedEvent);
  const [responseComment, setResponseComment] = useState("");
  const [error, setError] = useState("");
  const [responding, setResponding] = useState(false);

  function loadDraft(source: GoogleCalendarEvent | undefined): void {
    setEditingEvent(source);
    setCalendarId(source?.calendarId ?? defaultCalendarId);
    setTitle(source?.summary ?? "");
    setDescription(source?.description ?? "");
    setLocation(source?.location ?? "");
    const sourceAllDay = Boolean(source?.start.date);
    setAllDay(sourceAllDay);
    setStart(sourceAllDay ? source?.start.date ?? toYmd(new Date()) : source?.start.dateTime ? toLocalDateTime(new Date(source.start.dateTime)) : prefill ? toLocalDateTime(new Date(prefill.start)) : localDateTime(30));
    setEnd(sourceAllDay ? toYmd(addDays(dateFromYmd(source?.end.date ?? source?.start.date ?? toYmd(new Date())), -1)) : source?.end.dateTime ? toLocalDateTime(new Date(source.end.dateTime)) : prefill ? toLocalDateTime(new Date(prefill.end)) : localDateTime(90));
    setTimeZone(source?.start.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
    setAttendeeText(source?.attendees?.map((attendee) => attendee.email).join(", ") ?? "");
    setMeet(false);
    setAttachments(source?.attachments ? [...source.attachments] : []);
    setRecurrence(parseRecurrence(source?.recurrence));
    const popupReminder = source?.reminders?.overrides?.find((reminder) => reminder.method === "popup");
    setAdvanced({
      colorId: source?.colorId ?? "",
      transparency: source?.transparency ?? "opaque",
      visibility: source?.visibility ?? "default",
      reminderMinutes: String(popupReminder?.minutes ?? 10),
      useDefaultReminders: source?.reminders?.useDefault ?? true,
      guestsCanInviteOthers: source?.guestsCanInviteOthers ?? true,
      guestsCanModify: source?.guestsCanModify ?? false,
      guestsCanSeeOtherGuests: source?.guestsCanSeeOtherGuests ?? true,
      sendUpdates: "all",
      eventType: source?.eventType ?? "default",
      focusAutoDecline: source?.focusTimeProperties?.autoDeclineMode ?? source?.outOfOfficeProperties?.autoDeclineMode ?? "declineOnlyNewConflictingInvitations",
      focusChatStatus: source?.focusTimeProperties?.chatStatus ?? "doNotDisturb",
      declineMessage: source?.focusTimeProperties?.declineMessage ?? source?.outOfOfficeProperties?.declineMessage ?? "",
      workingLocationType: source?.workingLocationProperties?.type ?? "homeOffice",
      workingLocationLabel: source?.workingLocationProperties?.customLocation?.label ?? source?.workingLocationProperties?.officeLocation?.label ?? ""
    });
    setResponseComment(source?.attendees?.find((attendee) => attendee.self)?.comment ?? "");
    setError("");
  }

  useEffect(() => {
    setScope("instance");
    loadDraft(event);
  }, [event?.id, defaultCalendarId, prefill?.end, prefill?.start]);

  async function changeScope(next: "instance" | "following" | "series"): Promise<void> {
    if (!event?.recurringEventId || next === scope) {
      return;
    }
    setError("");
    try {
      if (next === "series" || next === "following") {
        loadDraft(await getEvent(event.calendarId, event.recurringEventId));
        if (next === "following") {
          const start = event.originalStartTime ?? event.start;
          const end = event.end;
          setAllDay(Boolean(start.date));
          setStart(start.date ?? (start.dateTime ? toLocalDateTime(new Date(start.dateTime)) : localDateTime(30)));
          setEnd(end.date ? toYmd(addDays(dateFromYmd(end.date), -1)) : end.dateTime ? toLocalDateTime(new Date(end.dateTime)) : localDateTime(90));
          setTimeZone(start.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
        }
      } else {
        loadDraft(event);
      }
      setScope(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The recurring event could not be loaded");
    }
  }

  function toggleAllDay(next: boolean): void {
    if (next) {
      setStart(toYmd(new Date(start)));
      setEnd(toYmd(new Date(end)));
    } else {
      setStart(`${start}T09:00`);
      setEnd(`${end}T10:00`);
    }
    setAllDay(next);
  }

  function updateFrequency(frequency: RepeatFrequency): void {
    setRecurrence((current) => ({ ...current, frequency, advanced: frequency === "custom" ? current.advanced : "" }));
  }

  async function submit(eventSubmit: React.FormEvent<HTMLFormElement>): Promise<void> {
    eventSubmit.preventDefault();
    setError("");
    try {
      const selectedCalendar = calendars.find((calendar) => calendar.id === calendarId);
      if (advanced.eventType !== "default" && !selectedCalendar?.primary) {
        throw new Error("Google status events are available only on the primary Calendar");
      }
      if ((advanced.eventType === "focusTime" || advanced.eventType === "outOfOffice") && allDay) {
        throw new Error("Focus time and out of office must be timed events");
      }
      if (advanced.eventType === "workingLocation" && !allDay) {
        throw new Error("Working location must be an all-day event");
      }
      if (advanced.eventType === "workingLocation" && start !== end) {
        throw new Error("Working location must cover exactly one day");
      }
      const constrainedAdvanced = advanced.eventType === "workingLocation"
        ? { ...advanced, transparency: "transparent" as const, visibility: "public" as const }
        : advanced.eventType === "focusTime" || advanced.eventType === "outOfOffice"
          ? { ...advanced, transparency: "opaque" as const }
          : advanced;
      const baseInput = eventInputFromDraft(title, description, location, allDay, start, end, timeZone, recurrence, attendeeText, attachments, meet, constrainedAdvanced);
      const input = editingEvent?.recurrence && recurrence.frequency === "none"
        ? { ...baseInput, recurrence: [] }
        : baseInput;
      if (editingEvent) {
        if (scope === "following" && event?.recurringEventId) {
          await splitRecurringEvent(editingEvent, event, input);
          close();
        } else {
          const result = await updateEvent(editingEvent, input);
          if (result === "updated") close();
        }
      } else {
        await createEvent(calendarId, input);
        close();
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Event could not be saved");
    }
  }

  async function remove(): Promise<void> {
    if (!editingEvent || !window.confirm(`Delete “${editingEvent.summary}”?`)) {
      return;
    }
    setError("");
    try {
      const result = await deleteEvent(editingEvent);
      if (result === "deleted") {
        close();
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Event could not be deleted");
    }
  }

  async function respond(responseStatus: "accepted" | "declined" | "tentative" | "needsAction"): Promise<void> {
    if (!editingEvent) {
      return;
    }
    setError("");
    setResponding(true);
    try {
      setEditingEvent(await respondToEvent(editingEvent, responseStatus, responseComment));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Invitation response could not be saved");
    } finally {
      setResponding(false);
    }
  }

  const selfAttendee = editingEvent?.attendees?.find((attendee) => attendee.self);

  return (
    <ModalDialog className="event-editor" labelledBy="event-editor-heading" initialFocusRef={titleRef} onClose={close}>
      <form onSubmit={(eventSubmit) => void submit(eventSubmit)}>
        <div className="panel-heading">
          <div><p className="eyebrow">Google Calendar</p><h2 id="event-editor-heading">{editingEvent ? "Edit event" : "New event"}</h2></div>
          <div className="button-row">{editingEvent && <button type="button" onClick={() => void navigator.clipboard?.writeText(`${window.location.origin}/event/${encodeURIComponent(editingEvent.calendarId)}/${encodeURIComponent(editingEvent.id)}`)}>Copy link</button>}<button type="button" onClick={close}>Close</button></div>
        </div>
        {event?.recurringEventId && (
          <fieldset className="scope-choice">
            <legend>Apply changes to</legend>
            <label><input type="radio" checked={scope === "instance"} onChange={() => void changeScope("instance")} /> Only this occurrence</label>
            <label><input type="radio" checked={scope === "following"} onChange={() => void changeScope("following")} /> This and following occurrences</label>
            <label><input type="radio" checked={scope === "series"} onChange={() => void changeScope("series")} /> The entire series</label>
            {scope === "following" && <p className="field-help">This creates a new series at this occurrence and trims the original one. Google Calendar resets exceptions after the split point.</p>}
          </fieldset>
        )}
        <label>Title<input ref={titleRef} value={title} onChange={(eventInput) => setTitle(eventInput.target.value)} required /></label>
        <label>Calendar<select value={calendarId} disabled={Boolean(editingEvent)} onChange={(eventInput) => setCalendarId(eventInput.target.value)}>{calendars.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.summary}</option>)}</select></label>
        <label>Location<input value={location} onChange={(eventInput) => setLocation(eventInput.target.value)} placeholder="Optional location" /></label>
        <label>Description<textarea value={description} onChange={(eventInput) => setDescription(eventInput.target.value)} rows={4} /></label>
        <label className="check-label"><input type="checkbox" checked={allDay} onChange={(eventInput) => toggleAllDay(eventInput.target.checked)} /> All-day event</label>
        <div className="event-time-fields">
          <label>Starts<input type={allDay ? "date" : "datetime-local"} value={start} onChange={(eventInput) => setStart(eventInput.target.value)} required /></label>
          <label>{allDay ? "Ends on" : "Ends"}<input type={allDay ? "date" : "datetime-local"} value={end} onChange={(eventInput) => setEnd(eventInput.target.value)} required /></label>
          {!allDay && <label>Time zone<select value={timeZone} onChange={(eventInput) => setTimeZone(eventInput.target.value)}>{timeZones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}</select></label>}
        </div>
        <fieldset className="recurrence-editor">
          <legend>Repeat</legend>
          <label>Schedule<select value={recurrence.frequency} onChange={(eventInput) => updateFrequency(eventInput.target.value as RepeatFrequency)}><option value="none">Does not repeat</option><option value="daily">Every day</option><option value="weekly">Every week</option><option value="monthly">Every month</option><option value="yearly">Every year</option><option value="custom">Advanced schedule</option></select></label>
          {recurrence.frequency !== "none" && recurrence.frequency !== "custom" && (
            <>
              <label>Every <input type="number" min="1" max="99" value={recurrence.interval} onChange={(eventInput) => setRecurrence((current) => ({ ...current, interval: Number(eventInput.target.value) || 1 }))} /> {recurrence.frequency === "daily" ? "day(s)" : recurrence.frequency === "weekly" ? "week(s)" : recurrence.frequency === "monthly" ? "month(s)" : "year(s)"}</label>
              {recurrence.frequency === "weekly" && <div className="weekday-toggle">{weekDays.map((day) => <label key={day}><input type="checkbox" checked={recurrence.weekdays.includes(day)} onChange={() => setRecurrence((current) => ({ ...current, weekdays: current.weekdays.includes(day) ? current.weekdays.filter((value) => value !== day) : [...current.weekdays, day] }))} /> {weekDayLabels[day]}</label>)}</div>}
              <label>Ends<select value={recurrence.end} onChange={(eventInput) => setRecurrence((current) => ({ ...current, end: eventInput.target.value as RepeatEnd }))}><option value="never">Never</option><option value="on-date">On a date</option><option value="after-count">After a number of times</option></select></label>
              {recurrence.end === "on-date" && <label>Final repeat date<input type="date" value={recurrence.until} onChange={(eventInput) => setRecurrence((current) => ({ ...current, until: eventInput.target.value }))} /></label>}
              {recurrence.end === "after-count" && <label>Number of times<input type="number" min="1" max="999" value={recurrence.count} onChange={(eventInput) => setRecurrence((current) => ({ ...current, count: eventInput.target.value }))} /></label>}
            </>
          )}
          <details>
            <summary>Advanced schedule</summary>
            <p className="field-help">Use RFC 5545 RRULE, EXDATE, or RDATE lines only. This is optional unless you choose Advanced schedule.</p>
            <textarea value={recurrence.advanced} onChange={(eventInput) => setRecurrence((current) => ({ ...current, advanced: eventInput.target.value }))} rows={4} placeholder="RRULE:FREQ=MONTHLY;BYDAY=MO" />
          </details>
        </fieldset>
        <label>Event type<select value={advanced.eventType} onChange={(eventInput) => setAdvanced((current) => ({ ...current, eventType: eventInput.target.value as GoogleEventType }))}><option value="default">Event</option><option value="focusTime" disabled={!calendars.find((calendar) => calendar.id === calendarId)?.primary}>Focus time</option><option value="outOfOffice" disabled={!calendars.find((calendar) => calendar.id === calendarId)?.primary}>Out of office</option><option value="workingLocation" disabled={!calendars.find((calendar) => calendar.id === calendarId)?.primary}>Working location</option></select></label>
        {advanced.eventType !== "default" && <p className="field-help">Google status events are available only on a primary Calendar. Focus time and out of office are timed and busy; working location is an all-day, public, free entry.</p>}
        <label>Attendees<input value={attendeeText} onChange={(eventInput) => setAttendeeText(eventInput.target.value)} placeholder="Emails separated by commas" /></label>
        {selfAttendee && <fieldset className="response-editor"><legend>Your invitation</legend><p className="field-help">Current response: {selfAttendee.responseStatus ?? "needs action"}</p><label>Response comment<textarea value={responseComment} onChange={(eventInput) => setResponseComment(eventInput.target.value)} rows={2} /></label><div className="button-row"><button type="button" disabled={responding} onClick={() => void respond("accepted")}>Accept</button><button type="button" disabled={responding} onClick={() => void respond("tentative")}>Maybe</button><button type="button" disabled={responding} onClick={() => void respond("declined")}>Decline</button></div></fieldset>}
        {editingEvent?.conferenceData ? <p className="field-help">This event already has a Google Meet link. Saving other fields preserves it.</p> : <label className="check-label"><input type="checkbox" checked={meet} onChange={(eventInput) => setMeet(eventInput.target.checked)} /> Create a Google Meet link</label>}
        <DriveAttachmentPicker
          authorized={driveAuthorized}
          authorize={authorizeDrive}
          search={searchDrive}
          addAttachment={(attachment) => setAttachments((current) => current.some((item) => item.fileUrl === attachment.fileUrl) ? current : [...current, attachment])}
        />
        {attachments.length > 0 && <ul className="selected-attachments">{attachments.map((attachment) => <li key={attachment.fileUrl}>{attachment.title ?? attachment.fileUrl}<button type="button" onClick={() => setAttachments((current) => current.filter((item) => item.fileUrl !== attachment.fileUrl))}>Remove</button></li>)}</ul>}
        <details className="event-advanced"><summary>Advanced event settings</summary><div className="advanced-fields"><label>Event color ID<input value={advanced.colorId} onChange={(eventInput) => setAdvanced((current) => ({ ...current, colorId: eventInput.target.value }))} placeholder="Google color ID" /></label><label>Availability<select value={advanced.transparency} onChange={(eventInput) => setAdvanced((current) => ({ ...current, transparency: eventInput.target.value as AdvancedEventDraft["transparency"] }))} disabled={advanced.eventType === "focusTime" || advanced.eventType === "outOfOffice" || advanced.eventType === "workingLocation"}><option value="opaque">Busy</option><option value="transparent">Free</option></select></label><label>Visibility<select value={advanced.visibility} onChange={(eventInput) => setAdvanced((current) => ({ ...current, visibility: eventInput.target.value as AdvancedEventDraft["visibility"] }))} disabled={advanced.eventType === "workingLocation"}><option value="default">Calendar default</option><option value="public">Public</option><option value="private">Private</option><option value="confidential">Confidential</option></select></label><label>Invitation email<select value={advanced.sendUpdates} onChange={(eventInput) => setAdvanced((current) => ({ ...current, sendUpdates: eventInput.target.value as SendUpdates }))}><option value="all">Send all updates</option><option value="externalOnly">Send external updates only</option><option value="none">Do not send updates</option></select></label></div><fieldset className="recurrence-editor"><legend>Popup reminder</legend><label className="check-label"><input type="checkbox" checked={advanced.useDefaultReminders} onChange={(eventInput) => setAdvanced((current) => ({ ...current, useDefaultReminders: eventInput.target.checked }))} /> Use Calendar default reminders</label>{!advanced.useDefaultReminders && <label>Minutes before<input type="number" min="0" max="40320" value={advanced.reminderMinutes} onChange={(eventInput) => setAdvanced((current) => ({ ...current, reminderMinutes: eventInput.target.value }))} /></label>}</fieldset><fieldset className="recurrence-editor"><legend>Guest permissions</legend><label className="check-label"><input type="checkbox" checked={advanced.guestsCanInviteOthers} onChange={(eventInput) => setAdvanced((current) => ({ ...current, guestsCanInviteOthers: eventInput.target.checked }))} /> Guests can invite others</label><label className="check-label"><input type="checkbox" checked={advanced.guestsCanModify} onChange={(eventInput) => setAdvanced((current) => ({ ...current, guestsCanModify: eventInput.target.checked }))} /> Guests can modify event</label><label className="check-label"><input type="checkbox" checked={advanced.guestsCanSeeOtherGuests} onChange={(eventInput) => setAdvanced((current) => ({ ...current, guestsCanSeeOtherGuests: eventInput.target.checked }))} /> Guests can see other guests</label></fieldset>{(advanced.eventType === "focusTime" || advanced.eventType === "outOfOffice") && <fieldset className="recurrence-editor"><legend>Decline conflicting invitations</legend><label>Policy<select value={advanced.focusAutoDecline} onChange={(eventInput) => setAdvanced((current) => ({ ...current, focusAutoDecline: eventInput.target.value as AdvancedEventDraft["focusAutoDecline"] }))}><option value="declineNone">Do not decline</option><option value="declineOnlyNewConflictingInvitations">Decline new conflicts</option><option value="declineAllConflictingInvitations">Decline all conflicts</option></select></label>{advanced.eventType === "focusTime" && <label>Chat status<select value={advanced.focusChatStatus} onChange={(eventInput) => setAdvanced((current) => ({ ...current, focusChatStatus: eventInput.target.value as AdvancedEventDraft["focusChatStatus"] }))}><option value="doNotDisturb">Do not disturb</option><option value="available">Available</option></select></label>}<label>Decline message<textarea value={advanced.declineMessage} onChange={(eventInput) => setAdvanced((current) => ({ ...current, declineMessage: eventInput.target.value }))} rows={2} /></label></fieldset>}{advanced.eventType === "workingLocation" && <fieldset className="recurrence-editor"><legend>Working location</legend><label>Location type<select value={advanced.workingLocationType} onChange={(eventInput) => setAdvanced((current) => ({ ...current, workingLocationType: eventInput.target.value as AdvancedEventDraft["workingLocationType"] }))}><option value="homeOffice">Home office</option><option value="officeLocation">Office</option><option value="customLocation">Custom</option></select></label>{advanced.workingLocationType !== "homeOffice" && <label>Location label<input value={advanced.workingLocationLabel} onChange={(eventInput) => setAdvanced((current) => ({ ...current, workingLocationLabel: eventInput.target.value }))} /></label>}</fieldset>}</details>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="button-row"><button type="submit">{editingEvent ? "Save event" : "Create event"}</button>{editingEvent && <button type="button" className="danger-button" onClick={() => void remove()}>Delete event</button>}</div>
      </form>
    </ModalDialog>
  );
}

function ConflictDialog({ conflict, resolve, dismiss }: {
  readonly conflict: EventConflict;
  resolve(resolution: "keep-local" | "use-google"): Promise<void>;
  dismiss(): void;
}): React.JSX.Element {
  const isDelete = conflict.kind === "delete";
  const dismissRef = useRef<HTMLButtonElement>(null);
  return (
    <ModalDialog className="conflict-card" labelledBy="conflict-heading" initialFocusRef={dismissRef} onClose={dismiss}>
        <p className="eyebrow">Google Calendar</p>
        <h2 id="conflict-heading">This event changed in Google</h2>
        <p>{isDelete ? "Someone changed this event before you deleted it." : "Someone changed this event while you were editing it."}</p>
        <p><strong>Google now has:</strong> {conflict.latest.summary} — {eventRangeLabel(conflict.latest)}</p>
        <p>{isDelete ? "Delete it anyway, or keep the Google version?" : "Use your changes to update Google, or discard them and use the Google version?"}</p>
        <div className="button-row"><button type="button" onClick={() => void resolve("keep-local")}>{isDelete ? "Delete it anyway" : "Use my changes"}</button><button type="button" onClick={() => void resolve("use-google")}>Use Google version</button><button ref={dismissRef} type="button" onClick={dismiss}>Not now</button></div>
    </ModalDialog>
  );
}

function InvitationInbox({ invitations, calendars, respond, close }: {
  readonly invitations: readonly GoogleCalendarEvent[];
  readonly calendars: readonly GoogleCalendar[];
  respond(event: GoogleCalendarEvent, response: "accepted" | "declined" | "tentative", comment?: string): Promise<void>;
  close(): void;
}): React.JSX.Element {
  const [comments, setComments] = useState<Readonly<Record<string, string>>>({});
  return <ModalDialog className="invitation-inbox" labelledBy="invitation-inbox-heading" onClose={close}>
    <div className="panel-heading"><div><p className="eyebrow">Google Calendar</p><h2 id="invitation-inbox-heading">Invitation inbox</h2></div><button type="button" onClick={close}>Close</button></div>
    {invitations.length === 0 ? <p className="empty-state">No pending invitations in the synced Calendar cache.</p> : <ul className="invitation-list">{invitations.map((event) => {
      const key = eventKey(event);
      return <li key={key}><strong>{event.summary || "Untitled event"}</strong><span>{calendars.find((calendar) => calendar.id === event.calendarId)?.summary ?? event.calendarId} · {eventRangeLabel(event)}</span><label>Response comment<textarea value={comments[key] ?? ""} onChange={(input) => setComments((current) => ({ ...current, [key]: input.target.value }))} rows={2} /></label><div className="button-row"><button type="button" onClick={() => void respond(event, "accepted", comments[key])}>Accept</button><button type="button" onClick={() => void respond(event, "tentative", comments[key])}>Maybe</button><button type="button" onClick={() => void respond(event, "declined", comments[key])}>Decline</button></div></li>;
    })}</ul>}
  </ModalDialog>;
}

function EventDetail({ event, calendars, createEvent, deleteEvent, edit, close }: {
  readonly event: GoogleCalendarEvent;
  readonly calendars: readonly GoogleCalendar[];
  createEvent(calendarId: string, input: CalendarEventInput): Promise<void>;
  deleteEvent(event: GoogleCalendarEvent): Promise<"deleted" | "conflict">;
  edit(): void;
  close(): void;
}): React.JSX.Element {
  const [error, setError] = useState("");
  const calendar = calendars.find((candidate) => candidate.id === event.calendarId);
  const meetUrl = event.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === "video")?.uri;
  async function duplicate(): Promise<void> {
    setError("");
    try {
      await createEvent(event.calendarId, { ...eventInputFromExisting(event), summary: `${event.summary || "Untitled event"} (copy)` });
      close();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Event could not be duplicated");
    }
  }
  async function remove(): Promise<void> {
    if (!window.confirm(`Delete “${event.summary || "Untitled event"}”?`)) return;
    setError("");
    try {
      const result = await deleteEvent(event);
      if (result === "deleted") close();
      else setError("Google changed this event before deletion. Resolve the conflict before retrying.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Event could not be deleted");
    }
  }
  return <ModalDialog className="item-detail event-detail" labelledBy="event-detail-heading" onClose={close}>
    <div className="panel-heading"><div><p className="eyebrow">Google Calendar</p><h2 id="event-detail-heading">{event.summary || "Untitled event"}</h2></div><button type="button" onClick={close}>Close</button></div>
    <dl className="detail-list">
      <div><dt>Calendar</dt><dd>{calendar?.summary ?? "Unknown calendar"}</dd></div>
      <div><dt>When</dt><dd>{eventRangeLabel(event)}</dd></div>
      {event.location && <div><dt>Location</dt><dd>{event.location}</dd></div>}
      {event.description && <div><dt>Description</dt><dd className="detail-notes">{event.description}</dd></div>}
      {event.recurrence || event.recurringEventId ? <div><dt>Repeats</dt><dd>{event.recurringEventId ? "Part of a recurring series" : "Recurring event"}</dd></div> : null}
      {event.attendees?.length ? <div><dt>Guests</dt><dd>{event.attendees.map((attendee) => attendee.displayName ?? attendee.email).join(", ")}</dd></div> : null}
      {event.transparency && <div><dt>Availability</dt><dd>{event.transparency === "transparent" ? "Free" : "Busy"}</dd></div>}
      {meetUrl && <div><dt>Google Meet</dt><dd><a href={meetUrl} target="_blank" rel="noreferrer">Open meeting</a></dd></div>}
    </dl>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="button-row"><button type="button" onClick={edit}>Edit event</button><button type="button" onClick={() => void duplicate()}>Duplicate</button><button type="button" onClick={() => void navigator.clipboard?.writeText(`${window.location.origin}/event/${encodeURIComponent(event.calendarId)}/${encodeURIComponent(event.id)}`)}>Copy link</button><button type="button" className="danger-button" onClick={() => void remove()}>Delete</button></div>
  </ModalDialog>;
}

export function CalendarPanel({
  calendars,
  events,
  invitations = [],
  search,
  command,
  driveAuthorized,
  visibleCalendarIds = emptyCalendarIds,
  eventConflict,
  createCalendar,
  subscribeCalendar,
  removeCalendarFromList,
  queryAvailability,
  createEvent,
  updateEvent,
  deleteEvent,
  getEvent,
  respondToEvent,
  loadCalendarRange,
  resolveEventConflict,
  dismissEventConflict,
  splitRecurringEvent,
  authorizeDrive,
  searchDrive,
  bulkEvents,
  saveVisibleCalendarIds
}: CalendarPanelProps): React.JSX.Element {
  const [view, setView] = useState<CalendarView>("week");
  const [anchor, setAnchor] = useState(() => new Date());
  const [selectedCalendarIds, setSelectedCalendarIds] = useState<string[]>([]);
  const [viewingEvent, setViewingEvent] = useState<GoogleCalendarEvent | undefined>();
  const [editingEvent, setEditingEvent] = useState<GoogleCalendarEvent | undefined>();
  const [composerOpen, setComposerOpen] = useState(false);
  const [calendarManagerOpen, setCalendarManagerOpen] = useState(false);
  const [availabilityOpen, setAvailabilityOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [composerPrefill, setComposerPrefill] = useState<AvailabilitySlot | undefined>();
  const [selectedEventKeys, setSelectedEventKeys] = useState<readonly string[]>([]);
  const [bulkResult, setBulkResult] = useState<BulkOperationResult | undefined>();
  const [bulkCalendarId, setBulkCalendarId] = useState("");
  const [bulkColorId, setBulkColorId] = useState("");
  const [bulkFind, setBulkFind] = useState("");
  const [bulkReplace, setBulkReplace] = useState("");
  const [bulkShiftMinutes, setBulkShiftMinutes] = useState("0");
  const [error, setError] = useState("");
  const defaultCalendarId = calendars.find((calendar) => calendar.primary)?.id ?? calendars[0]?.id ?? "";
  const range = useMemo(() => viewRange(anchor, view), [anchor, view]);

  useEffect(() => {
    setSelectedCalendarIds((current) => {
      const available = current.filter((id) => calendars.some((calendar) => calendar.id === id));
      const saved = visibleCalendarIds.filter((id) => calendars.some((calendar) => calendar.id === id));
      return available.length > 0 ? available : saved.length > 0 ? saved : defaultCalendarId ? [defaultCalendarId] : [];
    });
  }, [calendars, defaultCalendarId, visibleCalendarIds]);

  useEffect(() => {
    if (!command) {
      return;
    }
    if (command.type === "new-event") {
      setViewingEvent(undefined);
      setEditingEvent(undefined);
      setComposerPrefill(undefined);
      setComposerOpen(true);
      return;
    }
    if (command.type === "find-time") {
      setAvailabilityOpen(true);
      return;
    }
    if (command.type === "manage-calendars") {
      setCalendarManagerOpen(true);
      return;
    }
    const event = command.event;
    if (event) {
      const date = event.originalStartTime ?? event.start;
      const anchor = date.date ? dateFromYmd(date.date) : date.dateTime ? new Date(date.dateTime) : undefined;
      if (anchor && !Number.isNaN(anchor.getTime())) {
        setAnchor(anchor);
        setView("day");
      }
      setSelectedCalendarIds([event.calendarId]);
      setComposerOpen(false);
      setComposerPrefill(undefined);
      setViewingEvent(event);
    }
  }, [command, events]);

  useEffect(() => {
    void loadCalendarRange(range.start.toISOString(), range.end.toISOString()).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Calendar events could not be loaded"));
  }, [loadCalendarRange, range.end, range.start]);

  const query = search.trim().toLocaleLowerCase();
  const visibleEvents = useMemo(() => events
    .filter((event) => selectedCalendarIds.includes(event.calendarId))
    .filter((event) => eventEnd(event) > range.start && eventStart(event) < range.end)
    .filter((event) => matchesEvent(event, query))
    .sort(sortEvents), [events, query, range.end, range.start, selectedCalendarIds]);
  const colors = useMemo(() => new Map(calendars.map((calendar) => [calendar.id, calendar.backgroundColor])), [calendars]);
  const selectedEventSet = useMemo(() => new Set(selectedEventKeys), [selectedEventKeys]);
  const selectedEvents = useMemo(() => events.filter((event) => selectedEventSet.has(eventKey(event))), [events, selectedEventSet]);

  useEffect(() => {
    setSelectedEventKeys((current) => current.filter((key) => events.some((event) => eventKey(event) === key)));
  }, [events]);

  function changeAnchor(direction: number): void {
    const multiplier = view === "day" ? 1 : view === "week" ? 7 : view === "month" ? 31 : 30;
    setAnchor((current) => addDays(current, direction * multiplier));
  }

  function toggleCalendar(calendarId: string): void {
    setSelectedCalendarIds((current) => {
      const next = current.includes(calendarId) ? current.filter((id) => id !== calendarId) : [...current, calendarId];
      void saveVisibleCalendarIds?.(next).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Calendar visibility could not be saved"));
      return next;
    });
  }

  function openEvent(event: GoogleCalendarEvent): void {
    setComposerOpen(false);
    setComposerPrefill(undefined);
    setViewingEvent(event);
  }

  function toggleEventSelection(event: GoogleCalendarEvent): void {
    const key = eventKey(event);
    setSelectedEventKeys((current) => current.includes(key) ? current.filter((candidate) => candidate !== key) : [...current, key]);
  }

  async function runBulk(operation: EventBulkOperation): Promise<void> {
    if (!bulkEvents || selectedEvents.length === 0) return;
    if (operation.kind === "delete" && !window.confirm(`Delete ${selectedEvents.length} selected event${selectedEvents.length === 1 ? "" : "s"}? This can be recovered from Undo while its retention period lasts.`)) return;
    setError("");
    setBulkResult(undefined);
    try {
      const result = await bulkEvents(selectedEvents, operation);
      setBulkResult(result);
      if (result.failed.length === 0) setSelectedEventKeys([]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The selected events could not be changed");
    }
  }

  function closeEditor(): void {
    setEditingEvent(undefined);
    setComposerOpen(false);
    setComposerPrefill(undefined);
  }

  function useAvailabilitySlot(slot: AvailabilitySlot): void {
    setAvailabilityOpen(false);
    setEditingEvent(undefined);
    setViewingEvent(undefined);
    setComposerPrefill(slot);
    setComposerOpen(true);
  }

  function createTimeSlot(slot: AvailabilitySlot): void {
    setEditingEvent(undefined);
    setViewingEvent(undefined);
    setComposerPrefill(slot);
    setComposerOpen(true);
  }

  async function moveGridEvent(event: GoogleCalendarEvent, start: Date): Promise<void> {
    if (event.start.date || event.end.date) {
      setError("All-day events are not changed by a timed drag. Open the event to make that explicit change.");
      return;
    }
    const duration = eventEnd(event).getTime() - eventStart(event).getTime();
    try {
      const result = await updateEvent(event, eventInputFromExisting(event, { dateTime: start.toISOString(), timeZone: event.start.timeZone }, { dateTime: new Date(start.getTime() + duration).toISOString(), timeZone: event.end.timeZone }));
      if (result === "conflict") setError("Google changed this event before the move. Resolve the conflict before retrying.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The event could not be moved");
    }
  }

  async function resizeGridEvent(event: GoogleCalendarEvent, end: Date): Promise<void> {
    if (event.start.date || event.end.date || end <= eventStart(event)) {
      setError("A timed event must end after it starts. Open all-day events to edit them explicitly.");
      return;
    }
    try {
      const result = await updateEvent(event, eventInputFromExisting(event, event.start, { dateTime: end.toISOString(), timeZone: event.end.timeZone }));
      if (result === "conflict") setError("Google changed this event before the resize. Resolve the conflict before retrying.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The event could not be resized");
    }
  }

  return (
    <section className="workspace-panel calendar-panel" aria-labelledby="calendar-heading">
      <div className="panel-heading">
        <div><p className="eyebrow">Google Calendar</p><h2 id="calendar-heading">Calendar</h2></div>
        <div className="button-row"><button type="button" onClick={() => setInboxOpen(true)}>Invitations{invitations.length ? ` (${invitations.length})` : ""}</button><button type="button" onClick={() => setAvailabilityOpen(true)}>Find time</button><button type="button" onClick={() => setCalendarManagerOpen(true)}>Manage calendars</button><button type="button" disabled={!defaultCalendarId} onClick={() => { setViewingEvent(undefined); setEditingEvent(undefined); setComposerPrefill(undefined); setComposerOpen(true); }}>New event</button></div>
      </div>
      {calendars.length === 0 ? <p className="empty-state">No Google Calendars were found.</p> : (
        <>
          <div className="calendar-controls">
            <div className="button-row"><button type="button" onClick={() => changeAnchor(-1)}>Previous</button><button type="button" onClick={() => setAnchor(new Date())}>Today</button><button type="button" onClick={() => changeAnchor(1)}>Next</button></div>
            <div className="view-switcher" role="group" aria-label="Calendar view">{(["day", "week", "month", "agenda"] as const).map((candidate) => <button key={candidate} type="button" className={view === candidate ? "active" : ""} onClick={() => setView(candidate)}>{candidate[0].toUpperCase()}{candidate.slice(1)}</button>)}</div>
          </div>
          <fieldset className="calendar-sources"><legend>Show calendars</legend>{calendars.map((calendar) => <label key={calendar.id}><input type="checkbox" checked={selectedCalendarIds.includes(calendar.id)} onChange={() => toggleCalendar(calendar.id)} /> <span className="calendar-swatch" style={{ backgroundColor: calendar.backgroundColor }} /> {calendar.summary}</label>)}</fieldset>
          <p className="calendar-range-label">{view === "month" ? anchor.toLocaleDateString([], { month: "long", year: "numeric" }) : `${range.start.toLocaleDateString()} – ${addDays(range.end, -1).toLocaleDateString()}`}</p>
          {selectedEvents.length > 0 && bulkEvents && <fieldset className="bulk-actions"><legend>{selectedEvents.length} selected event{selectedEvents.length === 1 ? "" : "s"}</legend><div className="button-row"><button type="button" className="danger-button" onClick={() => void runBulk({ kind: "delete" })}>Delete</button><label>Move to<select aria-label="Bulk destination calendar" value={bulkCalendarId} onChange={(event) => setBulkCalendarId(event.target.value)}><option value="">Choose calendar</option>{calendars.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.summary}</option>)}</select></label><button type="button" disabled={!bulkCalendarId} onClick={() => void runBulk({ kind: "move", calendarId: bulkCalendarId })}>Move selected</button><label>Color ID<input aria-label="Bulk color ID" value={bulkColorId} onChange={(event) => setBulkColorId(event.target.value)} placeholder="Blank clears" /></label><button type="button" onClick={() => void runBulk({ kind: "color", colorId: bulkColorId || undefined })}>Apply color</button><select aria-label="Bulk availability" defaultValue=""><option value="" disabled>Set availability…</option><option value="opaque">Busy</option><option value="transparent">Free</option></select><button type="button" onClick={(event) => { const select = event.currentTarget.previousElementSibling as HTMLSelectElement; if (select.value) void runBulk({ kind: "availability", transparency: select.value as "opaque" | "transparent" }); }}>Apply availability</button><select aria-label="Bulk visibility" defaultValue=""><option value="" disabled>Set visibility…</option><option value="default">Calendar default</option><option value="public">Public</option><option value="private">Private</option><option value="confidential">Confidential</option></select><button type="button" onClick={(event) => { const select = event.currentTarget.previousElementSibling as HTMLSelectElement; if (select.value) void runBulk({ kind: "visibility", visibility: select.value as NonNullable<GoogleCalendarEvent["visibility"]> }); }}>Apply visibility</button><label>Shift minutes<input aria-label="Shift selected events in minutes" type="number" value={bulkShiftMinutes} onChange={(event) => setBulkShiftMinutes(event.target.value)} /></label><button type="button" onClick={() => void runBulk({ kind: "shift", minutes: Number(bulkShiftMinutes) })}>Shift</button><label>Find text<input aria-label="Bulk find event text" value={bulkFind} onChange={(event) => setBulkFind(event.target.value)} /></label><label>Replace with<input aria-label="Bulk replacement event text" value={bulkReplace} onChange={(event) => setBulkReplace(event.target.value)} /></label><button type="button" disabled={!bulkFind} onClick={() => void runBulk({ kind: "replace-text", find: bulkFind, replace: bulkReplace })}>Replace text</button><button type="button" onClick={() => setSelectedEventKeys([])}>Clear selection</button></div><p className="field-help">For a repeating event, open it first to choose whether an edit affects this occurrence or the series. “This and following” requires a series split, which the direct Google Calendar API does not expose as one mutation.</p></fieldset>}
          {error && <p className="error" role="alert">{error}</p>}
          {bulkResult && <p className={bulkResult.failed.length ? "error" : "status"} role="status">{bulkResult.succeeded.length} changed{bulkResult.failed.length ? `; ${bulkResult.failed.length} need attention: ${bulkResult.failed.map((entry) => entry.error).join(" · ")}` : ""}</p>}
          {view === "day" && <DayView day={range.start} events={visibleEvents} colors={colors} selected={selectedEventSet} select={toggleEventSelection} create={createTimeSlot} move={(event, start) => void moveGridEvent(event, start)} resize={(event, end) => void resizeGridEvent(event, end)} open={openEvent} />}
          {view === "week" && <WeekView start={range.start} events={visibleEvents} colors={colors} selected={selectedEventSet} select={toggleEventSelection} create={createTimeSlot} move={(event, start) => void moveGridEvent(event, start)} resize={(event, end) => void resizeGridEvent(event, end)} open={openEvent} />}
          {view === "month" && <MonthView anchor={anchor} events={visibleEvents} colors={colors} selected={selectedEventSet} select={toggleEventSelection} open={openEvent} />}
          {view === "agenda" && (visibleEvents.length > 0 ? <AgendaView events={visibleEvents} colors={colors} selected={selectedEventSet} select={toggleEventSelection} open={openEvent} /> : <p className="empty-state">No events in this range.</p>)}
        </>
      )}
      {viewingEvent && !editingEvent && !composerOpen && <EventDetail event={viewingEvent} calendars={calendars} createEvent={createEvent} deleteEvent={deleteEvent} edit={() => setEditingEvent(viewingEvent)} close={() => setViewingEvent(undefined)} />}
      {(composerOpen || editingEvent) && <EventEditor calendars={calendars} event={editingEvent} prefill={composerPrefill} defaultCalendarId={defaultCalendarId} driveAuthorized={driveAuthorized} createEvent={createEvent} updateEvent={updateEvent} deleteEvent={deleteEvent} getEvent={getEvent} respondToEvent={respondToEvent} authorizeDrive={authorizeDrive} searchDrive={searchDrive} splitRecurringEvent={splitRecurringEvent ?? (async () => { throw new Error("Recurring series splitting is unavailable in this workspace"); })} close={closeEditor} />}
      {calendarManagerOpen && <CalendarManagerDialog calendars={calendars} createCalendar={createCalendar} subscribeCalendar={subscribeCalendar} removeCalendarFromList={removeCalendarFromList} close={() => setCalendarManagerOpen(false)} />}
      {availabilityOpen && <AvailabilityAssistant calendars={calendars} defaultCalendarIds={selectedCalendarIds} queryAvailability={queryAvailability} useSlot={useAvailabilitySlot} close={() => setAvailabilityOpen(false)} />}
      {inboxOpen && <InvitationInbox invitations={invitations} calendars={calendars} close={() => setInboxOpen(false)} respond={async (event, response, comment) => { try { await respondToEvent(event, response, comment); } catch (reason) { setError(reason instanceof Error ? reason.message : "The invitation response could not be saved"); } }} />}
      {eventConflict && <ConflictDialog conflict={eventConflict} resolve={async (resolution) => { try { await resolveEventConflict(resolution); closeEditor(); } catch (reason) { setError(reason instanceof Error ? reason.message : "The conflict could not be resolved"); } }} dismiss={dismissEventConflict} />}
    </section>
  );
}
