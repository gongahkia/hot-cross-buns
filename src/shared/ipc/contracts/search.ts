import { z } from "zod";
import {
  MAX_SEARCH_LIMIT,
  emptyRequestSchema,
  idSchema,
  isoDateTimeSchema,
  pagedListResponseSchema,
  searchLimitSchema
} from "./core";
import { semanticSearchModelSchema } from "./settings";

export const searchDomainSchema = z.enum(["tasks", "calendar", "notes"]);
export const searchModeSchema = z.enum(["lexical", "semantic", "hybrid"]);

export const searchQueryRequestSchema = z
  .object({
    query: z.string().min(1).max(200),
    domains: z.array(searchDomainSchema).min(1).max(3).optional(),
    mode: searchModeSchema.optional(),
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
    snoozeUntil: isoDateTimeSchema.nullable().optional(),
    tags: z.array(z.string().min(1).max(120)).max(64).optional(),
    updatedAt: isoDateTimeSchema.optional(),
    score: z.number().finite().optional(),
    matchKind: z.enum(["lexical", "semantic", "hybrid"]).optional()
  })
  .strict();

export type SearchResultItem = z.infer<typeof searchResultItemSchema>;

export const searchQueryResponseSchema = pagedListResponseSchema(
  searchResultItemSchema,
  MAX_SEARCH_LIMIT
).extend({
  diagnostics: z
    .object({
      mode: searchModeSchema,
      semanticEnabled: z.boolean(),
      indexedCount: z.number().int().nonnegative(),
      staleCount: z.number().int().nonnegative(),
      modelId: z.string().min(1).max(120).optional(),
      fallbackReason: z.enum(["semantic-disabled", "semantic-unavailable", "model-not-installed"]).optional()
    })
    .strict()
    .optional()
});

export type SearchQueryResponse = z.infer<typeof searchQueryResponseSchema>;

export const searchModelListRequestSchema = emptyRequestSchema;
export const searchModelListResponseSchema = z
  .object({
    models: z.array(semanticSearchModelSchema).max(10),
    selectedModelId: z.string().min(1).max(120),
    enabled: z.boolean()
  })
  .strict();
export type SearchModelListResponse = z.infer<typeof searchModelListResponseSchema>;

export const searchModelMutationRequestSchema = z
  .object({
    modelId: z.string().trim().min(1).max(120)
  })
  .strict();
export type SearchModelMutationRequest = z.input<typeof searchModelMutationRequestSchema>;

export const searchModelMutationResponseSchema = z
  .object({
    model: semanticSearchModelSchema,
    selectedModelId: z.string().min(1).max(120),
    enabled: z.boolean()
  })
  .strict();
export type SearchModelMutationResponse = z.infer<typeof searchModelMutationResponseSchema>;

export const searchIndexRebuildRequestSchema = z
  .object({
    modelId: z.string().trim().min(1).max(120).optional()
  })
  .strict();
export type SearchIndexRebuildRequest = z.input<typeof searchIndexRebuildRequestSchema>;

export const searchIndexRebuildResponseSchema = z
  .object({
    modelId: z.string().min(1).max(120),
    indexedCount: z.number().int().nonnegative(),
    staleCount: z.number().int().nonnegative(),
    unavailableReason: z.string().min(1).max(500).optional()
  })
  .strict();
export type SearchIndexRebuildResponse = z.infer<typeof searchIndexRebuildResponseSchema>;
