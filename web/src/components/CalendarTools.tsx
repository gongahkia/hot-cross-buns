import { useEffect, useMemo, useRef, useState } from "react";

import { ConfirmationDialog } from "@/components/ConfirmationDialog";
import { LoadingState } from "@/components/LoadingState";
import { ModalDialog } from "@/components/ModalDialog";
import type {
  CalendarInput,
  GoogleCalendar,
  GoogleFreeBusyInterval,
  GoogleFreeBusyResponse
} from "@/types";

export interface AvailabilitySlot {
  readonly start: string;
  readonly end: string;
}

interface CalendarManagerDialogProps {
  readonly calendars: readonly GoogleCalendar[];
  createCalendar(input: CalendarInput): Promise<void>;
  subscribeCalendar(calendarId: string): Promise<void>;
  removeCalendarFromList(calendar: GoogleCalendar): Promise<void>;
  close(): void;
}

interface AvailabilityAssistantProps {
  readonly calendars: readonly GoogleCalendar[];
  readonly defaultCalendarIds: readonly string[];
  queryAvailability(calendarIds: readonly string[], timeMin: string, timeMax: string): Promise<GoogleFreeBusyResponse>;
  useSlot(slot: AvailabilitySlot): void;
  close(): void;
}

const timeZones = typeof Intl.supportedValuesOf === "function"
  ? Intl.supportedValuesOf("timeZone")
  : [Intl.DateTimeFormat().resolvedOptions().timeZone];

function localDateTime(value: Date): string {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
}

function defaultAvailabilityRange(): { readonly start: string; readonly end: string } {
  const start = new Date();
  start.setMinutes(Math.ceil(start.getMinutes() / 30) * 30, 0, 0);
  start.setDate(start.getDate() + 1);
  start.setHours(9, 0, 0, 0);
  const end = new Date(start);
  end.setHours(17, 0, 0, 0);
  return { start: localDateTime(start), end: localDateTime(end) };
}

function mergeBusyIntervals(intervals: readonly GoogleFreeBusyInterval[], start: number, end: number): Array<{ start: number; end: number }> {
  const ordered = intervals
    .map((interval) => ({ start: new Date(interval.start).getTime(), end: new Date(interval.end).getTime() }))
    .filter((interval) => Number.isFinite(interval.start) && Number.isFinite(interval.end) && interval.end > start && interval.start < end)
    .map((interval) => ({ start: Math.max(start, interval.start), end: Math.min(end, interval.end) }))
    .sort((left, right) => left.start - right.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const interval of ordered) {
    const previous = merged.at(-1);
    if (!previous || interval.start > previous.end) {
      merged.push(interval);
    } else {
      previous.end = Math.max(previous.end, interval.end);
    }
  }
  return merged;
}

function roundUpToThirtyMinutes(value: number): number {
  const increment = 30 * 60_000;
  return Math.ceil(value / increment) * increment;
}

export function findFreeSlots(
  response: GoogleFreeBusyResponse,
  calendarIds: readonly string[],
  durationMinutes: number,
  limit = 12
): AvailabilitySlot[] {
  const start = new Date(response.timeMin).getTime();
  const end = new Date(response.timeMax).getTime();
  const duration = durationMinutes * 60_000;
  if (!Number.isFinite(start) || !Number.isFinite(end) || duration <= 0 || end <= start) {
    return [];
  }
  const intervals = calendarIds.flatMap((calendarId) => response.calendars[calendarId]?.busy ?? []);
  const busy = mergeBusyIntervals(intervals, start, end);
  const slots: AvailabilitySlot[] = [];
  const addSlots = (availableStart: number, availableEnd: number): void => {
    for (let candidate = roundUpToThirtyMinutes(availableStart); candidate + duration <= availableEnd && slots.length < limit; candidate += 30 * 60_000) {
      slots.push({ start: new Date(candidate).toISOString(), end: new Date(candidate + duration).toISOString() });
    }
  };
  let cursor = start;
  for (const interval of busy) {
    addSlots(cursor, interval.start);
    cursor = Math.max(cursor, interval.end);
    if (slots.length >= limit) {
      return slots;
    }
  }
  addSlots(cursor, end);
  return slots;
}

