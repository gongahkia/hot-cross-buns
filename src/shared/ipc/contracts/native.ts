import { z } from "zod";
import { emptyRequestSchema, idSchema, isoDateTimeSchema } from "./core";

export const nativeCapabilitiesRequestSchema = emptyRequestSchema;

export const nativeFeatureStateSchema = z.enum([
  "pending",
  "ready",
  "disabled",
  "unsupported",
  "conflict",
  "error"
]);

export type NativeFeatureState = z.infer<typeof nativeFeatureStateSchema>;

const nativeStatusMessageSchema = z.string().min(1).max(500);

export const nativeFeatureStatusSchema = z
  .object({
    state: nativeFeatureStateSchema,
    message: nativeStatusMessageSchema.optional()
  })
  .strict();

export type NativeFeatureStatus = z.infer<typeof nativeFeatureStatusSchema>;

export const nativeUpdaterStatusSchema = nativeFeatureStatusSchema
  .extend({
    checkedAt: isoDateTimeSchema.optional(),
    downloadUrl: z.string().url().max(2_048).optional(),
    latestVersion: z.string().min(1).max(80).optional(),
    releaseName: z.string().min(1).max(200).optional(),
    releaseUrl: z.string().url().max(2_048).optional(),
    updateAvailable: z.boolean().optional()
  })
  .strict();

export type NativeUpdaterStatus = z.infer<typeof nativeUpdaterStatusSchema>;

export const nativeCapabilityKeySchema = z.enum([
  "appPaths",
  "credentialStorage",
  "tray",
  "appMenu",
  "globalShortcuts",
  "notifications",
  "customProtocol",
  "autostart",
  "updater",
  "installerMetadata",
  "externalOpen",
  "diagnostics",
  "oauthLoopback",
  "mcpLoopback",
  "packaging"
]);

export type NativeCapabilityKey = z.infer<typeof nativeCapabilityKeySchema>;

const nativePathRoleSchema = z.enum([
  "config",
  "data",
  "cache",
  "logs",
  "diagnostics",
  "temp"
]);

export const nativePathCapabilitySchema = z
  .object({
    role: nativePathRoleSchema,
    available: z.boolean(),
    source: z.string().min(1).max(120),
    redactedPath: z.string().min(1).max(1_000).optional()
  })
  .strict();

export type NativePathCapability = z.infer<typeof nativePathCapabilitySchema>;

export const nativeCapabilityDescriptorSchema = z
  .object({
    key: nativeCapabilityKeySchema,
    label: z.string().min(1).max(80),
    supported: z.boolean(),
    state: nativeFeatureStateSchema,
    message: nativeStatusMessageSchema.optional()
  })
  .strict();

export type NativeCapabilityDescriptor = z.infer<typeof nativeCapabilityDescriptorSchema>;

export const nativeCapabilityDiagnosticSchema = z
  .object({
    key: nativeCapabilityKeySchema,
    severity: z.enum(["info", "warning", "blocker"]),
    message: nativeStatusMessageSchema
  })
  .strict();

export type NativeCapabilityDiagnostic = z.infer<typeof nativeCapabilityDiagnosticSchema>;

export const nativeCapabilityFlagsSchema = z
  .object({
    supportsAppPaths: z.boolean(),
    supportsTray: z.boolean(),
    supportsAppMenu: z.boolean(),
    supportsGlobalShortcut: z.boolean(),
    supportsNotifications: z.boolean(),
    supportsNotificationPermissionQuery: z.boolean(),
    supportsProtocolRegistration: z.boolean(),
    supportsProtocolRegistrationCheck: z.boolean(),
    supportsAutostart: z.boolean(),
    supportsInPlaceAutoUpdate: z.boolean(),
    supportsInstallerMetadata: z.boolean(),
    supportsExternalUrlOpen: z.boolean(),
    supportsDiagnosticsCollection: z.boolean(),
    supportsCredentialStorage: z.boolean(),
    supportsOAuthLoopback: z.boolean(),
    supportsMcpLoopback: z.boolean(),
    requiresSignedBuildForNotifications: z.boolean(),
    hasWaylandSession: z.boolean().optional(),
    hasPortalShortcutSupport: z.boolean().optional()
  })
  .strict();

export type NativeCapabilityFlags = z.infer<typeof nativeCapabilityFlagsSchema>;

export const nativeCapabilityReportSchema = z
  .object({
    platform: z.enum(["darwin", "linux", "win32", "unknown"]),
    adapterId: z.string().min(1).max(80),
    packageFormat: z
      .enum([
        "development",
        "dmg",
        "zip",
        "appimage",
        "deb",
        "rpm",
        "nsis",
        "portable",
        "unknown"
      ])
      .default("development"),
    flags: nativeCapabilityFlagsSchema,
    paths: z.array(nativePathCapabilitySchema).max(12),
    capabilities: z.array(nativeCapabilityDescriptorSchema).max(24),
    diagnostics: z.array(nativeCapabilityDiagnosticSchema).max(40)
  })
  .strict();

