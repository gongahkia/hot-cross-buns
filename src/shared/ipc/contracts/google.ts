import { z } from "zod";
import { emptyRequestSchema, idSchema, isoDateTimeSchema } from "./core";

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

export type GoogleAccountConnectionStatus = z.infer<typeof googleAccountConnectionStatusSchema>;

export const googleStatusRequestSchema = emptyRequestSchema;

export const googleStatusResponseSchema = z
  .object({
    oauthClientConfigured: z.boolean(),
    clientId: z.string().min(1).max(500).nullable(),
    hasClientSecret: z.boolean(),
    account: googleAccountConnectionStatusSchema.optional(),
    accounts: z.array(googleAccountConnectionStatusSchema).max(20).default([])
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
