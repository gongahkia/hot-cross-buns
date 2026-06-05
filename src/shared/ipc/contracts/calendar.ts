import { z } from "zod";
import {
  MAX_LIST_LIMIT,
  MAX_RANGE_LIMIT,
  MAX_RANGE_WINDOW_DAYS,
  cursorSchema,
  dateOnlySchema,
  durationMinutesSchema,
  entityByIdRequestSchema,
  guestEmailSchema,
  idSchema,
  isoDateTimeSchema,
  listLimitSchema,
  millisecondsPerDay,
  pagedListResponseSchema,
  rangeLimitSchema,
  reminderMinutesSchema
} from "./core";
import { taskSummarySchema } from "./tasks";

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

const calendarColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/);

export const calendarListSummarySchema = z
  .object({
    id: idSchema,
    title: z.string().min(1).max(500),
    selected: z.boolean(),
    timeZone: z.string().min(1).max(120).nullable().optional(),
    backgroundColor: calendarColorSchema.nullable().optional(),
    foregroundColor: calendarColorSchema.nullable().optional(),
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

export const calendarConferenceSchema = z
  .object({
    solutionName: z.string().min(1).max(200).optional(),
    videoUri: z.string().min(1).max(1_300).optional(),
    videoLabel: z.string().min(1).max(512).optional(),
    phoneUri: z.string().min(1).max(1_300).optional(),
    phoneLabel: z.string().min(1).max(512).optional(),
    phonePin: z.string().min(1).max(128).optional(),
    moreUri: z.string().min(1).max(1_300).optional(),
    moreLabel: z.string().min(1).max(512).optional()
  })
  .strict();

export type CalendarConference = z.infer<typeof calendarConferenceSchema>;

export const calendarEventSummarySchema = z
  .object({
    id: idSchema,
    eventId: idSchema.optional(),
    linkedTaskId: idSchema.optional(),
    calendarId: idSchema,
    colorId: z.string().trim().min(1).max(32).nullable().optional(),
    title: z.string().min(1).max(500),
    startsAt: isoDateTimeSchema,
    endsAt: isoDateTimeSchema,
    allDay: z.boolean(),
    updatedAt: isoDateTimeSchema,
    location: z.string().max(1_000).optional(),
    notes: z.string().max(20_000).optional(),
    guestEmails: z.array(guestEmailSchema).max(50).optional(),
    reminderMinutes: z.array(reminderMinutesSchema).max(10).optional(),
    conference: calendarConferenceSchema.nullable().optional(),
    mutationState: z.enum(["synced", "queued", "failed"]).optional(),
    completedAt: isoDateTimeSchema.nullable().optional(),
    completionScopeApplied: z.enum(["occurrence", "seriesFuture", "seriesAll"]).optional(),
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
    count: z.number().int().min(1).max(366).nullable().optional(),
    byDay: z.array(z.enum(["SU", "MO", "TU", "WE", "TH", "FR", "SA"])).max(7).optional()
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

export const calendarEventCompletionScopeSchema = z.enum([
  "occurrence",
  "seriesFuture",
  "seriesAll"
]);

export type CalendarEventCompletionScope = z.infer<typeof calendarEventCompletionScopeSchema>;

export const calendarEventCompletionRequestSchema = z
  .object({
    id: idSchema,
    scope: calendarEventCompletionScopeSchema.optional()
  })
  .strict();

export type CalendarEventCompletionRequest = z.input<
  typeof calendarEventCompletionRequestSchema
>;

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
    colorId: z.string().trim().min(1).max(32).nullable().optional(),
    recurrence: calendarEventRecurrenceSchema.nullable().optional(),
    timeZone: z.string().trim().min(1).max(120).optional()
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
    colorId: z.string().trim().min(1).max(32).nullable().optional(),
    recurrence: calendarEventRecurrenceSchema.nullable().optional(),
    timeZone: z.string().trim().min(1).max(120).optional()
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
      request.colorId !== undefined ||
      request.recurrence !== undefined ||
      request.timeZone !== undefined,
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

export type ScheduledTaskBlockMoveRequest = z.input<typeof scheduledTaskBlockMoveRequestSchema>;

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
