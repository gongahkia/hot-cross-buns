import { z } from "zod";
import { cursorSchema, idSchema, isoDateTimeSchema, listLimitSchema, mutationAckSchema, pagedListResponseSchema } from "./core";

export const webhookEventSchema = z.enum([
  "task.created",
  "task.completed",
  "event.starting",
  "mutation.failed",
  "sync.completed"
]);
export type WebhookEvent = z.infer<typeof webhookEventSchema>;

export const webhookSubscriptionSchema = z
  .object({
    id: idSchema,
    url: z.string().url().max(2_000),
    events: z.array(webhookEventSchema).min(1).max(10),
    enabled: z.boolean(),
    includePrivateBodies: z.boolean(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
    lastDeliveryAt: isoDateTimeSchema.nullable(),
    lastError: z.string().max(500).nullable()
  })
  .strict();

export type WebhookSubscription = z.infer<typeof webhookSubscriptionSchema>;

export const webhookListRequestSchema = z
  .object({
    cursor: cursorSchema.optional(),
    limit: listLimitSchema
  })
  .strict();
export type WebhookListRequest = z.input<typeof webhookListRequestSchema>;

export const webhookListResponseSchema = pagedListResponseSchema(webhookSubscriptionSchema, 100);
export type WebhookListResponse = z.infer<typeof webhookListResponseSchema>;

export const webhookUpsertRequestSchema = z
  .object({
    id: idSchema.optional(),
    url: z.string().url().max(2_000),
    events: z.array(webhookEventSchema).min(1).max(10),
    enabled: z.boolean(),
    includePrivateBodies: z.boolean().optional()
  })
  .strict();
export type WebhookUpsertRequest = z.input<typeof webhookUpsertRequestSchema>;

export const webhookTestRequestSchema = z
  .object({ id: idSchema })
  .strict();
export type WebhookTestRequest = z.input<typeof webhookTestRequestSchema>;

export const webhookDeleteRequestSchema = z
  .object({ id: idSchema })
  .strict();
export type WebhookDeleteRequest = z.input<typeof webhookDeleteRequestSchema>;

export const webhookMutationResponseSchema = mutationAckSchema.extend({
  subscription: webhookSubscriptionSchema.optional()
});
export type WebhookMutationResponse = z.infer<typeof webhookMutationResponseSchema>;
