import { z } from "zod";
import {
  defaultNavigationTabOrder,
  defaultHistoryCategoryVisibility,
  defaultKeybindings,
  defaultLeaderKey,
  defaultLeaderKeybindings,
  defaultToolbarActionOrder,
  historyCategoryIds,
  hotkeyActionIds,
  navigationTabIds,
  toolbarActionIds
} from "../../settingsCatalog";
import { googleCalendarEventColorIds } from "../../googleCalendarColors";
import { appColorThemeIds } from "../themeCatalog";
import { emptyRequestSchema, idSchema, isoDateTimeSchema } from "./core";
import { taskStatusSchema } from "./tasks";

export const settingsGetRequestSchema = emptyRequestSchema;
export const appThemeSchema = z.enum(["system", "light", "dark"]);
export const appColorThemeSchema = z.enum(appColorThemeIds);
export const uiTextSizePointsSchema = z.number().min(9).max(24);
export const uiFontNameSchema = z.string().trim().min(1).max(120).nullable();
export const syncModeSchema = z.enum(["manual", "balanced", "near-real-time"]);
export const hcbStorageBackendSchema = z.enum(["google", "hcb-local", "hcb-hoster"]);
export const semanticSearchModeSettingSchema = z.enum(["lexical", "semantic", "hybrid"]);
export const appLanguageSchema = z.enum(["system", "en", "zh-Hans", "ta", "ms", "ko", "ja"]);
export const navigationPlacementSchema = z.enum(["left", "right"]);
export const navigationTabSchema = z.enum(navigationTabIds);
export const toolbarActionSchema = z.enum(toolbarActionIds);
export const calendarViewModeSchema = z.enum(["agenda", "day", "multiDay", "week", "month"]);
export const calendarTimelineDensitySchema = z.enum(["compact", "comfortable", "spacious"]);
export const eventCompletionDefaultScopeSchema = z.enum([
  "occurrence",
  "seriesFuture",
  "seriesAll",
  "ask"
]);
export const trayClickActionSchema = z.enum([
  "open-menu",
  "toggle-window",
  "open-today"
]);
export const menuBarPanelStyleSchema = z.enum(["adaptive", "calendar"]);
export const mcpPermissionModeSchema = z.enum([
  "read-only",
  "confirm-writes",
  "allow-writes"
]);
export const hotkeyActionIdSchema = z.enum(hotkeyActionIds);
export const keybindingsSchema = z
  .record(hotkeyActionIdSchema, z.string().trim().min(1).max(120).nullable())
  .default(defaultKeybindings);
export const leaderKeybindingsSchema = z
  .record(hotkeyActionIdSchema, z.string().trim().min(1).max(120).nullable())
  .default(defaultLeaderKeybindings);
export const completionSoundIds = [
  "glass",
  "pop",
  "chime",
  "click",
  "ding",
  "pluck",
  "tick",
  "sparkle",
  "success",
  "softBell",
  "arcade",
  "wood",
  "coin",
  "rise",
  "pulse"
] as const;
export const menuBarIconNames = [
  "calendar"
] as const;
export const completionSoundIdSchema = z.enum(completionSoundIds);
export const menuBarIconNameSchema = z.enum(menuBarIconNames);
export const menuBarCalendarDoneModeSchema = z.enum([
  "visibleTodayDone",
  "tasksOnly",
  "neverAutoSwitch"
]);
export const customMenuBarIconSchema = z
  .object({
    id: idSchema,
    name: z.string().trim().min(1).max(80),
    fileName: z.string().trim().min(1).max(200),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema
  })
  .strict();
export const perTabListFilterSchema = z
  .object({
    useCustomFilter: z.boolean(),
    selectedTaskListIds: z.array(idSchema).max(100)
  })
  .strict();
export const perTabListFiltersSchema = z
  .object({
    tasks: perTabListFilterSchema,
    notes: perTabListFilterSchema
  })
  .strict();
export const defaultPerTabListFilters = {
  tasks: {
    useCustomFilter: false,
    selectedTaskListIds: []
  },
  notes: {
    useCustomFilter: false,
    selectedTaskListIds: []
  }
} satisfies z.infer<typeof perTabListFiltersSchema>;
export const historyCategoryVisibilitySchema = z
  .record(z.enum(historyCategoryIds), z.boolean())
  .default(defaultHistoryCategoryVisibility);
export const perSurfaceFontKeySchema = z.enum([
  "markdownEditor",
  "sidebar",
  "calendarGrid",
  "taskList",
  "inspector",
  "menuBar"
]);
export const perSurfaceFontOverrideSchema = z
  .object({
    uiFontName: uiFontNameSchema,
    uiTextSizePoints: uiTextSizePointsSchema.nullable()
  })
  .strict();
export const perSurfaceFontOverridesSchema = z
  .record(perSurfaceFontKeySchema, perSurfaceFontOverrideSchema)
  .default({});
const calendarColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
export const calendarEventColorOverrideSchema = z
  .object({
    background: calendarColorSchema,
    foreground: calendarColorSchema
  })
  .strict();
export const calendarEventColorOverridesSchema = z
  .record(z.enum(googleCalendarEventColorIds), calendarEventColorOverrideSchema)
  .default({});
export const customBackgroundPaletteSchema = z
  .object({
    isDark: z.boolean(),
    ember: calendarColorSchema,
    moss: calendarColorSchema,
    blue: calendarColorSchema,
    ink: calendarColorSchema,
    cream: calendarColorSchema,
    cardStroke: calendarColorSchema,
    dominant: calendarColorSchema,
    accents: z.array(calendarColorSchema).min(1).max(8)
  })
  .strict();
