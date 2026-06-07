import { z } from "zod";
import {
  defaultNavigationTabOrder,
  defaultHistoryCategoryVisibility,
  defaultKeybindings,
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

export const autoTagRuleMatchKindSchema = z.enum(["prefix", "contains", "regex"]);
export const autoTagRuleTargetKindSchema = z.enum(["task", "event", "note"]);
export const autoTagRuleMatchFieldSchema = z.enum(["title", "body", "anyText"]);
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
    appLanguage: appLanguageSchema,
    uiFontName: uiFontNameSchema,
    uiTextSizePoints: uiTextSizePointsSchema,
    perSurfaceFontOverrides: perSurfaceFontOverridesSchema,
    calendarEventColorOverrides: calendarEventColorOverridesSchema,
    autoTagRules: z.array(autoTagRuleSchema).max(200),
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
    selectedTaskListIds: z.array(idSchema).max(100),
    selectedCalendarIds: z.array(idSchema).max(100),
    setupCompletedAt: isoDateTimeSchema.nullable(),
    syncMode: syncModeSchema,
    syncTasksEnabled: z.boolean(),
    syncCalendarEventsEnabled: z.boolean(),
    eventRetentionDaysBack: z.number().int().min(0).max(3650),
    completedTaskRetentionDaysBack: z.number().int().min(0).max(3650),
    showTrayIcon: z.boolean(),
    trayClickAction: trayClickActionSchema,
    menuBarPanelStyle: menuBarPanelStyleSchema,
    menuBarIconName: menuBarIconNameSchema,
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
    defaultTimeZone: z.string().min(1).max(120),
    todayCapacityMinutes: z.number().int().min(5).max(24 * 60),
    todayWorkingHoursStart: z.number().int().min(0).max(23),
    todayWorkingHoursEnd: z.number().int().min(1).max(24),
    diagnosticsIncludePerformance: z.boolean(),
    rawGoogleDiagnosticsEnabled: z.boolean(),
    savedSearchViews: z.array(savedSearchViewSchema).max(20),
    savedTaskViews: z.array(savedTaskViewSchema).max(20)
  })
  .strict();

export type SettingsSnapshot = z.infer<typeof settingsSnapshotSchema>;

export const settingsUpdateRequestSchema = z
  .object({
    theme: appThemeSchema.optional(),
    colorTheme: appColorThemeSchema.optional(),
    appLanguage: appLanguageSchema.optional(),
    uiFontName: uiFontNameSchema.optional(),
    uiTextSizePoints: uiTextSizePointsSchema.optional(),
    perSurfaceFontOverrides: perSurfaceFontOverridesSchema.optional(),
    calendarEventColorOverrides: calendarEventColorOverridesSchema.optional(),
    autoTagRules: z.array(autoTagRuleSchema).max(200).optional(),
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
    selectedTaskListIds: z.array(idSchema).max(100).optional(),
    selectedCalendarIds: z.array(idSchema).max(100).optional(),
    setupCompletedAt: isoDateTimeSchema.nullable().optional(),
    syncMode: syncModeSchema.optional(),
    syncTasksEnabled: z.boolean().optional(),
    syncCalendarEventsEnabled: z.boolean().optional(),
    eventRetentionDaysBack: z.number().int().min(0).max(3650).optional(),
    completedTaskRetentionDaysBack: z.number().int().min(0).max(3650).optional(),
    showTrayIcon: z.boolean().optional(),
    trayClickAction: trayClickActionSchema.optional(),
    menuBarPanelStyle: menuBarPanelStyleSchema.optional(),
    menuBarIconName: menuBarIconNameSchema.optional(),
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
    defaultTimeZone: z.string().min(1).max(120).optional(),
    todayCapacityMinutes: z.number().int().min(5).max(24 * 60).optional(),
    todayWorkingHoursStart: z.number().int().min(0).max(23).optional(),
    todayWorkingHoursEnd: z.number().int().min(1).max(24).optional(),
    diagnosticsIncludePerformance: z.boolean().optional(),
    rawGoogleDiagnosticsEnabled: z.boolean().optional(),
    savedSearchViews: z.array(savedSearchViewSchema).max(20).optional(),
    savedTaskViews: z.array(savedTaskViewSchema).max(20).optional()
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
