import { z } from "zod";
import {
  MAX_SEARCH_LIMIT,
  idSchema,
  isoDateTimeSchema,
  pagedListResponseSchema,
  searchLimitSchema
} from "./core";

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
      fallbackReason: z.enum(["semantic-disabled", "semantic-unavailable"]).optional()
    })
    .strict()
    .optional()
});

export type SearchQueryResponse = z.infer<typeof searchQueryResponseSchema>;
