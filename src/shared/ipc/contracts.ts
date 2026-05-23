import { z } from "zod";
import { hcbErrorCodeSchema, hcbResultSchema } from "./result";

export const HCB_IPC_VERSION = 1;
export const HCB_IPC_CHANNEL = "hcb:ipc:v1";
export const HCB_SYNC_STATUS_EVENT_CHANNEL = "hcb:sync-status:v1";
export const HCB_NATIVE_ACTION_EVENT_CHANNEL = "hcb:native-action:v1";

export const IPC_CHANNELS = {
  dispatch: HCB_IPC_CHANNEL,
  syncStatus: HCB_SYNC_STATUS_EVENT_CHANNEL,
  nativeAction: HCB_NATIVE_ACTION_EVENT_CHANNEL
} as const;

export const DEFAULT_LIST_LIMIT = 50;
export const MAX_LIST_LIMIT = 100;
export const DEFAULT_RANGE_LIMIT = 100;
export const MAX_RANGE_LIMIT = 500;
export const DEFAULT_SEARCH_LIMIT = 20;
export const MAX_SEARCH_LIMIT = 50;
export const MAX_RANGE_WINDOW_DAYS = 397;

const millisecondsPerDay = 24 * 60 * 60 * 1000;

export const hcbDomainSchema = z.enum([
  "tasks",
  "calendar",
  "notes",
  "search",
  "sync",
  "google",
  "settings",
  "mcp",
  "native",
  "diagnostics"
]);

export type HcbDomain = z.infer<typeof hcbDomainSchema>;

export const ipcDispatchEnvelopeSchema = z
  .object({
    version: z.literal(HCB_IPC_VERSION),
    domain: hcbDomainSchema,
    method: z.string().min(1).max(80),
    request: z.unknown()
  })
  .strict();

export type IpcDispatchEnvelope = z.infer<typeof ipcDispatchEnvelopeSchema>;

export interface IpcContract {
  readonly domain: HcbDomain;
  readonly method: string;
  readonly requestSchema: z.ZodTypeAny;
  readonly responseSchema: z.ZodTypeAny;
}

export function defineIpcContract<
  const Domain extends HcbDomain,
  const Method extends string,
  RequestSchema extends z.ZodTypeAny,
  ResponseSchema extends z.ZodTypeAny
>(
  domain: Domain,
  method: Method,
  requestSchema: RequestSchema,
  responseSchema: ResponseSchema
) {
  return {
    domain,
    method,
    requestSchema,
    responseSchema
  } as const;
}

const emptyRequestSchema = z.object({}).strict();
export type EmptyRequest = z.infer<typeof emptyRequestSchema>;

const idSchema = z.string().min(1).max(256);
const cursorSchema = z.string().min(1).max(512);
const isoDateTimeSchema = z.string().datetime({ offset: true });
const guestEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email()
  .min(3)
  .max(254);
const reminderMinutesSchema = z.number().int().min(0).max(28 * 24 * 60);
const durationMinutesSchema = z.number().int().min(5).max(24 * 60);
const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
  message: "Expected YYYY-MM-DD"
});

const listLimitSchema = z.number().int().min(1).max(MAX_LIST_LIMIT).default(DEFAULT_LIST_LIMIT);
const rangeLimitSchema = z
  .number()
  .int()
  .min(1)
  .max(MAX_RANGE_LIMIT)
  .default(DEFAULT_RANGE_LIMIT);
const searchLimitSchema = z
  .number()
  .int()
  .min(1)
  .max(MAX_SEARCH_LIMIT)
  .default(DEFAULT_SEARCH_LIMIT);

function pagedListResponseSchema<T extends z.ZodTypeAny>(itemSchema: T, maxItems: number) {
  return z
    .object({
      items: z.array(itemSchema).max(maxItems),
      page: z
        .object({
          limit: z.number().int().min(1).max(maxItems),
          nextCursor: cursorSchema.optional(),
          totalKnown: z.number().int().nonnegative().optional()
        })
        .strict()
    })
    .strict();
}

export const entityByIdRequestSchema = z
  .object({
    id: idSchema
  })
  .strict();

export type EntityByIdRequest = z.input<typeof entityByIdRequestSchema>;

export const mutationAckSchema = z
  .object({
    id: idSchema,
    queued: z.boolean(),
    revision: z.string().min(1).max(256).optional()
  })
  .strict();

export type MutationAck = z.infer<typeof mutationAckSchema>;

export const taskStatusSchema = z.enum(["active", "completed", "hidden", "deleted"]);
export const taskPrioritySchema = z.enum(["none", "low", "medium", "high"]);
export type TaskPriority = z.infer<typeof taskPrioritySchema>;

export const taskListRequestSchema = z
  .object({
    listId: idSchema.optional(),
    status: z.enum(["all", "active", "completed", "hidden", "deleted"]).default("active"),
    cursor: cursorSchema.optional(),
    limit: listLimitSchema
  })
  .strict();

export type TaskListRequest = z.input<typeof taskListRequestSchema>;

export const taskListsRequestSchema = z
  .object({
    cursor: cursorSchema.optional(),
    limit: listLimitSchema
  })
  .strict();

export type TaskListsRequest = z.input<typeof taskListsRequestSchema>;

export const taskListSummarySchema = z
  .object({
    id: idSchema,
    title: z.string().min(1).max(500),
    updatedAt: isoDateTimeSchema,
    taskCount: z.number().int().nonnegative().optional(),
    activeTaskCount: z.number().int().nonnegative().optional()
  })
  .strict();

export type TaskListSummary = z.infer<typeof taskListSummarySchema>;

export const taskListsResponseSchema = pagedListResponseSchema(
  taskListSummarySchema,
  MAX_LIST_LIMIT
);

export type TaskListsResponse = z.infer<typeof taskListsResponseSchema>;

export const taskSummarySchema = z
  .object({
    id: idSchema,
    listId: idSchema,
    title: z.string().min(1).max(500),
    status: taskStatusSchema,
    dueAt: isoDateTimeSchema.nullable().optional(),
    updatedAt: isoDateTimeSchema,
    notes: z.string().max(10_000).optional(),
    parentId: idSchema.nullable().optional(),
    priority: taskPrioritySchema.default("none"),
    sortOrder: z.number().int().optional(),
    mutationState: z.enum(["synced", "queued", "failed"]).optional(),
    plannedStart: isoDateTimeSchema.nullable().optional(),
    plannedEnd: isoDateTimeSchema.nullable().optional(),
    durationMinutes: z.number().int().nonnegative().nullable().optional(),
    lockedSchedule: z.boolean().optional(),
    snoozeUntil: isoDateTimeSchema.nullable().optional(),
    tags: z.array(z.string().min(1).max(120)).max(64).optional()
  })
  .strict();

export type TaskSummary = z.infer<typeof taskSummarySchema>;

export const taskListResponseSchema = pagedListResponseSchema(taskSummarySchema, MAX_LIST_LIMIT);
export type TaskListResponse = z.infer<typeof taskListResponseSchema>;

export const taskDetailSchema = taskSummarySchema
  .extend({
    notes: z.string().max(10_000).optional()
  })
  .strict();

export type TaskDetail = z.infer<typeof taskDetailSchema>;

export const taskCreateRequestSchema = z
  .object({
    title: z.string().min(1).max(500),
    notes: z.string().max(10_000).default(""),
    dueDate: dateOnlySchema.nullable().optional(),
    listId: idSchema,
    parentId: idSchema.nullable().optional(),
    previousSiblingId: idSchema.nullable().optional(),
    priority: taskPrioritySchema.default("none"),
    plannedStart: isoDateTimeSchema.nullable().optional(),
    plannedEnd: isoDateTimeSchema.nullable().optional(),
    durationMinutes: z.number().int().nonnegative().nullable().optional(),
    lockedSchedule: z.boolean().optional(),
    snoozeUntil: isoDateTimeSchema.nullable().optional(),
    tags: z.array(z.string().min(1).max(120)).max(64).optional()
  })
  .strict();

