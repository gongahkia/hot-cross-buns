import { describe, expect, it } from "vitest";
import { hcbErrorSchema, hcbResultSchema, ok, validationError } from "./result";
import { z } from "zod";

describe("HcbResult", () => {
  it("parses successful typed results", () => {
    const schema = hcbResultSchema(z.object({ value: z.string() }));

    expect(schema.parse(ok({ value: "ready" }))).toEqual({
      ok: true,
      data: {
        value: "ready"
      }
    });
  });

  it("keeps error details sanitized to scalar fields", () => {
    expect(
      hcbErrorSchema.safeParse({
        code: "INTERNAL_ERROR",
        message: "bad",
        details: {
          nested: {
            token: "secret"
          }
        }
      }).success
    ).toBe(false);
  });

  it("creates recoverable validation errors", () => {
    expect(validationError("Invalid health check")).toEqual({
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid health check",
        recoverable: true
      }
    });
  });
});
