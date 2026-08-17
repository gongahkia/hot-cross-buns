import { useEffect, useRef, useState } from "react";

import { ModalDialog } from "@/components/ModalDialog";
import type { ImportPreview, ImportedEvent, ImportedTask } from "@/features/importParser";
import { serializeTaskRecurrenceNotes } from "@/features/taskRecurrence";
import type { CalendarEventInput, GoogleCalendar, GoogleTask, GoogleTaskList, TaskMetadata } from "@/types";

interface ImportDialogProps {
  readonly taskLists: readonly GoogleTaskList[];
  readonly calendars: readonly GoogleCalendar[];
  createTask(listId: string, input: { readonly title: string; readonly notes?: string; readonly due?: string }): Promise<GoogleTask>;
  createEvent(calendarId: string, input: CalendarEventInput): Promise<void>;
  saveTaskMetadata(taskId: string, update: Pick<TaskMetadata, "priority" | "dueTimeZone">): Promise<void>;
  readonly initialFile?: File;
  close(): void;
}

function calendarInput(record: ImportedEvent): CalendarEventInput {
  return {
    summary: record.title,
    description: record.description,
    location: record.location,
    start: record.allDay ? { date: record.start } : { dateTime: record.start, timeZone: record.timeZone },
    end: record.allDay ? { date: record.end } : { dateTime: record.end, timeZone: record.timeZone },
    recurrence: record.recurrence
  };
}

function taskInput(record: ImportedTask): { readonly title: string; readonly notes?: string; readonly due?: string } {
  if (!record.rrule || !record.due) return { title: record.title, notes: record.notes, due: record.due ? `${record.due}T12:00:00.000Z` : undefined };
  const frequency = /FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)/.exec(record.rrule)?.[1]?.toLowerCase() as "daily" | "weekly" | "monthly" | "yearly" | undefined;
  const interval = Number(/INTERVAL=(\d+)/.exec(record.rrule)?.[1] ?? "1");
  if (!frequency) throw new Error(`Task “${record.title}” has an unsupported recurrence rule`);
  const seriesId = crypto.randomUUID();
  const serialized = serializeTaskRecurrenceNotes(record.notes ?? "", {
    seriesId,
    occurrenceId: `${seriesId}:0`,
    ordinal: 0,
    frequency,
    interval,
    anchorDate: record.due,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    end: record.until ? { kind: "until", untilDate: record.until } : record.count ? { kind: "count", count: record.count } : { kind: "never" },
    recurrenceRule: record.rrule.replace(/^RRULE:/, ""),
    exclusionDates: record.exclude,
    additionDates: record.include,
    templateTitle: record.title,
    templateDueDate: record.due,
    templatePriority: record.priority
  });
  if (!serialized.notes) throw new Error(serialized.error ?? "Could not save imported recurrence");
  return { title: record.title, notes: serialized.notes, due: `${record.due}T12:00:00.000Z` };
}

export function ImportDialog({ taskLists, calendars, createTask, createEvent, saveTaskMetadata, initialFile, close }: ImportDialogProps): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | undefined>(undefined);
  const requestRef = useRef(0);
  const [preview, setPreview] = useState<ImportPreview>();
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");

  useEffect(() => {
    const worker = new Worker(new URL("../workers/importWorker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<{ readonly id: number; readonly preview: ImportPreview }>) => {
      if (event.data.id === requestRef.current) setPreview(event.data.preview);
    };
    return () => worker.terminate();
  }, []);

  async function load(file: File | undefined): Promise<void> {
    if (!file) return;
    setError("");
    setProgress(`Reading ${file.name}…`);
    if (file.size > 5 * 1024 * 1024) { setError("Import source exceeds 5 MiB"); setProgress(""); return; }
    const text = await file.text();
    const id = requestRef.current + 1;
    requestRef.current = id;
    workerRef.current?.postMessage({ id, name: file.name, text });
    setProgress("Parsing in a browser worker…");
  }

  useEffect(() => {
    if (initialFile) void load(initialFile);
  }, [initialFile]);

  async function commit(): Promise<void> {
    const records = preview?.rows.flatMap((row) => row.record ? [row.record] : []) ?? [];
    if (records.length === 0) return;
    setError("");
    let succeeded = 0;
    const failed: string[] = [];
    for (const record of records) {
      try {
        if (record.kind === "task") {
          const list = taskLists.find((candidate) => candidate.id === record.list || candidate.title.localeCompare(record.list ?? "", undefined, { sensitivity: "accent" }) === 0) ?? taskLists[0];
          if (!list) throw new Error("No Google Task list is available");
          const task = await createTask(list.id, taskInput(record));
          await saveTaskMetadata(task.id, { priority: record.priority, dueTimeZone: record.due ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined });
        } else {
          const calendar = calendars.find((candidate) => candidate.id === record.calendar || candidate.summary.localeCompare(record.calendar ?? "", undefined, { sensitivity: "accent" }) === 0) ?? calendars.find((candidate) => candidate.primary) ?? calendars[0];
          if (!calendar) throw new Error("No Google Calendar is available");
          await createEvent(calendar.id, calendarInput(record));
        }
        succeeded += 1;
      } catch (reason) {
        failed.push(reason instanceof Error ? reason.message : "Unknown import error");
      }
      setProgress(`${succeeded + failed.length} of ${records.length} records committed…`);
    }
    setProgress(`${succeeded} committed${failed.length ? `; ${failed.length} failed` : ""}`);
    if (failed.length) setError(failed.join(" · "));
  }

  return <ModalDialog className="import-dialog" labelledBy="import-heading" initialFocusRef={inputRef} onClose={close}>
    <div className="panel-heading"><div><p className="eyebrow">Browser-local import</p><h2 id="import-heading">Import tasks and events</h2></div><button type="button" onClick={close}>Close</button></div>
    <p className="field-help">Choose or drop UTF-8 delimited text, the documented CSV schema, or iCalendar (.ics). Files stay in this browser and every record is previewed before a mutation is queued.</p>
    <div className="import-drop" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void load(event.dataTransfer.files[0]); }}><input ref={inputRef} aria-label="Import file" type="file" accept=".txt,.hcb,.csv,.ics,.ical,text/plain,text/csv,text/calendar" onChange={(event) => void load(event.target.files?.[0])} /><span>Drag a file here or use the picker (5 MiB / 1,000 records maximum).</span></div>
    {progress && <p className="status" role="status">{progress}</p>}
    {preview && <section className="import-preview"><h3>Preview</h3>{preview.errors.map((message) => <p key={message} className="error">{message}</p>)}<ul>{preview.rows.map((row) => <li key={row.line} className={row.errors.length ? "error" : ""}><strong>Line {row.line}</strong> {row.record ? `${row.record.kind}: ${row.record.title}` : row.errors.join(" · ")}{row.warnings.length > 0 && <small> Warning: {row.warnings.join(" · ")}</small>}</li>)}</ul><div className="button-row"><button type="button" disabled={preview.rows.every((row) => !row.record)} onClick={() => void commit()}>Commit accepted records</button></div></section>}
    {error && <p className="error" role="alert">{error}</p>}
  </ModalDialog>;
}
