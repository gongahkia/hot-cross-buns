import { z } from "zod";
import { hcbErrorCodeSchema, hcbResultSchema } from "./result";

export const HCB_IPC_VERSION = 1;
export const HCB_IPC_CHANNEL = "hcb:ipc:v1";

export const IPC_CHANNELS = {
  dispatch: HCB_IPC_CHANNEL
} as const;

export const DEFAULT_LIST_LIMIT = 50;
export const MAX_LIST_LIMIT = 100;
export const DEFAULT_RANGE_LIMIT = 100;
export const MAX_RANGE_LIMIT = 500;
export const DEFAULT_SEARCH_LIMIT = 20;
export const MAX_SEARCH_LIMIT = 50;
export const MAX_RANGE_WINDOW_DAYS = 397;

const millisecondsPerDay = 24 * 60 * 60 * 1000;

export const hcbDomainSchema = z.enum([
  "tasks",
  "calendar",
  "notes",
  "search",
  "sync",
  "settings",
  "mcp",
  "native",
  "diagnostics"
]);

export type HcbDomain = z.infer<typeof hcbDomainSchema>;

export const ipcDispatchEnvelopeSchema = z
  .object({
    version: z.literal(HCB_IPC_VERSION),
    domain: hcbDomainSchema,
    method: z.string().min(1).max(80),
    request: z.unknown()
  })
  .strict();

export type IpcDispatchEnvelope = z.infer<typeof ipcDispatchEnvelopeSchema>;

export interface IpcContract {
  readonly domain: HcbDomain;
  readonly method: string;
  readonly requestSchema: z.ZodTypeAny;
  readonly responseSchema: z.ZodTypeAny;
}

export function defineIpcContract<
  const Domain extends HcbDomain,
  const Method extends string,
  RequestSchema extends z.ZodTypeAny,
  ResponseSchema extends z.ZodTypeAny
>(
  domain: Domain,
  method: Method,
  requestSchema: RequestSchema,
  responseSchema: ResponseSchema
) {
  return {
    domain,
    method,
    requestSchema,
    responseSchema
  } as const;
}

const emptyRequestSchema = z.object({}).strict();
export type EmptyRequest = z.infer<typeof emptyRequestSchema>;

const idSchema = z.string().min(1).max(256);
const cursorSchema = z.string().min(1).max(512);
const isoDateTimeSchema = z.string().datetime({ offset: true });

const listLimitSchema = z.number().int().min(1).max(MAX_LIST_LIMIT).default(DEFAULT_LIST_LIMIT);
const rangeLimitSchema = z
  .number()
  .int()
  .min(1)
  .max(MAX_RANGE_LIMIT)
  .default(DEFAULT_RANGE_LIMIT);
const searchLimitSchema = z
  .number()
  .int()
  .min(1)
  .max(MAX_SEARCH_LIMIT)
  .default(DEFAULT_SEARCH_LIMIT);

function pagedListResponseSchema<T extends z.ZodTypeAny>(itemSchema: T, maxItems: number) {
  return z
    .object({
      items: z.array(itemSchema).max(maxItems),
      page: z
        .object({
          limit: z.number().int().min(1).max(maxItems),
          nextCursor: cursorSchema.optional(),
          totalKnown: z.number().int().nonnegative().optional()
        })
        .strict()
    })
    .strict();
}

export const entityByIdRequestSchema = z
  .object({
    id: idSchema
  })
  .strict();

export type EntityByIdRequest = z.input<typeof entityByIdRequestSchema>;

export const mutationAckSchema = z
  .object({
    id: idSchema,
    queued: z.boolean(),
    revision: z.string().min(1).max(256).optional()
  })
  .strict();

export type MutationAck = z.infer<typeof mutationAckSchema>;

export const taskStatusSchema = z.enum(["active", "completed"]);

export const taskListRequestSchema = z
  .object({
    listId: idSchema.optional(),
    status: z.enum(["all", "active", "completed"]).default("active"),
    cursor: cursorSchema.optional(),
    limit: listLimitSchema
  })
  .strict();

export type TaskListRequest = z.input<typeof taskListRequestSchema>;

export const taskSummarySchema = z
  .object({
    id: idSchema,
    listId: idSchema,
    title: z.string().min(1).max(500),
    status: taskStatusSchema,
    dueAt: isoDateTimeSchema.nullable().optional(),
    updatedAt: isoDateTimeSchema
  })
  .strict();

