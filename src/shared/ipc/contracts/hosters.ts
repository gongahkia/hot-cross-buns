import { z } from "zod";
import { idSchema, isoDateTimeSchema } from "./core";
import { mcpPermissionModeSchema } from "./settings";

export const localHosterCapabilitySchema = z.enum([
  "host.info",
  "signal.send",
  "planner.read",
  "planner.write"
]);
export type LocalHosterCapability = z.infer<typeof localHosterCapabilitySchema>;

export const localHosterProfileSchema = z
  .object({
    id: idSchema,
    name: z.string().trim().min(1).max(120),
    capabilities: z.array(localHosterCapabilitySchema).min(1).max(10),
    permissionMode: mcpPermissionModeSchema,
    endpoint: z.string().url().max(500),
    keyFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema
  })
  .strict();
export type LocalHosterProfile = z.infer<typeof localHosterProfileSchema>;

export const localHosterStatusResponseSchema = z
  .object({
    enabled: z.boolean(),
    running: z.boolean(),
    port: z.number().int().min(0).max(65535),
    url: z.literal("http://127.0.0.1").optional(),
    profiles: z.array(localHosterProfileSchema).max(200),
    lastError: z.string().min(1).max(500).optional()
  })
  .strict();
export type LocalHosterStatusResponse = z.infer<typeof localHosterStatusResponseSchema>;

export const localHosterCreateRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    capabilities: z.array(localHosterCapabilitySchema).min(1).max(10).optional(),
    permissionMode: mcpPermissionModeSchema.optional()
  })
  .strict();
export type LocalHosterCreateRequest = z.input<typeof localHosterCreateRequestSchema>;

export const localHosterExportRequestSchema = z
  .object({
    id: idSchema,
    out: z.string().trim().min(1).max(4_096),
    passphrase: z.string().min(8).max(4_096).optional()
  })
  .strict();
export type LocalHosterExportRequest = z.input<typeof localHosterExportRequestSchema>;

export const localHosterImportRequestSchema = z
  .object({
    path: z.string().trim().min(1).max(4_096),
    passphrase: z.string().min(8).max(4_096).optional()
  })
  .strict();
export type LocalHosterImportRequest = z.input<typeof localHosterImportRequestSchema>;

export const localHosterRemoveRequestSchema = z
  .object({
    id: idSchema
  })
  .strict();
export type LocalHosterRemoveRequest = z.input<typeof localHosterRemoveRequestSchema>;

export const localHosterTestRequestSchema = z
  .object({
    id: idSchema.optional(),
    privatePayload: z.boolean().optional()
  })
  .strict();
export type LocalHosterTestRequest = z.input<typeof localHosterTestRequestSchema>;

export const localHosterManifestSchema = z
  .object({
    formatVersion: z.literal(1),
    kind: z.literal("hot-cross-buns-2-local-hoster"),
    createdAt: isoDateTimeSchema,
    appVersion: z.string().min(1).max(80),
    hosterId: idSchema,
    name: z.string().trim().min(1).max(120),
    capabilities: z.array(localHosterCapabilitySchema).min(1).max(10),
    permissionMode: mcpPermissionModeSchema,
    endpoint: z.string().url().max(500),
    keyFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    payloadFile: z.literal("payload.hcbenc"),
    payloadSha256: z.string().regex(/^[0-9a-f]{64}$/),
    keyWrap: z
      .object({
        algorithm: z.literal("scrypt-AES-256-GCM"),
        kdf: z.literal("scrypt"),
        saltBase64: z.string().min(1).max(256),
        ivBase64: z.string().min(1).max(256),
        tagBase64: z.string().min(1).max(256),
        wrappedKeyBase64: z.string().min(1).max(512),
        keyLength: z.literal(32),
        cost: z.number().int().min(16_384).max(1_048_576),
        blockSize: z.number().int().min(1).max(64),
        parallelization: z.number().int().min(1).max(16)
      })
      .strict()
      .optional()
  })
  .strict();
export type LocalHosterManifest = z.infer<typeof localHosterManifestSchema>;

export const localHosterMutationResponseSchema = z
  .object({
    id: idSchema,
    path: z.string().min(1).max(4_096).optional(),
    profile: localHosterProfileSchema.optional(),
    manifest: localHosterManifestSchema.optional(),
    message: z.string().min(1).max(500)
  })
  .strict();
export type LocalHosterMutationResponse = z.infer<typeof localHosterMutationResponseSchema>;

export const localHosterSignalEnvelopeSchema = z
  .object({
    version: z.literal(1),
    algorithm: z.literal("X25519-HKDF-SHA256-AES-256-GCM"),
    ephemeralPublicKeyBase64: z.string().min(1).max(4096),
    saltBase64: z.string().min(1).max(256),
    ivBase64: z.string().min(1).max(256),
    tagBase64: z.string().min(1).max(256),
    ciphertextBase64: z.string().min(1).max(262_144)
  })
  .strict();
export type LocalHosterSignalEnvelope = z.infer<typeof localHosterSignalEnvelopeSchema>;

export const localHosterSignalPayloadSchema = z
  .object({
    formatVersion: z.literal(1),
    requestId: z.string().trim().regex(/^[A-Za-z0-9:_-]{8,120}$/),
    createdAt: isoDateTimeSchema,
    toolName: z.string().trim().min(1).max(120),
    arguments: z.record(z.unknown()).default({})
  })
  .strict();
export type LocalHosterSignalPayload = z.infer<typeof localHosterSignalPayloadSchema>;

export const localHosterSignalRequestSchema = z
  .object({
    profileId: idSchema,
    private: z.boolean().optional(),
    payload: localHosterSignalPayloadSchema.optional(),
    envelope: localHosterSignalEnvelopeSchema.optional()
  })
  .strict()
  .refine((value) => value.payload !== undefined || value.envelope !== undefined, {
    message: "payload or envelope is required"
  });
export type LocalHosterSignalRequest = z.infer<typeof localHosterSignalRequestSchema>;