export type TaskCreateRequest = z.input<typeof taskCreateRequestSchema>;

export const taskUpdateRequestSchema = z
  .object({
    id: idSchema,
    title: z.string().min(1).max(500).optional(),
    notes: z.string().max(10_000).optional(),
    dueDate: dateOnlySchema.nullable().optional(),
    listId: idSchema.optional(),
    parentId: idSchema.nullable().optional(),
    previousSiblingId: idSchema.nullable().optional(),
    priority: taskPrioritySchema.optional(),
    plannedStart: isoDateTimeSchema.nullable().optional(),
    plannedEnd: isoDateTimeSchema.nullable().optional(),
    durationMinutes: z.number().int().nonnegative().nullable().optional(),
    lockedSchedule: z.boolean().optional(),
    snoozeUntil: isoDateTimeSchema.nullable().optional(),
    tags: z.array(z.string().min(1).max(120)).max(64).optional()
  })
  .strict()
  .refine(
    (request) =>
      request.title !== undefined ||
      request.notes !== undefined ||
      request.dueDate !== undefined ||
      request.listId !== undefined ||
      request.parentId !== undefined ||
      request.previousSiblingId !== undefined ||
      request.priority !== undefined ||
      request.plannedStart !== undefined ||
      request.plannedEnd !== undefined ||
      request.durationMinutes !== undefined ||
      request.lockedSchedule !== undefined ||
      request.snoozeUntil !== undefined ||
      request.tags !== undefined,
    {
      message: "At least one task field must be supplied"
    }
  );

export type TaskUpdateRequest = z.input<typeof taskUpdateRequestSchema>;

export const taskCompletionRequestSchema = entityByIdRequestSchema;
export type TaskCompletionRequest = z.input<typeof taskCompletionRequestSchema>;

export const taskMoveRequestSchema = z
  .object({
    id: idSchema,
    listId: idSchema.optional(),
    parentId: idSchema.nullable().optional(),
    previousSiblingId: idSchema.nullable().optional()
  })
  .strict()
  .refine(
    (request) =>
      request.listId !== undefined ||
      request.parentId !== undefined ||
      request.previousSiblingId !== undefined,
    {
      message: "At least one task move field must be supplied"
    }
  );

export type TaskMoveRequest = z.input<typeof taskMoveRequestSchema>;

export const taskDeleteRequestSchema = entityByIdRequestSchema;
export type TaskDeleteRequest = z.input<typeof taskDeleteRequestSchema>;

export const taskListCreateRequestSchema = z
  .object({
    title: z.string().min(1).max(500)
  })
  .strict();

export type TaskListCreateRequest = z.input<typeof taskListCreateRequestSchema>;

export const taskListRenameRequestSchema = z
  .object({
    id: idSchema,
    title: z.string().min(1).max(500)
  })
  .strict();

export type TaskListRenameRequest = z.input<typeof taskListRenameRequestSchema>;

export const taskListDeleteRequestSchema = entityByIdRequestSchema;
export type TaskListDeleteRequest = z.input<typeof taskListDeleteRequestSchema>;

export const calendarRangeRequestSchema = z
  .object({
    calendarIds: z.array(idSchema).min(1).max(25).optional(),
    start: isoDateTimeSchema,
    end: isoDateTimeSchema,
    cursor: cursorSchema.optional(),
    limit: rangeLimitSchema
  })
  .strict()
  .superRefine((request, context) => {
    const startMs = Date.parse(request.start);
    const endMs = Date.parse(request.end);

    if (endMs <= startMs) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["end"],
        message: "End must be after start"
      });
      return;
    }

    if (endMs - startMs > MAX_RANGE_WINDOW_DAYS * millisecondsPerDay) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["end"],
        message: "Range window is too large"
      });
    }
  });

export type CalendarRangeRequest = z.input<typeof calendarRangeRequestSchema>;

export const calendarListRequestSchema = z
  .object({
    cursor: cursorSchema.optional(),
    limit: listLimitSchema
  })
  .strict();

export type CalendarListRequest = z.input<typeof calendarListRequestSchema>;

export const calendarListSummarySchema = z
  .object({
    id: idSchema,
    title: z.string().min(1).max(500),
    selected: z.boolean(),
    timeZone: z.string().min(1).max(120).nullable().optional(),
    updatedAt: isoDateTimeSchema,
    eventCount: z.number().int().nonnegative().optional()
  })
  .strict();

export type CalendarListSummary = z.infer<typeof calendarListSummarySchema>;

export const calendarListResponseSchema = pagedListResponseSchema(
  calendarListSummarySchema,
  MAX_LIST_LIMIT
);

export type CalendarListResponse = z.infer<typeof calendarListResponseSchema>;

export const calendarEventSummarySchema = z
  .object({
    id: idSchema,
    eventId: idSchema.optional(),
    calendarId: idSchema,
    title: z.string().min(1).max(500),
    startsAt: isoDateTimeSchema,
    endsAt: isoDateTimeSchema,
    allDay: z.boolean(),
    updatedAt: isoDateTimeSchema,
    location: z.string().max(1_000).optional(),
    notes: z.string().max(20_000).optional(),
    guestEmails: z.array(guestEmailSchema).max(50).optional(),
    reminderMinutes: z.array(reminderMinutesSchema).max(10).optional(),
    mutationState: z.enum(["synced", "queued", "failed"]).optional(),
    timeZone: z.string().min(1).max(120).nullable().optional(),
    recurrenceRule: z.string().min(1).max(1_000).nullable().optional(),
    recurringEventId: z.string().min(1).max(256).nullable().optional(),
    originalStartAt: isoDateTimeSchema.nullable().optional()
  })
  .strict();

export type CalendarEventSummary = z.infer<typeof calendarEventSummarySchema>;

export const calendarRangeResponseSchema = pagedListResponseSchema(
  calendarEventSummarySchema,
  MAX_RANGE_LIMIT
);

export type CalendarRangeResponse = z.infer<typeof calendarRangeResponseSchema>;

export const calendarEventRecurrenceSchema = z
  .object({
    frequency: z.enum(["daily", "weekly", "monthly", "yearly"]),
    interval: z.number().int().min(1).max(366),
    endsOn: dateOnlySchema.nullable().optional(),
    count: z.number().int().min(1).max(366).nullable().optional()
  })
  .strict();

export type CalendarEventRecurrence = z.infer<typeof calendarEventRecurrenceSchema>;

export const calendarEventDetailSchema = calendarEventSummarySchema
  .extend({
    calendarTitle: z.string().min(1).max(500),
    deepLink: z.string().min(1).max(1_000)
  })
  .strict();

export type CalendarEventDetail = z.infer<typeof calendarEventDetailSchema>;

const calendarEventWriteFieldsSchema = z
  .object({
    title: z.string().trim().min(1).max(500),
    calendarId: idSchema,
    startsAt: isoDateTimeSchema,
    endsAt: isoDateTimeSchema,
    allDay: z.boolean().default(false),
    location: z.string().trim().max(1_000).default(""),
    notes: z.string().max(20_000).default(""),
    guestEmails: z.array(guestEmailSchema).max(50).default([]),
    reminderMinutes: z.array(reminderMinutesSchema).max(10).default([]),
    recurrence: calendarEventRecurrenceSchema.nullable().optional()
  })
  .strict()
  .superRefine((request, context) => {
    const startMs = Date.parse(request.startsAt);
    const endMs = Date.parse(request.endsAt);

    if (!Number.isFinite(startMs)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["startsAt"],
        message: "Start must be a valid ISO date-time"
      });
    }

    if (!Number.isFinite(endMs) || endMs <= startMs) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endsAt"],
        message: "End must be after start"
      });
    }
  });

