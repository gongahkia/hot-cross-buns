import { describe, expect, it } from "vitest";
import {
  MAX_LIST_LIMIT,
  MAX_RANGE_LIMIT,
  calendarEventCreateRequestSchema,
  calendarEventUpdateRequestSchema,
  calendarRangeRequestSchema,
  hcbDomainSchema,
  nativeCapabilitiesResponseSchema,
  taskCreateRequestSchema,
  taskUpdateRequestSchema,
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

  it("validates calendar event write payloads", () => {
    expect(
      calendarEventCreateRequestSchema.parse({
        title: "Design review",
        calendarId: "cal-1",
        startsAt: "2026-05-22T09:00:00.000Z",
        endsAt: "2026-05-22T10:00:00.000Z",
        guestEmails: ["ADA@example.com"],
        reminderMinutes: [10]
      })
    ).toMatchObject({
      title: "Design review",
      guestEmails: ["ada@example.com"],
      allDay: false
    });
    expect(
      calendarEventCreateRequestSchema.safeParse({
        title: "Bad event",
        calendarId: "cal-1",
        startsAt: "2026-05-22T10:00:00.000Z",
        endsAt: "2026-05-22T09:00:00.000Z"
      }).success
    ).toBe(false);
    expect(calendarEventUpdateRequestSchema.safeParse({ id: "event-1" }).success).toBe(false);
  });

  it("validates task write payloads as date-only Google Tasks mutations", () => {
    expect(
      taskCreateRequestSchema.parse({
        title: "Review notes",
        listId: "list-1",
        dueDate: "2026-05-22",
        parentId: null,
        priority: "medium"
      })
    ).toMatchObject({
      title: "Review notes",
      dueDate: "2026-05-22",
      priority: "medium"
    });
    expect(
      taskCreateRequestSchema.safeParse({
        title: "Timed task",
        listId: "list-1",
        dueDate: "2026-05-22T10:00:00.000Z"
      }).success
    ).toBe(false);
    expect(taskUpdateRequestSchema.safeParse({ id: "task-1" }).success).toBe(false);
  });

  it("requires native capability reports for platform adapter status", () => {
    const parsed = nativeCapabilitiesResponseSchema.parse({
      platform: "linux",
      notifications: false,
      globalShortcuts: false,
      tray: false,
      deepLinks: false,
      trayStatus: { state: "unsupported" },
      quickCaptureShortcut: {
        accelerator: null,
        registered: false,
        state: "unsupported"
      },
      notificationsStatus: {
        permission: "unsupported",
        scheduledCount: 0,
        state: "unsupported"
      },
      deepLinkStatus: {
        scheme: "hotcrossbuns",
        registered: false,
        state: "unsupported"
      },
      updaterStatus: { state: "unsupported" },
      mcpStatus: { state: "disabled" },
      capabilityReport: {
        platform: "linux",
        adapterId: "noop",
        packageFormat: "development",
        flags: {
          supportsAppPaths: true,
          supportsTray: false,
          supportsAppMenu: false,
          supportsGlobalShortcut: false,
          supportsNotifications: false,
          supportsNotificationPermissionQuery: false,
          supportsProtocolRegistration: false,
          supportsProtocolRegistrationCheck: false,
          supportsAutostart: false,
          supportsInPlaceAutoUpdate: false,
          supportsInstallerMetadata: false,
          supportsExternalUrlOpen: false,
          supportsDiagnosticsCollection: true,
          supportsCredentialStorage: false,
          supportsOAuthLoopback: true,
          supportsMcpLoopback: true,
          requiresSignedBuildForNotifications: false,
          hasWaylandSession: true,
          hasPortalShortcutSupport: false
        },
        paths: [],
        capabilities: [
          {
            key: "globalShortcuts",
            label: "Global shortcuts",
            supported: false,
            state: "unsupported",
            message: "Wayland portal support is not available."
          }
        ],
        diagnostics: [
          {
            key: "credentialStorage",
            severity: "blocker",
            message: "Secret Service is not wired."
          }
        ]
      },
      deferredStartup: { state: "pending" }
    });

    expect(parsed.capabilityReport.flags.supportsCredentialStorage).toBe(false);
    expect(parsed.capabilityReport.diagnostics[0]).toMatchObject({
      key: "credentialStorage",
      severity: "blocker"
    });
  });
});
