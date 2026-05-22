import { describe, expect, it } from "vitest";
import {
  MAX_LIST_LIMIT,
  MAX_RANGE_LIMIT,
  calendarRangeRequestSchema,
  hcbDomainSchema,
  taskListRequestSchema
} from "./contracts";
import { hcbErrorSchema, hcbResultSchema, ok, validationError } from "./result";
import { z } from "zod";

describe("shared IPC contracts", () => {
  it("keeps HcbResult success and error shapes stable", () => {
    const schema = hcbResultSchema(z.object({ value: z.string() }));

    expect(schema.parse(ok({ value: "ready" }))).toEqual({
      ok: true,
      data: {
        value: "ready"
      }
    });
    expect(validationError("Invalid request")).toEqual({
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid request",
        recoverable: true
      }
    });
  });

  it("rejects unsanitized nested error details", () => {
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

  it("defines every required domain namespace", () => {
    expect(hcbDomainSchema.options).toEqual([
      "tasks",
      "calendar",
      "notes",
      "search",
      "sync",
      "settings",
      "mcp",
      "native",
      "diagnostics"
    ]);
  });

  it("applies bounded defaults to list requests", () => {
    expect(taskListRequestSchema.parse({})).toEqual({
      status: "active",
      limit: 50
    });
    expect(taskListRequestSchema.safeParse({ limit: MAX_LIST_LIMIT + 1 }).success).toBe(false);
  });

  it("bounds calendar range windows and response sizes", () => {
    const start = "2026-01-01T00:00:00.000Z";
    const end = "2026-01-02T00:00:00.000Z";

    expect(calendarRangeRequestSchema.parse({ start, end })).toMatchObject({
      start,
      end,
      limit: 100
    });
    expect(
      calendarRangeRequestSchema.safeParse({
        start,
        end,
        limit: MAX_RANGE_LIMIT + 1
      }).success
    ).toBe(false);
    expect(
      calendarRangeRequestSchema.safeParse({
        start: "2026-01-02T00:00:00.000Z",
        end: "2026-01-01T00:00:00.000Z"
      }).success
    ).toBe(false);
  });
});
