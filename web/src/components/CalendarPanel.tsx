import { useEffect, useMemo, useState } from "react";

import { DriveAttachmentPicker } from "@/components/DriveAttachmentPicker";
import type { EventConflict } from "@/features/useWorkspace";
import type {
  CalendarEventInput,
  GoogleCalendar,
  GoogleCalendarEvent,
  GoogleDriveFile,
  GoogleEventAttachment
} from "@/types";

type CalendarView = "day" | "week" | "month" | "agenda";
type RepeatFrequency = "none" | "daily" | "weekly" | "monthly" | "yearly" | "custom";
type RepeatEnd = "never" | "on-date" | "after-count";

interface CalendarPanelProps {
  readonly calendars: readonly GoogleCalendar[];
  readonly events: readonly GoogleCalendarEvent[];
  readonly search: string;
  readonly driveAuthorized: boolean;
  readonly eventConflict: EventConflict | undefined;
  createEvent(calendarId: string, event: CalendarEventInput): Promise<void>;
  updateEvent(event: GoogleCalendarEvent, input: CalendarEventInput): Promise<"updated" | "conflict">;
  deleteEvent(event: GoogleCalendarEvent): Promise<"deleted" | "conflict">;
  getEvent(calendarId: string, eventId: string): Promise<GoogleCalendarEvent>;
  loadCalendarRange(timeMin: string, timeMax: string): Promise<void>;
  resolveEventConflict(resolution: "keep-local" | "use-google"): Promise<void>;
  dismissEventConflict(): void;
  authorizeDrive(): Promise<void>;
  searchDrive(query: string): Promise<GoogleDriveFile[]>;
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

const weekDays = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;
const weekDayLabels: Record<(typeof weekDays)[number], string> = {
  SU: "Sun",
  MO: "Mon",
  TU: "Tue",
  WE: "Wed",
  TH: "Thu",
  FR: "Fri",
  SA: "Sat"
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
  meet: boolean
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
    createGoogleMeet: meet
  };
}

function EventCard({ event, color, open }: { readonly event: GoogleCalendarEvent; readonly color?: string; open(): void }): React.JSX.Element {
  return (
    <button type="button" className="calendar-event" style={{ borderInlineStartColor: color }} onClick={open}>
      <span>{eventTimeLabel(event)}</span>
      <strong>{event.summary}</strong>
      {event.recurringEventId || event.recurrence ? <small>Repeats</small> : null}
    </button>
  );
}

function DayView({ day, events, colors, open }: {
  readonly day: Date;
  readonly events: readonly GoogleCalendarEvent[];
  readonly colors: ReadonlyMap<string, string | undefined>;
  open(event: GoogleCalendarEvent): void;
}): React.JSX.Element {
  const daily = events.filter((event) => eventOverlapsDay(event, day)).sort(sortEvents);
  return (
    <div className="day-view">
      <h3>{day.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</h3>
      {daily.length === 0 ? <p className="empty-state">Nothing scheduled for this day.</p> : daily.map((event) => <EventCard key={`${event.calendarId}:${event.id}`} event={event} color={colors.get(event.calendarId)} open={() => open(event)} />)}
    </div>
  );
}

function WeekView({ start, events, colors, open }: {
  readonly start: Date;
  readonly events: readonly GoogleCalendarEvent[];
  readonly colors: ReadonlyMap<string, string | undefined>;
  open(event: GoogleCalendarEvent): void;
}): React.JSX.Element {
  return (
    <div className="week-grid">
      {Array.from({ length: 7 }, (_, index) => {
        const day = addDays(start, index);
        const daily = events.filter((event) => eventOverlapsDay(event, day)).sort(sortEvents);
        return (
          <section key={toYmd(day)} className="calendar-day">
            <h3>{day.toLocaleDateString([], { weekday: "short", day: "numeric" })}</h3>
            {daily.map((event) => <EventCard key={`${event.calendarId}:${event.id}`} event={event} color={colors.get(event.calendarId)} open={() => open(event)} />)}
          </section>
        );
      })}
    </div>
  );
}

function MonthView({ anchor, events, colors, open }: {
  readonly anchor: Date;
  readonly events: readonly GoogleCalendarEvent[];
  readonly colors: ReadonlyMap<string, string | undefined>;
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
            {daily.slice(0, 3).map((event) => <EventCard key={`${event.calendarId}:${event.id}`} event={event} color={colors.get(event.calendarId)} open={() => open(event)} />)}
            {daily.length > 3 && <small>+{daily.length - 3} more</small>}
          </section>
        );
      })}
    </div>
  );
}