export const calendarEventCreateRequestSchema = calendarEventWriteFieldsSchema;
export type CalendarEventCreateRequest = z.input<typeof calendarEventCreateRequestSchema>;

export const calendarEventUpdateRequestSchema = z
  .object({
    id: idSchema,
    title: z.string().trim().min(1).max(500).optional(),
    calendarId: idSchema.optional(),
    startsAt: isoDateTimeSchema.optional(),
    endsAt: isoDateTimeSchema.optional(),
    allDay: z.boolean().optional(),
    location: z.string().trim().max(1_000).optional(),
    notes: z.string().max(20_000).optional(),
    guestEmails: z.array(guestEmailSchema).max(50).optional(),
    reminderMinutes: z.array(reminderMinutesSchema).max(10).optional(),
    recurrence: calendarEventRecurrenceSchema.nullable().optional()
  })
  .strict()
  .refine(
    (request) =>
      request.title !== undefined ||
      request.calendarId !== undefined ||
      request.startsAt !== undefined ||
      request.endsAt !== undefined ||
      request.allDay !== undefined ||
      request.location !== undefined ||
      request.notes !== undefined ||
      request.guestEmails !== undefined ||
      request.reminderMinutes !== undefined ||
      request.recurrence !== undefined,
    {
      message: "At least one event field must be supplied"
    }
  );

export type CalendarEventUpdateRequest = z.input<typeof calendarEventUpdateRequestSchema>;

export const calendarEventDeleteRequestSchema = entityByIdRequestSchema;
export type CalendarEventDeleteRequest = z.input<typeof calendarEventDeleteRequestSchema>;

export const scheduledTaskBlockStatusSchema = z.enum(["scheduled", "orphaned"]);

export const scheduledTaskBlockSummarySchema = z
  .object({
    id: idSchema,
    taskId: idSchema,
    calendarEventId: idSchema,
    calendarId: idSchema,
    title: z.string().min(1).max(500),
    startsAt: isoDateTimeSchema,
    endsAt: isoDateTimeSchema,
    durationMinutes: durationMinutesSchema,
    status: scheduledTaskBlockStatusSchema,
    mutationState: z.enum(["synced", "queued", "failed"]).optional(),
    updatedAt: isoDateTimeSchema
  })
  .strict();

export type ScheduledTaskBlockSummary = z.infer<typeof scheduledTaskBlockSummarySchema>;

export const scheduledTaskBlockListRequestSchema = calendarRangeRequestSchema;
export type ScheduledTaskBlockListRequest = z.input<
  typeof scheduledTaskBlockListRequestSchema
>;

export const scheduledTaskBlockListResponseSchema = pagedListResponseSchema(
  scheduledTaskBlockSummarySchema,
  MAX_RANGE_LIMIT
);
export type ScheduledTaskBlockListResponse = z.infer<
  typeof scheduledTaskBlockListResponseSchema
>;

export const scheduledTaskBlockCreateRequestSchema = z
  .object({
    taskId: idSchema,
    calendarId: idSchema,
    startsAt: isoDateTimeSchema,
    durationMinutes: durationMinutesSchema.default(30)
  })
  .strict();

export type ScheduledTaskBlockCreateRequest = z.input<
  typeof scheduledTaskBlockCreateRequestSchema
>;

export const scheduledTaskBlockMoveRequestSchema = z
  .object({
    id: idSchema,
    calendarId: idSchema.optional(),
    startsAt: isoDateTimeSchema.optional(),
    durationMinutes: durationMinutesSchema.optional()
  })
  .strict()
  .refine(
    (request) =>
      request.calendarId !== undefined ||
      request.startsAt !== undefined ||
      request.durationMinutes !== undefined,
    {
      message: "At least one scheduled task block field must be supplied"
    }
  );

export type ScheduledTaskBlockMoveRequest = z.input<
  typeof scheduledTaskBlockMoveRequestSchema
>;

export const scheduledTaskBlockUnscheduleRequestSchema = z
  .object({
    id: idSchema,
    deleteCalendarEvent: z.boolean().default(true)
  })
  .strict();

export type ScheduledTaskBlockUnscheduleRequest = z.input<
  typeof scheduledTaskBlockUnscheduleRequestSchema
>;

export const calendarScheduleSuggestRequestSchema = z
  .object({
    date: dateOnlySchema,
    capacityMinutes: z.number().int().min(5).max(24 * 60).default(480),
    workingHours: z
      .object({
        start: z.number().int().min(0).max(23).default(6),
        end: z.number().int().min(1).max(24).default(22)
      })
      .strict()
      .default({ start: 6, end: 22 })
  })
  .strict()
  .refine((request) => request.workingHours.end > request.workingHours.start, {
    path: ["workingHours", "end"],
    message: "Working hours end must be after start"
  });

export type CalendarScheduleSuggestRequest = z.input<typeof calendarScheduleSuggestRequestSchema>;

export const scheduleSlotSchema = z
  .object({
    startsAt: isoDateTimeSchema,
    endsAt: isoDateTimeSchema,
    taskId: idSchema.optional(),
    eventId: idSchema.optional(),
    locked: z.boolean(),
    conflict: z.boolean()
  })
  .strict();

export type ScheduleSlot = z.infer<typeof scheduleSlotSchema>;

export const calendarScheduleSuggestResponseSchema = z
  .object({
    slots: z.array(scheduleSlotSchema).max(1_000),
    unscheduled: z.array(taskSummarySchema).max(1_000),
    overloadMinutes: z.number().int().nonnegative()
  })
  .strict();

export type CalendarScheduleSuggestResponse = z.infer<
  typeof calendarScheduleSuggestResponseSchema
>;

export const availabilityExportRequestSchema = z
  .object({
    calendarIds: z.array(idSchema).min(1).max(25).optional(),
    start: isoDateTimeSchema,
    end: isoDateTimeSchema,
    format: z.enum(["text"]).default("text")
  })
  .strict()
  .superRefine((request, context) => {
    const startMs = Date.parse(request.start);
    const endMs = Date.parse(request.end);

    if (endMs <= startMs) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["end"],
        message: "End must be after start"
      });
      return;
    }

    if (endMs - startMs > MAX_RANGE_WINDOW_DAYS * millisecondsPerDay) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["end"],
        message: "Range window is too large"
      });
    }
  });

export type AvailabilityExportRequest = z.input<typeof availabilityExportRequestSchema>;

export const availabilityExportResponseSchema = z
  .object({
    format: z.literal("text"),
    text: z.string().min(1).max(50_000),
    generatedAt: isoDateTimeSchema,
    busyBlockCount: z.number().int().nonnegative()
  })
  .strict();

export type AvailabilityExportResponse = z.infer<typeof availabilityExportResponseSchema>;

export const noteListRequestSchema = z
  .object({
    cursor: cursorSchema.optional(),
    limit: listLimitSchema
  })
  .strict();

export type NoteListRequest = z.input<typeof noteListRequestSchema>;

export const noteSummarySchema = z
  .object({
    id: idSchema,
    title: z.string().min(1).max(500),
    preview: z.string().max(500),
    updatedAt: isoDateTimeSchema
  })
  .strict();

export type NoteSummary = z.infer<typeof noteSummarySchema>;

export const noteListResponseSchema = pagedListResponseSchema(noteSummarySchema, MAX_LIST_LIMIT);
export type NoteListResponse = z.infer<typeof noteListResponseSchema>;

export const noteDetailSchema = noteSummarySchema
  .extend({
    body: z.string().max(50_000)
  })
  .strict();

export type NoteDetail = z.infer<typeof noteDetailSchema>;