export type TaskSummary = z.infer<typeof taskSummarySchema>;

export const taskListResponseSchema = pagedListResponseSchema(taskSummarySchema, MAX_LIST_LIMIT);
export type TaskListResponse = z.infer<typeof taskListResponseSchema>;

export const taskDetailSchema = taskSummarySchema
  .extend({
    notes: z.string().max(10_000).optional(),
    parentId: idSchema.nullable().optional()
  })
  .strict();

export type TaskDetail = z.infer<typeof taskDetailSchema>;

export const calendarRangeRequestSchema = z
  .object({
    calendarIds: z.array(idSchema).min(1).max(25).optional(),
    start: isoDateTimeSchema,
    end: isoDateTimeSchema,
    cursor: cursorSchema.optional(),
    limit: rangeLimitSchema
  })
  .strict()
  .superRefine((request, context) => {
    const startMs = Date.parse(request.start);
    const endMs = Date.parse(request.end);

    if (endMs <= startMs) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["end"],
        message: "End must be after start"
      });
      return;
    }

    if (endMs - startMs > MAX_RANGE_WINDOW_DAYS * millisecondsPerDay) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["end"],
        message: "Range window is too large"
      });
    }
  });

export type CalendarRangeRequest = z.input<typeof calendarRangeRequestSchema>;

export const calendarEventSummarySchema = z
  .object({
    id: idSchema,
    calendarId: idSchema,
    title: z.string().min(1).max(500),
    startsAt: isoDateTimeSchema,
    endsAt: isoDateTimeSchema,
    allDay: z.boolean(),
    updatedAt: isoDateTimeSchema
  })
  .strict();

export type CalendarEventSummary = z.infer<typeof calendarEventSummarySchema>;

export const calendarRangeResponseSchema = pagedListResponseSchema(
  calendarEventSummarySchema,
  MAX_RANGE_LIMIT
);

export type CalendarRangeResponse = z.infer<typeof calendarRangeResponseSchema>;

export const noteListRequestSchema = z
  .object({
    cursor: cursorSchema.optional(),
    limit: listLimitSchema
  })
  .strict();

export type NoteListRequest = z.input<typeof noteListRequestSchema>;

export const noteSummarySchema = z
  .object({
    id: idSchema,
    title: z.string().min(1).max(500),
    preview: z.string().max(500),
    updatedAt: isoDateTimeSchema
  })
  .strict();

export type NoteSummary = z.infer<typeof noteSummarySchema>;

export const noteListResponseSchema = pagedListResponseSchema(noteSummarySchema, MAX_LIST_LIMIT);
export type NoteListResponse = z.infer<typeof noteListResponseSchema>;

export const noteDetailSchema = noteSummarySchema
  .extend({
    body: z.string().max(50_000)
  })
  .strict();

export type NoteDetail = z.infer<typeof noteDetailSchema>;

export const searchDomainSchema = z.enum(["tasks", "calendar", "notes"]);

export const searchQueryRequestSchema = z
  .object({
    query: z.string().min(1).max(200),
    domains: z.array(searchDomainSchema).min(1).max(3).optional(),
    limit: searchLimitSchema
  })
  .strict();

export type SearchQueryRequest = z.input<typeof searchQueryRequestSchema>;

export const searchResultItemSchema = z
  .object({
    id: idSchema,
    domain: searchDomainSchema,
    title: z.string().min(1).max(500),
    snippet: z.string().max(500).optional(),
    updatedAt: isoDateTimeSchema.optional()
  })
  .strict();

export type SearchResultItem = z.infer<typeof searchResultItemSchema>;

export const searchQueryResponseSchema = pagedListResponseSchema(
  searchResultItemSchema,
  MAX_SEARCH_LIMIT
);

export type SearchQueryResponse = z.infer<typeof searchQueryResponseSchema>;

export const syncStatusRequestSchema = emptyRequestSchema;

export const syncStatusResponseSchema = z
  .object({
    state: z.enum(["idle", "running", "error"]),
    pendingMutationCount: z.number().int().nonnegative(),
    lastCompletedAt: isoDateTimeSchema.optional(),
    lastErrorCode: hcbErrorCodeSchema.optional()
  })
  .strict();

export type SyncStatusResponse = z.infer<typeof syncStatusResponseSchema>;