export type NativeCapabilityReport = z.infer<typeof nativeCapabilityReportSchema>;

export const nativeNotificationStatusSchema = nativeFeatureStatusSchema
  .extend({
    permission: z.enum(["granted", "denied", "prompt", "unsupported"]),
    scheduledCount: z.number().int().nonnegative()
  })
  .strict();

export type NativeNotificationStatus = z.infer<typeof nativeNotificationStatusSchema>;

export const nativeDeepLinkStatusSchema = nativeFeatureStatusSchema
  .extend({
    scheme: z.literal("hotcrossbuns"),
    registered: z.boolean()
  })
  .strict();

export type NativeDeepLinkStatus = z.infer<typeof nativeDeepLinkStatusSchema>;

export const nativeDeferredStartupStatusSchema = z
  .object({
    state: z.enum(["pending", "running", "complete", "error"]),
    startedAt: isoDateTimeSchema.optional(),
    completedAt: isoDateTimeSchema.optional(),
    message: nativeStatusMessageSchema.optional()
  })
  .strict();

export type NativeDeferredStartupStatus = z.infer<typeof nativeDeferredStartupStatusSchema>;

export const nativeCapabilitiesResponseSchema = z
  .object({
    platform: z.enum(["darwin", "linux", "win32", "unknown"]),
    notifications: z.boolean(),
    globalShortcuts: z.boolean(),
    tray: z.boolean(),
    deepLinks: z.boolean(),
    trayStatus: nativeFeatureStatusSchema,
    notificationsStatus: nativeNotificationStatusSchema,
    deepLinkStatus: nativeDeepLinkStatusSchema,
    updaterStatus: nativeUpdaterStatusSchema,
    mcpStatus: nativeFeatureStatusSchema,
    capabilityReport: nativeCapabilityReportSchema,
    deferredStartup: nativeDeferredStartupStatusSchema
  })
  .strict();

export type NativeCapabilitiesResponse = z.infer<typeof nativeCapabilitiesResponseSchema>;

export const nativeOpenExternalUrlRequestSchema = z
  .object({
    url: z.string().url().max(2_048)
  })
  .strict();

export type NativeOpenExternalUrlRequest = z.infer<typeof nativeOpenExternalUrlRequestSchema>;

export const nativeNotificationPermissionRequestSchema = emptyRequestSchema;

export const nativeNotificationPermissionResponseSchema = z
  .object({
    state: z.enum(["granted", "denied", "prompt", "unsupported"])
  })
  .strict();

export type NativeNotificationPermissionResponse = z.infer<
  typeof nativeNotificationPermissionResponseSchema
>;

export const nativeFontFamiliesRequestSchema = emptyRequestSchema;

export const nativeFontFamiliesResponseSchema = z
  .object({
    platform: z.enum(["darwin", "linux", "win32", "unknown"]),
    families: z.array(z.string().trim().min(1).max(120)).max(2_000)
  })
  .strict();

export type NativeFontFamiliesResponse = z.infer<typeof nativeFontFamiliesResponseSchema>;

export const nativeImportMenuBarIconRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    dataBase64: z.string().trim().min(1).max(1_000_000)
  })
  .strict();

export const nativeImportMenuBarIconResponseSchema = z
  .object({
    id: idSchema,
    name: z.string().trim().min(1).max(80),
    fileName: z.string().trim().min(1).max(200),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema
  })
  .strict();

export type NativeImportMenuBarIconRequest = z.infer<typeof nativeImportMenuBarIconRequestSchema>;
export type NativeImportMenuBarIconResponse = z.infer<typeof nativeImportMenuBarIconResponseSchema>;

export const nativeRouteSchema = z
  .object({
    kind: z.enum([
      "today",
      "tasks",
      "task",
      "calendar",
      "event",
      "notes",
      "note",
      "settings",
      "search"
    ]),
    id: idSchema.optional(),
    query: z.string().min(1).max(200).optional()
  })
  .strict();

export type NativeRoute = z.infer<typeof nativeRouteSchema>;

export const nativeActionSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("openSettings")
    })
    .strict(),
  z
    .object({
      type: z.literal("refresh")
    })
    .strict(),
  z
    .object({
      type: z.literal("openQuickAdd")
    })
    .strict(),
  z
    .object({
      type: z.literal("openRoute"),
      route: nativeRouteSchema
    })
    .strict()
]);

export type NativeAction = z.infer<typeof nativeActionSchema>;