export const noteCreateRequestSchema = z
  .object({
    title: z.string().min(1).max(500),
    body: z.string().max(50_000).default("")
  })
  .strict();

export type NoteCreateRequest = z.input<typeof noteCreateRequestSchema>;

export const noteUpdateRequestSchema = z
  .object({
    id: idSchema,
    title: z.string().min(1).max(500).optional(),
    body: z.string().max(50_000).optional()
  })
  .strict()
  .refine((request) => request.title !== undefined || request.body !== undefined, {
    message: "At least one note field must be supplied"
  });

export type NoteUpdateRequest = z.input<typeof noteUpdateRequestSchema>;

export const noteDeleteRequestSchema = entityByIdRequestSchema;
export type NoteDeleteRequest = z.input<typeof noteDeleteRequestSchema>;

export const noteLinkSuggestRequestSchema = z
  .object({
    query: z.string().min(1).max(120),
    kinds: z.array(z.enum(["note", "task", "event"])).optional(),
    limit: z.number().int().min(1).max(20).default(8)
  })
  .strict();

export type NoteLinkSuggestRequest = z.input<typeof noteLinkSuggestRequestSchema>;

export const noteLinkSuggestResponseSchema = z
  .object({
    items: z.array(
      z
        .object({
          kind: z.enum(["note", "task", "event"]),
          id: idSchema,
          label: z.string()
        })
        .strict()
    )
  })
  .strict();

export type NoteLinkSuggestResponse = z.infer<typeof noteLinkSuggestResponseSchema>;

export const noteBrokenLinksRequestSchema = z
  .object({
    noteId: idSchema
  })
  .strict();

export type NoteBrokenLinksRequest = z.input<typeof noteBrokenLinksRequestSchema>;

export const noteBrokenLinksResponseSchema = z
  .object({
    items: z.array(
      z
        .object({
          linkText: z.string().min(1).max(160)
        })
        .strict()
    )
  })
  .strict();

export type NoteBrokenLinksResponse = z.infer<typeof noteBrokenLinksResponseSchema>;

export const searchDomainSchema = z.enum(["tasks", "calendar", "notes"]);

export const searchQueryRequestSchema = z
  .object({
    query: z.string().min(1).max(200),
    domains: z.array(searchDomainSchema).min(1).max(3).optional(),
    limit: searchLimitSchema
  })
  .strict();

export type SearchQueryRequest = z.input<typeof searchQueryRequestSchema>;

export const searchResultItemSchema = z
  .object({
    id: idSchema,
    domain: searchDomainSchema,
    title: z.string().min(1).max(500),
    snippet: z.string().max(500).optional(),
    updatedAt: isoDateTimeSchema.optional()
  })
  .strict();

export type SearchResultItem = z.infer<typeof searchResultItemSchema>;

export const searchQueryResponseSchema = pagedListResponseSchema(
  searchResultItemSchema,
  MAX_SEARCH_LIMIT
);

export type SearchQueryResponse = z.infer<typeof searchQueryResponseSchema>;

export const syncStatusRequestSchema = emptyRequestSchema;

export const syncStatusResponseSchema = z
  .object({
    state: z.enum(["idle", "running", "error"]),
    pendingMutationCount: z.number().int().nonnegative(),
    lastStartedAt: isoDateTimeSchema.optional(),
    lastCompletedAt: isoDateTimeSchema.optional(),
    lastErrorCode: hcbErrorCodeSchema.optional(),
    lastDurationMs: z.number().nonnegative().optional(),
    offline: z.boolean().optional(),
    stale: z.boolean().optional()
  })
  .strict();

export type SyncStatusResponse = z.infer<typeof syncStatusResponseSchema>;

export const syncRunNowRequestSchema = z
  .object({
    resources: z.array(z.enum(["tasks", "calendar"])).min(1).max(2).optional(),
    full: z.boolean().default(false),
    dryRun: z.boolean().default(false)
  })
  .strict();

export type SyncRunNowRequest = z.input<typeof syncRunNowRequestSchema>;

export const syncRunNowResponseSchema = z
  .object({
    accepted: z.boolean(),
    dryRun: z.boolean(),
    resources: z.array(z.enum(["tasks", "calendar"])).min(1).max(2)
  })
  .strict();

export type SyncRunNowResponse = z.infer<typeof syncRunNowResponseSchema>;

export const googleConnectionStateSchema = z.enum([
  "signed_out",
  "connected",
  "reauth_required",
  "sync_paused"
]);

export const googleAccountConnectionStatusSchema = z
  .object({
    accountId: idSchema,
    googleAccountId: z.string().min(1).max(256).optional(),
    email: z.string().email().max(254).optional(),
    displayName: z.string().max(256).nullable().optional(),
    avatarUrl: z.string().url().max(2048).nullable().optional(),
    locale: z.string().min(1).max(64).nullable().optional(),
    timeZone: z.string().min(1).max(128).nullable().optional(),
    connectionState: googleConnectionStateSchema,
    grantedScopes: z.array(z.string().min(1).max(256)).max(20),
    missingScopes: z.array(z.string().min(1).max(256)).max(20),
    lastAuthenticatedAt: isoDateTimeSchema.optional(),
    updatedAt: isoDateTimeSchema
  })
  .strict();

export type GoogleAccountConnectionStatus = z.infer<
  typeof googleAccountConnectionStatusSchema
>;

export const googleStatusRequestSchema = emptyRequestSchema;

export const googleStatusResponseSchema = z
  .object({
    oauthClientConfigured: z.boolean(),
    clientId: z.string().min(1).max(500).nullable(),
    hasClientSecret: z.boolean(),
    account: googleAccountConnectionStatusSchema.optional()
  })
  .strict();

export type GoogleStatusResponse = z.infer<typeof googleStatusResponseSchema>;

export const googleSaveOAuthClientRequestSchema = z
  .object({
    clientId: z.string().trim().min(10).max(500),
    clientSecret: z.string().trim().min(1).max(1000).nullable().optional()
  })
  .strict();

export type GoogleSaveOAuthClientRequest = z.input<
  typeof googleSaveOAuthClientRequestSchema
>;

export const googleBeginOAuthRequestSchema = emptyRequestSchema;

export const googleBeginOAuthResponseSchema = z
  .object({
    accepted: z.boolean(),
    openedExternalBrowser: z.boolean(),
    expiresAt: isoDateTimeSchema,
    scopes: z.array(z.string().min(1).max(256)).max(20),
    redirectUri: z.string().url().max(2048),
    message: z.string().min(1).max(500)
  })
  .strict();

export type GoogleBeginOAuthResponse = z.infer<typeof googleBeginOAuthResponseSchema>;

export const googleDisconnectRequestSchema = z
  .object({
    accountId: idSchema.optional()
  })
  .strict();

export type GoogleDisconnectRequest = z.input<typeof googleDisconnectRequestSchema>;

export const settingsGetRequestSchema = emptyRequestSchema;

export const appThemeSchema = z.enum(["system", "light", "dark"]);
export const syncModeSchema = z.enum(["manual", "balanced", "near-real-time"]);
export const trayClickActionSchema = z.enum(["open-menu", "toggle-window", "quick-capture", "open-today"]);
export const menuBarPanelStyleSchema = z.enum(["adaptive", "agenda", "compact"]);
export const mcpPermissionModeSchema = z.enum(["read-only", "confirm-writes", "allow-writes"]);

export const savedSearchViewSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1).max(80),
    query: z.string().min(1).max(500),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema
  })
  .strict();

export type SavedSearchView = z.infer<typeof savedSearchViewSchema>;

