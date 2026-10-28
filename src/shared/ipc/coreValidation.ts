import { z } from "zod";

export const requestSchema = z.object({
  namespace: z.enum([
    "bootstrap", "tasks", "calendar", "notes", "tags", "search", "settings",
    "sync", "google", "undo", "native", "diagnostics", "agent", "duplicates"
  ]),
  action: z.string().min(1).max(80).regex(/^[a-zA-Z][a-zA-Z0-9]*$/),
  payload: z.object({}).catchall(z.unknown()).default({})
}).strict();

const actionMap: Record<string, readonly string[]> = {
  bootstrap: ["get"],
  tasks: ["listTaskLists", "list", "board", "context", "forCalendarRange", "get", "create", "update", "complete", "reopen", "delete", "move", "bulkReschedule", "createTaskList", "renameTaskList", "deleteTaskList"],
  calendar: ["listCalendars", "listEvents", "get", "create", "update", "delete", "complete", "reopen", "listScheduledTaskBlocks", "scheduleTaskBlock", "moveScheduledTaskBlock", "unscheduleTaskBlock", "exportAvailability", "freeBusy", "scheduleSuggest", "smartReschedule"],
  notes: ["list", "get", "create", "update", "delete", "createNoteList", "renameNoteList", "deleteNoteList", "linkSuggest", "legacyMigrationPreview", "importLegacyPseudoNotes"],
  tags: ["list", "create", "update", "delete"],
  search: ["query", "resolveLinks"],
  settings: ["get", "update", "recoveryAction"],
  sync: ["status", "runNow", "forceFullResync"],
  google: ["status", "saveOAuthClient", "beginOAuth", "reconfigureOptionalAccess", "cancelOAuth", "disconnect", "searchDriveFiles", "pickAndUploadDriveFile", "searchGmailMessages", "captureGmailMessage", "previewAccountCopy", "copyAccountData"],
  undo: ["status", "undo", "redo"],
  native: ["capabilities", "listFontFamilies", "requestNotificationPermission", "openExternalUrl", "importMenuBarIcon", "writeClipboardText"],
  diagnostics: ["summary", "logs", "history", "pendingMutations", "rescheduleNotifications", "retryPendingMutation", "cancelPendingMutation", "previewMutationResolution", "resolveMutation", "clearLogs", "copyableSummary", "exportBundle", "markCachedDataRendered", "recordTiming"],
  agent: [],
  duplicates: []
};

const isoDateSchema = z.string().datetime({ offset: true });
const idSchema = z.string().min(1).max(200);
const taskWriteSchema = z.object({
  id: idSchema.optional(), listId: idSchema.optional(), title: z.string().trim().min(1).max(10_000).optional(),
  notes: z.string().max(100_000).optional(), status: z.enum(["active", "completed", "deleted", "hidden"]).optional(),
  dueDate: z.string().max(100).nullable().optional(), parentId: idSchema.nullable().optional(), previousTaskId: idSchema.nullable().optional(),
  durationMinutes: z.number().finite().min(1).max(1_440).nullable().optional(), lockedSchedule: z.boolean().optional(),
  plannedStart: isoDateSchema.nullable().optional(), plannedEnd: isoDateSchema.nullable().optional(), accountId: idSchema.optional()
}).passthrough();
const eventWriteSchema = z.object({
  id: idSchema.optional(), calendarId: idSchema.optional(), title: z.string().trim().min(1).max(10_000).optional(),
  startsAt: isoDateSchema.optional(), endsAt: isoDateSchema.optional(), allDay: z.boolean().optional(),
  description: z.string().max(100_000).optional(), scope: z.enum(["series", "seriesAll", "occurrence", "following", "seriesFuture", "thisAndFollowing", "future"]).optional(),
  timeChangeOrigin: z.object({ startsAt: isoDateSchema, endsAt: isoDateSchema, allDay: z.boolean() }).strict().optional()
}).passthrough();