export const customBackgroundSchema = z
  .object({
    fileName: z.string().trim().min(1).max(240),
    mimeType: z.string().trim().min(1).max(120),
    dataBase64: z.string().trim().min(1).max(12_000_000),
    palette: customBackgroundPaletteSchema,
    updatedAt: isoDateTimeSchema
  })
  .strict()
  .nullable();
export type SettingsCustomBackgroundPalette = z.infer<typeof customBackgroundPaletteSchema>;
export type SettingsCustomBackground = z.infer<typeof customBackgroundSchema>;

export const autoTagRuleMatchKindSchema = z.enum(["prefix", "contains", "regex"]);
export const autoTagRuleTargetKindSchema = z.enum(["task", "event", "note"]);
export const autoTagRuleMatchFieldSchema = z.enum(["title", "body", "anyText"]);
export const autoTagBackgroundReapplyModeSchema = z.enum(["manual", "preview", "silent"]);
export const autoTagRuleSchema = z
  .object({
    id: idSchema,
    name: z.string().trim().min(1).max(80),
    enabled: z.boolean(),
    targetKinds: z.array(autoTagRuleTargetKindSchema).min(1).max(3),
    matchField: autoTagRuleMatchFieldSchema,
    matchType: autoTagRuleMatchKindSchema,
    pattern: z.string().trim().min(1).max(500),
    tags: z.array(z.string().trim().min(1).max(120)).max(64),
    stripMatchedPrefix: z.boolean(),
    eventColorId: z.enum(googleCalendarEventColorIds).nullable(),
    overrideExistingEventColor: z.boolean(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema
  })
  .strict();

export type AutoTagRule = z.infer<typeof autoTagRuleSchema>;

export const savedSearchViewSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1).max(80),
    query: z.string().min(1).max(500),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema
  })
  .strict();

export type SavedSearchView = z.infer<typeof savedSearchViewSchema>;

export const semanticSearchModelSchema = z
  .object({
    id: z.string().trim().min(1).max(120),
    label: z.string().trim().min(1).max(120),
    provider: z.enum(["transformers-js", "builtin"]),
    dimensions: z.number().int().min(1).max(4096),
    installed: z.boolean(),
    installState: z.enum(["not-installed", "installed", "error"]),
    cachePath: z.string().trim().max(1_000).nullable(),
    lastError: z.string().trim().max(500).nullable(),
    updatedAt: isoDateTimeSchema.nullable()
  })
  .strict();

export type SemanticSearchModel = z.infer<typeof semanticSearchModelSchema>;

export const defaultSemanticSearchModels = [
  {
    id: "Xenova/all-MiniLM-L6-v2",
    label: "MiniLM L6 v2",
    provider: "transformers-js",
    dimensions: 384,
    installed: false,
    installState: "not-installed",
    cachePath: null,
    lastError: null,
    updatedAt: null
  },
  {
    id: "hcb-local-hash-384",
    label: "Built-in lexical hash",
    provider: "builtin",
    dimensions: 384,
    installed: true,
    installState: "installed",
    cachePath: null,
    lastError: null,
    updatedAt: null
  }
] satisfies SemanticSearchModel[];

export const savedTaskViewSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1).max(80),
    filters: z
      .object({
        statuses: z.array(taskStatusSchema).max(4).optional(),
        listIds: z.array(idSchema).max(100).optional(),
        tags: z.array(z.string().min(1).max(120)).max(64).optional(),
        due: z.enum(["overdue", "today", "next14", "none"]).optional(),
        planned: z.enum(["planned", "unplanned"]).optional()
      })
      .strict(),
    groupBy: z.enum(["none", "dueDate", "list", "tag", "status"]),
    sortBy: z.enum(["dueDate", "updatedAt", "priority", "title"]),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema
  })
  .strict();

export type SavedTaskView = z.infer<typeof savedTaskViewSchema>;

export const taskTemplateSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1).max(80),
    title: z.string().min(1).max(200),
    notes: z.string().max(4_000).nullable(),
    dueExpression: z.string().min(1).max(120).nullable(),
    listId: idSchema.nullable(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema
  })
  .strict();

export type TaskTemplate = z.infer<typeof taskTemplateSchema>;

export const eventTemplateSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1).max(80),
    title: z.string().min(1).max(200),
    notes: z.string().max(4_000).nullable(),
    location: z.string().max(500).nullable(),
    calendarId: idSchema.nullable(),
    startExpression: z.string().min(1).max(120).nullable(),
    endExpression: z.string().min(1).max(120).nullable(),
    attendeeEmails: z.array(z.string().email()).max(50),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema
  })
  .strict();

export type EventTemplate = z.infer<typeof eventTemplateSchema>;

export const noteTemplateSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1).max(80),
    title: z.string().min(1).max(500),
    body: z.string().max(50_000),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema
  })
  .strict();

export type NoteTemplate = z.infer<typeof noteTemplateSchema>;