export const savedTaskViewSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1).max(80),
    filters: z
      .object({
        statuses: z.array(taskStatusSchema).max(4).optional(),
        listIds: z.array(idSchema).max(100).optional(),
        tags: z.array(z.string().min(1).max(120)).max(64).optional(),
        due: z.enum(["overdue", "today", "next14", "none"]).optional(),
        planned: z.enum(["planned", "unplanned"]).optional()
      })
      .strict(),
    groupBy: z.enum(["none", "dueDate", "list", "tag", "status"]),
    sortBy: z.enum(["dueDate", "updatedAt", "priority", "title"]),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema
  })
  .strict();

export type SavedTaskView = z.infer<typeof savedTaskViewSchema>;

export const settingsSnapshotSchema = z
  .object({
    theme: appThemeSchema,
    startOnLogin: z.boolean(),
    quickCaptureShortcut: z.string().min(1).max(120).nullable(),
    selectedTaskListIds: z.array(idSchema).max(100),
    selectedCalendarIds: z.array(idSchema).max(100),
    setupCompletedAt: isoDateTimeSchema.nullable(),
    syncMode: syncModeSchema,
    showTrayIcon: z.boolean(),
    trayClickAction: trayClickActionSchema,
    menuBarPanelStyle: menuBarPanelStyleSchema,
    showMenuBarBadge: z.boolean(),
    notificationsEnabled: z.boolean(),
    notificationLeadMinutes: z.number().int().min(0).max(28 * 24 * 60),
    mcpEnabled: z.boolean(),
    mcpPermissionMode: mcpPermissionModeSchema,
    mcpPort: z.number().int().min(0).max(65535),
    defaultTimeZone: z.string().min(1).max(120),
    todayCapacityMinutes: z.number().int().min(5).max(24 * 60),
    todayWorkingHoursStart: z.number().int().min(0).max(23),
    todayWorkingHoursEnd: z.number().int().min(1).max(24),
    diagnosticsIncludePerformance: z.boolean(),
    savedSearchViews: z.array(savedSearchViewSchema).max(20),
    savedTaskViews: z.array(savedTaskViewSchema).max(20)
  })
  .strict();

export type SettingsSnapshot = z.infer<typeof settingsSnapshotSchema>;

export const settingsUpdateRequestSchema = z
  .object({
    theme: appThemeSchema.optional(),
    startOnLogin: z.boolean().optional(),
    quickCaptureShortcut: z.string().min(1).max(120).nullable().optional(),
    selectedTaskListIds: z.array(idSchema).max(100).optional(),
    selectedCalendarIds: z.array(idSchema).max(100).optional(),
    setupCompletedAt: isoDateTimeSchema.nullable().optional(),
    syncMode: syncModeSchema.optional(),
    showTrayIcon: z.boolean().optional(),
    trayClickAction: trayClickActionSchema.optional(),
    menuBarPanelStyle: menuBarPanelStyleSchema.optional(),
    showMenuBarBadge: z.boolean().optional(),
    notificationsEnabled: z.boolean().optional(),
    notificationLeadMinutes: z.number().int().min(0).max(28 * 24 * 60).optional(),
    mcpEnabled: z.boolean().optional(),
    mcpPermissionMode: mcpPermissionModeSchema.optional(),
    mcpPort: z.number().int().min(0).max(65535).optional(),
    defaultTimeZone: z.string().min(1).max(120).optional(),
    todayCapacityMinutes: z.number().int().min(5).max(24 * 60).optional(),
    todayWorkingHoursStart: z.number().int().min(0).max(23).optional(),
    todayWorkingHoursEnd: z.number().int().min(1).max(24).optional(),
    diagnosticsIncludePerformance: z.boolean().optional(),
    savedSearchViews: z.array(savedSearchViewSchema).max(20).optional(),
    savedTaskViews: z.array(savedTaskViewSchema).max(20).optional()
  })
  .strict()
  .refine((request) => Object.keys(request).length > 0, {
    message: "At least one setting must be supplied"
  });

export type SettingsUpdateRequest = z.input<typeof settingsUpdateRequestSchema>;

export const settingsRecoveryActionSchema = z.enum([
  "refresh",
  "forceFullResync",
  "clearGoogleCache",
  "resetOnboarding",
  "resetMcpToken"
]);

export const settingsRecoveryActionRequestSchema = z
  .object({
    action: settingsRecoveryActionSchema,
    confirmation: z
      .object({
        accepted: z.boolean(),
        phrase: z.string().trim().max(80).optional()
      })
      .strict()
      .optional()
  })
  .strict();

export type SettingsRecoveryActionRequest = z.input<
  typeof settingsRecoveryActionRequestSchema
>;

export const settingsRecoveryActionResponseSchema = z
  .object({
    action: settingsRecoveryActionSchema,
    accepted: z.boolean(),
    destructive: z.boolean(),
    requiresReload: z.boolean(),
    message: z.string().min(1).max(500)
  })
  .strict();

export type SettingsRecoveryActionResponse = z.infer<
  typeof settingsRecoveryActionResponseSchema
>;

export const mcpStatusRequestSchema = emptyRequestSchema;

export const mcpStatusResponseSchema = z
  .object({
    enabled: z.boolean(),
    running: z.boolean(),
    readOnly: z.boolean(),
    confirmationRequired: z.boolean(),
    permissionMode: mcpPermissionModeSchema,
    port: z.number().int().min(0).max(65535),
    tokenState: z.enum(["not_configured", "configured", "rotated"]),
    lastTokenResetAt: isoDateTimeSchema.optional(),
    url: z.literal("http://127.0.0.1").optional()
  })
  .strict();

export type McpStatusResponse = z.infer<typeof mcpStatusResponseSchema>;

export const mcpSetEnabledRequestSchema = z
  .object({
    enabled: z.boolean(),
    confirmationRequired: z.boolean().optional(),
    permissionMode: mcpPermissionModeSchema.optional(),
    port: z.number().int().min(0).max(65535).optional()
  })
  .strict();

export type McpSetEnabledRequest = z.input<typeof mcpSetEnabledRequestSchema>;

export const nativeCapabilitiesRequestSchema = emptyRequestSchema;

export const nativeFeatureStateSchema = z.enum([
  "pending",
  "ready",
  "disabled",
  "unsupported",
  "conflict",
  "error"
]);

export type NativeFeatureState = z.infer<typeof nativeFeatureStateSchema>;

const nativeStatusMessageSchema = z.string().min(1).max(500);

export const nativeFeatureStatusSchema = z
  .object({
    state: nativeFeatureStateSchema,
    message: nativeStatusMessageSchema.optional()
  })
  .strict();

export type NativeFeatureStatus = z.infer<typeof nativeFeatureStatusSchema>;

export const nativeCapabilityKeySchema = z.enum([
  "appPaths",
  "credentialStorage",
  "tray",
  "appMenu",
  "globalShortcuts",
  "notifications",
  "customProtocol",
  "autostart",
  "updater",
  "installerMetadata",
  "externalOpen",
  "diagnostics",
  "oauthLoopback",
  "mcpLoopback",
  "packaging"
]);

export type NativeCapabilityKey = z.infer<typeof nativeCapabilityKeySchema>;

const nativePathRoleSchema = z.enum([
  "config",
  "data",
  "cache",
  "logs",
  "diagnostics",
  "temp"
]);

export const nativePathCapabilitySchema = z
  .object({
    role: nativePathRoleSchema,
    available: z.boolean(),
    source: z.string().min(1).max(120),
    redactedPath: z.string().min(1).max(1_000).optional()
  })
  .strict();

export type NativePathCapability = z.infer<typeof nativePathCapabilitySchema>;

export const nativeCapabilityDescriptorSchema = z
  .object({
    key: nativeCapabilityKeySchema,
    label: z.string().min(1).max(80),
    supported: z.boolean(),
    state: nativeFeatureStateSchema,
    message: nativeStatusMessageSchema.optional()
  })
  .strict();

export type NativeCapabilityDescriptor = z.infer<
  typeof nativeCapabilityDescriptorSchema
