import { z } from "zod";
import { hcbErrorCodeSchema } from "../result";
import { emptyRequestSchema, isoDateTimeSchema } from "./core";

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
    drainOnly: z.boolean().default(false),
    full: z.boolean().default(false),
    dryRun: z.boolean().default(false)
  })
  .strict();

export type SyncRunNowRequest = z.input<typeof syncRunNowRequestSchema>;

export const syncRunNowResponseSchema = z
  .object({
    accepted: z.boolean(),
    dryRun: z.boolean(),
    drainOnly: z.boolean().default(false),
    resources: z.array(z.enum(["tasks", "calendar", "hcb-vault"])).max(3)
  })
  .strict();

export type SyncRunNowResponse = z.infer<typeof syncRunNowResponseSchema>;
