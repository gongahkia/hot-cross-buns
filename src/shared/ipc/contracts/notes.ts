import { z } from "zod";
import {
  MAX_LIST_LIMIT,
  cursorSchema,
  entityByIdRequestSchema,
  idSchema,
  isoDateTimeSchema,
  listLimitSchema,
  pagedListResponseSchema
} from "./core";

export const noteListRequestSchema = z
  .object({
    cursor: cursorSchema.optional(),
    limit: listLimitSchema
  })
  .strict();

export type NoteListRequest = z.input<typeof noteListRequestSchema>;

export const noteListSummarySchema = z
  .object({
    id: idSchema,
    title: z.string().min(1).max(200),
    noteCount: z.number().int().nonnegative(),
    updatedAt: isoDateTimeSchema
  })
  .strict();

export type NoteListSummary = z.infer<typeof noteListSummarySchema>;

export const noteListCreateRequestSchema = z
  .object({
    title: z.string().min(1).max(200)
  })
  .strict();

export type NoteListCreateRequest = z.input<typeof noteListCreateRequestSchema>;

export const noteListRenameRequestSchema = z
  .object({
    id: idSchema,
    title: z.string().min(1).max(200)
  })
  .strict();

export type NoteListRenameRequest = z.input<typeof noteListRenameRequestSchema>;

export const noteListDeleteRequestSchema = entityByIdRequestSchema;
export type NoteListDeleteRequest = z.input<typeof noteListDeleteRequestSchema>;

export const noteSummarySchema = z
  .object({
    id: idSchema,
    listId: idSchema,
    listTitle: z.string().min(1).max(200),
    title: z.string().min(1).max(500),
    preview: z.string().max(500),
    updatedAt: isoDateTimeSchema
  })
  .strict();

export type NoteSummary = z.infer<typeof noteSummarySchema>;

export const noteListResponseSchema = pagedListResponseSchema(noteSummarySchema, MAX_LIST_LIMIT).extend({
  lists: z.array(noteListSummarySchema)
});
export type NoteListResponse = z.infer<typeof noteListResponseSchema>;

export const noteDetailSchema = noteSummarySchema
  .extend({
    body: z.string().max(50_000)
  })
  .strict();

export type NoteDetail = z.infer<typeof noteDetailSchema>;

export const noteCreateRequestSchema = z
  .object({
    listId: idSchema.optional(),
    title: z.string().min(1).max(500),
    body: z.string().max(50_000).default("")
  })
  .strict();

export type NoteCreateRequest = z.input<typeof noteCreateRequestSchema>;

export const noteUpdateRequestSchema = z
  .object({
    id: idSchema,
    listId: idSchema.optional(),
    title: z.string().min(1).max(500).optional(),
    body: z.string().max(50_000).optional()
  })
  .strict()
  .refine((request) => request.title !== undefined || request.body !== undefined || request.listId !== undefined, {
    message: "At least one note field must be supplied"
  });

export type NoteUpdateRequest = z.input<typeof noteUpdateRequestSchema>;

export const noteDeleteRequestSchema = entityByIdRequestSchema;
export type NoteDeleteRequest = z.input<typeof noteDeleteRequestSchema>;

export const noteLinkSuggestRequestSchema = z
  .object({
    query: z.string().min(1).max(120),
    kinds: z.array(z.enum(["note", "task", "event"])).optional(),
    limit: z.number().int().min(1).max(20).default(8)
  })
  .strict();

export type NoteLinkSuggestRequest = z.input<typeof noteLinkSuggestRequestSchema>;

export const noteLinkSuggestResponseSchema = z
  .object({
    items: z.array(
      z
        .object({
          kind: z.enum(["note", "task", "event"]),
          id: idSchema,
          label: z.string()
        })
        .strict()
    )
  })
  .strict();

export type NoteLinkSuggestResponse = z.infer<typeof noteLinkSuggestResponseSchema>;

export const noteBrokenLinksRequestSchema = z
  .object({
    noteId: idSchema
  })
  .strict();

export type NoteBrokenLinksRequest = z.input<typeof noteBrokenLinksRequestSchema>;

export const noteBrokenLinksResponseSchema = z
  .object({
    items: z.array(
      z
        .object({
          linkText: z.string().min(1).max(160)
        })
        .strict()
    )
  })
  .strict();

export type NoteBrokenLinksResponse = z.infer<typeof noteBrokenLinksResponseSchema>;
