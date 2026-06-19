import { describe, expect, it } from "vitest";
import {
  MAX_LIST_LIMIT,
  MAX_RANGE_LIMIT,
  availabilityExportRequestSchema,
  calendarScheduleSuggestRequestSchema,
  calendarEventDetailSchema,
  calendarEventCreateRequestSchema,
  calendarEventUpdateRequestSchema,
  calendarRangeRequestSchema,
  hcbDomainSchema,
  hcbVaultRemoteCredentialSaveRequestSchema,
  hcbVaultRemoteCredentialStatusResponseSchema,
  hcbVaultRemotePullRequestSchema,
  hcbVaultRemotePushRequestSchema,
  hcbVaultRemoteStatusResponseSchema,
  ipcContracts,
  nativeCapabilitiesResponseSchema,
  noteLinkSuggestRequestSchema,
  noteLinkSuggestResponseSchema,
  scheduledTaskBlockCreateRequestSchema,
  scheduledTaskBlockMoveRequestSchema,
  defaultLeaderKey,
  defaultLeaderKeybindings,
  defaultSemanticSearchModels,
  settingsRecoveryActionRequestSchema,
  settingsSnapshotSchema,
  settingsUpdateRequestSchema,
  taskCreateRequestSchema,
  taskUpdateRequestSchema,
  taskListRequestSchema
} from "./contracts";
import { hcbErrorSchema, hcbResultSchema, ok, validationError } from "./result";
import {
  defaultHistoryCategoryVisibility,
  defaultKeybindings
} from "../settingsCatalog";
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
      "bootstrap",
      "tasks",
      "calendar",
      "notes",
      "tags",
      "duplicates",
      "search",
      "agent",
      "webhooks",
      "sync",
      "google",
      "settings",
      "undo",
      "mcp",
      "native",
      "diagnostics"
    ]);
  });

  it("validates bootstrap and drain-only sync contracts", () => {
    expect(
      ipcContracts.bootstrap.get.requestSchema.parse({
        calendarRange: {
          start: "2026-05-22T00:00:00.000Z",
          end: "2026-05-23T00:00:00.000Z"
        }
      })
    ).toMatchObject({
      mode: "full",
      calendarRange: {
        limit: 100
      }
    });
    expect(
      ipcContracts.bootstrap.get.requestSchema.parse({
        mode: "light",
        calendarRange: {
          start: "2026-05-22T00:00:00.000Z",
          end: "2026-05-23T00:00:00.000Z"
        }
      })
    ).toMatchObject({
      mode: "light"
    });
    expect(
      ipcContracts.sync.runNow.requestSchema.parse({
        drainOnly: true
      })
    ).toEqual({
      drainOnly: true,
      full: false,
      dryRun: false
    });
    expect(
      ipcContracts.sync.runNow.responseSchema.parse({
        accepted: true,
        dryRun: false,
        drainOnly: true,
        resources: []
      })
    ).toEqual({
      accepted: true,
      dryRun: false,
      drainOnly: true,
      resources: []
    });
    expect(
      ipcContracts.diagnostics.recordTiming.requestSchema.parse({
        kind: "startup",
        name: "startup.bootstrap.get",
        durationMs: 12.4,
        metadata: {
          outcome: "used",
          payloadBytes: 1234,
          accepted: true,
          errorCode: null
        }
      })
    ).toEqual({
      kind: "startup",
      name: "startup.bootstrap.get",
      durationMs: 12.4,
      metadata: {
        outcome: "used",
        payloadBytes: 1234,
        accepted: true,
        errorCode: null
      }
    });
    const bootstrapShape = (ipcContracts.bootstrap.get.responseSchema as z.ZodObject<any>).shape;
    expect(
      bootstrapShape.tasks.safeParse({
        items: Array.from({ length: MAX_LIST_LIMIT + 1 }, (_, index) => ({
          id: `task-${index}`,
          listId: "list-1",
          title: `Task ${index}`,
          status: "active",
          updatedAt: "2026-05-22T00:00:00.000Z"
        })),
        page: {
          limit: MAX_LIST_LIMIT,
          totalKnown: MAX_LIST_LIMIT + 1
        }
      }).success
    ).toBe(true);
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
        colorId: "9",
        startsAt: "2026-05-22T09:00:00.000Z",
        endsAt: "2026-05-22T10:00:00.000Z",
        guestEmails: ["ADA@example.com"],
        reminderMinutes: [10],
        timeZone: "Asia/Singapore",
        hcbKind: "birthday",
        recurrence: {
          frequency: "weekly",
          interval: 2,
          byDay: ["MO", "WE"],
          endsOn: "2026-12-31",
          count: null
        }
      })
    ).toMatchObject({
      title: "Design review",
      colorId: "9",
      guestEmails: ["ada@example.com"],
      timeZone: "Asia/Singapore",
      hcbKind: "birthday",
      allDay: false,
      recurrence: {
        frequency: "weekly",
        interval: 2,
        byDay: ["MO", "WE"],
        endsOn: "2026-12-31"
      }
    });
    expect(
      calendarEventCreateRequestSchema.safeParse({
        title: "Bad event",
        calendarId: "cal-1",
        startsAt: "2026-05-22T10:00:00.000Z",
        endsAt: "2026-05-22T09:00:00.000Z"
      }).success
    ).toBe(false);
    expect(
      calendarEventCreateRequestSchema.safeParse({
        title: "Bad recurrence",
        calendarId: "cal-1",
        startsAt: "2026-05-22T09:00:00.000Z",
        endsAt: "2026-05-22T10:00:00.000Z",
        recurrence: {
          frequency: "weekly",
          interval: 0
        }
      }).success
    ).toBe(false);
    expect(calendarEventUpdateRequestSchema.safeParse({ id: "event-1" }).success).toBe(false);
    expect(
      calendarEventUpdateRequestSchema.parse({
        id: "event-1",
        colorId: null,
        recurrence: null,
        hcbKind: "birthday",
        timeZone: "Asia/Singapore"
      })
    ).toEqual({
      id: "event-1",
      colorId: null,
      recurrence: null,
      hcbKind: "birthday",
      timeZone: "Asia/Singapore"
    });
  });

  it("validates calendar event depth fields exposed to the renderer", () => {
    expect(
      calendarEventDetailSchema.parse({
        id: "event-1",
        eventId: "google-event-1",
        calendarId: "cal-1",
        title: "Recurring release review",
        startsAt: "2026-05-22T09:00:00.000Z",
        endsAt: "2026-05-22T10:00:00.000Z",
        allDay: false,
        colorId: "10",
        updatedAt: "2026-05-22T08:00:00.000Z",
        calendarTitle: "Product",
        deepLink: "hotcrossbuns://calendar/event-1",
        mutationState: "queued",
        hcbKind: "birthday",
        timeZone: "America/New_York",
        recurrenceRule: "RRULE:FREQ=MONTHLY;INTERVAL=2;COUNT=4",
        recurringEventId: "series-1",
        originalStartAt: "2026-05-22T09:00:00.000Z"
      })
    ).toMatchObject({
      mutationState: "queued",
      hcbKind: "birthday",
      colorId: "10",
      recurrenceRule: "RRULE:FREQ=MONTHLY;INTERVAL=2;COUNT=4",
      timeZone: "America/New_York"
    });
    expect(
      calendarEventDetailSchema.safeParse({
        id: "event-1",
        calendarId: "cal-1",
        title: "Bad mutation",
        startsAt: "2026-05-22T09:00:00.000Z",
        endsAt: "2026-05-22T10:00:00.000Z",
        allDay: false,
        updatedAt: "2026-05-22T08:00:00.000Z",
        calendarTitle: "Product",
        deepLink: "hotcrossbuns://calendar/event-1",
        mutationState: "sending"
      }).success
    ).toBe(false);
  });

  it("validates scheduled task blocks and static availability export contracts", () => {
    expect(
      scheduledTaskBlockCreateRequestSchema.parse({
        taskId: "task-1",
        calendarId: "cal-1",
        startsAt: "2026-05-22T09:00:00.000Z"
      })
    ).toMatchObject({
      taskId: "task-1",
      durationMinutes: 30
    });
    expect(
      scheduledTaskBlockCreateRequestSchema.safeParse({
        taskId: "task-1",
        calendarId: "cal-1",
        startsAt: "2026-05-22T09:00:00.000Z",
        durationMinutes: 2
      }).success
    ).toBe(false);
    expect(
      scheduledTaskBlockMoveRequestSchema.safeParse({
        id: "block-1"
      }).success
    ).toBe(false);
    expect(
      availabilityExportRequestSchema.parse({
        start: "2026-05-22T00:00:00.000Z",
        end: "2026-05-23T00:00:00.000Z"
      })
    ).toMatchObject({
      format: "text"
    });
    expect(ipcContracts.calendar.scheduleTaskBlock.method).toBe("scheduleTaskBlock");
    expect(ipcContracts.calendar.scheduleSuggest.method).toBe("scheduleSuggest");
    expect(ipcContracts.calendar.exportAvailability.method).toBe("exportAvailability");
  });

  it("validates day schedule suggestion requests", () => {
    expect(
      calendarScheduleSuggestRequestSchema.parse({
        date: "2026-05-23"
      })
    ).toMatchObject({
      capacityMinutes: 480,
      workingHours: {
        start: 6,
        end: 22
      }
    });
    expect(
      calendarScheduleSuggestRequestSchema.safeParse({
        date: "2026-05-23",
        workingHours: { start: 18, end: 8 }
      }).success
    ).toBe(false);
  });

  it("validates note link suggestion contracts", () => {
    expect(
      noteLinkSuggestRequestSchema.parse({
        query: "plan",
        kinds: ["note", "task"],
        limit: 4
      })
    ).toEqual({
      query: "plan",
      kinds: ["note", "task"],
      limit: 4
    });
    expect(noteLinkSuggestRequestSchema.safeParse({ query: "" }).success).toBe(false);
    expect(
      noteLinkSuggestResponseSchema.parse({
        items: [{ kind: "note", id: "note-1", label: "Project plan" }]
      })
    ).toEqual({
      items: [{ kind: "note", id: "note-1", label: "Project plan" }]
    });
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
        colorTheme: "dracula",
        uiFontName: "Inter",
        uiTextSizePoints: 15,
        selectedTaskListIds: ["list-inbox"],
        selectedCalendarIds: ["cal-product"],
        storageBackend: "hcb-local",
        hcbVaultPath: "/tmp/hot-cross-buns.hcbvault",
        calendarEventColorOverrides: {
          "9": { background: "#123456", foreground: "#abcdef" }
        },
        syncMode: "manual",
        notificationsEnabled: false,
        mcpEnabled: false
      })
    ).toMatchObject({
      setupCompletedAt: completedAt,
      colorTheme: "dracula",
      uiFontName: "Inter",
      uiTextSizePoints: 15,
      storageBackend: "hcb-local",
      hcbVaultPath: "/tmp/hot-cross-buns.hcbvault",
      calendarEventColorOverrides: {
        "9": { background: "#123456", foreground: "#abcdef" }
      },
      syncMode: "manual"
    });
    expect(
      settingsSnapshotSchema.parse({
        theme: "system",
        colorTheme: "notion",
        customBackground: null,
        useInferredBackgroundTheme: true,
        appLanguage: "system",
        uiFontName: null,
        uiTextSizePoints: 13,
        perSurfaceFontOverrides: {},
        calendarEventColorOverrides: {},
        autoTagRules: [],
        autoTagBackgroundReapplyMode: "preview",
        disableAnimations: false,
        uiLayoutScale: 1,
        navigationPlacement: "left",
        hiddenNavigationTabs: [],
        navigationTabOrder: ["calendar", "tasks", "notes"],
        toolbarActionOrder: ["commandPalette", "notifications", "diagnostics", "splitPane", "refresh", "settings"],
        hiddenCalendarViewModes: [],
        showCompletedInCalendarViews: true,
        eventCompletionDefaultScope: "occurrence",
        calendarTimelineDensity: "compact",
        monthScrollPastMonths: 0,
        monthScrollFutureMonths: 1,
        quickCreateExpandedByDefault: false,
        restoreWindowStateEnabled: true,
        startOnLogin: false,
        selectedTaskListIds: [],
        selectedCalendarIds: [],
        setupCompletedAt: null,
        storageBackend: "google",
        hcbHosterEndpoint: null,
        hcbVaultPath: null,
        syncMode: "balanced",
        syncTasksEnabled: true,
        syncCalendarEventsEnabled: true,
        eventRetentionDaysBack: 0,
        completedTaskRetentionDaysBack: 365,
        showTrayIcon: true,
        trayClickAction: "open-menu",
        menuBarPanelStyle: "adaptive",
        menuBarIconName: "calendar",
        menuBarCalendarIconId: "calendar",
        menuBarCalendarDoneMode: "visibleTodayDone",
        customMenuBarIcons: [],
        showMenuBarBadge: true,
        showDockBadge: true,
        notificationsEnabled: false,
        notificationLeadMinutes: 10,
        taskCompletionSoundEnabled: true,
        taskCompletionSoundId: "glass",
        eventCompletionSoundEnabled: true,
        eventCompletionSoundId: "pop",
        importedSoundCount: 0,
        perTabListFilters: {
          tasks: { useCustomFilter: false, selectedTaskListIds: [] },
          notes: { useCustomFilter: false, selectedTaskListIds: [] }
        },
        portableExportOnlySelectedTaskLists: false,
        portableExportOnlySelectedCalendars: false,
        portableExportOnlyFutureCurrentEvents: false,
        dailyLocalBackupEnabled: false,
        localBackupRetentionCount: 14,
        lastLocalBackupAt: null,
        visibleHistoryEntryCount: 50,
        historyStorageCap: 5_000,
        historyCategoryVisibility: defaultHistoryCategoryVisibility,
        dismissedDuplicateGroupIds: [],
        taskTemplates: [],
        eventTemplates: [],
        noteTemplates: [],
        lastUpdateCheckAt: null,
        mcpEnabled: false,
        mcpPermissionMode: "confirm-writes",
        mcpPort: 0,
        localHostersEnabled: false,
        localHosterPort: 0,
        defaultTimeZone: "UTC",
        todayCapacityMinutes: 480,
        todayWorkingHoursStart: 6,
        todayWorkingHoursEnd: 22,
        diagnosticsIncludePerformance: true,
        rawGoogleDiagnosticsEnabled: false,
        keybindings: defaultKeybindings,
        leaderKey: defaultLeaderKey,
        leaderKeybindings: defaultLeaderKeybindings,
        savedSearchViews: [],
        pinnedSavedSearchViewIds: [],
        savedTaskViews: [],
        semanticSearchEnabled: false,
        semanticSearchMode: "lexical",
        embeddingModelId: "hcb-local-hash-384",
        semanticSearchModels: defaultSemanticSearchModels,
        agentActionTrayEnabled: true,
        webhooksEnabled: false
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
    expect(settingsUpdateRequestSchema.safeParse({ colorTheme: "missing-theme" }).success).toBe(false);
    expect(settingsUpdateRequestSchema.safeParse({ uiFontName: "" }).success).toBe(false);
    expect(settingsUpdateRequestSchema.safeParse({ uiTextSizePoints: 8 }).success).toBe(false);
    expect(settingsUpdateRequestSchema.safeParse({ uiTextSizePoints: 25 }).success).toBe(false);
    expect(
      settingsUpdateRequestSchema.parse({
        customBackground: {
          fileName: "desk.png",
          mimeType: "image/png",
          dataBase64: "abc",
          palette: {
            isDark: true,
            ember: "#F97316",
            moss: "#22C55E",
            blue: "#38BDF8",
            ink: "#F8FAFC",
            cream: "#111827",
            cardStroke: "#374151",
            dominant: "#111827",
            accents: ["#F97316", "#22C55E", "#38BDF8"]
          },
          updatedAt: completedAt
        },
        useInferredBackgroundTheme: true
      }).customBackground?.palette.ember
    ).toBe("#F97316");
    expect(
      settingsUpdateRequestSchema.safeParse({
        calendarEventColorOverrides: {
          "9": { background: "blue", foreground: "#ffffff" }
        }
      }).success
    ).toBe(false);
    expect(settingsUpdateRequestSchema.safeParse({ menuBarIconName: "calendar" }).success).toBe(true);
    expect(settingsUpdateRequestSchema.safeParse({ menuBarIconName: "bolt" }).success).toBe(false);
    expect(
      settingsUpdateRequestSchema.safeParse({
        customMenuBarIcons: [
          {
            id: "custom:test",
            name: "test",
            fileName: "custom-test.png",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z"
          }
        ]
      }).success
    ).toBe(true);
    expect(
      settingsUpdateRequestSchema.safeParse({
        customMenuBarIcons: [
          {
            id: "custom:test",
            name: "test",
            svg: "<svg></svg>",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z"
          }
        ]
      }).success
    ).toBe(false);
    expect(settingsUpdateRequestSchema.safeParse({ calendarTimelineDensity: "comfortable" }).success).toBe(true);
    expect(settingsUpdateRequestSchema.safeParse({ calendarTimelineDensity: "huge" }).success).toBe(false);
    expect(settingsUpdateRequestSchema.safeParse({ taskCompletionSoundId: "coin" }).success).toBe(true);
    expect(settingsUpdateRequestSchema.safeParse({ eventCompletionSoundId: "sparkle" }).success).toBe(
      true
    );
    expect(
      ipcContracts.native.listFontFamilies.responseSchema.parse({
        platform: "darwin",
        families: ["Avenir", "SF Pro Text"]
      })
    ).toEqual({
      platform: "darwin",
      families: ["Avenir", "SF Pro Text"]
    });
    expect(settingsRecoveryActionRequestSchema.parse({ action: "resetOnboarding" })).toEqual({
      action: "resetOnboarding"
    });
  });

  it("validates HCB vault host requests without persistent secret settings", () => {
    expect(
      hcbVaultRemotePushRequestSchema.parse({
        endpoint: "https://pi.local/hcb/v1/vault",
        token: "remote-host-token"
      })
    ).toMatchObject({
      endpoint: "https://pi.local/hcb/v1/vault",
      token: "remote-host-token"
    });
    expect(
      hcbVaultRemotePullRequestSchema.safeParse({
        endpoint: "https://pi.local/hcb/v1/vault",
        token: "remote-host-token"
      }).success
    ).toBe(false);
    expect(
      hcbVaultRemoteCredentialSaveRequestSchema.safeParse({
        endpoint: "https://pi.local/hcb/v1/vault",
        token: "short",
        passphrase: "vault-passphrase"
      }).success
    ).toBe(false);
    expect(
      hcbVaultRemoteCredentialStatusResponseSchema.parse({
        endpoint: "https://pi.local/hcb/v1/vault",
        configured: true,
        secretStore: {
          ok: true,
          state: "ready"
        }
      }).configured
    ).toBe(true);
    expect(
      ipcContracts.sync.runNow.responseSchema.parse({
        accepted: true,
        dryRun: false,
        drainOnly: false,
        resources: ["hcb-vault"]
      }).resources
    ).toEqual(["hcb-vault"]);
    expect(
      hcbVaultRemoteStatusResponseSchema.parse({
        endpoint: "https://pi.local/hcb/v1/vault",
        remote: {
          kind: "hcbVaultHostInfo",
          protocolVersion: 1,
          hcbVaultFormatVersions: [1],
          routes: ["/hcb/v1/vault/info", "/hcb/v1/vault"],
          hasVault: false,
          vaultName: "remote.hcbvault",
          maxPackageBytes: 134217728
        }
      }).remote.hasVault
    ).toBe(false);
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