function AgendaView({ events, colors, open }: {
  readonly events: readonly GoogleCalendarEvent[];
  readonly colors: ReadonlyMap<string, string | undefined>;
  open(event: GoogleCalendarEvent): void;
}): React.JSX.Element {
  return (
    <ol className="agenda-list">
      {events.map((event) => (
        <li key={`${event.calendarId}:${event.id}`}>
          <time dateTime={event.start.dateTime ?? event.start.date}>{eventRangeLabel(event)}</time>
          <div>
            <EventCard event={event} color={colors.get(event.calendarId)} open={() => open(event)} />
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
  defaultCalendarId,
  driveAuthorized,
  createEvent,
  updateEvent,
  deleteEvent,
  getEvent,
  authorizeDrive,
  searchDrive,
  close
}: {
  readonly calendars: readonly GoogleCalendar[];
  readonly event: GoogleCalendarEvent | undefined;
  readonly defaultCalendarId: string;
  readonly driveAuthorized: boolean;
  createEvent(calendarId: string, input: CalendarEventInput): Promise<void>;
  updateEvent(event: GoogleCalendarEvent, input: CalendarEventInput): Promise<"updated" | "conflict">;
  deleteEvent(event: GoogleCalendarEvent): Promise<"deleted" | "conflict">;
  getEvent(calendarId: string, eventId: string): Promise<GoogleCalendarEvent>;
  authorizeDrive(): Promise<void>;
  searchDrive(query: string): Promise<GoogleDriveFile[]>;
  close(): void;
}): React.JSX.Element {
  const [editingEvent, setEditingEvent] = useState(event);
  const [scope, setScope] = useState<"instance" | "series">("instance");
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
  const [error, setError] = useState("");

  function loadDraft(source: GoogleCalendarEvent | undefined): void {
    setEditingEvent(source);
    setCalendarId(source?.calendarId ?? defaultCalendarId);
    setTitle(source?.summary ?? "");
    setDescription(source?.description ?? "");
    setLocation(source?.location ?? "");
    const sourceAllDay = Boolean(source?.start.date);
    setAllDay(sourceAllDay);
    setStart(sourceAllDay ? source?.start.date ?? toYmd(new Date()) : source?.start.dateTime ? toLocalDateTime(new Date(source.start.dateTime)) : localDateTime(30));
    setEnd(sourceAllDay ? toYmd(addDays(dateFromYmd(source?.end.date ?? source?.start.date ?? toYmd(new Date())), -1)) : source?.end.dateTime ? toLocalDateTime(new Date(source.end.dateTime)) : localDateTime(90));
    setTimeZone(source?.start.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
    setAttendeeText(source?.attendees?.map((attendee) => attendee.email).join(", ") ?? "");
    setMeet(Boolean(source?.conferenceData));
    setAttachments(source?.attachments ? [...source.attachments] : []);
    setRecurrence(parseRecurrence(source?.recurrence));
    setError("");
  }

  useEffect(() => {
    setScope("instance");
    loadDraft(event);
  }, [event?.id, defaultCalendarId]);

  async function changeScope(next: "instance" | "series"): Promise<void> {
    if (!event?.recurringEventId || next === scope) {
      return;
    }
    setError("");
    try {
      if (next === "series") {
        loadDraft(await getEvent(event.calendarId, event.recurringEventId));
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
      const baseInput = eventInputFromDraft(title, description, location, allDay, start, end, timeZone, recurrence, attendeeText, attachments, meet);
      const input = editingEvent?.recurrence && recurrence.frequency === "none"
        ? { ...baseInput, recurrence: [] }
        : baseInput;
      if (editingEvent) {
        const result = await updateEvent(editingEvent, input);
        if (result === "updated") {
          close();
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

  return (
    <div className="modal-backdrop" role="presentation">
      <form className="modal-card event-editor" onSubmit={(eventSubmit) => void submit(eventSubmit)} aria-labelledby="event-editor-heading">
        <div className="panel-heading">
          <div><p className="eyebrow">Google Calendar</p><h2 id="event-editor-heading">{editingEvent ? "Edit event" : "New event"}</h2></div>
          <button type="button" onClick={close}>Close</button>
        </div>
        {event?.recurringEventId && (
          <fieldset className="scope-choice">
            <legend>Apply changes to</legend>
            <label><input type="radio" checked={scope === "instance"} onChange={() => void changeScope("instance")} /> Only this occurrence</label>
            <label><input type="radio" checked={scope === "series"} onChange={() => void changeScope("series")} /> The entire series</label>
          </fieldset>
        )}
        <label>Title<input value={title} onChange={(eventInput) => setTitle(eventInput.target.value)} required /></label>
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
        <label>Attendees<input value={attendeeText} onChange={(eventInput) => setAttendeeText(eventInput.target.value)} placeholder="Emails separated by commas" /></label>
        <label className="check-label"><input type="checkbox" checked={meet} onChange={(eventInput) => setMeet(eventInput.target.checked)} /> Create a Google Meet link</label>
        <DriveAttachmentPicker
          authorized={driveAuthorized}
          authorize={authorizeDrive}
          search={searchDrive}
          addAttachment={(attachment) => setAttachments((current) => current.some((item) => item.fileUrl === attachment.fileUrl) ? current : [...current, attachment])}
        />
        {attachments.length > 0 && <ul className="selected-attachments">{attachments.map((attachment) => <li key={attachment.fileUrl}>{attachment.title ?? attachment.fileUrl}<button type="button" onClick={() => setAttachments((current) => current.filter((item) => item.fileUrl !== attachment.fileUrl))}>Remove</button></li>)}</ul>}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="button-row"><button type="submit">{editingEvent ? "Save event" : "Create event"}</button>{editingEvent && <button type="button" className="danger-button" onClick={() => void remove()}>Delete event</button>}</div>
      </form>
    </div>
  );
}

function ConflictDialog({ conflict, resolve, dismiss }: {
  readonly conflict: EventConflict;
  resolve(resolution: "keep-local" | "use-google"): Promise<void>;
  dismiss(): void;
}): React.JSX.Element {
  const isDelete = conflict.kind === "delete";
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-card conflict-card" role="dialog" aria-modal="true" aria-labelledby="conflict-heading">
        <p className="eyebrow">Google Calendar</p>
        <h2 id="conflict-heading">This event changed in Google</h2>
        <p>{isDelete ? "Someone changed this event before you deleted it." : "Someone changed this event while you were editing it."}</p>
        <p><strong>Google now has:</strong> {conflict.latest.summary} — {eventRangeLabel(conflict.latest)}</p>
        <p>{isDelete ? "Delete it anyway, or keep the Google version?" : "Use your changes to update Google, or discard them and use the Google version?"}</p>
        <div className="button-row"><button type="button" onClick={() => void resolve("keep-local")}>{isDelete ? "Delete it anyway" : "Use my changes"}</button><button type="button" onClick={() => void resolve("use-google")}>Use Google version</button><button type="button" onClick={dismiss}>Not now</button></div>
      </section>
    </div>
  );
}

export function CalendarPanel({
  calendars,
  events,
  search,
  driveAuthorized,
  eventConflict,
  createEvent,
  updateEvent,
  deleteEvent,
  getEvent,
  loadCalendarRange,
  resolveEventConflict,
  dismissEventConflict,
  authorizeDrive,
  searchDrive
}: CalendarPanelProps): React.JSX.Element {
  const [view, setView] = useState<CalendarView>("week");
  const [anchor, setAnchor] = useState(() => new Date());
  const [selectedCalendarIds, setSelectedCalendarIds] = useState<string[]>([]);
  const [editingEvent, setEditingEvent] = useState<GoogleCalendarEvent | undefined>();
  const [composerOpen, setComposerOpen] = useState(false);
  const [error, setError] = useState("");
  const defaultCalendarId = calendars.find((calendar) => calendar.primary)?.id ?? calendars[0]?.id ?? "";
  const range = useMemo(() => viewRange(anchor, view), [anchor, view]);

  useEffect(() => {
    setSelectedCalendarIds((current) => {
      const available = current.filter((id) => calendars.some((calendar) => calendar.id === id));
      return available.length > 0 ? available : defaultCalendarId ? [defaultCalendarId] : [];
    });
  }, [calendars, defaultCalendarId]);

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

  function changeAnchor(direction: number): void {
    const multiplier = view === "day" ? 1 : view === "week" ? 7 : view === "month" ? 31 : 30;
    setAnchor((current) => addDays(current, direction * multiplier));
  }

  function toggleCalendar(calendarId: string): void {
    setSelectedCalendarIds((current) => current.includes(calendarId) ? current.filter((id) => id !== calendarId) : [...current, calendarId]);
  }

  function openEvent(event: GoogleCalendarEvent): void {
    setComposerOpen(false);
    setEditingEvent(event);
  }

  function closeEditor(): void {
    setEditingEvent(undefined);
    setComposerOpen(false);
  }

  return (
    <section className="workspace-panel calendar-panel" aria-labelledby="calendar-heading">
      <div className="panel-heading">
        <div><p className="eyebrow">Google Calendar</p><h2 id="calendar-heading">Calendar</h2></div>
        <button type="button" disabled={!defaultCalendarId} onClick={() => { setEditingEvent(undefined); setComposerOpen(true); }}>New event</button>
      </div>
      {calendars.length === 0 ? <p className="empty-state">No Google Calendars were found.</p> : (
        <>
          <div className="calendar-controls">
            <div className="button-row"><button type="button" onClick={() => changeAnchor(-1)}>Previous</button><button type="button" onClick={() => setAnchor(new Date())}>Today</button><button type="button" onClick={() => changeAnchor(1)}>Next</button></div>
            <div className="view-switcher" role="group" aria-label="Calendar view">{(["day", "week", "month", "agenda"] as const).map((candidate) => <button key={candidate} type="button" className={view === candidate ? "active" : ""} onClick={() => setView(candidate)}>{candidate[0].toUpperCase()}{candidate.slice(1)}</button>)}</div>
          </div>
          <fieldset className="calendar-sources"><legend>Show calendars</legend>{calendars.map((calendar) => <label key={calendar.id}><input type="checkbox" checked={selectedCalendarIds.includes(calendar.id)} onChange={() => toggleCalendar(calendar.id)} /> <span className="calendar-swatch" style={{ backgroundColor: calendar.backgroundColor }} /> {calendar.summary}</label>)}</fieldset>
          <p className="calendar-range-label">{view === "month" ? anchor.toLocaleDateString([], { month: "long", year: "numeric" }) : `${range.start.toLocaleDateString()} – ${addDays(range.end, -1).toLocaleDateString()}`}</p>
          {error && <p className="error" role="alert">{error}</p>}
          {view === "day" && <DayView day={range.start} events={visibleEvents} colors={colors} open={openEvent} />}
          {view === "week" && <WeekView start={range.start} events={visibleEvents} colors={colors} open={openEvent} />}
          {view === "month" && <MonthView anchor={anchor} events={visibleEvents} colors={colors} open={openEvent} />}
          {view === "agenda" && (visibleEvents.length > 0 ? <AgendaView events={visibleEvents} colors={colors} open={openEvent} /> : <p className="empty-state">No events in this range.</p>)}
        </>
      )}
      {(composerOpen || editingEvent) && <EventEditor calendars={calendars} event={editingEvent} defaultCalendarId={defaultCalendarId} driveAuthorized={driveAuthorized} createEvent={createEvent} updateEvent={updateEvent} deleteEvent={deleteEvent} getEvent={getEvent} authorizeDrive={authorizeDrive} searchDrive={searchDrive} close={closeEditor} />}
      {eventConflict && <ConflictDialog conflict={eventConflict} resolve={async (resolution) => { try { await resolveEventConflict(resolution); closeEditor(); } catch (reason) { setError(reason instanceof Error ? reason.message : "The conflict could not be resolved"); } }} dismiss={dismissEventConflict} />}
    </section>
  );
}