export function CalendarManagerDialog({
  calendars,
  createCalendar,
  subscribeCalendar,
  removeCalendarFromList,
  close
}: CalendarManagerDialogProps): React.JSX.Element {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [timeZone, setTimeZone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [calendarId, setCalendarId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [removalCandidate, setRemovalCandidate] = useState<GoogleCalendar>();
  const titleRef = useRef<HTMLInputElement>(null);

  async function create(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError("");
    setMessage("");
    setBusy(true);
    try {
      await createCalendar({ summary: title, description, timeZone });
      setTitle("");
      setDescription("");
      setMessage("Calendar created and added to your Google Calendar list.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Calendar could not be created");
    } finally {
      setBusy(false);
    }
  }

  async function subscribe(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError("");
    setMessage("");
    setBusy(true);
    try {
      await subscribeCalendar(calendarId);
      setCalendarId("");
      setMessage("Calendar added to your Google Calendar list.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Calendar could not be added");
    } finally {
      setBusy(false);
    }
  }

  async function remove(calendar: GoogleCalendar): Promise<void> {
    setError("");
    setMessage("");
    setBusy(true);
    try {
      await removeCalendarFromList(calendar);
      setMessage("Calendar removed from your Google Calendar list. Its data was not deleted.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Calendar could not be removed");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <ModalDialog className="calendar-manager" labelledBy="calendar-manager-heading" initialFocusRef={titleRef} onClose={close}>
        <div className="panel-heading"><div><p className="eyebrow">Google Calendar</p><h2 id="calendar-manager-heading">Manage calendars</h2></div><button type="button" onClick={close}>Close</button></div>
        <form onSubmit={(event) => void create(event)}>
          <h3>Create a new calendar</h3>
          <label>Name<input ref={titleRef} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Team planning" required /></label>
          <label>Description<textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={2} /></label>
          <label>Time zone<select value={timeZone} onChange={(event) => setTimeZone(event.target.value)}>{timeZones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}</select></label>
          <button type="submit" disabled={busy}>Create calendar</button>
        </form>
        <form onSubmit={(event) => void subscribe(event)}>
          <h3>Add an existing calendar</h3>
          <label>Google Calendar ID<input value={calendarId} onChange={(event) => setCalendarId(event.target.value)} placeholder="calendar-id@group.calendar.google.com" required /></label>
          <p className="field-help">You need access to this calendar already. The app does not change its sharing permissions.</p>
          <button type="submit" disabled={busy}>Add calendar</button>
        </form>
        <section>
          <h3>Calendars you can remove from this list</h3>
          <ul className="calendar-management-list">
            {calendars.filter((calendar) => !calendar.primary && calendar.accessRole !== "owner").map((calendar) => (
              <li key={calendar.id}><span>{calendar.summary}</span><button type="button" className="danger-button" disabled={busy} onClick={() => setRemovalCandidate(calendar)}>Remove from list</button></li>
            ))}
          </ul>
          {calendars.every((calendar) => calendar.primary || calendar.accessRole === "owner") && <p className="field-help">No subscribed calendars can be removed here. Owner and primary calendars stay protected.</p>}
        </section>
        {error && <p className="error" role="alert">{error}</p>}
        {message && <p className="status" role="status">{message}</p>}
    </ModalDialog>
    {removalCandidate && <ConfirmationDialog title={`Remove “${removalCandidate.summary}” from this list?`} description="This does not delete its events or the calendar itself." confirmLabel="Remove calendar" destructive close={() => setRemovalCandidate(undefined)} confirm={() => remove(removalCandidate)} />}
  </>;
}

export function AvailabilityAssistant({
  calendars,
  defaultCalendarIds,
  queryAvailability,
  useSlot,
  close
}: AvailabilityAssistantProps): React.JSX.Element {
  const initial = useMemo(defaultAvailabilityRange, []);
  const [calendarIds, setCalendarIds] = useState<string[]>([...defaultCalendarIds]);
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [duration, setDuration] = useState("30");
  const [slots, setSlots] = useState<AvailabilitySlot[]>([]);
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const startRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setCalendarIds((current) => {
      const available = current.filter((id) => calendars.some((calendar) => calendar.id === id));
      return available.length > 0 ? available : [...defaultCalendarIds];
    });
  }, [calendars, defaultCalendarIds]);

  function toggleCalendar(calendarId: string): void {
    setCalendarIds((current) => current.includes(calendarId) ? current.filter((id) => id !== calendarId) : [...current, calendarId]);
  }

  async function find(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const startDate = new Date(start);
    const endDate = new Date(end);
    const minutes = Number(duration);
    if (!calendarIds.length) {
      setError("Choose at least one calendar");
      return;
    }
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate <= startDate) {
      setError("Choose an end time after the start time");
      return;
    }
    setError("");
    setSlots([]);
    setUnavailable([]);
    setBusy(true);
    try {
      const response = await queryAvailability(calendarIds, startDate.toISOString(), endDate.toISOString());
      setSlots(findFreeSlots(response, calendarIds, minutes));
      setUnavailable(calendarIds.filter((id) => (response.calendars[id]?.errors?.length ?? 0) > 0));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Availability could not be checked");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalDialog className="availability-assistant" labelledBy="availability-heading" initialFocusRef={startRef} onClose={close}>
        <div className="panel-heading"><div><p className="eyebrow">Google Calendar</p><h2 id="availability-heading">Find a free time</h2></div><button type="button" onClick={close}>Close</button></div>
        <p className="field-help">This checks only the calendars you select below. It does not expose event titles or invitee schedules.</p>
        <form onSubmit={(event) => void find(event)}>
          <fieldset className="calendar-sources"><legend>Check calendars</legend>{calendars.map((calendar) => <label key={calendar.id}><input type="checkbox" checked={calendarIds.includes(calendar.id)} onChange={() => toggleCalendar(calendar.id)} /> {calendar.summary}</label>)}</fieldset>
          <div className="event-time-fields"><label>From<input ref={startRef} type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} required /></label><label>Until<input type="datetime-local" value={end} onChange={(event) => setEnd(event.target.value)} required /></label><label>Length<select value={duration} onChange={(event) => setDuration(event.target.value)}><option value="30">30 minutes</option><option value="45">45 minutes</option><option value="60">1 hour</option><option value="90">90 minutes</option></select></label></div>
          <button type="submit" disabled={busy}>Find times</button>
        </form>
        {busy && <LoadingState label="Checking availability" variant="Dots" className="inline-loader" />}
        {error && <p className="error" role="alert">{error}</p>}
        {unavailable.length > 0 && <p className="field-help">Google could not check: {unavailable.map((id) => calendars.find((calendar) => calendar.id === id)?.summary ?? id).join(", ")}.</p>}
        {slots.length > 0 && <ol className="availability-slots">{slots.map((slot) => <li key={slot.start}><time>{new Date(slot.start).toLocaleString()} – {new Date(slot.end).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time><button type="button" onClick={() => useSlot(slot)}>Use this time</button></li>)}</ol>}
        {!busy && !error && slots.length === 0 && <p className="field-help">Choose a range and select Find times to see openings.</p>}
    </ModalDialog>
  );
}
