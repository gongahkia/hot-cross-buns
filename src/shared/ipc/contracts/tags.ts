import { z } from "zod";
import {
  MAX_LIST_LIMIT,
  cursorSchema,
  entityByIdRequestSchema,
  idSchema,
  isoDateTimeSchema,
  listLimitSchema,
  mutationAckSchema,
  pagedListResponseSchema
} from "./core";

export const tagColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable();
export const tagEntityKindSchema = z.enum(["task", "event", "note"]);
export type TagEntityKind = z.infer<typeof tagEntityKindSchema>;

export const tagSummarySchema = z
  .object({
    id: idSchema,
    name: z.string().trim().min(1).max(120),
    color: tagColorSchema,
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
    firstUsedAt: isoDateTimeSchema.nullable().optional(),
    lastUsedAt: isoDateTimeSchema.nullable().optional(),
    taskCount: z.number().int().nonnegative(),
    eventCount: z.number().int().nonnegative(),
    noteCount: z.number().int().nonnegative(),
    totalCount: z.number().int().nonnegative()
  })
  .strict();

export type TagSummary = z.infer<typeof tagSummarySchema>;

export const tagListRequestSchema = z
  .object({
    cursor: cursorSchema.optional(),
    limit: listLimitSchema,
    query: z.string().trim().max(120).optional()
  })
  .strict();

export type TagListRequest = z.input<typeof tagListRequestSchema>;

export const tagListResponseSchema = pagedListResponseSchema(tagSummarySchema, MAX_LIST_LIMIT);
export type TagListResponse = z.infer<typeof tagListResponseSchema>;

export const tagCreateRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    color: tagColorSchema.optional()
  })
  .strict();

export type TagCreateRequest = z.input<typeof tagCreateRequestSchema>;

export const tagUpdateRequestSchema = z
  .object({
    id: idSchema,
    name: z.string().trim().min(1).max(120).optional(),
    color: tagColorSchema.optional()
  })
  .strict()
  .refine((request) => request.name !== undefined || request.color !== undefined, {
    message: "At least one tag field must be supplied"
  });

export type TagUpdateRequest = z.input<typeof tagUpdateRequestSchema>;

export const tagDeleteRequestSchema = entityByIdRequestSchema;
export type TagDeleteRequest = z.input<typeof tagDeleteRequestSchema>;

export const tagMergeRequestSchema = z
  .object({
    sourceId: idSchema,
    targetId: idSchema
  })
  .strict()
  .refine((request) => request.sourceId !== request.targetId, {
    message: "Source and target tags must differ"
  });

export type TagMergeRequest = z.input<typeof tagMergeRequestSchema>;

export const tagBulkApplyRequestSchema = z
  .object({
    tagIds: z.array(idSchema).min(1).max(64),
    entityKind: tagEntityKindSchema,
    entityIds: z.array(idSchema).min(1).max(500),
    mode: z.enum(["add", "remove", "replace"])
  })
  .strict();

export type TagBulkApplyRequest = z.input<typeof tagBulkApplyRequestSchema>;

export const tagMutationResponseSchema = mutationAckSchema.extend({
  tag: tagSummarySchema.optional()
});

export type TagMutationResponse = z.infer<typeof tagMutationResponseSchema>;

export const autoTagReapplyScopeSchema = z.enum(["all"]);
export const autoTagReapplyPreviewRequestSchema = z
  .object({
    kind: tagEntityKindSchema,
    scope: autoTagReapplyScopeSchema.default("all")
  })
  .strict();

export type AutoTagReapplyPreviewRequest = z.input<typeof autoTagReapplyPreviewRequestSchema>;

export const autoTagReapplyPreviewResponseSchema = z
  .object({
    kind: tagEntityKindSchema,
    scope: autoTagReapplyScopeSchema,
    scanned: z.number().int().nonnegative(),
    changed: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    blocked: z.boolean(),
    message: z.string().min(1).max(500),
    sample: z.array(z.object({
      id: idSchema,
      title: z.string().min(1).max(500),
      nextTitle: z.string().min(1).max(500),
      tags: z.array(z.string().min(1).max(120)).max(64),
      nextTags: z.array(z.string().min(1).max(120)).max(64)
    }).strict()).max(20)
  })
  .strict();

export type AutoTagReapplyPreviewResponse = z.infer<typeof autoTagReapplyPreviewResponseSchema>;

export const autoTagReapplyApplyRequestSchema = autoTagReapplyPreviewRequestSchema.extend({
  confirm: z.literal(true)
}).strict();

export type AutoTagReapplyApplyRequest = z.input<typeof autoTagReapplyApplyRequestSchema>;

export const autoTagReapplyApplyResponseSchema = autoTagReapplyPreviewResponseSchema.extend({
  queued: z.boolean(),
  revision: isoDateTimeSchema,
  undoLabel: z.string().min(1).max(120).optional()
});

export type AutoTagReapplyApplyResponse = z.infer<typeof autoTagReapplyApplyResponseSchema>;

export const tagAnalyticsResponseSchema = z
  .object({
    totalTags: z.number().int().nonnegative(),
    unusedTags: z.number().int().nonnegative(),
    linkedEntities: z.number().int().nonnegative(),
    topTags: z.array(tagSummarySchema).max(10),
    staleTags: z.array(tagSummarySchema).max(10)
  })
  .strict();

export type TagAnalyticsResponse = z.infer<typeof tagAnalyticsResponseSchema>;
