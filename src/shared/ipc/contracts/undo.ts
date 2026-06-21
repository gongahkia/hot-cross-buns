import { z } from "zod";
import { emptyRequestSchema, idSchema } from "./core";

export const undoRequestSchema = emptyRequestSchema;
export type UndoRequest = z.input<typeof undoRequestSchema>;

export const undoResourceKindSchema = z.enum([
  "task",
  "taskList",
  "calendarEvent",
  "scheduledTaskBlock",
  "note",
  "noteList",
  "bulk"
]);

export const undoStackStatusResponseSchema = z
  .object({
    canUndo: z.boolean(),
    canRedo: z.boolean(),
    undoLabel: z.string().min(1).max(200).optional(),
    redoLabel: z.string().min(1).max(200).optional()
  })
  .strict();

export type UndoStackStatusResponse = z.infer<typeof undoStackStatusResponseSchema>;

export const undoApplyResponseSchema = z
  .object({
    action: z.enum(["undo", "redo"]),
    applied: z.boolean(),
    label: z.string().min(1).max(200).optional(),
    resourceKind: undoResourceKindSchema.optional(),
    resourceId: idSchema.optional()
  })
  .strict();

export type UndoApplyResponse = z.infer<typeof undoApplyResponseSchema>;