export function payloadIsValid(namespace: string, action: string, payload: Record<string, unknown>): boolean {
  if (!actionMap[namespace]?.includes(action)) return false;
  if (namespace === "diagnostics" && action === "previewMutationResolution") return z.object({ id: idSchema }).strict().safeParse(payload).success;
  if (namespace === "diagnostics" && action === "resolveMutation") return z.object({ id: idSchema, reviewId: z.string().uuid(), strategy: z.enum(["local", "google"]) }).strict().safeParse(payload).success;
  if (namespace === "tasks" && action === "context") return z.object({ id: idSchema }).strict().safeParse(payload).success;
  if (namespace === "search" && action === "resolveLinks") return z.object({ links: z.array(z.object({ kind: z.enum(["task","note","event"]), targetId: idSchema.optional(), label: z.string().max(500), fullBody: z.boolean().optional() }).strict()).max(50) }).strict().safeParse(payload).success;
  if (namespace === "tasks" && action === "forCalendarRange") return z.object({ start: isoDateSchema, end: isoDateSchema, limit: z.number().int().min(1).max(1000).optional(), cursor: z.string().regex(/^\d+$/).max(16).optional() }).strict().safeParse(payload).success;
  if (namespace === "tasks" && action === "board") return z.object({
    listId: idSchema.optional(), locateTaskId: idSchema.optional(), starred: z.boolean().optional(), sort: z.enum(["myOrder", "date", "deadline", "starred", "title"]).optional(),
    completedOpen: z.boolean().optional(), collapsedTaskIds: z.array(idSchema).max(10_000).optional(),
    cursor: z.string().regex(/^\d+$/).max(16).optional(), limit: z.number().int().min(1).max(200).optional()
  }).strict().safeParse(payload).success;
  if (namespace === "tasks" && action === "bulkReschedule") return z.object({ taskIds: z.array(idSchema).min(1).max(500), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable() }).strict().safeParse(payload).success;
  if (namespace === "tasks" && ["create", "update", "complete", "reopen", "delete", "move"].includes(action)) return taskWriteSchema.safeParse(payload).success;
  if (namespace === "calendar" && ["create", "update", "complete", "reopen"].includes(action)) return eventWriteSchema.safeParse(payload).success;
  if (namespace === "calendar" && action === "scheduleTaskBlock") return z.object({ taskId: idSchema, calendarId: idSchema, startsAt: isoDateSchema, endsAt: isoDateSchema.optional(), durationMinutes: z.number().finite().min(5).max(1_440).optional() }).safeParse(payload).success;
  if (namespace === "calendar" && action === "smartReschedule") return z.union([
    z.object({
      apply: z.literal(false).optional(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      calendarId: idSchema,
      workingHours: z.object({
        startMinutes: z.number().finite().min(0).max(1_439).optional(),
        endMinutes: z.number().finite().min(1).max(1_440).optional(),
        start: z.number().finite().min(0).max(24).optional(),
        end: z.number().finite().min(0).max(24).optional()
      }).strict().optional(),
      capacityMinutes: z.number().finite().min(5).max(1_440).optional(),
      candidateScope: z.enum(["dueSoon", "allOpen"]).optional()
    }).strict(),
    z.object({ apply: z.literal(true), planId: z.string().uuid() }).strict()
  ]).safeParse(payload).success;
  if (namespace === "calendar" && action === "exportAvailability") return z.object({ start: isoDateSchema, end: isoDateSchema, calendarIds: z.array(idSchema).max(100).optional(), format: z.literal("text").optional() }).safeParse(payload).success;
  if (namespace === "google" && action === "saveOAuthClient") return z.object({ clientId: z.string().trim().min(10).max(500), clientSecret: z.string().max(1_000).optional() }).safeParse(payload).success;
  if (namespace === "google" && action === "beginOAuth") return z.object({ requestedServices: z.array(z.enum(["drive", "driveUpload", "gmail"])).max(3).optional() }).safeParse(payload).success;
  if (namespace === "google" && action === "reconfigureOptionalAccess") return z.object({ accountId: idSchema, requestedServices: z.array(z.enum(["drive", "driveUpload", "gmail"])).max(3), confirmation: z.literal("RECONFIGURE_OPTIONAL_ACCESS") }).strict().safeParse(payload).success;
  if (namespace === "google" && action === "disconnect") return z.object({ accountId: idSchema.optional() }).safeParse(payload).success;
  if (namespace === "google" && ["searchDriveFiles", "searchGmailMessages"].includes(action)) return z.object({ accountId: idSchema.optional(), query: z.string().max(500).optional() }).safeParse(payload).success;
  if (namespace === "google" && action === "pickAndUploadDriveFile") return z.object({ accountId: idSchema.optional() }).strict().safeParse(payload).success;
  if (namespace === "google" && action === "captureGmailMessage") return z.object({ accountId: idSchema.optional(), listId: idSchema.optional(), messageId: idSchema, threadId: idSchema.optional(), subject: z.string().max(10_000).optional(), from: z.string().max(10_000).optional(), snippet: z.string().max(100_000).optional() }).safeParse(payload).success;
  if (namespace === "google" && action === "previewAccountCopy") return z.object({ sourceAccountId: idSchema, destinationAccountId: idSchema, destinationCalendarId: idSchema }).safeParse(payload).success;
  if (namespace === "google" && action === "copyAccountData") return z.object({ sourceAccountId: idSchema, destinationAccountId: idSchema, destinationCalendarId: idSchema, confirmation: z.literal("COPY") }).safeParse(payload).success;
  if (namespace === "calendar" && action === "freeBusy") return z.object({ accountId: idSchema.optional(), start: isoDateSchema, end: isoDateSchema, calendarIds: z.array(z.string().min(1).max(500)).min(1).max(50) }).safeParse(payload).success;
  if (namespace === "notes" && action === "list") return z.object({ listId: idSchema.optional(), summary: z.boolean().optional(), limit: z.number().int().min(1).max(1000).optional(), cursor: z.string().regex(/^\d+$/).max(16).optional() }).strict().safeParse(payload).success;
  if (namespace === "notes" && action === "create") return z.object({ title: z.string().trim().min(1).max(10_000), body: z.string().max(100_000).optional(), listId: idSchema.optional(), tags: z.array(z.string().trim().min(1).max(100)).max(100).optional() }).strict().safeParse(payload).success;
  if (namespace === "notes" && action === "update") return z.object({ id: idSchema, title: z.string().trim().min(1).max(10_000).optional(), body: z.string().max(100_000).optional(), listId: idSchema.optional(), tags: z.array(z.string().trim().min(1).max(100)).max(100).optional() }).strict().safeParse(payload).success;
  if (namespace === "notes" && action === "delete") return z.object({ id: idSchema }).strict().safeParse(payload).success;
  if (namespace === "notes" && action === "createNoteList") return z.object({ title: z.string().trim().min(1).max(500) }).strict().safeParse(payload).success;
  if (namespace === "notes" && action === "renameNoteList") return z.object({ id: idSchema, title: z.string().trim().min(1).max(500) }).strict().safeParse(payload).success;
  if (namespace === "notes" && action === "deleteNoteList") return z.object({ id: idSchema }).strict().safeParse(payload).success;
  if (namespace === "notes" && action === "legacyMigrationPreview") return z.object({ automatic: z.boolean().optional(), limit: z.number().int().min(1).max(1_000).optional() }).strict().safeParse(payload).success;
  if (namespace === "notes" && action === "importLegacyPseudoNotes") return z.object({ taskIds: z.array(idSchema).min(1).max(1_000) }).strict().safeParse(payload).success;
  if (namespace === "native" && action === "writeClipboardText") return z.object({ text: z.string().max(1_000_000) }).strict().safeParse(payload).success;
  if (namespace === "native" && action === "openExternalUrl") return z.object({ url: z.string().url().max(4_096) }).safeParse(payload).success;
  if (namespace === "settings" && action === "recoveryAction") return z.object({
    action: z.enum(["refresh", "forceFullResync", "resetOnboarding", "checkForUpdates", "backupNow", "exportBackup", "openBackupsFolder", "restoreLocalNotes"]),
    confirmation: z.object({ accepted: z.boolean(), phrase: z.string().max(100) }).optional()
  }).strict().safeParse(payload).success;
  return true;
}

