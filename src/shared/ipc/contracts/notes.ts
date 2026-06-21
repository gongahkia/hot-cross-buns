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
    tags: z.array(z.string().min(1).max(120)).max(64).optional(),
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
    body: z.string().max(50_000).default(""),
    tags: z.array(z.string().min(1).max(120)).max(64).optional()
  })
  .strict();

export type NoteCreateRequest = z.input<typeof noteCreateRequestSchema>;

export const noteUpdateRequestSchema = z
  .object({
    id: idSchema,
    listId: idSchema.optional(),
    title: z.string().min(1).max(500).optional(),
    body: z.string().max(50_000).optional(),
    tags: z.array(z.string().min(1).max(120)).max(64).optional()
  })
  .strict()
  .refine(
    (request) =>
      request.title !== undefined ||
      request.body !== undefined ||
      request.listId !== undefined ||
      request.tags !== undefined,
    {
      message: "At least one note field must be supplied"
    }
  );

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

export const noteEntityKindSchema = z.enum(["note", "task", "event", "list", "calendar"]);
export type NoteEntityKind = z.infer<typeof noteEntityKindSchema>;

export const noteEntityLinkTypeSchema = z.enum(["wikilink", "transclusion"]);
export type NoteEntityLinkType = z.infer<typeof noteEntityLinkTypeSchema>;

export const noteBrokenLinksRequestSchema = z
  .object({
    entityKind: noteEntityKindSchema.default("note"),
    entityId: idSchema.optional(),
    noteId: idSchema.optional()
  })
  .strict()
  .refine((request) => request.entityId !== undefined || request.noteId !== undefined, {
    message: "An entity id is required"
  });

export type NoteBrokenLinksRequest = z.input<typeof noteBrokenLinksRequestSchema>;

export const noteEntityLinkSchema = z
  .object({
    sourceKind: noteEntityKindSchema,
    sourceId: idSchema,
    sourceField: z.string().min(1).max(80),
    targetKind: noteEntityKindSchema,
    targetId: idSchema.nullable(),
    targetLabel: z.string().min(1).max(220),
    raw: z.string().min(1).max(220),
    alias: z.string().min(1).max(220).nullable(),
    linkType: noteEntityLinkTypeSchema,
    broken: z.boolean()
  })
  .strict();

export type NoteEntityLink = z.infer<typeof noteEntityLinkSchema>;

export const noteBrokenLinksResponseSchema = z
  .object({
    items: z.array(
      z
        .object({
          linkText: z.string().min(1).max(220),
          link: noteEntityLinkSchema.optional()
        })
        .strict()
    )
  })
  .strict();

export type NoteBrokenLinksResponse = z.infer<typeof noteBrokenLinksResponseSchema>;

export const noteEntityLinksRequestSchema = z
  .object({
    entityKind: noteEntityKindSchema,
    entityId: idSchema
  })
  .strict();

export type NoteEntityLinksRequest = z.input<typeof noteEntityLinksRequestSchema>;

export const noteEntityLinksResponseSchema = z
  .object({
    outgoing: z.array(noteEntityLinkSchema),
    backlinks: z.array(noteEntityLinkSchema),
    broken: z.array(noteEntityLinkSchema)
  })
  .strict();

export type NoteEntityLinksResponse = z.infer<typeof noteEntityLinksResponseSchema>;
