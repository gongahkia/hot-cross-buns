import { z } from "zod";
import { cursorSchema, emptyRequestSchema, idSchema, isoDateTimeSchema, listLimitSchema, pagedListResponseSchema } from "./core";

export const chatRoleSchema = z.enum(["user", "assistant", "system"]);
export type ChatRole = z.infer<typeof chatRoleSchema>;

export const chatMessageSchema = z
  .object({
    id: idSchema,
    sessionId: idSchema,
    role: chatRoleSchema,
    content: z.string().min(1).max(20_000),
    createdAt: isoDateTimeSchema
  })
  .strict();
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const chatSessionSchema = z
  .object({
    id: idSchema,
    title: z.string().min(1).max(120),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema
  })
  .strict();
export type ChatSession = z.infer<typeof chatSessionSchema>;

export const chatListSessionsRequestSchema = z
  .object({
    cursor: cursorSchema.optional(),
    limit: listLimitSchema
  })
  .strict();
export type ChatListSessionsRequest = z.input<typeof chatListSessionsRequestSchema>;

export const chatListSessionsResponseSchema = pagedListResponseSchema(chatSessionSchema, 100);
export type ChatListSessionsResponse = z.infer<typeof chatListSessionsResponseSchema>;

export const chatListMessagesRequestSchema = z
  .object({
    sessionId: idSchema,
    cursor: cursorSchema.optional(),
    limit: listLimitSchema
  })
  .strict();
export type ChatListMessagesRequest = z.input<typeof chatListMessagesRequestSchema>;

export const chatListMessagesResponseSchema = pagedListResponseSchema(chatMessageSchema, 100);
export type ChatListMessagesResponse = z.infer<typeof chatListMessagesResponseSchema>;

export const chatSendRequestSchema = z
  .object({
    sessionId: idSchema.optional(),
    message: z.string().trim().min(1).max(4_000)
  })
  .strict();
export type ChatSendRequest = z.input<typeof chatSendRequestSchema>;

export const chatSendResponseSchema = z
  .object({
    session: chatSessionSchema,
    userMessage: chatMessageSchema,
    assistantMessage: chatMessageSchema,
    provider: z.string().min(1).max(80),
    proposedActionIds: z.array(idSchema).max(20)
  })
  .strict();
export type ChatSendResponse = z.infer<typeof chatSendResponseSchema>;

export const chatClearRequestSchema = z
  .object({ sessionId: idSchema.optional() })
  .strict();
export const chatClearResponseSchema = z
  .object({ cleared: z.number().int().nonnegative() })
  .strict();
export type ChatClearRequest = z.input<typeof chatClearRequestSchema>;
export type ChatClearResponse = z.infer<typeof chatClearResponseSchema>;

export const chatProviderHealthRequestSchema = emptyRequestSchema;
export const chatProviderHealthResponseSchema = z
  .object({
    enabled: z.boolean(),
    provider: z.string().min(1).max(80),
    endpoint: z.string().max(2_000).nullable(),
    remoteAllowed: z.boolean(),
    ok: z.boolean(),
    message: z.string().min(1).max(500)
  })
  .strict();
export type ChatProviderHealthResponse = z.infer<typeof chatProviderHealthResponseSchema>;
