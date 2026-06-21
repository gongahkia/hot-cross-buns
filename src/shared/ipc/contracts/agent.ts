import { z } from "zod";
import { cursorSchema, emptyRequestSchema, idSchema, isoDateTimeSchema, listLimitSchema, pagedListResponseSchema } from "./core";

export const agentActionStatusSchema = z.enum(["pending", "approved", "rejected", "expired", "applied", "failed"]);
export type AgentActionStatus = z.infer<typeof agentActionStatusSchema>;

export const agentActionSummarySchema = z
  .object({
    id: idSchema,
    status: agentActionStatusSchema,
    toolName: z.string().min(1).max(120),
    summary: z.string().min(1).max(500),
    createdAt: isoDateTimeSchema,
    expiresAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
    appliedAt: isoDateTimeSchema.nullable(),
    errorMessage: z.string().max(500).nullable()
  })
  .strict();

export type AgentActionSummary = z.infer<typeof agentActionSummarySchema>;

export const agentActionListRequestSchema = z
  .object({
    cursor: cursorSchema.optional(),
    limit: listLimitSchema,
    statuses: z.array(agentActionStatusSchema).max(6).optional()
  })
  .strict();

export type AgentActionListRequest = z.input<typeof agentActionListRequestSchema>;

export const agentActionListResponseSchema = pagedListResponseSchema(agentActionSummarySchema, 100);
export type AgentActionListResponse = z.infer<typeof agentActionListResponseSchema>;

export const agentActionApplyRequestSchema = z
  .object({ id: idSchema })
  .strict();

export type AgentActionApplyRequest = z.input<typeof agentActionApplyRequestSchema>;

export const agentActionRejectRequestSchema = z
  .object({ id: idSchema })
  .strict();

export type AgentActionRejectRequest = z.input<typeof agentActionRejectRequestSchema>;

export const agentActionApplyResponseSchema = z
  .object({
    action: agentActionSummarySchema,
    result: z.unknown().optional()
  })
  .strict();

export type AgentActionApplyResponse = z.infer<typeof agentActionApplyResponseSchema>;

export const agentActionRejectResponseSchema = z
  .object({ action: agentActionSummarySchema })
  .strict();

export type AgentActionRejectResponse = z.infer<typeof agentActionRejectResponseSchema>;

export const agentActionClearExpiredRequestSchema = emptyRequestSchema;
export const agentActionClearExpiredResponseSchema = z
  .object({ cleared: z.number().int().nonnegative() })
  .strict();

export type AgentActionClearExpiredResponse = z.infer<typeof agentActionClearExpiredResponseSchema>;
