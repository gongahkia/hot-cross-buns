import { z } from "zod";
import { hcbResultSchema } from "./result";

const identifierSchema = z.string().min(1).max(128);
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected an ISO date");
const isoTimestampSchema = z.string().datetime();

export const plannerTaskStatusSchema = z.enum(["open", "completed"]);
export type PlannerTaskStatus = z.infer<typeof plannerTaskStatusSchema>;

export const plannerTaskSchema = z
  .object({
    id: identifierSchema,
    title: z.string().trim().min(1).max(500),
    notes: z.string().max(20_000).default(""),
    dueDate: isoDateSchema.nullable().default(null),
    status: plannerTaskStatusSchema,
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
    revision: z.number().int().nonnegative()
  })
  .strict();
export type PlannerTask = z.infer<typeof plannerTaskSchema>;

export const plannerWorkspaceSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    taskCount: z.number().int().nonnegative(),
    openTaskCount: z.number().int().nonnegative(),
    completedTaskCount: z.number().int().nonnegative(),
    pendingMutationCount: z.number().int().nonnegative(),
    conflictCount: z.number().int().nonnegative(),
    searchIndexState: z.literal("ready")
  })
  .strict();
export type PlannerWorkspace = z.infer<typeof plannerWorkspaceSchema>;

export const plannerTaskListRequestSchema = z
  .object({
    query: z.string().trim().max(200).default(""),
    status: plannerTaskStatusSchema.optional(),
    limit: z.number().int().min(1).max(200).default(50),
    cursor: z.string().min(1).max(256).optional()
  })
  .strict();
export type PlannerTaskListRequest = z.infer<typeof plannerTaskListRequestSchema>;

export const plannerTaskPageSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    tasks: z.array(plannerTaskSchema),
    nextCursor: z.string().nullable()
  })
  .strict();
export type PlannerTaskPage = z.infer<typeof plannerTaskPageSchema>;

export const plannerSaveTaskRequestSchema = z
  .object({
    id: identifierSchema.optional(),
    title: z.string().trim().min(1).max(500),
    notes: z.string().max(20_000).default(""),
    dueDate: isoDateSchema.nullable().default(null),
    idempotencyKey: z.string().min(16).max(200)
  })
  .strict();
export type PlannerSaveTaskRequest = z.infer<typeof plannerSaveTaskRequestSchema>;

export const plannerCompleteTaskRequestSchema = z
  .object({
    id: identifierSchema,
    completed: z.boolean().default(true),
    idempotencyKey: z.string().min(16).max(200)
  })
  .strict();
export type PlannerCompleteTaskRequest = z.infer<typeof plannerCompleteTaskRequestSchema>;

export const plannerTaskMutationResultSchema = z
  .object({
    task: plannerTaskSchema,
    revision: z.number().int().nonnegative(),
    queued: z.boolean()
  })
  .strict();
export type PlannerTaskMutationResult = z.infer<typeof plannerTaskMutationResultSchema>;

export const plannerSyncStatusSchema = z
  .object({
    pendingMutationCount: z.number().int().nonnegative(),
    conflictCount: z.number().int().nonnegative(),
    nextAttemptAt: isoTimestampSchema.nullable(),
    lastSuccessfulDeliveryAt: isoTimestampSchema.nullable(),
    lastError: z.string().max(240).nullable()
  })
  .strict();
export type PlannerSyncStatus = z.infer<typeof plannerSyncStatusSchema>;

export const plannerWorkspaceResultSchema = hcbResultSchema(plannerWorkspaceSchema);
export const plannerTaskPageResultSchema = hcbResultSchema(plannerTaskPageSchema);
export const plannerTaskMutationResultEnvelopeSchema = hcbResultSchema(
  plannerTaskMutationResultSchema
);
export const plannerSyncStatusResultSchema = hcbResultSchema(plannerSyncStatusSchema);