export const settingsSnapshotSchema = z
  .object({
    theme: appThemeSchema,
    colorTheme: appColorThemeSchema,
    customBackground: customBackgroundSchema,
    useInferredBackgroundTheme: z.boolean(),
    appLanguage: appLanguageSchema,
    uiFontName: uiFontNameSchema,
    uiTextSizePoints: uiTextSizePointsSchema,
    perSurfaceFontOverrides: perSurfaceFontOverridesSchema,
    calendarEventColorOverrides: calendarEventColorOverridesSchema,
    autoTagRules: z.array(autoTagRuleSchema).max(200),
    autoTagBackgroundReapplyMode: autoTagBackgroundReapplyModeSchema,
    disableAnimations: z.boolean(),
    uiLayoutScale: z.number().min(0.8).max(1.5),
    navigationPlacement: navigationPlacementSchema,
    hiddenNavigationTabs: z.array(navigationTabSchema).max(2),
    navigationTabOrder: z.array(navigationTabSchema).max(defaultNavigationTabOrder.length),
    toolbarActionOrder: z.array(toolbarActionSchema).max(defaultToolbarActionOrder.length),
    hiddenCalendarViewModes: z.array(calendarViewModeSchema).max(4),
    showCompletedInCalendarViews: z.boolean(),
    eventCompletionDefaultScope: eventCompletionDefaultScopeSchema,
    calendarTimelineDensity: calendarTimelineDensitySchema,
    monthScrollPastMonths: z.number().int().min(0).max(24),
    monthScrollFutureMonths: z.number().int().min(0).max(24),
    quickCreateExpandedByDefault: z.boolean(),
    restoreWindowStateEnabled: z.boolean(),
    startOnLogin: z.boolean(),
    keybindings: keybindingsSchema,
    leaderKey: z.string().trim().min(1).max(120).nullable(),
    leaderKeybindings: leaderKeybindingsSchema,
    selectedTaskListIds: z.array(idSchema).max(100),
    selectedCalendarIds: z.array(idSchema).max(100),
    setupCompletedAt: isoDateTimeSchema.nullable(),
    storageBackend: hcbStorageBackendSchema,
    hcbHosterEndpoint: z.string().url().max(500).nullable(),
    hcbVaultPath: z.string().trim().min(1).max(4_096).nullable(),
    syncMode: syncModeSchema,
    syncTasksEnabled: z.boolean(),
    syncCalendarEventsEnabled: z.boolean(),
    eventRetentionDaysBack: z.number().int().min(0).max(3650),
    completedTaskRetentionDaysBack: z.number().int().min(0).max(3650),
    showTrayIcon: z.boolean(),
    trayClickAction: trayClickActionSchema,
    menuBarPanelStyle: menuBarPanelStyleSchema,
    menuBarIconName: menuBarIconNameSchema,
    menuBarCalendarIconId: z.string().trim().min(1).max(120),
    menuBarCalendarDoneMode: menuBarCalendarDoneModeSchema,
    customMenuBarIcons: z.array(customMenuBarIconSchema).max(50),
    showMenuBarBadge: z.boolean(),
    showDockBadge: z.boolean(),
    notificationsEnabled: z.boolean(),
    notificationLeadMinutes: z.number().int().min(0).max(28 * 24 * 60),
    taskCompletionSoundEnabled: z.boolean(),
    taskCompletionSoundId: completionSoundIdSchema,
    eventCompletionSoundEnabled: z.boolean(),
    eventCompletionSoundId: completionSoundIdSchema,
    importedSoundCount: z.number().int().nonnegative().max(10_000),
    perTabListFilters: perTabListFiltersSchema,
    portableExportOnlySelectedTaskLists: z.boolean(),
    portableExportOnlySelectedCalendars: z.boolean(),
    portableExportOnlyFutureCurrentEvents: z.boolean(),
    dailyLocalBackupEnabled: z.boolean(),
    localBackupRetentionCount: z.number().int().min(1).max(365),
    lastLocalBackupAt: isoDateTimeSchema.nullable(),
    visibleHistoryEntryCount: z.number().int().min(10).max(500),
    historyStorageCap: z.number().int().min(100).max(50_000),
    historyCategoryVisibility: historyCategoryVisibilitySchema,
    dismissedDuplicateGroupIds: z.array(idSchema).max(1_000),
    taskTemplates: z.array(taskTemplateSchema).max(50),
    eventTemplates: z.array(eventTemplateSchema).max(50),
    noteTemplates: z.array(noteTemplateSchema).max(50),
    lastUpdateCheckAt: isoDateTimeSchema.nullable(),
    mcpEnabled: z.boolean(),
    mcpPermissionMode: mcpPermissionModeSchema,
    mcpPort: z.number().int().min(0).max(65535),
    localHostersEnabled: z.boolean(),
    localHosterPort: z.number().int().min(0).max(65535),
    defaultTimeZone: z.string().min(1).max(120),
    todayCapacityMinutes: z.number().int().min(5).max(24 * 60),
    todayWorkingHoursStart: z.number().int().min(0).max(23),
    todayWorkingHoursEnd: z.number().int().min(1).max(24),
    diagnosticsIncludePerformance: z.boolean(),
    rawGoogleDiagnosticsEnabled: z.boolean(),
    savedSearchViews: z.array(savedSearchViewSchema).max(20),
    pinnedSavedSearchViewIds: z.array(idSchema).max(20),
    savedTaskViews: z.array(savedTaskViewSchema).max(20),
    semanticSearchEnabled: z.boolean(),
    semanticSearchMode: semanticSearchModeSettingSchema,
    embeddingModelId: z.string().trim().min(1).max(120),
    semanticSearchModels: z.array(semanticSearchModelSchema).max(10),
    agentActionTrayEnabled: z.boolean(),
    webhooksEnabled: z.boolean()
  })
  .strict();

export type SettingsSnapshot = z.infer<typeof settingsSnapshotSchema>;