export const syncRunNowRequestSchema = z
  .object({
    resources: z.array(z.enum(["tasks", "calendar"])).min(1).max(2).optional(),
    full: z.boolean().default(false),
    dryRun: z.boolean().default(false)
  })
  .strict();

export type SyncRunNowRequest = z.input<typeof syncRunNowRequestSchema>;

export const syncRunNowResponseSchema = z
  .object({
    accepted: z.boolean(),
    dryRun: z.boolean(),
    resources: z.array(z.enum(["tasks", "calendar"])).min(1).max(2)
  })
  .strict();

export type SyncRunNowResponse = z.infer<typeof syncRunNowResponseSchema>;

export const settingsGetRequestSchema = emptyRequestSchema;

export const appThemeSchema = z.enum(["system", "light", "dark"]);

export const settingsSnapshotSchema = z
  .object({
    theme: appThemeSchema,
    startOnLogin: z.boolean(),
    quickCaptureShortcut: z.string().min(1).max(120).nullable(),
    mcpEnabled: z.boolean()
  })
  .strict();

export type SettingsSnapshot = z.infer<typeof settingsSnapshotSchema>;

export const settingsUpdateRequestSchema = z
  .object({
    theme: appThemeSchema.optional(),
    startOnLogin: z.boolean().optional(),
    quickCaptureShortcut: z.string().min(1).max(120).nullable().optional(),
    mcpEnabled: z.boolean().optional()
  })
  .strict()
  .refine((request) => Object.keys(request).length > 0, {
    message: "At least one setting must be supplied"
  });

export type SettingsUpdateRequest = z.input<typeof settingsUpdateRequestSchema>;

export const mcpStatusRequestSchema = emptyRequestSchema;

export const mcpStatusResponseSchema = z
  .object({
    enabled: z.boolean(),
    running: z.boolean(),
    readOnly: z.boolean(),
    confirmationRequired: z.boolean(),
    url: z.literal("http://127.0.0.1").optional()
  })
  .strict();

export type McpStatusResponse = z.infer<typeof mcpStatusResponseSchema>;

export const mcpSetEnabledRequestSchema = z
  .object({
    enabled: z.boolean(),
    confirmationRequired: z.boolean().optional()
  })
  .strict();

export type McpSetEnabledRequest = z.input<typeof mcpSetEnabledRequestSchema>;

export const nativeCapabilitiesRequestSchema = emptyRequestSchema;

export const nativeCapabilitiesResponseSchema = z
  .object({
    platform: z.enum(["darwin", "linux", "win32", "unknown"]),
    notifications: z.boolean(),
    globalShortcuts: z.boolean(),
    tray: z.boolean(),
    deepLinks: z.boolean()
  })
  .strict();

export type NativeCapabilitiesResponse = z.infer<typeof nativeCapabilitiesResponseSchema>;

export const nativeNotificationPermissionRequestSchema = emptyRequestSchema;

export const nativeNotificationPermissionResponseSchema = z
  .object({
    state: z.enum(["granted", "denied", "prompt", "unsupported"])
  })
  .strict();

export type NativeNotificationPermissionResponse = z.infer<
  typeof nativeNotificationPermissionResponseSchema
>;

export const startupTimingSnapshotSchema = z
  .object({
    processStartedMs: z.number().nonnegative().optional(),
    appReadyMs: z.number().nonnegative().optional(),
    windowCreatedMs: z.number().nonnegative().optional(),
    rendererLoadedMs: z.number().nonnegative().optional(),
    shellVisibleMs: z.number().nonnegative().optional(),
    databaseReadyMs: z.number().nonnegative().optional()
  })
  .strict();

export type StartupTimingSnapshot = z.infer<typeof startupTimingSnapshotSchema>;

export const diagnosticsHealthRequestSchema = emptyRequestSchema;

export const diagnosticsHealthResponseSchema = z
  .object({
    status: z.literal("ok"),
    version: z.string().min(1),
    environment: z.enum(["development", "test", "production"]),
    timestamp: isoDateTimeSchema,
    uptimeMs: z.number().nonnegative(),
    startup: startupTimingSnapshotSchema
  })
  .strict();

export type DiagnosticsHealthResponse = z.infer<typeof diagnosticsHealthResponseSchema>;

export const diagnosticsShellVisibleRequestSchema = z
  .object({
    rendererNowMs: z.number().finite().nonnegative().optional()
  })
  .strict();