>;

export const nativeCapabilityDiagnosticSchema = z
  .object({
    key: nativeCapabilityKeySchema,
    severity: z.enum(["info", "warning", "blocker"]),
    message: nativeStatusMessageSchema
  })
  .strict();

export type NativeCapabilityDiagnostic = z.infer<
  typeof nativeCapabilityDiagnosticSchema
>;

export const nativeCapabilityFlagsSchema = z
  .object({
    supportsAppPaths: z.boolean(),
    supportsTray: z.boolean(),
    supportsAppMenu: z.boolean(),
    supportsGlobalShortcut: z.boolean(),
    supportsNotifications: z.boolean(),
    supportsNotificationPermissionQuery: z.boolean(),
    supportsProtocolRegistration: z.boolean(),
    supportsProtocolRegistrationCheck: z.boolean(),
    supportsAutostart: z.boolean(),
    supportsInPlaceAutoUpdate: z.boolean(),
    supportsInstallerMetadata: z.boolean(),
    supportsExternalUrlOpen: z.boolean(),
    supportsDiagnosticsCollection: z.boolean(),
    supportsCredentialStorage: z.boolean(),
    supportsOAuthLoopback: z.boolean(),
    supportsMcpLoopback: z.boolean(),
    requiresSignedBuildForNotifications: z.boolean(),
    hasWaylandSession: z.boolean().optional(),
    hasPortalShortcutSupport: z.boolean().optional()
  })
  .strict();

export type NativeCapabilityFlags = z.infer<typeof nativeCapabilityFlagsSchema>;

export const nativeCapabilityReportSchema = z
  .object({
    platform: z.enum(["darwin", "linux", "win32", "unknown"]),
    adapterId: z.string().min(1).max(80),
    packageFormat: z
      .enum([
        "development",
        "dmg",
        "zip",
        "appimage",
        "deb",
        "rpm",
        "nsis",
        "portable",
        "unknown"
      ])
      .default("development"),
    flags: nativeCapabilityFlagsSchema,
    paths: z.array(nativePathCapabilitySchema).max(12),
    capabilities: z.array(nativeCapabilityDescriptorSchema).max(24),
    diagnostics: z.array(nativeCapabilityDiagnosticSchema).max(40)
  })
  .strict();

export type NativeCapabilityReport = z.infer<typeof nativeCapabilityReportSchema>;

export const nativeHotkeyStatusSchema = nativeFeatureStatusSchema
  .extend({
    accelerator: z.string().min(1).max(120).nullable(),
    registered: z.boolean()
  })
  .strict();

export type NativeHotkeyStatus = z.infer<typeof nativeHotkeyStatusSchema>;

export const nativeNotificationStatusSchema = nativeFeatureStatusSchema
  .extend({
    permission: z.enum(["granted", "denied", "prompt", "unsupported"]),
    scheduledCount: z.number().int().nonnegative()
  })
  .strict();

export type NativeNotificationStatus = z.infer<typeof nativeNotificationStatusSchema>;

export const nativeDeepLinkStatusSchema = nativeFeatureStatusSchema
  .extend({
    scheme: z.literal("hotcrossbuns"),
    registered: z.boolean()
  })
  .strict();

export type NativeDeepLinkStatus = z.infer<typeof nativeDeepLinkStatusSchema>;

export const nativeDeferredStartupStatusSchema = z
  .object({
    state: z.enum(["pending", "running", "complete", "error"]),
    startedAt: isoDateTimeSchema.optional(),
    completedAt: isoDateTimeSchema.optional(),
    message: nativeStatusMessageSchema.optional()
  })
  .strict();

export type NativeDeferredStartupStatus = z.infer<typeof nativeDeferredStartupStatusSchema>;

export const nativeCapabilitiesResponseSchema = z
  .object({
    platform: z.enum(["darwin", "linux", "win32", "unknown"]),
    notifications: z.boolean(),
    globalShortcuts: z.boolean(),
    tray: z.boolean(),
    deepLinks: z.boolean(),
    trayStatus: nativeFeatureStatusSchema,
    quickCaptureShortcut: nativeHotkeyStatusSchema,
    notificationsStatus: nativeNotificationStatusSchema,
    deepLinkStatus: nativeDeepLinkStatusSchema,
    updaterStatus: nativeFeatureStatusSchema,
    mcpStatus: nativeFeatureStatusSchema,
    capabilityReport: nativeCapabilityReportSchema,
    deferredStartup: nativeDeferredStartupStatusSchema
  })
  .strict();

export type NativeCapabilitiesResponse = z.infer<typeof nativeCapabilitiesResponseSchema>;

export const nativeNotificationPermissionRequestSchema = emptyRequestSchema;

export const nativeNotificationPermissionResponseSchema = z
  .object({
    state: z.enum(["granted", "denied", "prompt", "unsupported"])
  })
  .strict();

export type NativeNotificationPermissionResponse = z.infer<
  typeof nativeNotificationPermissionResponseSchema
>;

export const nativeRouteSchema = z
  .object({
    kind: z.enum(["today", "tasks", "task", "calendar", "event", "notes", "note", "settings", "search"]),
    id: idSchema.optional(),
    query: z.string().min(1).max(200).optional()
  })
  .strict();

export type NativeRoute = z.infer<typeof nativeRouteSchema>;

export const nativeActionSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("quickCapture")
    })
    .strict(),
  z
    .object({
      type: z.literal("openSettings")
    })
    .strict(),
  z
    .object({
      type: z.literal("refresh")
    })
    .strict(),
  z
    .object({
      type: z.literal("openRoute"),
      route: nativeRouteSchema
    })
    .strict()
]);

export type NativeAction = z.infer<typeof nativeActionSchema>;

export const startupTimingSnapshotSchema = z
  .object({
    processStartedMs: z.number().nonnegative().optional(),
    appReadyMs: z.number().nonnegative().optional(),
    windowCreatedMs: z.number().nonnegative().optional(),
    rendererLoadedMs: z.number().nonnegative().optional(),
    shellVisibleMs: z.number().nonnegative().optional(),
    databaseReadyMs: z.number().nonnegative().optional(),
    cachedDataRenderedMs: z.number().nonnegative().optional()
  })
  .strict();

export type StartupTimingSnapshot = z.infer<typeof startupTimingSnapshotSchema>;

export const diagnosticsHealthRequestSchema = emptyRequestSchema;

const diagnosticsBuildMetadataSchema = z
  .object({
    appName: z.string().min(1).max(120),
    version: z.string().min(1).max(80),
    environment: z.enum(["development", "test", "production"]),
    electronVersion: z.string().min(1).max(80).optional(),
    nodeVersion: z.string().min(1).max(80),
    packaged: z.boolean(),
    commit: z.string().min(1).max(80).optional(),
    buildDate: isoDateTimeSchema.optional(),
    packageTool: z.string().min(1).max(80).optional()
  })
  .strict();

export const diagnosticsHealthResponseSchema = z
  .object({
    status: z.literal("ok"),
    version: z.string().min(1),
    environment: z.enum(["development", "test", "production"]),
    timestamp: isoDateTimeSchema,
    uptimeMs: z.number().nonnegative(),
    startup: startupTimingSnapshotSchema,
    build: diagnosticsBuildMetadataSchema
  })
  .strict();

export type DiagnosticsHealthResponse = z.infer<typeof diagnosticsHealthResponseSchema>;

export const diagnosticsShellVisibleRequestSchema = z
  .object({
    rendererNowMs: z.number().finite().nonnegative().optional()
  })
  .strict();

export type DiagnosticsShellVisibleRequest = z.input<
  typeof diagnosticsShellVisibleRequestSchema
>;

export const diagnosticsCachedDataRenderedRequestSchema = z
  .object({
    rendererNowMs: z.number().finite().nonnegative().optional()
  })
  .strict();

