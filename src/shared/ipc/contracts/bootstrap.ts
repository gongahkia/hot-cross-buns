import { z } from "zod";
import {
  calendarEventSummarySchema,
  calendarListSummarySchema,
  calendarRangeRequestSchema,
  scheduledTaskBlockSummarySchema
} from "./calendar";
import { googleStatusResponseSchema } from "./google";
import { nativeCapabilitiesResponseSchema } from "./native";
import { noteListSummarySchema, noteSummarySchema } from "./notes";
import { settingsSnapshotSchema } from "./settings";
import { syncStatusResponseSchema } from "./sync";
import { tagSummarySchema } from "./tags";
import {
  taskListSummarySchema,
  taskSummarySchema
} from "./tasks";
import { pagedListResponseSchema } from "./core";
import { undoStackStatusResponseSchema } from "./undo";

const MAX_BOOTSTRAP_ITEMS = 50_000;

const bootstrapTaskListsResponseSchema = pagedListResponseSchema(
  taskListSummarySchema,
  MAX_BOOTSTRAP_ITEMS
);
const bootstrapTaskListResponseSchema = pagedListResponseSchema(
  taskSummarySchema,
  MAX_BOOTSTRAP_ITEMS
);
const bootstrapCalendarListResponseSchema = pagedListResponseSchema(
  calendarListSummarySchema,
  MAX_BOOTSTRAP_ITEMS
);
const bootstrapCalendarRangeResponseSchema = pagedListResponseSchema(
  calendarEventSummarySchema,
  MAX_BOOTSTRAP_ITEMS
);
const bootstrapScheduledTaskBlockListResponseSchema = pagedListResponseSchema(
  scheduledTaskBlockSummarySchema,
  MAX_BOOTSTRAP_ITEMS
);
const bootstrapNoteListResponseSchema = pagedListResponseSchema(
  noteSummarySchema,
  MAX_BOOTSTRAP_ITEMS
).extend({
  lists: z.array(noteListSummarySchema).max(MAX_BOOTSTRAP_ITEMS)
});
const bootstrapTagListResponseSchema = pagedListResponseSchema(
  tagSummarySchema,
  MAX_BOOTSTRAP_ITEMS
);

export const bootstrapGetRequestSchema = z
  .object({
    mode: z.enum(["full", "light"]).default("full"),
    calendarRange: calendarRangeRequestSchema
  })
  .strict();

export type BootstrapGetRequest = z.input<typeof bootstrapGetRequestSchema>;

export const bootstrapResourceCountsSchema = z
  .object({
    calendarEvents: z.number().int().nonnegative(),
    notes: z.number().int().nonnegative(),
    tasks: z.number().int().nonnegative()
  })
  .strict();

export const bootstrapGetResponseSchema = z
  .object({
    taskLists: bootstrapTaskListsResponseSchema,
    tasks: bootstrapTaskListResponseSchema,
    hiddenTasks: bootstrapTaskListResponseSchema,
    deletedTasks: bootstrapTaskListResponseSchema,
    calendars: bootstrapCalendarListResponseSchema,
    events: bootstrapCalendarRangeResponseSchema,
    scheduledTaskBlocks: bootstrapScheduledTaskBlockListResponseSchema,
    notes: bootstrapNoteListResponseSchema,
    tags: bootstrapTagListResponseSchema,
    settings: settingsSnapshotSchema,
    syncStatus: syncStatusResponseSchema,
    googleStatus: googleStatusResponseSchema,
    undoStatus: undoStackStatusResponseSchema,
    native: nativeCapabilitiesResponseSchema,
    resourceCounts: bootstrapResourceCountsSchema
  })
  .strict();

export type BootstrapGetResponse = z.infer<typeof bootstrapGetResponseSchema>;
