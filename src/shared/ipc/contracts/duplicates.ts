import { z } from "zod";
import { idSchema, mutationAckSchema } from "./core";

export const duplicateEntityKindSchema = z.enum(["task", "event", "note"]);
export type DuplicateEntityKind = z.infer<typeof duplicateEntityKindSchema>;

export const duplicateCleanupRequestSchema = z
  .object({
    kind: duplicateEntityKindSchema,
    winnerId: idSchema,
    loserIds: z.array(idSchema).min(1).max(50)
  })
  .strict()
  .refine((request) => !request.loserIds.includes(request.winnerId), {
    message: "Winner cannot also be a loser"
  });

export type DuplicateCleanupRequest = z.input<typeof duplicateCleanupRequestSchema>;

export const duplicateCleanupResponseSchema = mutationAckSchema.extend({
  kind: duplicateEntityKindSchema,
  loserIds: z.array(idSchema).max(50)
});

export type DuplicateCleanupResponse = z.infer<typeof duplicateCleanupResponseSchema>;
