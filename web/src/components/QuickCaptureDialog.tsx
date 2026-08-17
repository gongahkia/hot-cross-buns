import { useMemo, useRef, useState } from "react";

import { ModalDialog } from "@/components/ModalDialog";
import { parseQuickCapture } from "@/features/quickCapture";
import { serializeTaskRecurrenceNotes } from "@/features/taskRecurrence";
import type { CalendarEventInput, GoogleCalendar, GoogleTask, GoogleTaskList, QuickCapturePreferences, TaskMetadata } from "@/types";

interface QuickCaptureDialogProps {
  readonly taskLists: readonly GoogleTaskList[];
  readonly calendars: readonly GoogleCalendar[];
  readonly preferences: QuickCapturePreferences;
  createTask(listId: string, input: { readonly title: string; readonly notes?: string; readonly due?: string }): Promise<GoogleTask>;
  createEvent(calendarId: string, input: CalendarEventInput): Promise<void>;
  saveTaskMetadata(taskId: string, update: Pick<TaskMetadata, "priority" | "dueTimeZone">): Promise<void>;
  close(): void;
}

function dateTime(date: string, time: string): string {
  return new Date(`${date}T${time}`).toISOString();
}

export function QuickCaptureDialog({ taskLists, calendars, preferences, createTask, createEvent, saveTaskMetadata, close }: QuickCaptureDialogProps): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [kind, setKind] = useState<"task" | "event">("task");
  const [disabled, setDisabled] = useState<readonly string[]>([]);
  const [taskListId, setTaskListId] = useState(preferences.defaultTaskListId ?? taskLists[0]?.id ?? "");
  const [calendarId, setCalendarId] = useState(preferences.defaultCalendarId ?? calendars.find((calendar) => calendar.primary)?.id ?? calendars[0]?.id ?? "");
  const [error, setError] = useState("");
  const parsed = useMemo(() => parseQuickCapture(text, kind, preferences, disabled), [disabled, kind, preferences, text]);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError("");
    try {
      if (!parsed.parsedTitle) throw new Error("Enter a title after reviewing the recognized text");
      if (parsed.kind === "task") {
        if (!taskListId) throw new Error("Choose a Google Task list");
        let notes: string | undefined;
        if (parsed.recurrence && parsed.date) {
          const seriesId = crypto.randomUUID();
          const serialized = serializeTaskRecurrenceNotes("", {
            seriesId,
            occurrenceId: `${seriesId}:0`,
            ordinal: 0,
            frequency: parsed.recurrence.frequency,
            interval: parsed.recurrence.interval,
            anchorDate: parsed.date,
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            end: { kind: "never" },
            recurrenceRule: "",
            exclusionDates: [],
            additionDates: [],
            templateTitle: parsed.parsedTitle,
            templateDueDate: parsed.date,
            templatePriority: parsed.taskPriority
          });
          if (!serialized.notes) throw new Error(serialized.error ?? "Could not create the recurrence marker");
          notes = serialized.notes;
        }
        const task = await createTask(taskListId, { title: parsed.parsedTitle, notes, due: parsed.date ? `${parsed.date}T12:00:00.000Z` : undefined });
        await saveTaskMetadata(task.id, { priority: parsed.taskPriority, dueTimeZone: parsed.date ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined });
      } else {
        if (!calendarId) throw new Error("Choose a Calendar");
        if (!parsed.eventReady || !parsed.date) throw new Error("Choose a date for this event");
        const start = parsed.time ? dateTime(parsed.date, parsed.time) : undefined;
        const end = start ? new Date(new Date(start).getTime() + parsed.eventDurationMinutes * 60_000).toISOString() : undefined;
        const allDayEnd = new Date(`${parsed.date}T00:00:00`);
        allDayEnd.setDate(allDayEnd.getDate() + 1);
        await createEvent(calendarId, {
          summary: parsed.parsedTitle,
          start: start ? { dateTime: start, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone } : { date: parsed.date },
          end: end ? { dateTime: end, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone } : { date: `${allDayEnd.getFullYear()}-${String(allDayEnd.getMonth() + 1).padStart(2, "0")}-${String(allDayEnd.getDate()).padStart(2, "0")}` },
          recurrence: parsed.recurrence ? [parsed.recurrence.rrule] : undefined
        });
      }
      close();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Quick capture could not be saved");
    }
  }

  return (
    <ModalDialog className="quick-capture" labelledBy="quick-capture-heading" initialFocusRef={inputRef} onClose={close}>
      <form onSubmit={(event) => void submit(event)}>
        <div className="panel-heading"><div><p className="eyebrow">Planner</p><h2 id="quick-capture-heading">Quick capture</h2></div><button type="button" onClick={close}>Close</button></div>
        <label>Capture text<input ref={inputRef} value={text} onChange={(event) => { setText(event.target.value); setDisabled([]); }} placeholder="Team sync tomorrow at 9am for 45m" /></label>
        <label>Kind<select value={kind} onChange={(event) => setKind(event.target.value as "task" | "event")}><option value="task">Task</option><option value="event">Event</option></select></label>
        {parsed.kind === "task" ? <label>Task list<select value={taskListId} onChange={(event) => setTaskListId(event.target.value)}>{taskLists.map((list) => <option key={list.id} value={list.id}>{list.title}</option>)}</select></label> : <label>Calendar<select value={calendarId} onChange={(event) => setCalendarId(event.target.value)}>{calendars.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.summary}</option>)}</select></label>}
        <p className="field-help">Preview only: click a chip to keep that recognition in the title.</p>
        <div className="recognition-chips">{parsed.recognitions.map((recognition) => <button key={recognition.id} type="button" disabled={!recognition.removable} onClick={() => setDisabled((current) => [...current, recognition.id])}>{recognition.label}{recognition.removable ? " ×" : ""}</button>)}</div>
        <dl className="capture-preview"><div><dt>Title</dt><dd>{parsed.parsedTitle || "—"}</dd></div><div><dt>When</dt><dd>{parsed.date ? `${parsed.date}${parsed.time ? ` ${parsed.time}` : " all day"}` : "No date recognized"}</dd></div>{parsed.recurrence && <div><dt>Repeat</dt><dd>{parsed.recurrence.rrule}</dd></div>}</dl>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="button-row"><button type="submit">Create {parsed.kind}</button></div>
      </form>
    </ModalDialog>
  );
}