export const HCB_VAULT_FORMAT_VERSION = 1;
export const HCB_VAULT_KIND = "hot-cross-buns-2-vault";
export const HCB_VAULT_PAYLOAD_FILE = "payload.hcbenc";
export const HCB_VAULT_ALGORITHM = "scrypt-AES-256-GCM";

export const hcbVaultManifestSchema = z
  .object({
    formatVersion: z.literal(HCB_VAULT_FORMAT_VERSION),
    kind: z.literal(HCB_VAULT_KIND),
    exportedAt: isoDateTimeSchema,
    appVersion: z.string().min(1).max(80),
    stateEncoding: z.literal("hcb-portable-state-json"),
    stateSha256: z.string().regex(/^[0-9a-f]{64}$/),
    payloadFile: z.literal(HCB_VAULT_PAYLOAD_FILE),
    payloadSha256: z.string().regex(/^[0-9a-f]{64}$/),
    encryption: z
      .object({
        algorithm: z.literal(HCB_VAULT_ALGORITHM),
        kdf: z.literal("scrypt"),
        saltBase64: z.string().min(1).max(256),
        ivBase64: z.string().min(1).max(256),
        tagBase64: z.string().min(1).max(256),
        keyLength: z.literal(32),
        cost: z.number().int().min(16_384).max(1_048_576),
        blockSize: z.number().int().min(1).max(64),
        parallelization: z.number().int().min(1).max(16)
      })
      .strict(),
    notes: z.array(z.string().min(1).max(500)).max(10)
  })
  .strict();
export type HcbVaultManifest = z.infer<typeof hcbVaultManifestSchema>;

export const hcbVaultExportRequestSchema = z
  .object({
    out: z.string().trim().min(1).max(4_096).optional(),
    passphrase: z.string().min(8).max(4_096)
  })
  .strict();
export type HcbVaultExportRequest = z.input<typeof hcbVaultExportRequestSchema>;

export const hcbVaultImportRequestSchema = z
  .object({
    path: z.string().trim().min(1).max(4_096),
    passphrase: z.string().min(8).max(4_096)
  })
  .strict();
export type HcbVaultImportRequest = z.input<typeof hcbVaultImportRequestSchema>;

export const hcbVaultExportResponseSchema = z
  .object({
    path: z.string().min(1).max(4_096),
    exportedAt: isoDateTimeSchema,
    manifest: hcbVaultManifestSchema
  })
  .strict();
export type HcbVaultExportResponse = z.infer<typeof hcbVaultExportResponseSchema>;

export const hcbVaultImportResponseSchema = z
  .object({
    importedAt: isoDateTimeSchema,
    backupPath: z.string().min(1).max(4_096),
    manifest: hcbVaultManifestSchema
  })
  .strict();
export type HcbVaultImportResponse = z.infer<typeof hcbVaultImportResponseSchema>;

export const hcbVaultRemoteBaseRequestSchema = z
  .object({
    endpoint: z.string().url().max(500).optional(),
    token: z.string().min(8).max(4_096),
    allowInsecureHttp: z.boolean().optional()
  })
  .strict();

export const hcbVaultRemoteStatusRequestSchema = hcbVaultRemoteBaseRequestSchema;
export type HcbVaultRemoteStatusRequest = z.input<typeof hcbVaultRemoteStatusRequestSchema>;

export const hcbVaultRemoteInfoSchema = z
  .object({
    kind: z.literal("hcbVaultHostInfo"),
    protocolVersion: z.literal(1),
    hcbVaultFormatVersions: z.array(z.literal(HCB_VAULT_FORMAT_VERSION)).max(4),
    routes: z.array(z.string().min(1).max(120)).max(8),
    hasVault: z.boolean(),
    vaultName: z.string().min(1).max(500),
    maxPackageBytes: z.number().int().min(1),
    manifest: hcbVaultManifestSchema.optional()
  })
  .strict();
export type HcbVaultRemoteInfo = z.infer<typeof hcbVaultRemoteInfoSchema>;

export const hcbVaultRemoteStatusResponseSchema = z
  .object({
    endpoint: z.string().url().max(500),
    remote: hcbVaultRemoteInfoSchema
  })
  .strict();
export type HcbVaultRemoteStatusResponse = z.infer<typeof hcbVaultRemoteStatusResponseSchema>;

export const hcbVaultRemotePushRequestSchema = hcbVaultRemoteBaseRequestSchema.extend({
  passphrase: z.string().min(8).max(4_096),
  out: z.string().trim().min(1).max(4_096).optional()
}).strict();
export type HcbVaultRemotePushRequest = z.input<typeof hcbVaultRemotePushRequestSchema>;

export const hcbVaultRemotePushResponseSchema = z
  .object({
    endpoint: z.string().url().max(500),
    exportedAt: isoDateTimeSchema,
    path: z.string().min(1).max(4_096),
    manifest: hcbVaultManifestSchema,
    remote: hcbVaultRemoteInfoSchema
  })
  .strict();
export type HcbVaultRemotePushResponse = z.infer<typeof hcbVaultRemotePushResponseSchema>;

export const hcbVaultRemotePullRequestSchema = hcbVaultRemoteBaseRequestSchema.extend({
  passphrase: z.string().min(8).max(4_096),
  confirm: z.literal(true)
}).strict();
export type HcbVaultRemotePullRequest = z.input<typeof hcbVaultRemotePullRequestSchema>;

