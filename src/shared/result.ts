import { z } from "zod";

export const hcbErrorCodeSchema = z.enum([
  "VALIDATION_ERROR",
  "IPC_ERROR",
  "INTERNAL_ERROR",
  "NOT_IMPLEMENTED"
]);

export type HcbErrorCode = z.infer<typeof hcbErrorCodeSchema>;

export const hcbErrorDetailsSchema = z.record(
  z.union([z.string(), z.number(), z.boolean(), z.null()])
);

export const hcbErrorSchema = z
  .object({
    code: hcbErrorCodeSchema,
    message: z.string().min(1),
    recoverable: z.boolean().optional(),
    retryAfterMs: z.number().int().nonnegative().optional(),
    details: hcbErrorDetailsSchema.optional()
  })
  .strict();

export type HcbError = z.infer<typeof hcbErrorSchema>;

export type HcbResult<T> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      error: HcbError;
    };

export const hcbResultSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.discriminatedUnion("ok", [
    z
      .object({
        ok: z.literal(true),
        data: dataSchema
      })
      .strict(),
    z
      .object({
        ok: z.literal(false),
        error: hcbErrorSchema
      })
      .strict()
  ]);

export function ok<T>(data: T): HcbResult<T> {
  return { ok: true, data };
}

export function err(error: HcbError): HcbResult<never> {
  return { ok: false, error };
}

export function validationError(message = "Invalid request payload"): HcbResult<never> {
  return err({
    code: "VALIDATION_ERROR",
    message,
    recoverable: true
  });
}

export function ipcError(message = "IPC request failed"): HcbResult<never> {
  return err({
    code: "IPC_ERROR",
    message,
    recoverable: true
  });
}

export function internalError(message = "Internal application error"): HcbResult<never> {
  return err({
    code: "INTERNAL_ERROR",
    message,
    recoverable: false
  });
}
