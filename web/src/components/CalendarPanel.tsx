import { useEffect, useMemo, useState } from "react";

import { DriveAttachmentPicker } from "@/components/DriveAttachmentPicker";
import type {
  CalendarEventInput,
  GoogleCalendar,
  GoogleCalendarEvent,
  GoogleDriveFile,
  GoogleEventAttachment
} from "@/types";

interface CalendarPanelProps {
  readonly calendars: readonly GoogleCalendar[];
  readonly events: readonly GoogleCalendarEvent[];
  readonly search: string;
  readonly driveAuthorized: boolean;
  createEvent(calendarId: string, event: CalendarEventInput): Promise<void>;
  authorizeDrive(): Promise<void>;
  searchDrive(query: string): Promise<GoogleDriveFile[]>;
}

function localDateTime(minutesFromNow: number): string {
  const date = new Date(Date.now() + minutesFromNow * 60_000);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function eventStart(event: GoogleCalendarEvent): Date {
  return new Date(event.start.dateTime ?? `${event.start.date ?? "1970-01-01"}T00:00:00`);
}

export function CalendarPanel({
  calendars,
  events,
  search,
  driveAuthorized,
  createEvent,
  authorizeDrive,
  searchDrive
}: CalendarPanelProps): React.JSX.Element {
  const [selectedCalendarId, setSelectedCalendarId] = useState("");
  const [title, setTitle] = useState("");
  const [start, setStart] = useState(() => localDateTime(30));
  const [end, setEnd] = useState(() => localDateTime(90));
  const [description, setDescription] = useState("");
  const [attendeeText, setAttendeeText] = useState("");
  const [meet, setMeet] = useState(false);
  const [attachments, setAttachments] = useState<GoogleEventAttachment[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!calendars.some((calendar) => calendar.id === selectedCalendarId)) {
      setSelectedCalendarId(calendars.find((calendar) => calendar.primary)?.id ?? calendars[0]?.id ?? "");
    }
  }, [calendars, selectedCalendarId]);

  const visibleEvents = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return events
      .filter((event) => event.calendarId === selectedCalendarId)
      .filter((event) => !query || `${event.summary} ${event.description ?? ""}`.toLocaleLowerCase().includes(query))
      .sort((left, right) => eventStart(left).getTime() - eventStart(right).getTime());
  }, [events, search, selectedCalendarId]);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedCalendarId || !title.trim()) {
      return;
    }
    const startDate = new Date(start);
    const endDate = new Date(end);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate <= startDate) {
      setError("Choose an end time after the start time");
      return;
    }
    const attendees = attendeeText
      .split(/[\s,;]+/)
      .map((email) => email.trim())
      .filter(Boolean)
      .map((email) => ({ email }));
    setError("");
    try {
      await createEvent(selectedCalendarId, {
        summary: title.trim(),
        description: description.trim() || undefined,
        start: { dateTime: startDate.toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
        end: { dateTime: endDate.toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
        attendees: attendees.length > 0 ? attendees : undefined,
        attachments: attachments.length > 0 ? attachments : undefined,
        createGoogleMeet: meet
      });
      setTitle("");
      setDescription("");
      setAttendeeText("");
      setAttachments([]);
      setMeet(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Event could not be saved");
    }
  }

  return (
    <section className="workspace-panel" aria-labelledby="calendar-heading">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Google Calendar</p>
          <h2 id="calendar-heading">Agenda</h2>
        </div>
        <label className="compact-field">
          <span>Calendar</span>
          <select value={selectedCalendarId} onChange={(event) => setSelectedCalendarId(event.target.value)}>
            {calendars.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.summary}</option>)}
          </select>
        </label>
      </div>
      {calendars.length === 0 ? (
        <p className="empty-state">No Google Calendars were found.</p>
      ) : (
        <>
          <form className="event-form" onSubmit={(event) => void submit(event)}>
            <input aria-label="Event title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Event title" required />
            <label>
              Starts
              <input type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} required />
            </label>
            <label>
              Ends
              <input type="datetime-local" value={end} onChange={(event) => setEnd(event.target.value)} required />
            </label>
            <input aria-label="Event description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Description" />
            <input aria-label="Attendee email addresses" value={attendeeText} onChange={(event) => setAttendeeText(event.target.value)} placeholder="Attendees, separated by commas" />
            <label className="check-label"><input type="checkbox" checked={meet} onChange={(event) => setMeet(event.target.checked)} /> Create Google Meet</label>
            <DriveAttachmentPicker
              authorized={driveAuthorized}
              authorize={authorizeDrive}
              search={searchDrive}
              addAttachment={(attachment) => setAttachments((current) => current.some((item) => item.fileUrl === attachment.fileUrl) ? current : [...current, attachment])}
            />
            {attachments.length > 0 && (
              <ul className="selected-attachments">
                {attachments.map((attachment) => (
                  <li key={attachment.fileUrl}>
                    {attachment.title ?? attachment.fileUrl}
                    <button type="button" onClick={() => setAttachments((current) => current.filter((item) => item.fileUrl !== attachment.fileUrl))}>Remove</button>
                  </li>
                ))}
              </ul>
            )}
            {error && <p className="error" role="alert">{error}</p>}
            <button type="submit">Create event</button>
          </form>
          <ol className="agenda-list">
            {visibleEvents.map((event) => (
              <li key={event.id}>
                <time dateTime={event.start.dateTime ?? event.start.date}>{event.start.date ? event.start.date : eventStart(event).toLocaleString()}</time>
                <div>
                  <strong>{event.summary}</strong>
                  {event.description && <p>{event.description}</p>}
                  {event.attendees && <small>{event.attendees.length} attendee{event.attendees.length === 1 ? "" : "s"}</small>}
                  {event.attachments && <small>{event.attachments.length} Drive attachment{event.attachments.length === 1 ? "" : "s"}</small>}
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
