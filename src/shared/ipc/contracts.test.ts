import { describe, expect, it } from "vitest";
import {
  MAX_LIST_LIMIT,
  MAX_RANGE_LIMIT,
  calendarEventCreateRequestSchema,
  calendarEventUpdateRequestSchema,
  calendarRangeRequestSchema,
  hcbDomainSchema,
  ipcContracts,
  nativeCapabilitiesResponseSchema,
  settingsRecoveryActionRequestSchema,
  settingsSnapshotSchema,
  settingsUpdateRequestSchema,
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
      "google",
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

  it("validates first-run setup settings without secret fields", () => {
    const completedAt = "2026-05-22T00:00:00.000Z";

    expect(
      settingsUpdateRequestSchema.parse({
        setupCompletedAt: completedAt,
        selectedTaskListIds: ["list-inbox"],
        selectedCalendarIds: ["cal-product"],
        syncMode: "manual",
        notificationsEnabled: false,
        mcpEnabled: false
      })
    ).toMatchObject({
      setupCompletedAt: completedAt,
      syncMode: "manual"
    });
    expect(
      settingsSnapshotSchema.parse({
        theme: "system",
        startOnLogin: false,
        quickCaptureShortcut: null,
        selectedTaskListIds: [],
        selectedCalendarIds: [],
        setupCompletedAt: null,
        syncMode: "balanced",
        showTrayIcon: true,
        trayClickAction: "open-menu",
        menuBarPanelStyle: "adaptive",
        showMenuBarBadge: true,
        notificationsEnabled: false,
        notificationLeadMinutes: 10,
        mcpEnabled: false,
        mcpPermissionMode: "confirm-writes",
        mcpPort: 0,
        diagnosticsIncludePerformance: true
      }).setupCompletedAt
    ).toBeNull();
    expect(
      settingsUpdateRequestSchema.safeParse({
        setupCompletedAt: "not-a-date"
      }).success
    ).toBe(false);
    expect(
      settingsUpdateRequestSchema.safeParse({
        setupCompletedAt: completedAt,
        oauthClientSecret: "must-not-parse"
      }).success
    ).toBe(false);
    expect(settingsRecoveryActionRequestSchema.parse({ action: "resetOnboarding" })).toEqual({
      action: "resetOnboarding"
    });
  });

  it("keeps Google OAuth secrets out of settings and status contracts", () => {
    expect(
      ipcContracts.google.saveOAuthClient.requestSchema.parse({
        clientId: "desktop-client-id.apps.googleusercontent.com",
        clientSecret: "optional-client-secret"
      })
    ).toMatchObject({
      clientId: "desktop-client-id.apps.googleusercontent.com",
      clientSecret: "optional-client-secret"
    });
    expect(
      ipcContracts.google.status.responseSchema.safeParse({
        oauthClientConfigured: true,
        clientId: "desktop-client-id.apps.googleusercontent.com",
        hasClientSecret: true,
        clientSecret: "must-not-parse"
      }).success
    ).toBe(false);
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