export type DiagnosticsShellVisibleRequest = z.input<
  typeof diagnosticsShellVisibleRequestSchema
>;

export const ipcRouteMetricSchema = z
  .object({
    route: z.string().min(1).max(160),
    totalCalls: z.number().int().nonnegative(),
    successCount: z.number().int().nonnegative(),
    failureCount: z.number().int().nonnegative(),
    validationFailures: z.number().int().nonnegative(),
    serviceFailures: z.number().int().nonnegative(),
    responseFailures: z.number().int().nonnegative(),
    averageDurationMs: z.number().nonnegative(),
    lastDurationMs: z.number().nonnegative().optional(),
    lastErrorCode: hcbErrorCodeSchema.optional(),
    lastSeenAt: isoDateTimeSchema.optional()
  })
  .strict();

export type IpcRouteMetric = z.infer<typeof ipcRouteMetricSchema>;

export const diagnosticsIpcMetricsRequestSchema = emptyRequestSchema;

export const diagnosticsIpcMetricsResponseSchema = z
  .object({
    totalCalls: z.number().int().nonnegative(),
    validationFailures: z.number().int().nonnegative(),
    serviceFailures: z.number().int().nonnegative(),
    responseFailures: z.number().int().nonnegative(),
    routes: z.array(ipcRouteMetricSchema).max(100)
  })
  .strict();

export type DiagnosticsIpcMetricsResponse = z.infer<
  typeof diagnosticsIpcMetricsResponseSchema
>;

export const ipcContracts = {
  tasks: {
    list: defineIpcContract("tasks", "list", taskListRequestSchema, taskListResponseSchema),
    get: defineIpcContract("tasks", "get", entityByIdRequestSchema, taskDetailSchema)
  },
  calendar: {
    listEvents: defineIpcContract(
      "calendar",
      "listEvents",
      calendarRangeRequestSchema,
      calendarRangeResponseSchema
    )
  },
  notes: {
    list: defineIpcContract("notes", "list", noteListRequestSchema, noteListResponseSchema),
    get: defineIpcContract("notes", "get", entityByIdRequestSchema, noteDetailSchema)
  },
  search: {
    query: defineIpcContract(
      "search",
      "query",
      searchQueryRequestSchema,
      searchQueryResponseSchema
    )
  },
  sync: {
    status: defineIpcContract("sync", "status", syncStatusRequestSchema, syncStatusResponseSchema),
    runNow: defineIpcContract("sync", "runNow", syncRunNowRequestSchema, syncRunNowResponseSchema)
  },
  settings: {
    get: defineIpcContract("settings", "get", settingsGetRequestSchema, settingsSnapshotSchema),
    update: defineIpcContract(
      "settings",
      "update",
      settingsUpdateRequestSchema,
      settingsSnapshotSchema
    )
  },
  mcp: {
    status: defineIpcContract("mcp", "status", mcpStatusRequestSchema, mcpStatusResponseSchema),
    setEnabled: defineIpcContract(
      "mcp",
      "setEnabled",
      mcpSetEnabledRequestSchema,
      mcpStatusResponseSchema
    )
  },
  native: {
    capabilities: defineIpcContract(
      "native",
      "capabilities",
      nativeCapabilitiesRequestSchema,
      nativeCapabilitiesResponseSchema
    ),
    requestNotificationPermission: defineIpcContract(
      "native",
      "requestNotificationPermission",
      nativeNotificationPermissionRequestSchema,
      nativeNotificationPermissionResponseSchema
    )
  },
  diagnostics: {
    health: defineIpcContract(
      "diagnostics",
      "health",
      diagnosticsHealthRequestSchema,
      diagnosticsHealthResponseSchema
    ),
    markShellVisible: defineIpcContract(
      "diagnostics",
      "markShellVisible",
      diagnosticsShellVisibleRequestSchema,
      startupTimingSnapshotSchema
    ),
    ipcMetrics: defineIpcContract(
      "diagnostics",
      "ipcMetrics",
      diagnosticsIpcMetricsRequestSchema,
      diagnosticsIpcMetricsResponseSchema
    )
  }
} as const;

export type IpcContracts = typeof ipcContracts;
export type IpcDomainName = keyof IpcContracts;
export type IpcMethodName<Domain extends IpcDomainName> = keyof IpcContracts[Domain] & string;

export function resultSchemaForContract(contract: IpcContract) {
  return hcbResultSchema(contract.responseSchema);
}