export const hcbVaultRemotePullResponseSchema = z
  .object({
    endpoint: z.string().url().max(500),
    importedAt: isoDateTimeSchema,
    backupPath: z.string().min(1).max(4_096),
    manifest: hcbVaultManifestSchema,
    remote: hcbVaultRemoteInfoSchema
  })
  .strict();
export type HcbVaultRemotePullResponse = z.infer<typeof hcbVaultRemotePullResponseSchema>;

export const settingsUpdateRequestSchema = z
  .object({
    theme: appThemeSchema.optional(),
    colorTheme: appColorThemeSchema.optional(),
    customBackground: customBackgroundSchema.optional(),
    useInferredBackgroundTheme: z.boolean().optional(),
    appLanguage: appLanguageSchema.optional(),
    uiFontName: uiFontNameSchema.optional(),
    uiTextSizePoints: uiTextSizePointsSchema.optional(),
    perSurfaceFontOverrides: perSurfaceFontOverridesSchema.optional(),
    calendarEventColorOverrides: calendarEventColorOverridesSchema.optional(),
    autoTagRules: z.array(autoTagRuleSchema).max(200).optional(),
    autoTagBackgroundReapplyMode: autoTagBackgroundReapplyModeSchema.optional(),
    disableAnimations: z.boolean().optional(),
    uiLayoutScale: z.number().min(0.8).max(1.5).optional(),
    navigationPlacement: navigationPlacementSchema.optional(),
    hiddenNavigationTabs: z.array(navigationTabSchema).max(2).optional(),
    navigationTabOrder: z.array(navigationTabSchema).max(defaultNavigationTabOrder.length).optional(),
    toolbarActionOrder: z.array(toolbarActionSchema).max(defaultToolbarActionOrder.length).optional(),
    hiddenCalendarViewModes: z.array(calendarViewModeSchema).max(4).optional(),
    showCompletedInCalendarViews: z.boolean().optional(),
    eventCompletionDefaultScope: eventCompletionDefaultScopeSchema.optional(),
    calendarTimelineDensity: calendarTimelineDensitySchema.optional(),
    monthScrollPastMonths: z.number().int().min(0).max(24).optional(),
    monthScrollFutureMonths: z.number().int().min(0).max(24).optional(),
    quickCreateExpandedByDefault: z.boolean().optional(),
    restoreWindowStateEnabled: z.boolean().optional(),
    startOnLogin: z.boolean().optional(),
    keybindings: keybindingsSchema.optional(),
    leaderKey: z.string().trim().min(1).max(120).nullable().optional(),
    leaderKeybindings: leaderKeybindingsSchema.optional(),
    selectedTaskListIds: z.array(idSchema).max(100).optional(),
    selectedCalendarIds: z.array(idSchema).max(100).optional(),
    setupCompletedAt: isoDateTimeSchema.nullable().optional(),
    storageBackend: hcbStorageBackendSchema.optional(),
    hcbHosterEndpoint: z.string().url().max(500).nullable().optional(),
    hcbVaultPath: z.string().trim().min(1).max(4_096).nullable().optional(),
    syncMode: syncModeSchema.optional(),
    syncTasksEnabled: z.boolean().optional(),
    syncCalendarEventsEnabled: z.boolean().optional(),
    eventRetentionDaysBack: z.number().int().min(0).max(3650).optional(),
    completedTaskRetentionDaysBack: z.number().int().min(0).max(3650).optional(),
    showTrayIcon: z.boolean().optional(),
    trayClickAction: trayClickActionSchema.optional(),
    menuBarPanelStyle: menuBarPanelStyleSchema.optional(),
    menuBarIconName: menuBarIconNameSchema.optional(),
    menuBarCalendarIconId: z.string().trim().min(1).max(120).optional(),
    menuBarCalendarDoneMode: menuBarCalendarDoneModeSchema.optional(),
    customMenuBarIcons: z.array(customMenuBarIconSchema).max(50).optional(),
    showMenuBarBadge: z.boolean().optional(),
    showDockBadge: z.boolean().optional(),
    notificationsEnabled: z.boolean().optional(),
    notificationLeadMinutes: z.number().int().min(0).max(28 * 24 * 60).optional(),
    taskCompletionSoundEnabled: z.boolean().optional(),
    taskCompletionSoundId: completionSoundIdSchema.optional(),
    eventCompletionSoundEnabled: z.boolean().optional(),
    eventCompletionSoundId: completionSoundIdSchema.optional(),
    importedSoundCount: z.number().int().nonnegative().max(10_000).optional(),
    perTabListFilters: perTabListFiltersSchema.optional(),
    portableExportOnlySelectedTaskLists: z.boolean().optional(),
    portableExportOnlySelectedCalendars: z.boolean().optional(),
    portableExportOnlyFutureCurrentEvents: z.boolean().optional(),
    dailyLocalBackupEnabled: z.boolean().optional(),
    localBackupRetentionCount: z.number().int().min(1).max(365).optional(),
    lastLocalBackupAt: isoDateTimeSchema.nullable().optional(),
    visibleHistoryEntryCount: z.number().int().min(10).max(500).optional(),
    historyStorageCap: z.number().int().min(100).max(50_000).optional(),
    historyCategoryVisibility: historyCategoryVisibilitySchema.optional(),
    dismissedDuplicateGroupIds: z.array(idSchema).max(1_000).optional(),
    taskTemplates: z.array(taskTemplateSchema).max(50).optional(),
    eventTemplates: z.array(eventTemplateSchema).max(50).optional(),
    noteTemplates: z.array(noteTemplateSchema).max(50).optional(),
    lastUpdateCheckAt: isoDateTimeSchema.nullable().optional(),
    mcpEnabled: z.boolean().optional(),
    mcpPermissionMode: mcpPermissionModeSchema.optional(),
    mcpPort: z.number().int().min(0).max(65535).optional(),
    localHostersEnabled: z.boolean().optional(),
    localHosterPort: z.number().int().min(0).max(65535).optional(),
    defaultTimeZone: z.string().min(1).max(120).optional(),
    todayCapacityMinutes: z.number().int().min(5).max(24 * 60).optional(),
    todayWorkingHoursStart: z.number().int().min(0).max(23).optional(),
    todayWorkingHoursEnd: z.number().int().min(1).max(24).optional(),
    diagnosticsIncludePerformance: z.boolean().optional(),
    rawGoogleDiagnosticsEnabled: z.boolean().optional(),
    savedSearchViews: z.array(savedSearchViewSchema).max(20).optional(),
    pinnedSavedSearchViewIds: z.array(idSchema).max(20).optional(),
    savedTaskViews: z.array(savedTaskViewSchema).max(20).optional(),
    semanticSearchEnabled: z.boolean().optional(),
    semanticSearchMode: semanticSearchModeSettingSchema.optional(),
    embeddingModelId: z.string().trim().min(1).max(120).optional(),
    semanticSearchModels: z.array(semanticSearchModelSchema).max(10).optional(),
    agentActionTrayEnabled: z.boolean().optional(),
    webhooksEnabled: z.boolean().optional()
  })
  .strict()
  .refine((request) => Object.keys(request).length > 0, {
    message: "At least one setting must be supplied"
  });

