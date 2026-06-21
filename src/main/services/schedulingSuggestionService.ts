import type { CalendarEventSummary, TaskSummary } from "@shared/ipc/contracts";

export interface ScheduleSlot {
  startsAt: string;
  endsAt: string;
  taskId?: string;
  eventId?: string;
  locked: boolean;
  conflict: boolean;
}

export interface DayScheduleInput {
  date: string;
  events: CalendarEventSummary[];
  tasks: TaskSummary[];
  capacityMinutes: number;
  workingHours: { start: number; end: number };
}

export interface DaySchedule {
  slots: ScheduleSlot[];
  unscheduled: TaskSummary[];
  overloadMinutes: number;
}

interface TimeRange {
  startsAt: string;
  endsAt: string;
}

const priorityRank: Record<NonNullable<TaskSummary["priority"]>, number> = {
  high: 0,
  medium: 1,
  low: 2,
  none: 3
};

export function buildDaySchedule(input: DayScheduleInput): DaySchedule {
  const dayStartMs = Date.parse(`${input.date}T00:00:00.000Z`);
  const dayEndMs = dayStartMs + 24 * 60 * 60 * 1000;
  const workStartMs = dayStartMs + input.workingHours.start * 60 * 60 * 1000;
  const workEndMs = dayStartMs + input.workingHours.end * 60 * 60 * 1000;
  const slots: ScheduleSlot[] = [];
  const unscheduled: TaskSummary[] = [];
  let plannedTaskMinutes = 0;
  let totalTaskMinutes = 0;

  for (const event of input.events) {
    const slot = clampedSlot({
      startsAt: event.startsAt,
      endsAt: event.endsAt
    }, dayStartMs, dayEndMs);

    if (slot) {
      slots.push({
        ...slot,
        eventId: event.id,
        locked: true,
        conflict: false
      });
    }
  }

  const remainingTasks: TaskSummary[] = [];

  for (const task of input.tasks) {
    if (task.status !== "active") {
      continue;
    }

    const durationMinutes = taskDurationMinutes(task);

    if (durationMinutes !== null) {
      totalTaskMinutes += durationMinutes;
    }

    const planned = plannedTaskRange(task);

    if (planned) {
      const slot = clampedSlot(planned, dayStartMs, dayEndMs);

      if (slot) {
        slots.push({
          ...slot,
          taskId: task.id,
          locked: task.lockedSchedule === true,
          conflict: false
        });
        plannedTaskMinutes += minutesBetween(slot.startsAt, slot.endsAt);
        continue;
      }
    }

    remainingTasks.push(task);
  }

  let usedTaskMinutes = plannedTaskMinutes;

  for (const task of [...remainingTasks].sort(compareSchedulableTasks)) {
    const durationMinutes = taskDurationMinutes(task);

    if (durationMinutes === null) {
      unscheduled.push(task);
      continue;
    }

    if (usedTaskMinutes + durationMinutes > input.capacityMinutes) {
      unscheduled.push(task);
      continue;
    }

    const startMs = firstFreeStart(slots, workStartMs, workEndMs, durationMinutes);

    if (startMs === null) {
      unscheduled.push(task);
      continue;
    }

    slots.push({
      startsAt: new Date(startMs).toISOString(),
      endsAt: new Date(startMs + durationMinutes * 60 * 1000).toISOString(),
      taskId: task.id,
      locked: false,
      conflict: false
    });
    usedTaskMinutes += durationMinutes;
  }

  markConflicts(slots);

  return {
    slots: slots.sort(compareSlots),
    unscheduled,
    overloadMinutes: Math.max(0, totalTaskMinutes - input.capacityMinutes)
  };
}

function taskDurationMinutes(task: TaskSummary): number | null {
  if (typeof task.durationMinutes === "number" && task.durationMinutes > 0) {
    return task.durationMinutes;
  }

  const planned = plannedTaskRange(task);

  if (!planned) {
    return null;
  }

  return minutesBetween(planned.startsAt, planned.endsAt);
}

function plannedTaskRange(task: TaskSummary): TimeRange | null {
  if (!task.plannedStart) {
    return null;
  }

  if (task.plannedEnd && Date.parse(task.plannedEnd) > Date.parse(task.plannedStart)) {
    return {
      startsAt: task.plannedStart,
      endsAt: task.plannedEnd
    };
  }

  if (typeof task.durationMinutes === "number" && task.durationMinutes > 0) {
    return {
      startsAt: task.plannedStart,
      endsAt: new Date(Date.parse(task.plannedStart) + task.durationMinutes * 60 * 1000).toISOString()
    };
  }

  return null;
}

function clampedSlot(range: TimeRange, minMs: number, maxMs: number): TimeRange | null {
  const startsAtMs = Math.max(Date.parse(range.startsAt), minMs);
  const endsAtMs = Math.min(Date.parse(range.endsAt), maxMs);

  if (!Number.isFinite(startsAtMs) || !Number.isFinite(endsAtMs) || endsAtMs <= startsAtMs) {
    return null;
  }

  return {
    startsAt: new Date(startsAtMs).toISOString(),
    endsAt: new Date(endsAtMs).toISOString()
  };
}

function firstFreeStart(
  slots: ScheduleSlot[],
  workStartMs: number,
  workEndMs: number,
  durationMinutes: number
): number | null {
  const durationMs = durationMinutes * 60 * 1000;
  let cursor = workStartMs;
  const occupied = slots
    .map((slot) => ({
      start: Date.parse(slot.startsAt),
      end: Date.parse(slot.endsAt)
    }))
    .filter((slot) => Number.isFinite(slot.start) && Number.isFinite(slot.end) && slot.end > slot.start)
    .sort((left, right) => left.start - right.start || left.end - right.end);

  for (const slot of occupied) {
    if (cursor + durationMs <= Math.min(slot.start, workEndMs)) {
      return cursor;
    }

    if (slot.end > cursor) {
      cursor = slot.end;
    }

    if (cursor >= workEndMs) {
      return null;
    }
  }

  return cursor + durationMs <= workEndMs ? cursor : null;
}

function markConflicts(slots: ScheduleSlot[]): void {
  for (let leftIndex = 0; leftIndex < slots.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < slots.length; rightIndex += 1) {
      const left = slots[leftIndex];
      const right = slots[rightIndex];

      if (!left || !right || left.locked || right.locked) {
        continue;
      }

      if (Date.parse(left.startsAt) < Date.parse(right.endsAt) && Date.parse(right.startsAt) < Date.parse(left.endsAt)) {
        left.conflict = true;
        right.conflict = true;
      }
    }
  }
}

function compareSchedulableTasks(left: TaskSummary, right: TaskSummary): number {
  return (
    (left.dueAt ?? "9999-12-31T00:00:00.000Z").localeCompare(right.dueAt ?? "9999-12-31T00:00:00.000Z") ||
    (priorityRank[left.priority ?? "none"] - priorityRank[right.priority ?? "none"]) ||
    left.updatedAt.localeCompare(right.updatedAt) ||
    left.id.localeCompare(right.id)
  );
}

function compareSlots(left: ScheduleSlot, right: ScheduleSlot): number {
  return (
    left.startsAt.localeCompare(right.startsAt) ||
    left.endsAt.localeCompare(right.endsAt) ||
    (left.taskId ?? left.eventId ?? "").localeCompare(right.taskId ?? right.eventId ?? "")
  );
}

function minutesBetween(startsAt: string, endsAt: string): number {
  return Math.max(0, Math.round((Date.parse(endsAt) - Date.parse(startsAt)) / 60_000));
}
