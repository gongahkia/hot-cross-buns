import { z } from "zod";
import { emptyRequestSchema, isoDateTimeSchema } from "./core";
import { mcpPermissionModeSchema } from "./settings";

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