export type SettingsUpdateRequest = z.input<typeof settingsUpdateRequestSchema>;

export const settingsRecoveryActionSchema = z.enum([
  "refresh",
  "forceFullResync",
  "clearGoogleCache",
  "resetOnboarding",
  "resetMcpToken",
  "backupNow",
  "exportPortableArchive",
  "resetDuplicateDismissals",
  "checkForUpdates"
]);

export const settingsRecoveryActionRequestSchema = z
  .object({
    action: settingsRecoveryActionSchema,
    confirmation: z
      .object({
        accepted: z.boolean(),
        phrase: z.string().trim().max(80).optional()
      })
      .strict()
      .optional()
  })
  .strict();

export type SettingsRecoveryActionRequest = z.input<
  typeof settingsRecoveryActionRequestSchema
>;

export const settingsRecoveryActionResponseSchema = z
  .object({
    action: settingsRecoveryActionSchema,
    accepted: z.boolean(),
    destructive: z.boolean(),
    requiresReload: z.boolean(),
    message: z.string().min(1).max(500)
  })
  .strict();

export type SettingsRecoveryActionResponse = z.infer<
  typeof settingsRecoveryActionResponseSchema
>;

export const portableArchivePathRequestSchema = z
  .object({
    path: z.string().trim().min(1).max(4_096)
  })
  .strict();

export type PortableArchivePathRequest = z.input<typeof portableArchivePathRequestSchema>;

export const portableAttachmentManifestSchema = z
  .object({
    kind: z.enum(["image", "file"]),
    displayName: z.string().min(1).max(500),
    originalURL: z.string().min(1).max(4_096),
    bundledRelativePath: z.string().min(1).max(1_000),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    byteCount: z.number().int().nonnegative()
  })
  .strict();

export const portableArchiveManifestSchema = z
  .object({
    formatVersion: z.literal(1),
    exportedAt: isoDateTimeSchema,
    appVersion: z.string().min(1).max(80),
    stateFile: z.literal("hot-cross-buns-2-state.json"),
    stateSha256: z.string().regex(/^[0-9a-f]{64}$/),
    attachmentDirectory: z.literal("Attachments"),
    attachments: z.array(portableAttachmentManifestSchema).max(10_000),
    skippedPointers: z.array(z.string().min(1).max(4_096)).max(10_000),
    notes: z.array(z.string().min(1).max(500)).max(20)
  })
  .strict();

export type PortableArchiveManifest = z.infer<typeof portableArchiveManifestSchema>;

export const portableExportResponseSchema = z
  .object({
    path: z.string().min(1).max(4_096),
    exportedAt: isoDateTimeSchema,
    manifest: portableArchiveManifestSchema
  })
  .strict();

export type PortableExportResponse = z.infer<typeof portableExportResponseSchema>;

export const portableChangeCountSchema = z
  .object({
    added: z.number().int().nonnegative(),
    removed: z.number().int().nonnegative(),
    changed: z.number().int().nonnegative()
  })
  .strict();

export const portablePreviewItemSchema = z
  .object({
    id: idSchema,
    title: z.string().min(1).max(500),
    change: z.enum(["added", "removed", "changed"])
  })
  .strict();

export const portableImportPreviewSchema = z
  .object({
    path: z.string().min(1).max(4_096),
    exportedAt: isoDateTimeSchema,
    formatVersion: z.literal(1),
    destructive: z.literal(true),
    tasks: portableChangeCountSchema,
    events: portableChangeCountSchema,
    calendars: portableChangeCountSchema,
    taskLists: portableChangeCountSchema,
    settingsWillChange: z.boolean(),
    queuedMutationCount: z.number().int().nonnegative(),
    attachments: z
      .object({
        bundled: z.number().int().nonnegative(),
        missing: z.number().int().nonnegative(),
        corrupt: z.number().int().nonnegative(),
        skipped: z.number().int().nonnegative()
      })
      .strict(),
    items: z
      .object({
        tasks: z.array(portablePreviewItemSchema).max(50),
        events: z.array(portablePreviewItemSchema).max(50),
        calendars: z.array(portablePreviewItemSchema).max(50),
        taskLists: z.array(portablePreviewItemSchema).max(50)
      })
      .strict()
      .optional()
  })
  .strict();