export type DiagnosticsCachedDataRenderedRequest = z.input<
  typeof diagnosticsCachedDataRenderedRequestSchema
>;

export const ipcRouteMetricSchema = z
  .object({
    route: z.string().min(1).max(160),
    totalCalls: z.number().int().nonnegative(),
    successCount: z.number().int().nonnegative(),
    failureCount: z.number().int().nonnegative(),
    validationFailures: z.number().int().nonnegative(),
    serviceFailures: z.number().int().nonnegative(),
    responseFailures: z.number().int().nonnegative(),
    averageDurationMs: z.number().nonnegative(),
    lastDurationMs: z.number().nonnegative().optional(),
    lastErrorCode: hcbErrorCodeSchema.optional(),
    lastSeenAt: isoDateTimeSchema.optional()
  })
  .strict();

export type IpcRouteMetric = z.infer<typeof ipcRouteMetricSchema>;

export const diagnosticsIpcMetricsRequestSchema = emptyRequestSchema;

export const diagnosticsIpcMetricsResponseSchema = z
  .object({
    totalCalls: z.number().int().nonnegative(),
    validationFailures: z.number().int().nonnegative(),
    serviceFailures: z.number().int().nonnegative(),
    responseFailures: z.number().int().nonnegative(),
    routes: z.array(ipcRouteMetricSchema).max(100)
  })
  .strict();

export type DiagnosticsIpcMetricsResponse = z.infer<
  typeof diagnosticsIpcMetricsResponseSchema
>;

export const localPerformanceTimingSchema = z
  .object({
    id: z.number().int().positive().optional(),
    kind: z.enum(["startup", "cached_render", "ipc", "sqlite_query", "search"]),
    name: z.string().min(1).max(160),
    durationMs: z.number().nonnegative(),
    createdAt: isoDateTimeSchema
  })
  .strict();

export type LocalPerformanceTiming = z.infer<typeof localPerformanceTimingSchema>;

export const diagnosticsPerformanceRequestSchema = z
  .object({
    limit: z.number().int().min(1).max(100).default(50)
  })
  .strict();

export type DiagnosticsPerformanceRequest = z.input<
  typeof diagnosticsPerformanceRequestSchema
>;

export const diagnosticsPerformanceResponseSchema = z
  .object({
    timings: z.array(localPerformanceTimingSchema).max(100)
  })
  .strict();

export type DiagnosticsPerformanceResponse = z.infer<
  typeof diagnosticsPerformanceResponseSchema
>;

export const diagnosticsSummaryRequestSchema = emptyRequestSchema;

const diagnosticsResourceSelectionSchema = z
  .object({
    id: idSchema,
    title: z.string().min(1).max(500),
    selected: z.boolean()
  })
  .strict();

const diagnosticsPendingMutationBucketSchema = z
  .object({
    resourceType: z.string().min(1).max(80),
    count: z.number().int().nonnegative()
  })
  .strict();

const diagnosticsSlowQuerySampleSchema = z
  .object({
    name: z.string().min(1).max(160),
    durationMs: z.number().nonnegative(),
    createdAt: isoDateTimeSchema
  })
  .strict();

const diagnosticsMcpRequestCountsSchema = z
  .object({
    totalRequests: z.number().int().nonnegative(),
    successCount: z.number().int().nonnegative(),
    rejectedCount: z.number().int().nonnegative(),
    errorCount: z.number().int().nonnegative(),
    rateLimitedCount: z.number().int().nonnegative()
  })
  .strict();

export const diagnosticsSummaryResponseSchema = z
  .object({
    status: z.literal("ok"),
    generatedAt: isoDateTimeSchema,
    account: z
      .object({
        state: z.enum(["signed_out", "connected", "reauth_required", "sync_paused"]),
        accountId: idSchema.optional(),
        email: z.string().email().max(254).optional(),
        displayName: z.string().max(200).nullable().optional(),
        grantedScopeCount: z.number().int().nonnegative(),
        missingScopeCount: z.number().int().nonnegative(),
        lastAuthenticatedAt: isoDateTimeSchema.optional(),
        updatedAt: isoDateTimeSchema.optional()
      })
      .strict(),
    sync: syncStatusResponseSchema.extend({ mode: syncModeSchema }).strict(),
    cache: z
      .object({
        taskListCount: z.number().int().nonnegative(),
        taskCount: z.number().int().nonnegative(),
        calendarCount: z.number().int().nonnegative(),
        eventCount: z.number().int().nonnegative(),
        noteCount: z.number().int().nonnegative(),
        performanceSampleCount: z.number().int().nonnegative(),
        migrationVersion: z.number().int().nonnegative(),
        migrationDurationMs: z.number().nonnegative()
      })
      .strict(),
    selectedResources: z
      .object({
        taskLists: z.array(diagnosticsResourceSelectionSchema).max(100),
        calendars: z.array(diagnosticsResourceSelectionSchema).max(100)
      })
      .strict(),
    checkpoints: z
      .object({
        totalCount: z.number().int().nonnegative(),
        tasksCount: z.number().int().nonnegative(),
        calendarCount: z.number().int().nonnegative(),
        lastUpdatedAt: isoDateTimeSchema.optional()
      })
      .strict(),
    pendingMutations: z
      .object({
        totalCount: z.number().int().nonnegative(),
        pendingCount: z.number().int().nonnegative(),
        applyingCount: z.number().int().nonnegative(),
        failedCount: z.number().int().nonnegative(),
        retryableCount: z.number().int().nonnegative(),
        authPausedCount: z.number().int().nonnegative(),
        nextRetryAt: isoDateTimeSchema.optional(),
        lastErrorCode: hcbErrorCodeSchema.optional(),
        byResourceType: z.array(diagnosticsPendingMutationBucketSchema).max(20)
      })
      .strict(),
    mcp: z
      .object({
        enabled: z.boolean(),
        running: z.boolean(),
        permissionMode: mcpPermissionModeSchema,
        confirmationRequired: z.boolean(),
        url: z.literal("http://127.0.0.1").optional(),
        port: z.number().int().min(0).max(65535),
        tokenState: z.enum(["not_configured", "configured", "rotated"]),
        lastTokenResetAt: isoDateTimeSchema.optional(),
        requestCounts: diagnosticsMcpRequestCountsSchema
      })
      .strict(),
    native: nativeCapabilityReportSchema,
    build: diagnosticsBuildMetadataSchema,
    performance: z
      .object({
        startup: startupTimingSnapshotSchema,
        migrationDurationMs: z.number().nonnegative(),
        lastSyncDurationMs: z.number().nonnegative().optional(),
        slowQuerySamples: z.array(diagnosticsSlowQuerySampleSchema).max(10),
        pendingMutationCounts: z
          .object({
            totalCount: z.number().int().nonnegative(),
            failedCount: z.number().int().nonnegative()
          })
          .strict(),
        mcpRequestCounts: diagnosticsMcpRequestCountsSchema
      })
      .strict(),
    redaction: z
      .object({
        credentials: z.literal("redacted"),
        googlePayloads: z.literal("omitted"),
        mcpBearerTokens: z.literal("redacted"),
        sensitiveBodies: z.literal("omitted")
      })
      .strict()
  })
  .strict();

export type DiagnosticsSummaryResponse = z.infer<typeof diagnosticsSummaryResponseSchema>;

