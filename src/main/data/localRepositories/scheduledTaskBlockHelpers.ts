import type { SqliteWriteOperation } from "../sqliteConnection";
import type { TaskRow } from "./types";
import { validationFailure } from "./shared";

export function scheduledTaskBlockInsertOperation(input: {
  id: string;
  taskId: string;
  calendarEventId: string;
  calendarId: string;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  now: string;
}): SqliteWriteOperation {
  return {
    kind: "run",
    sql: `INSERT INTO local_scheduled_task_blocks (
      id, task_id, calendar_event_id, calendar_id, planned_start_at, planned_end_at,
      duration_minutes, status, created_at, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, NULL);`,
    params: [
      input.id,
      input.taskId,
      input.calendarEventId,
      input.calendarId,
      input.startsAt,
      input.endsAt,
      input.durationMinutes,
      input.now,
      input.now
    ]
  };
}

export function scheduledTaskNotes(task: TaskRow): string {
  const notes = task.notes?.trim();
  const marker = `Hot Cross Buns scheduled task: ${task.id}`;

  return notes ? `${notes}\n\n${marker}` : marker;
}

export function addMinutesIso(startsAt: string, durationMinutes: number): string {
  const startMs = Date.parse(startsAt);

  if (!Number.isFinite(startMs)) {
    throw validationFailure("Scheduled task start must be a valid date-time.");
  }

  const endMs = startMs + durationMinutes * 60 * 1000;

  if (!Number.isFinite(endMs) || endMs <= startMs) {
    throw validationFailure("Scheduled task duration must produce a valid end time.");
  }

  return new Date(endMs).toISOString();
}