export type PortableImportPreview = z.infer<typeof portableImportPreviewSchema>;

export const portableImportRequestSchema = portableArchivePathRequestSchema.extend({
  confirm: z.literal(true)
}).strict();

export type PortableImportRequest = z.input<typeof portableImportRequestSchema>;

export const portableImportResponseSchema = z
  .object({
    importedAt: isoDateTimeSchema,
    backupPath: z.string().min(1).max(4_096),
    preview: portableImportPreviewSchema
  })
  .strict();

export type PortableImportResponse = z.infer<typeof portableImportResponseSchema>;

export const localPointerKindSchema = z.enum(["task", "event"]);
export const localPointerSummarySchema = z
  .object({
    pointer: z.string().min(1).max(4_096),
    kind: localPointerKindSchema,
    entityId: idSchema,
    title: z.string().min(1).max(500),
    exists: z.boolean()
  })
  .strict();

export const localPointerListRequestSchema = z
  .object({
    includeHealthy: z.boolean().optional(),
    limit: z.number().int().min(1).max(500).default(100)
  })
  .strict();

export type LocalPointerListRequest = z.input<typeof localPointerListRequestSchema>;

export const localPointerListResponseSchema = z
  .object({
    items: z.array(localPointerSummarySchema).max(500),
    totalKnown: z.number().int().nonnegative()
  })
  .strict();

export type LocalPointerListResponse = z.infer<typeof localPointerListResponseSchema>;

export const localPointerRepairRequestSchema = z
  .object({
    pointer: z.string().min(1).max(4_096),
    replacementPath: z.string().trim().min(1).max(4_096),
    confirm: z.literal(true)
  })
  .strict();

export type LocalPointerRepairRequest = z.input<typeof localPointerRepairRequestSchema>;

export const localPointerRepairResponseSchema = z
  .object({
    pointer: z.string().min(1).max(4_096),
    replacementPointer: z.string().min(1).max(4_096),
    updated: z.number().int().nonnegative(),
    queued: z.boolean(),
    revision: isoDateTimeSchema
  })
  .strict();

export type LocalPointerRepairResponse = z.infer<typeof localPointerRepairResponseSchema>;

export const customizationSnippetSchema = z
  .object({
    id: idSchema,
    fileName: z.string().min(1).max(255),
    path: z.string().min(1).max(4_096),
    enabled: z.boolean(),
    sizeBytes: z.number().int().nonnegative(),
    updatedAt: isoDateTimeSchema.nullable(),
    content: z.string().max(200_000).optional(),
    error: z.string().min(1).max(500).nullable()
  })
  .strict();

export type CustomizationSnippet = z.infer<typeof customizationSnippetSchema>;

export const customizationExternalFileStatusSchema = z
  .object({
    path: z.string().min(1).max(4_096),
    exists: z.boolean(),
    valid: z.boolean(),
    appliedKeys: z.array(z.string().min(1).max(120)).max(120),
    conflicts: z.array(z.string().min(1).max(300)).max(50),
    error: z.string().min(1).max(500).nullable()
  })
  .strict();

export type CustomizationExternalFileStatus = z.infer<
  typeof customizationExternalFileStatusSchema
>;

export const customizationExtensionCapabilitySchema = z.enum([
  "ui.panel",
  "host.info",
  "log.write"
]);

export type CustomizationExtensionCapability = z.infer<
  typeof customizationExtensionCapabilitySchema
>;

export const customizationExtensionSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1).max(120),
    version: z.string().min(1).max(80),
    path: z.string().min(1).max(4_096),
    mainPath: z.string().min(1).max(4_096),
    enabled: z.boolean(),
    capabilities: z.array(customizationExtensionCapabilitySchema).max(10),
    code: z.string().max(200_000).optional(),
    logs: z.array(z.string().min(1).max(500)).max(100),
    error: z.string().min(1).max(500).nullable()
  })
  .strict();

export type CustomizationExtension = z.infer<typeof customizationExtensionSchema>;

export const customizationStatusResponseSchema = z
  .object({
    configDirectory: z.string().min(1).max(4_096),
    snippetsDirectory: z.string().min(1).max(4_096),
    extensionsDirectory: z.string().min(1).max(4_096),
    settingsJsonPath: z.string().min(1).max(4_096),
    keymapJsonPath: z.string().min(1).max(4_096),
    snippets: z.array(customizationSnippetSchema).max(200),
    externalSettings: customizationExternalFileStatusSchema,
    externalKeymap: customizationExternalFileStatusSchema,
    extensions: z.array(customizationExtensionSchema).max(100),
    safeMode: z.boolean()
  })
  .strict();

export type CustomizationStatusResponse = z.infer<
  typeof customizationStatusResponseSchema
>;

export const customizationToggleRequestSchema = z
  .object({
    id: idSchema,
    enabled: z.boolean()
  })
  .strict();

export type CustomizationToggleRequest = z.input<
  typeof customizationToggleRequestSchema
>;

export const customizationExtensionLogRequestSchema = z
  .object({
    extensionId: idSchema,
    level: z.enum(["info", "warn", "error"]).default("info"),
    message: z.string().trim().min(1).max(500)
  })
  .strict();

