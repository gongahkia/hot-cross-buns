import { z } from "zod";

export const HCB_IPC_VERSION = 1;
export const HCB_IPC_CHANNEL = "hcb:ipc:v1";
export const HCB_SYNC_STATUS_EVENT_CHANNEL = "hcb:sync-status:v1";
export const HCB_NATIVE_ACTION_EVENT_CHANNEL = "hcb:native-action:v1";

export const IPC_CHANNELS = {
  dispatch: HCB_IPC_CHANNEL,
  syncStatus: HCB_SYNC_STATUS_EVENT_CHANNEL,
  nativeAction: HCB_NATIVE_ACTION_EVENT_CHANNEL
} as const;

export const DEFAULT_LIST_LIMIT = 50;
export const MAX_LIST_LIMIT = 100;
export const DEFAULT_RANGE_LIMIT = 100;
export const MAX_RANGE_LIMIT = 500;
export const DEFAULT_SEARCH_LIMIT = 20;
export const MAX_SEARCH_LIMIT = 50;
export const MAX_RANGE_WINDOW_DAYS = 397;

export const millisecondsPerDay = 24 * 60 * 60 * 1000;

export const hcbDomainSchema = z.enum([
  "bootstrap",
  "tasks",
  "calendar",
  "notes",
  "tags",
  "duplicates",
  "search",
  "agent",
  "webhooks",
  "sync",
  "google",
  "settings",
  "undo",
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

export const emptyRequestSchema = z.object({}).strict();
export type EmptyRequest = z.infer<typeof emptyRequestSchema>;

export const idSchema = z.string().min(1).max(256);
export const cursorSchema = z.string().min(1).max(512);
export const isoDateTimeSchema = z.string().datetime({ offset: true });
export const guestEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email()
  .min(3)
  .max(254);
export const reminderMinutesSchema = z.number().int().min(0).max(28 * 24 * 60);
export const durationMinutesSchema = z.number().int().min(5).max(24 * 60);
export const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
  message: "Expected YYYY-MM-DD"
});

export const listLimitSchema = z
  .number()
  .int()
  .min(1)
  .max(MAX_LIST_LIMIT)
  .default(DEFAULT_LIST_LIMIT);
export const rangeLimitSchema = z
  .number()
  .int()
  .min(1)
  .max(MAX_RANGE_LIMIT)
  .default(DEFAULT_RANGE_LIMIT);
export const searchLimitSchema = z
  .number()
  .int()
  .min(1)
  .max(MAX_SEARCH_LIMIT)
  .default(DEFAULT_SEARCH_LIMIT);

export function pagedListResponseSchema<T extends z.ZodTypeAny>(
  itemSchema: T,
  maxItems: number
) {
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