export const ipcContracts = {
  tasks: {
    listTaskLists: defineIpcContract(
      "tasks",
      "listTaskLists",
      taskListsRequestSchema,
      taskListsResponseSchema
    ),
    list: defineIpcContract("tasks", "list", taskListRequestSchema, taskListResponseSchema),
    get: defineIpcContract("tasks", "get", entityByIdRequestSchema, taskDetailSchema),
    create: defineIpcContract("tasks", "create", taskCreateRequestSchema, taskDetailSchema),
    update: defineIpcContract("tasks", "update", taskUpdateRequestSchema, taskDetailSchema),
    complete: defineIpcContract(
      "tasks",
      "complete",
      taskCompletionRequestSchema,
      taskDetailSchema
    ),
    reopen: defineIpcContract("tasks", "reopen", taskCompletionRequestSchema, taskDetailSchema),
    move: defineIpcContract("tasks", "move", taskMoveRequestSchema, taskDetailSchema),
    delete: defineIpcContract("tasks", "delete", taskDeleteRequestSchema, mutationAckSchema),
    createTaskList: defineIpcContract(
      "tasks",
      "createTaskList",
      taskListCreateRequestSchema,
      taskListSummarySchema
    ),
    renameTaskList: defineIpcContract(
      "tasks",
      "renameTaskList",
      taskListRenameRequestSchema,
      taskListSummarySchema
    ),
    deleteTaskList: defineIpcContract(
      "tasks",
      "deleteTaskList",
      taskListDeleteRequestSchema,
      mutationAckSchema
    )
  },
  calendar: {
    listCalendars: defineIpcContract(
      "calendar",
      "listCalendars",
      calendarListRequestSchema,
      calendarListResponseSchema
    ),
    listEvents: defineIpcContract(
      "calendar",
      "listEvents",
      calendarRangeRequestSchema,
      calendarRangeResponseSchema
    ),
    get: defineIpcContract("calendar", "get", entityByIdRequestSchema, calendarEventDetailSchema),
    create: defineIpcContract(
      "calendar",
      "create",
      calendarEventCreateRequestSchema,
      calendarEventDetailSchema
    ),
    update: defineIpcContract(
      "calendar",
      "update",
      calendarEventUpdateRequestSchema,
      calendarEventDetailSchema
    ),
    delete: defineIpcContract(
      "calendar",
      "delete",
      calendarEventDeleteRequestSchema,
      mutationAckSchema
    ),
    listScheduledTaskBlocks: defineIpcContract(
      "calendar",
      "listScheduledTaskBlocks",
      scheduledTaskBlockListRequestSchema,
      scheduledTaskBlockListResponseSchema
    ),
    scheduleTaskBlock: defineIpcContract(
      "calendar",
      "scheduleTaskBlock",
      scheduledTaskBlockCreateRequestSchema,
      scheduledTaskBlockSummarySchema
    ),
    moveScheduledTaskBlock: defineIpcContract(
      "calendar",
      "moveScheduledTaskBlock",
      scheduledTaskBlockMoveRequestSchema,
      scheduledTaskBlockSummarySchema
    ),
    unscheduleTaskBlock: defineIpcContract(
      "calendar",
      "unscheduleTaskBlock",
      scheduledTaskBlockUnscheduleRequestSchema,
      mutationAckSchema
    ),
    scheduleSuggest: defineIpcContract(
      "calendar",
      "scheduleSuggest",
      calendarScheduleSuggestRequestSchema,
      calendarScheduleSuggestResponseSchema
    ),
    exportAvailability: defineIpcContract(
      "calendar",
      "exportAvailability",
      availabilityExportRequestSchema,
      availabilityExportResponseSchema
    )
  },
  notes: {
    list: defineIpcContract("notes", "list", noteListRequestSchema, noteListResponseSchema),
    get: defineIpcContract("notes", "get", entityByIdRequestSchema, noteDetailSchema),
    create: defineIpcContract("notes", "create", noteCreateRequestSchema, noteDetailSchema),
    update: defineIpcContract("notes", "update", noteUpdateRequestSchema, noteDetailSchema),
    delete: defineIpcContract("notes", "delete", noteDeleteRequestSchema, mutationAckSchema),
    linkSuggest: defineIpcContract(
      "notes",
      "linkSuggest",
      noteLinkSuggestRequestSchema,
      noteLinkSuggestResponseSchema
    ),
    listBrokenLinks: defineIpcContract(
      "notes",
      "listBrokenLinks",
      noteBrokenLinksRequestSchema,
      noteBrokenLinksResponseSchema
    )
  },
  search: {
    query: defineIpcContract(
      "search",
      "query",
      searchQueryRequestSchema,
      searchQueryResponseSchema
    )
  },
  sync: {
    status: defineIpcContract("sync", "status", syncStatusRequestSchema, syncStatusResponseSchema),
    runNow: defineIpcContract("sync", "runNow", syncRunNowRequestSchema, syncRunNowResponseSchema)
  },
  google: {
    status: defineIpcContract("google", "status", googleStatusRequestSchema, googleStatusResponseSchema),
    saveOAuthClient: defineIpcContract(
      "google",
      "saveOAuthClient",
      googleSaveOAuthClientRequestSchema,
      googleStatusResponseSchema
    ),
    beginOAuth: defineIpcContract(
      "google",
      "beginOAuth",
      googleBeginOAuthRequestSchema,
      googleBeginOAuthResponseSchema
    ),
    disconnect: defineIpcContract(
      "google",
      "disconnect",
      googleDisconnectRequestSchema,
      googleStatusResponseSchema
    )
  },
  settings: {
    get: defineIpcContract("settings", "get", settingsGetRequestSchema, settingsSnapshotSchema),
    update: defineIpcContract(
      "settings",
      "update",
      settingsUpdateRequestSchema,
      settingsSnapshotSchema
    ),
    recoveryAction: defineIpcContract(
      "settings",
      "recoveryAction",
      settingsRecoveryActionRequestSchema,
      settingsRecoveryActionResponseSchema
    )
  },
  mcp: {
    status: defineIpcContract("mcp", "status", mcpStatusRequestSchema, mcpStatusResponseSchema),
    setEnabled: defineIpcContract(
      "mcp",
      "setEnabled",
      mcpSetEnabledRequestSchema,
      mcpStatusResponseSchema
    )
  },
  native: {
    capabilities: defineIpcContract(
      "native",
      "capabilities",
      nativeCapabilitiesRequestSchema,
      nativeCapabilitiesResponseSchema
    ),
    requestNotificationPermission: defineIpcContract(
      "native",
      "requestNotificationPermission",
      nativeNotificationPermissionRequestSchema,
      nativeNotificationPermissionResponseSchema
    )
  },
  diagnostics: {
    health: defineIpcContract(
      "diagnostics",
      "health",
      diagnosticsHealthRequestSchema,
      diagnosticsHealthResponseSchema
    ),
    markShellVisible: defineIpcContract(
      "diagnostics",
      "markShellVisible",
      diagnosticsShellVisibleRequestSchema,
      startupTimingSnapshotSchema
    ),
    markCachedDataRendered: defineIpcContract(
      "diagnostics",
      "markCachedDataRendered",
      diagnosticsCachedDataRenderedRequestSchema,
      startupTimingSnapshotSchema
    ),
    ipcMetrics: defineIpcContract(
      "diagnostics",
      "ipcMetrics",
      diagnosticsIpcMetricsRequestSchema,
      diagnosticsIpcMetricsResponseSchema
    ),
    performance: defineIpcContract(
      "diagnostics",
      "performance",
      diagnosticsPerformanceRequestSchema,
      diagnosticsPerformanceResponseSchema
    ),
    summary: defineIpcContract(
      "diagnostics",
      "summary",
      diagnosticsSummaryRequestSchema,
      diagnosticsSummaryResponseSchema
    )
  }
} as const;

export type IpcContracts = typeof ipcContracts;
export type IpcDomainName = keyof IpcContracts;
export type IpcMethodName<Domain extends IpcDomainName> = keyof IpcContracts[Domain] & string;

export function resultSchemaForContract(contract: IpcContract) {
  return hcbResultSchema(contract.responseSchema);
}
