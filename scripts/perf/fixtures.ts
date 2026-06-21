import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type PerfFixtureSize = "small" | "medium" | "event15k" | "large";

export interface PerfFixtureCounts {
  tasks: number;
  eventInstances: number;
  notes: number;
}

export interface PerfTaskFixture {
  id: string;
  taskListId: string;
  parentTaskId: string | null;
  title: string;
  status: "needsAction" | "completed";
  dueAt: string | null;
  completedAt: string | null;
  updatedAt: string;
  sortOrder: number;
}

export interface PerfEventInstanceFixture {
  id: string;
  calendarId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  isAllDay: boolean;
  updatedAt: string;
}

export interface PerfNoteFixture {
  id: string;
  linkedResourceType: "task" | "event" | null;
  linkedResourceId: string | null;
  title: string;
  body: string;
  updatedAt: string;
}

export interface PerfFixtureSet {
  schemaVersion: 1;
  size: PerfFixtureSize;
  seed: string;
  generatedDataOnly: true;
  baseTime: string;
  counts: PerfFixtureCounts;
  taskLists: Array<{ id: string; title: string }>;
  calendars: Array<{ id: string; title: string }>;
  tasks: PerfTaskFixture[];
  eventInstances: PerfEventInstanceFixture[];
  notes: PerfNoteFixture[];
}

export interface PerfFixtureSummary {
  size: PerfFixtureSize;
  seed: string;
  generatedDataOnly: true;
  counts: PerfFixtureCounts;
  totalRecords: number;
  jsonBytes: number;
  sha256: string;
}

export const PERF_FIXTURE_COUNTS: Record<PerfFixtureSize, PerfFixtureCounts> = {
  small: {
    tasks: 50,
    eventInstances: 20,
    notes: 10
  },
  medium: {
    tasks: 1000,
    eventInstances: 1000,
    notes: 200
  },
  event15k: {
    tasks: 1000,
    eventInstances: 15000,
    notes: 500
  },
  large: {
    tasks: 10000,
    eventInstances: 25000,
    notes: 2000
  }
};

const FIXTURE_BASE_TIME_MS = Date.UTC(2026, 0, 5, 9, 0, 0, 0);
const FIXTURE_BASE_TIME = new Date(FIXTURE_BASE_TIME_MS).toISOString();
const TASK_LIST_IDS = ["generated-inbox", "generated-work", "generated-personal", "generated-later"];
const CALENDAR_IDS = ["generated-primary", "generated-focus", "generated-shared"];

function padded(value: number, width: number): string {
  return value.toString().padStart(width, "0");
}

function timestamp(offsetMinutes: number): string {
  return new Date(FIXTURE_BASE_TIME_MS + offsetMinutes * 60_000).toISOString();
}

function taskId(size: PerfFixtureSize, index: number): string {
  return `generated-${size}-task-${padded(index + 1, 5)}`;
}

function eventId(size: PerfFixtureSize, index: number): string {
  return `generated-${size}-event-instance-${padded(index + 1, 5)}`;
}

function noteId(size: PerfFixtureSize, index: number): string {
  return `generated-${size}-note-${padded(index + 1, 5)}`;
}

function generateTasks(size: PerfFixtureSize, count: number): PerfTaskFixture[] {
  return Array.from({ length: count }, (_, index) => {
    const status = index % 9 === 0 ? "completed" : "needsAction";
    const completedAt = status === "completed" ? timestamp(index - 120) : null;

    return {
      id: taskId(size, index),
      taskListId: TASK_LIST_IDS[index % TASK_LIST_IDS.length],
      parentTaskId: index > 0 && index % 17 === 0 ? taskId(size, index - 1) : null,
      title: `Generated task ${padded(index + 1, 5)}`,
      status,
      dueAt: index % 5 === 0 ? null : timestamp(index * 37),
      completedAt,
      updatedAt: timestamp(index - 240),
      sortOrder: index + 1
    };
  });
}

function generateEventInstances(size: PerfFixtureSize, count: number): PerfEventInstanceFixture[] {
  return Array.from({ length: count }, (_, index) => {
    const startsAtOffset = index * 45;
    const durationMinutes = 30 + (index % 4) * 15;

    return {
      id: eventId(size, index),
      calendarId: CALENDAR_IDS[index % CALENDAR_IDS.length],
      title: `Generated event ${padded(index + 1, 5)}`,
      startsAt: timestamp(startsAtOffset),
      endsAt: timestamp(startsAtOffset + durationMinutes),
      isAllDay: index % 31 === 0,
      updatedAt: timestamp(index - 90)
    };
  });
}

function generateNotes(size: PerfFixtureSize, count: number): PerfNoteFixture[] {
  return Array.from({ length: count }, (_, index) => {
    const linkedToTask = index % 3 === 0;
    const linkedToEvent = !linkedToTask && index % 5 === 0;

    return {
      id: noteId(size, index),
      linkedResourceType: linkedToTask ? "task" : linkedToEvent ? "event" : null,
      linkedResourceId: linkedToTask
        ? taskId(size, index % PERF_FIXTURE_COUNTS[size].tasks)
        : linkedToEvent
          ? eventId(size, index % PERF_FIXTURE_COUNTS[size].eventInstances)
          : null,
      title: `Generated note ${padded(index + 1, 5)}`,
      body: `Generated note body ${padded(index + 1, 5)} for deterministic performance fixtures.`,
      updatedAt: timestamp(index - 360)
    };
  });
}

export function generatePerfFixtureSet(size: PerfFixtureSize): PerfFixtureSet {
  const counts = PERF_FIXTURE_COUNTS[size];

  return {
    schemaVersion: 1,
    size,
    seed: `hot-cross-buns-2-perf-${size}-v1`,
    generatedDataOnly: true,
    baseTime: FIXTURE_BASE_TIME,
    counts,
    taskLists: TASK_LIST_IDS.map((id) => ({ id, title: id.replace("generated-", "") })),
    calendars: CALENDAR_IDS.map((id) => ({ id, title: id.replace("generated-", "") })),
    tasks: generateTasks(size, counts.tasks),
    eventInstances: generateEventInstances(size, counts.eventInstances),
    notes: generateNotes(size, counts.notes)
  };
}

export function summarizePerfFixtureSet(size: PerfFixtureSize): PerfFixtureSummary {
  const fixture = generatePerfFixtureSet(size);
  const serialized = JSON.stringify(fixture);

  return {
    size,
    seed: fixture.seed,
    generatedDataOnly: true,
    counts: fixture.counts,
    totalRecords: fixture.counts.tasks + fixture.counts.eventInstances + fixture.counts.notes,
    jsonBytes: Buffer.byteLength(serialized),
    sha256: createHash("sha256").update(serialized).digest("hex")
  };
}

export function summarizeAllPerfFixtureSets(): PerfFixtureSummary[] {
  return (["small", "medium", "event15k", "large"] as const).map((size) => summarizePerfFixtureSet(size));
}

export function writePerfFixtureSet(size: PerfFixtureSize, outputDir: string): string {
  mkdirSync(outputDir, { recursive: true });

  const outputPath = join(outputDir, `${size}.json`);
  writeFileSync(outputPath, `${JSON.stringify(generatePerfFixtureSet(size), null, 2)}\n`);

  return outputPath;
}
