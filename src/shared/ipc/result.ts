import { z } from "zod";
import { redactDiagnosticDetails, redactErrorMessage } from "../redaction";

export const hcbErrorCodeSchema = z.enum([
  "VALIDATION_ERROR",
  "IPC_ERROR",
  "INTERNAL_ERROR",
  "NOT_IMPLEMENTED",
  "PAYLOAD_TOO_LARGE",
  "SERVICE_UNAVAILABLE",
  "RATE_LIMITED",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "CONFLICT"
]);

export type HcbErrorCode = z.infer<typeof hcbErrorCodeSchema>;

const hcbErrorDetailsValueSchema = z.union([
  z.string().max(500),
  z.number().finite(),
  z.boolean(),
  z.null()
]);

export const hcbErrorDetailsSchema = z.record(hcbErrorDetailsValueSchema);

export const hcbErrorSchema = z
  .object({
    code: hcbErrorCodeSchema,
    message: z.string().min(1).max(500),
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
  return { ok: false, error: sanitizeHcbError(error) };
}

export function validationError(
  message = "Invalid request payload",
  details?: HcbError["details"]
): HcbResult<never> {
  return err({
    code: "VALIDATION_ERROR",
    message,
    recoverable: true,
    ...(details ? { details } : {})
  });
}

export function ipcError(message = "IPC request failed"): HcbResult<never> {
  return err({
    code: "IPC_ERROR",
    message,
    recoverable: true
  });
}

export function internalError(
  message = "Internal application error",
  details?: HcbError["details"]
): HcbResult<never> {
  return err({
    code: "INTERNAL_ERROR",
    message,
    recoverable: false,
    ...(details ? { details } : {})
  });
}

export class HcbPublicError extends Error {
  readonly code: HcbErrorCode;
  readonly recoverable?: boolean;
  readonly retryAfterMs?: number;
  readonly details?: HcbError["details"];

  constructor(error: HcbError) {
    super(error.message);
    this.name = "HcbPublicError";
    this.code = error.code;
    this.recoverable = error.recoverable;
    this.retryAfterMs = error.retryAfterMs;
    this.details = error.details;
  }

  toHcbError(): HcbError {
    return sanitizeHcbError({
      code: this.code,
      message: redactErrorMessage(this.message),
      ...(this.recoverable === undefined ? {} : { recoverable: this.recoverable }),
      ...(this.retryAfterMs === undefined ? {} : { retryAfterMs: this.retryAfterMs }),
      ...(this.details === undefined ? {} : { details: redactDiagnosticDetails(this.details) })
    });
  }
}

export function notImplemented(message: string): HcbPublicError {
  return new HcbPublicError({
    code: "NOT_IMPLEMENTED",
    message,
    recoverable: false
  });
}

export function sanitizeThrownError(thrown: unknown): HcbError {
  if (thrown instanceof HcbPublicError) {
    return thrown.toHcbError();
  }

  return {
    code: "INTERNAL_ERROR",
    message: "Internal application error",
    recoverable: false
  };
}

export function sanitizeHcbError(error: HcbError): HcbError {
  return hcbErrorSchema.parse({
    code: error.code,
    message: redactErrorMessage(error.message),
    ...(error.recoverable === undefined ? {} : { recoverable: error.recoverable }),
    ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }),
    ...(error.details === undefined ? {} : { details: redactDiagnosticDetails(error.details) })
  });
}