export type CustomizationExtensionLogRequest = z.input<
  typeof customizationExtensionLogRequestSchema
>;

export const attachmentEntityKindSchema = z.enum(["task", "event", "note"]);
export type AttachmentEntityKind = z.infer<typeof attachmentEntityKindSchema>;

export const attachmentSummarySchema = z
  .object({
    id: idSchema,
    entityKind: attachmentEntityKindSchema,
    entityId: idSchema,
    pointer: z.string().min(1).max(4_096),
    displayName: z.string().min(1).max(500),
    kind: z.enum(["image", "file"]),
    exists: z.boolean(),
    sizeBytes: z.number().int().nonnegative().nullable()
  })
  .strict();

export type AttachmentSummary = z.infer<typeof attachmentSummarySchema>;

export const attachmentListRequestSchema = z
  .object({
    entityKind: attachmentEntityKindSchema,
    entityId: idSchema
  })
  .strict();

export type AttachmentListRequest = z.input<typeof attachmentListRequestSchema>;

export const attachmentListResponseSchema = z
  .object({
    items: z.array(attachmentSummarySchema).max(200)
  })
  .strict();

export type AttachmentListResponse = z.infer<typeof attachmentListResponseSchema>;

export const attachmentAddRequestSchema = attachmentListRequestSchema.extend({
  fileName: z.string().trim().min(1).max(500),
  mimeType: z.string().trim().max(200).optional(),
  dataBase64: z.string().min(1).max(60_000_000)
}).strict();

export type AttachmentAddRequest = z.input<typeof attachmentAddRequestSchema>;

export const attachmentActionRequestSchema = z
  .object({
    pointer: z.string().min(1).max(4_096),
    displayName: z.string().trim().min(1).max(500).optional()
  })
  .strict();

export type AttachmentActionRequest = z.input<typeof attachmentActionRequestSchema>;

export const attachmentMutationResponseSchema = attachmentListResponseSchema.extend({
  queued: z.boolean(),
  revision: isoDateTimeSchema
}).strict();

export type AttachmentMutationResponse = z.infer<
  typeof attachmentMutationResponseSchema
>;

export const attachmentActionResponseSchema = z
  .object({
    path: z.string().min(1).max(4_096),
    message: z.string().min(1).max(500)
  })
  .strict();

export type AttachmentActionResponse = z.infer<
  typeof attachmentActionResponseSchema
>;

export const icsImportRequestSchema = z
  .object({
    fileName: z.string().trim().min(1).max(500),
    calendarTitle: z.string().trim().min(1).max(500).optional(),
    dataBase64: z.string().min(1).max(40_000_000)
  })
  .strict();

export type IcsImportRequest = z.input<typeof icsImportRequestSchema>;

export const icsSubscriptionCreateRequestSchema = z
  .object({
    url: z.string().trim().min(1).max(2_048),
    title: z.string().trim().min(1).max(500).optional(),
    refreshMinutes: z.number().int().min(15).max(7 * 24 * 60).default(360)
  })
  .strict();

export type IcsSubscriptionCreateRequest = z.input<
  typeof icsSubscriptionCreateRequestSchema
>;

export const icsSubscriptionActionRequestSchema = z
  .object({
    id: idSchema
  })
  .strict();

export type IcsSubscriptionActionRequest = z.input<
  typeof icsSubscriptionActionRequestSchema
>;

export const icsSubscriptionSummarySchema = z
  .object({
    id: idSchema,
    url: z.string().min(1).max(2_048),
    title: z.string().min(1).max(500),
    enabled: z.boolean(),
    refreshMinutes: z.number().int().min(15).max(7 * 24 * 60),
    calendarId: idSchema,
    lastAttemptAt: isoDateTimeSchema.nullable(),
    lastSuccessAt: isoDateTimeSchema.nullable(),
    lastError: z.string().min(1).max(500).nullable(),
    eventCount: z.number().int().nonnegative(),
    etag: z.string().min(1).max(500).nullable(),
    lastModified: z.string().min(1).max(500).nullable()
  })
  .strict();

export type IcsSubscriptionSummary = z.infer<typeof icsSubscriptionSummarySchema>;

export const icsImportResponseSchema = z
  .object({
    calendarId: idSchema,
    calendarTitle: z.string().min(1).max(500),
    importedEventCount: z.number().int().nonnegative(),
    skippedEventCount: z.number().int().nonnegative(),
    revision: isoDateTimeSchema
  })
  .strict();

export type IcsImportResponse = z.infer<typeof icsImportResponseSchema>;

export const icsSubscriptionsResponseSchema = z
  .object({
    items: z.array(icsSubscriptionSummarySchema).max(200)
  })
  .strict();

export type IcsSubscriptionsResponse = z.infer<
  typeof icsSubscriptionsResponseSchema
>;

export const localReportExportRequestSchema = z
  .object({
    range: z.enum(["today", "week", "custom"]).default("today"),
    format: z.enum(["markdown", "csv", "ics"]).default("markdown"),
    start: isoDateTimeSchema.optional(),
    end: isoDateTimeSchema.optional()
  })
  .strict();

export type LocalReportExportRequest = z.input<
  typeof localReportExportRequestSchema
>;

export const localReportExportResponseSchema = z
  .object({
    path: z.string().min(1).max(4_096),
    format: z.enum(["markdown", "csv", "ics"]),
    generatedAt: isoDateTimeSchema,
    itemCount: z.number().int().nonnegative()
  })
  .strict();

export type LocalReportExportResponse = z.infer<
  typeof localReportExportResponseSchema
>;
