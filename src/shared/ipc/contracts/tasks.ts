import { z } from "zod";
import {
  MAX_LIST_LIMIT,
  cursorSchema,
  dateOnlySchema,
  entityByIdRequestSchema,
  idSchema,
  isoDateTimeSchema,
  listLimitSchema,
  pagedListResponseSchema
} from "./core";

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
