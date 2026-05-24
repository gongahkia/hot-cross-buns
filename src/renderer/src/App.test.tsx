import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  NativeCapabilitiesResponse,
  SearchResultItem,
  SettingsSnapshot,
  TaskDetail
} from "@shared/ipc/contracts";
import type { HcbApi } from "@shared/ipc/preloadApi";
import { err, ok } from "@shared/ipc/result";
import App from "./App";

const originalHcb = window.hcb;
const todayDate = new Date().toISOString().slice(0, 10);
const now = `${todayDate}T00:00:00.000Z`;
const tomorrow = new Date(now);
tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
const tomorrowIso = tomorrow.toISOString();

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-color-theme");
  document.documentElement.removeAttribute("style");
  Object.defineProperty(window, "hcb", {
    configurable: true,
    value: originalHcb
  });
});

function primaryNavigation(): HTMLElement {
  return screen.getByRole("navigation", { name: "Primary" });
}

async function runPaletteCommand(user: ReturnType<typeof userEvent.setup>, query: string, label: RegExp): Promise<void> {
  await user.keyboard("{Meta>}p{/Meta}");
  const dialog = await screen.findByRole("dialog", { name: "Command palette" });
  const input = within(dialog).getByRole("searchbox", { name: "Filter commands" });

  await user.type(input, query);
  await user.click(within(dialog).getByRole("option", { name: label }));
}

async function goToSection(label: string): Promise<void> {
  const user = userEvent.setup();

  if (label === "Settings") {
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await screen.findByRole("dialog", { name: "Settings" });
    return;
  }

  if (label === "Search") {
    await runPaletteCommand(user, "go to search", /Go to Search/);
    return;
  }

  if (label === "Today") {
    await runPaletteCommand(user, "go to today", /Go to Today/);
    return;
  }

  await user.click(within(primaryNavigation()).getByRole("button", { name: new RegExp(label) }));
}

function testDataTransfer(): DataTransfer {
  const data = new Map<string, string>();
  const transfer = {
    dropEffect: "none",
    effectAllowed: "all",
    files: [],
    items: [],
    types: [] as string[],
    clearData: vi.fn((format?: string) => {
      if (format) {
        data.delete(format);
        transfer.types = transfer.types.filter((type) => type !== format);
        return;
      }

      data.clear();
      transfer.types = [];
    }),
    getData: vi.fn((format: string) => data.get(format) ?? ""),
    setData: vi.fn((format: string, value: string) => {
      data.set(format, value);

      if (!transfer.types.includes(format)) {
        transfer.types.push(format);
      }
    }),
    setDragImage: vi.fn()
  };

  return transfer as unknown as DataTransfer;
}

function utcWeekStartDate(value: string): string {
  const date = new Date(value);
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  return start.toISOString().slice(0, 10);
}

function installHcb(api: HcbApi | undefined): void {
  Object.defineProperty(window, "hcb", {
    configurable: true,
    value: api
  });
}

function testSettings(overrides: Partial<SettingsSnapshot> = {}): SettingsSnapshot {
  return {
    theme: "system",
    colorTheme: "notion",
    appLanguage: "system",
    uiFontName: null,
    uiTextSizePoints: 13,
    perSurfaceFontOverrides: {},
    performanceMode: "snappy",
    appBackgroundTranslucencyEnabled: false,
    appBackgroundOpacity: 1,
    disableAnimations: false,
    uiLayoutScale: 1,
    navigationPlacement: "left",
    hiddenNavigationTabs: [],
    hiddenCalendarViewModes: [],
    monthScrollPastMonths: 0,
    monthScrollFutureMonths: 1,
    quickCreateExpandedByDefault: false,
    restoreWindowStateEnabled: true,
    startOnLogin: false,
    selectedTaskListIds: [],
    selectedCalendarIds: [],
    setupCompletedAt: now,
    syncMode: "balanced",
    eventRetentionDaysBack: 0,
    completedTaskRetentionDaysBack: 365,
    quickCaptureShortcut: null,
    showTrayIcon: true,
    trayClickAction: "open-menu",
    menuBarPanelStyle: "adaptive",
    showMenuBarBadge: true,
    notificationsEnabled: false,
    notificationLeadMinutes: 10,
    mcpEnabled: false,
    mcpPermissionMode: "confirm-writes",
    mcpPort: 0,
    defaultTimeZone: "UTC",
    todayCapacityMinutes: 480,
    todayWorkingHoursStart: 6,
    todayWorkingHoursEnd: 22,
    diagnosticsIncludePerformance: true,
    rawGoogleDiagnosticsEnabled: false,
    savedSearchViews: [],
    savedTaskViews: [],
    ...overrides
  };
}

function testNativeCapabilities(
  overrides: Partial<NativeCapabilitiesResponse> = {}
): NativeCapabilitiesResponse {
  return {
    platform: "darwin",
    notifications: true,
    globalShortcuts: true,
    tray: true,
    deepLinks: true,
    trayStatus: {
      state: "ready",
      message: "Menu bar item is ready."
    },
    quickCaptureShortcut: {
      accelerator: "Ctrl+Space",
      registered: true,
      state: "ready",
      message: "Quick capture shortcut is registered."
    },
    notificationsStatus: {
      permission: "prompt",
      scheduledCount: 0,
      state: "disabled",
      message: "Local notifications are disabled in Settings."
    },
    deepLinkStatus: {
      scheme: "hotcrossbuns",
      registered: true,
      state: "ready",
      message: "Protocol handler is registered."
    },
    updaterStatus: {
      state: "unsupported",
      message: "Preview update checks are not configured."
    },
    mcpStatus: {
      state: "disabled",
      message: "MCP local agent access is disabled."
    },
    capabilityReport: {
      platform: "darwin",
      adapterId: "test",
      packageFormat: "development",
      flags: {
        supportsAppPaths: true,
        supportsTray: true,
        supportsAppMenu: true,
        supportsGlobalShortcut: true,
        supportsNotifications: true,
        supportsNotificationPermissionQuery: false,
        supportsProtocolRegistration: true,
        supportsProtocolRegistrationCheck: true,
        supportsAutostart: true,
        supportsInPlaceAutoUpdate: false,
        supportsInstallerMetadata: true,
        supportsExternalUrlOpen: true,
        supportsDiagnosticsCollection: true,
        supportsCredentialStorage: false,
        supportsOAuthLoopback: true,
        supportsMcpLoopback: true,
        requiresSignedBuildForNotifications: false
      },
      paths: [],
      capabilities: [],
      diagnostics: []
    },
    deferredStartup: {
      state: "complete"
    },
    ...overrides
  };
}

function seededTaskDetail(id: string, overrides: Partial<TaskDetail> = {}): TaskDetail {
  return {
    id,
    listId: id === "task-inbox-rules" ? "list-inbox" : "list-planning",
    title:
      id === "task-done"
        ? "Report shell-visible timing"
        : id === "task-calendar-fixtures"
          ? "Review calendar fixture shape"
          : "Draft inbox triage rules",
    status: id === "task-done" ? "completed" as const : "active" as const,
    priority:
      id === "task-inbox-rules"
        ? "high" as const
        : id === "task-calendar-fixtures"
          ? "medium" as const
          : "low" as const,
    dueAt: id === "task-done" ? null : now,
    updatedAt: now,
    tags: id === "task-inbox-rules" ? ["ops"] : id === "task-calendar-fixtures" ? ["calendar"] : [],
    notes:
      id === "task-done"
        ? "Already complete."
        : id === "task-calendar-fixtures"
          ? "Keep visible rows stable for future agenda virtualization."
          : "Define keyboard-first review states.",
    parentId: null,
    ...overrides
  };
}

function seededHcb(): HcbApi {
  const api = originalHcb!;
  let createdTaskCount = 0;

  return {
    ...api,
    tasks: {
      ...api.tasks,
      listTaskLists: vi.fn(async () =>
        ok({
          items: [
            {
              id: "list-inbox",
              title: "Inbox",
              updatedAt: now,
              taskCount: 2,
              activeTaskCount: 1
            },
            {
              id: "list-planning",
              title: "Planning",
              updatedAt: now,
              taskCount: 1,
              activeTaskCount: 1
            }
          ],
          page: { limit: 100, totalKnown: 2 }
        })
      ),
      list: vi.fn(async () =>
        ok({
          items: [
            {
              id: "task-inbox-rules",
              listId: "list-inbox",
              title: "Draft inbox triage rules",
              status: "active" as const,
              priority: "high" as const,
              dueAt: now,
              updatedAt: now,
              tags: ["ops"]
            },
            {
              id: "task-calendar-fixtures",
              listId: "list-planning",
              title: "Review calendar fixture shape",
              status: "active" as const,
              priority: "medium" as const,
              dueAt: now,
              updatedAt: now,
              tags: ["calendar"]
            },
            {
              id: "task-done",
              listId: "list-planning",
              title: "Report shell-visible timing",
              status: "completed" as const,
              priority: "low" as const,
              dueAt: null,
              updatedAt: now
            }
          ],
          page: { limit: 100, totalKnown: 3 }
        })
      ),
      get: vi.fn(async ({ id }) => ok(seededTaskDetail(id))),
      create: vi.fn(async (request) =>
        ok({
          id: `task-created-${++createdTaskCount}`,
          listId: request.listId,
          title: request.title,
          status: "active" as const,
          priority: request.priority ?? "none",
          dueAt: request.dueDate ? `${request.dueDate}T00:00:00.000Z` : null,
          updatedAt: now,
          notes: request.notes ?? "",
          parentId: request.parentId ?? null,
          plannedStart: request.plannedStart ?? null,
          plannedEnd: request.plannedEnd ?? null,
          durationMinutes: request.durationMinutes ?? null,
          lockedSchedule: request.lockedSchedule ?? false,
          snoozeUntil: request.snoozeUntil ?? null,
          tags: request.tags ?? []
        })
      ),
      update: vi.fn(async (request) =>
        ok(
          seededTaskDetail(request.id, {
            ...(request.title === undefined ? {} : { title: request.title }),
            ...(request.notes === undefined ? {} : { notes: request.notes }),
            ...(request.dueDate === undefined
              ? {}
              : { dueAt: request.dueDate ? `${request.dueDate}T00:00:00.000Z` : null }),
            ...(request.listId === undefined ? {} : { listId: request.listId }),
            ...(request.parentId === undefined ? {} : { parentId: request.parentId }),
            ...(request.priority === undefined ? {} : { priority: request.priority }),
            ...(request.plannedStart === undefined ? {} : { plannedStart: request.plannedStart }),
            ...(request.plannedEnd === undefined ? {} : { plannedEnd: request.plannedEnd }),
            ...(request.durationMinutes === undefined ? {} : { durationMinutes: request.durationMinutes }),
            ...(request.lockedSchedule === undefined ? {} : { lockedSchedule: request.lockedSchedule }),
            ...(request.snoozeUntil === undefined ? {} : { snoozeUntil: request.snoozeUntil }),
            ...(request.tags === undefined ? {} : { tags: request.tags })
          })
        )
      ),
      complete: vi.fn(async ({ id }) => ok(seededTaskDetail(id, { status: "completed" }))),
      reopen: vi.fn(async ({ id }) => ok(seededTaskDetail(id, { status: "active" }))),
      move: vi.fn(async (request) =>
        ok(
          seededTaskDetail(request.id, {
            ...(request.listId === undefined ? {} : { listId: request.listId }),
            ...(request.parentId === undefined ? {} : { parentId: request.parentId })
          })
        )
      ),
      delete: vi.fn(async ({ id }) => ok({ id, queued: true, revision: now })),
      createTaskList: vi.fn(async (request) =>
        ok({
          id: "list-created",
          title: request.title,
          updatedAt: now,
          taskCount: 0,
          activeTaskCount: 0
        })
      ),
      renameTaskList: vi.fn(async (request) =>
        ok({
          id: request.id,
          title: request.title,
          updatedAt: now,
          taskCount: request.id === "list-inbox" ? 2 : 1,
          activeTaskCount: request.id === "list-inbox" ? 1 : 1
        })
      ),
      deleteTaskList: vi.fn(async ({ id }) => ok({ id, queued: true, revision: now }))
    },
    calendar: {
      ...api.calendar,
      listCalendars: vi.fn(async () =>
        ok({
          items: [
            {
              id: "cal-product",
              title: "Product",
              selected: true,
              timeZone: "UTC",
              updatedAt: now,
              eventCount: 1
            }
          ],
          page: { limit: 100, totalKnown: 1 }
        })
      ),
      listEvents: vi.fn(async () =>
        ok({
          items: [
            {
              id: "event-standup",
              calendarId: "cal-product",
              title: "Planner shell standup",
              startsAt: `${todayDate}T09:30:00.000Z`,
              endsAt: `${todayDate}T09:50:00.000Z`,
              allDay: false,
              updatedAt: now
            },
            {
              id: "event-review",
              calendarId: "cal-product",
              title: "Renderer acceptance review",
              startsAt: `${todayDate}T15:30:00.000Z`,
              endsAt: `${todayDate}T16:15:00.000Z`,
              allDay: false,
              updatedAt: now
            }
          ],
          page: { limit: 250, totalKnown: 2 }
        })
      ),
      listScheduledTaskBlocks: vi.fn(async () =>
        ok({
          items: [],
          page: { limit: 250, totalKnown: 0 }
        })
      ),
      scheduleTaskBlock: vi.fn(async (request) =>
        ok({
          id: "block-created",
          taskId: request.taskId,
          calendarEventId: "event-task-block",
          calendarId: request.calendarId,
          title: request.taskId === "task-calendar-fixtures"
            ? "Review calendar fixture shape"
            : "Draft inbox triage rules",
          startsAt: request.startsAt,
          endsAt: new Date(
            Date.parse(request.startsAt) + (request.durationMinutes ?? 30) * 60 * 1000
          ).toISOString(),
          durationMinutes: request.durationMinutes ?? 30,
          status: "scheduled" as const,
          mutationState: "queued" as const,
          updatedAt: now
        })
      ),
      moveScheduledTaskBlock: vi.fn(async (request) =>
        ok({
          id: request.id,
          taskId: "task-inbox-rules",
          calendarEventId: "event-task-block",
          calendarId: request.calendarId ?? "cal-product",
          title: "Draft inbox triage rules",
          startsAt: request.startsAt ?? `${todayDate}T10:00:00.000Z`,
          endsAt: new Date(
            Date.parse(request.startsAt ?? `${todayDate}T10:00:00.000Z`) +
              (request.durationMinutes ?? 30) * 60 * 1000
          ).toISOString(),
          durationMinutes: request.durationMinutes ?? 30,
          status: "scheduled" as const,
          mutationState: "queued" as const,
          updatedAt: now
        })
      ),
      unscheduleTaskBlock: vi.fn(async (request) =>
        ok({
          id: request.id,
          queued: request.deleteCalendarEvent ?? true,
          revision: now
        })
      ),
      scheduleSuggest: vi.fn(async (request) =>
        ok({
          slots: [
            {
              startsAt: `${request.date}T09:30:00.000Z`,
              endsAt: `${request.date}T09:50:00.000Z`,
              eventId: "event-standup",
              locked: true,
              conflict: false
            },
            {
              startsAt: `${request.date}T10:00:00.000Z`,
              endsAt: `${request.date}T10:45:00.000Z`,
              taskId: "task-calendar-fixtures",
              locked: false,
              conflict: false
            }
          ],
          unscheduled: [
            seededTaskDetail("task-inbox-rules", {
              durationMinutes: 30
            })
          ],
          overloadMinutes: 0
        })
      ),
      exportAvailability: vi.fn(async (request) =>
        ok({
          format: "text" as const,
          text: `Availability from ${request.start} to ${request.end}`,
          generatedAt: now,
          busyBlockCount: 2
        })
      )
    },
    notes: {
      ...api.notes,
      list: vi.fn(async () =>
        ok({
          items: [
            {
              id: "note-cache-first",
              title: "Cache-first startup",
              preview: "Renderer paints from SQLite.",
              updatedAt: now
            }
          ],
          page: { limit: 50, totalKnown: 1 }
        })
      ),
      get: vi.fn(async ({ id }) =>
        ok({
          id,
          title: "Cache-first startup",
          preview: "Renderer paints from SQLite.",
          body: "Renderer paints from SQLite before fresh sync completes.",
          updatedAt: now
        })
      ),
      create: vi.fn(async (request) =>
        ok({
          id: "note-created",
          title: request.title,
          preview: request.body ?? "Empty local note",
          body: request.body ?? "",
          updatedAt: now
        })
      ),
      update: vi.fn(async (request) =>
        ok({
          id: request.id,
          title: request.title ?? "Untitled note",
          preview: request.body ?? "",
          body: request.body ?? "",
          updatedAt: now
        })
      ),
      delete: vi.fn(async (request) =>
        ok({
          id: request.id,
          queued: false,
          revision: now
        })
      ),
      linkSuggest: vi.fn(async (request) => {
        const query = request.query.toLowerCase();
        const items = [
          { kind: "note" as const, id: "note-cache-first", label: "Cache-first startup" },
          { kind: "task" as const, id: "task-inbox-rules", label: "Draft inbox triage rules" },
          { kind: "event" as const, id: "event-standup", label: "Planner shell standup" }
        ].filter((item) => item.label.toLowerCase().includes(query));

        return ok({ items: items.slice(0, request.limit ?? 8) });
      }),
      listBrokenLinks: vi.fn(async () => ok({ items: [] }))
    },
    search: {
      query: vi.fn(async (request) => {
        const query = request.query.toLowerCase();
        const items: SearchResultItem[] = [];

        if (query.includes("triage") || query.includes("task")) {
          items.push({
            id: "task-inbox-rules",
            domain: "tasks" as const,
            title: "Draft inbox triage rules",
            snippet: "Task in Inbox",
            updatedAt: now
          });
        }

        if (query.includes("review") || query.includes("event")) {
          items.push({
            id: "event-review",
            domain: "calendar" as const,
            title: "Renderer acceptance review",
            snippet: "Calendar event at 15:30",
            updatedAt: now
          });
        }

        if (query.includes("cache") || query.includes("note")) {
          items.push({
            id: "note-cache-first",
            domain: "notes" as const,
            title: "Cache-first startup",
            snippet: "Local note updated from cache",
            updatedAt: now
          });
        }

        return ok({
          items,
          page: { limit: 30, totalKnown: items.length }
        });
      })
    },
    sync: {
      ...api.sync,
      status: vi.fn(async () =>
        ok({
          state: "idle" as const,
          pendingMutationCount: 0,
          lastCompletedAt: now,
          offline: false,
          stale: false
        })
      )
    }
  };
}

function onboardingHcb(
  overrides: Partial<SettingsSnapshot> = {}
): { api: HcbApi; getSettings: () => SettingsSnapshot } {
  const api = seededHcb();
  let settings = testSettings({
    setupCompletedAt: null,
    selectedTaskListIds: [],
    selectedCalendarIds: [],
    ...overrides
  });

  api.settings.get = vi.fn(async () => ok(settings));
  api.settings.update = vi.fn(async (request) => {
    settings = testSettings({
      ...settings,
      ...request,
      setupCompletedAt:
        request.setupCompletedAt === undefined ? settings.setupCompletedAt : request.setupCompletedAt
    });

    return ok(settings);
  });
  api.settings.recoveryAction = vi.fn(async (request) => {
    if (request.action === "resetOnboarding") {
      settings = testSettings({
        ...settings,
        setupCompletedAt: null
      });
    }

    return ok({
      action: request.action,
      accepted: true,
      destructive: request.action !== "refresh" && request.action !== "resetOnboarding",
      requiresReload: request.action === "clearGoogleCache",
      message: "Recovery action accepted."
    });
  });

  return { api, getSettings: () => settings };
}

function loadingHcb(): HcbApi {
  const api = originalHcb!;
  const pendingRead = new Promise<never>(() => undefined);

  return {
    ...api,
    tasks: {
      ...api.tasks,
      listTaskLists: vi.fn(() => pendingRead)
    }
  };
}

function settingsLoadingHcb(): HcbApi {
  const api = seededHcb();
  const pendingRead = new Promise<never>(() => undefined);

  return {
    ...api,
    settings: {
      ...api.settings,
      get: vi.fn(() => pendingRead)
    }
  };
}

describe("App shell", () => {
  it("renders the loading cache state while preload reads are pending", () => {
    installHcb(loadingHcb());
    render(<App />);

    expect(screen.getByText("Loading local cache")).toBeInTheDocument();
    expect(screen.getByText("Reading cached planner data from SQLite.")).toBeInTheDocument();
  });

  it("waits for cached settings before reporting the shell visible", async () => {
    const api = settingsLoadingHcb();

    installHcb(api);
    render(<App />);

    await waitFor(() => expect(api.tasks.listTaskLists).toHaveBeenCalled());
    await new Promise((resolve) => window.setTimeout(resolve, 25));

    expect(api.diagnostics.markShellVisible).not.toHaveBeenCalled();
  });

  it("reports the shell visible after cached settings load while other cache reads continue", async () => {
    const api = loadingHcb();

    installHcb(api);
    render(<App />);

    await waitFor(() => expect(api.diagnostics.markShellVisible).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Loading local cache")).toBeInTheDocument();
  });

  it("reports the shell visible after the cached settings theme can be applied", async () => {
    const api = seededHcb();

    installHcb(api);
    render(<App />);

    await waitFor(() => expect(api.diagnostics.markShellVisible).toHaveBeenCalledTimes(1));
  });

  it("renders from an empty fresh local cache and invokes preload read APIs", async () => {
    render(<App />);

    expect(screen.getByTestId("app-shell")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "Today" })[0]).toBeInTheDocument();

    for (const label of ["Calendar", "Tasks", "Notes"]) {
      expect(within(primaryNavigation()).getByRole("button", { name: new RegExp(label) })).toBeInTheDocument();
    }
    expect(within(primaryNavigation()).queryByRole("button", { name: /Settings/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
    expect(within(primaryNavigation()).queryByRole("button", { name: /Notifications/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Notifications, \d+ active/ })).toBeInTheDocument();

    expect(await screen.findByText("Fresh local cache")).toBeInTheDocument();
    expect(screen.getByText("Nothing cached yet")).toBeInTheDocument();

    await waitFor(() => {
      expect(originalHcb?.tasks.listTaskLists).toHaveBeenCalled();
      expect(originalHcb?.tasks.list).toHaveBeenCalled();
      expect(originalHcb?.calendar.listCalendars).toHaveBeenCalled();
      expect(originalHcb?.calendar.listEvents).toHaveBeenCalled();
      expect(originalHcb?.notes.list).toHaveBeenCalled();
      expect(originalHcb?.sync.status).toHaveBeenCalled();
    });
  });

  it("navigates sections and opens the command palette", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(within(primaryNavigation()).getByRole("button", { name: /Tasks/ }));
    expect(screen.getByRole("heading", { level: 1, name: "Tasks" })).toBeInTheDocument();

    const tasksButton = within(primaryNavigation()).getByRole("button", { name: /Tasks/ });
    tasksButton.focus();
    await user.keyboard("{ArrowDown}");

    expect(screen.getByRole("heading", { level: 1, name: "Calendar" })).toBeInTheDocument();
    expect(within(primaryNavigation()).getByRole("button", { name: /Calendar/ })).toHaveFocus();

    await user.keyboard("{Meta>}p{/Meta}");
    const dialog = await screen.findByRole("dialog", { name: "Command palette" });

    await user.type(within(dialog).getByRole("searchbox", { name: "Filter commands" }), "note");
    expect(within(dialog).getByRole("option", { name: /New note/ })).toBeInTheDocument();

    await user.click(within(dialog).getByRole("option", { name: /Go to Notes/ }));
    expect(screen.queryByRole("dialog", { name: "Command palette" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Notes" })).toBeInTheDocument();
  });

  it("supports command-number shortcuts for primary sidebar sections", async () => {
    const user = userEvent.setup();
    render(<App />);

    const tasksButton = within(primaryNavigation()).getByRole("button", { name: "Tasks" });
    const calendarButton = within(primaryNavigation()).getByRole("button", { name: "Calendar" });
    const notesButton = within(primaryNavigation()).getByRole("button", { name: "Notes" });

    expect(tasksButton).toHaveAttribute(
      "aria-keyshortcuts",
      "Meta+1 Control+1"
    );
    expect(calendarButton).toHaveAttribute(
      "aria-keyshortcuts",
      "Meta+2 Control+2"
    );
    expect(notesButton).toHaveAttribute(
      "aria-keyshortcuts",
      "Meta+3 Control+3"
    );
    expect(within(tasksButton).getByText("Cmd 1")).toBeInTheDocument();
    expect(within(calendarButton).getByText("Cmd 2")).toBeInTheDocument();
    expect(within(notesButton).getByText("Cmd 3")).toBeInTheDocument();

    await user.keyboard("{Meta>}1{/Meta}");
    expect(screen.getByRole("heading", { level: 1, name: "Tasks" })).toBeInTheDocument();

    await user.keyboard("{Meta>}2{/Meta}");
    expect(screen.getByRole("heading", { level: 1, name: "Calendar" })).toBeInTheDocument();

    await user.keyboard("{Meta>}3{/Meta}");
    expect(screen.getByRole("heading", { level: 1, name: "Notes" })).toBeInTheDocument();
  });

  it("opens notifications as a toolbar overlay instead of a primary navigation section", async () => {
    const user = userEvent.setup();
    installHcb(seededHcb());
    render(<App />);

    expect(within(primaryNavigation()).queryByRole("button", { name: /Notifications/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Notifications, \d+ active/ }));

    const dialog = await screen.findByRole("dialog", { name: "Notifications" });
    expect(dialog.parentElement).toHaveClass("bg-bg-tertiary/45", "backdrop-blur-sm");
    expect(dialog).toHaveClass("bg-bg-primary");
    expect(dialog).not.toHaveClass("bg-bg-primary/95");
    expect(within(dialog).getByRole("heading", { level: 3, name: "App notices" })).toBeInTheDocument();
    expect(within(dialog).queryByText("Local reminders")).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Notification lead minutes")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Request permission" })).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Delivery status")).not.toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Notifications" })).not.toBeInTheDocument();
  });

  it("opens settings as a centered opaque overlay with a blurred backdrop", async () => {
    const user = userEvent.setup();
    installHcb(seededHcb());
    render(<App />);

    expect(within(primaryNavigation()).queryByRole("button", { name: /Settings/ })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Today" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Settings" }));

    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    expect(dialog.parentElement).toHaveClass("place-items-center", "bg-bg-tertiary/45", "backdrop-blur-sm");
    expect(dialog).toHaveClass("max-w-[1120px]", "bg-bg-primary");
    expect(dialog).not.toHaveClass("bg-bg-primary/90", "backdrop-blur-xl");
    expect(within(dialog).getByRole("button", { name: "General" })).toHaveAttribute("aria-pressed", "true");
    expect(within(dialog).getByRole("button", { name: "Profile" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Appearance" })).toBeInTheDocument();
    expect(within(dialog).getByRole("heading", { level: 2, name: "Language" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Today" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Settings" })).not.toBeInTheDocument();
  });

  it("routes palette action command shells without waiting on sync or search", async () => {
    const user = userEvent.setup();
    installHcb(seededHcb());
    render(<App />);

    await runPaletteCommand(user, "new task", /New task/);
    expect(screen.getByRole("heading", { level: 1, name: "Tasks" })).toBeInTheDocument();

    await runPaletteCommand(user, "new event", /New event/);
    expect(screen.getByRole("heading", { level: 1, name: "Calendar" })).toBeInTheDocument();

    await runPaletteCommand(user, "quick capture", /Quick capture/);
    expect(screen.getByRole("heading", { level: 1, name: "Tasks" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Quick capture" })).toBeInTheDocument();

    await runPaletteCommand(user, "refresh", /Refresh/);
    expect(screen.getByRole("heading", { level: 1, name: "Today" })).toBeInTheDocument();

    await runPaletteCommand(user, "force", /Force full resync/);
    expect(await screen.findByRole("dialog", { name: "Settings" })).toBeInTheDocument();

    await runPaletteCommand(user, "mcp", /Toggle MCP server/);
    expect(await screen.findByRole("dialog", { name: "Settings" })).toBeInTheDocument();

    await runPaletteCommand(user, "diagnostics", /Copy diagnostics summary/);
    expect(await screen.findByRole("dialog", { name: "Settings" })).toBeInTheDocument();
  });

  it("shares action IDs across task controls and command palette availability", async () => {
    const user = userEvent.setup();
    installHcb(seededHcb());
    render(<App />);

    await goToSection("Tasks");
    expect(await screen.findByRole("heading", { name: "Inbox" })).toBeInTheDocument();

    const taskToolbar = screen.getByRole("toolbar", { name: "Task actions" });
    const newTaskButton = within(taskToolbar).getByRole("button", { name: "New task" });
    const quickCaptureButton = within(taskToolbar).getByRole("button", { name: "Quick capture" });
    const completeButton = within(taskToolbar).getByRole("button", { name: "Complete" });

    expect(newTaskButton).toHaveAttribute("data-action-id", "task.create");
    expect(quickCaptureButton).toHaveAttribute("data-action-id", "task.quickCapture");
    expect(completeButton).toHaveAttribute("data-action-id", "task.completeSelected");
    expect(completeButton).toBeDisabled();

    await user.keyboard("{Meta>}p{/Meta}");
    const dialog = await screen.findByRole("dialog", { name: "Command palette" });
    const input = within(dialog).getByRole("searchbox", { name: "Filter commands" });

    await user.type(input, "complete selected");
    const completeCommand = within(dialog).getByRole("option", { name: /Complete selected task/ });

    expect(completeCommand).toHaveAttribute("data-action-id", "task.completeSelected");
    expect(completeCommand).toBeDisabled();
    expect(completeCommand).toHaveTextContent("No selected task");

    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: /^Draft inbox triage rules / }));
    expect(completeButton).not.toBeDisabled();
  });

  it("renders seeded SQLite-shaped data and uses local search", async () => {
    const api = seededHcb();
    installHcb(api);
    render(<App />);

    expect(await screen.findByText("Local cache ready")).toBeInTheDocument();
    expect(screen.getAllByText("Draft inbox triage rules")[0]).toBeInTheDocument();
    expect(screen.getByText("Planner shell standup")).toBeInTheDocument();

    await goToSection("Tasks");
    expect(screen.getByRole("heading", { name: "Inbox" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Planning" })).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();

    await goToSection("Calendar");
    expect(screen.getByText("Agenda view")).toBeInTheDocument();
    expect(screen.getAllByText("Product").length).toBeGreaterThan(0);

    await goToSection("Search");
    await userEvent.setup().type(screen.getByRole("textbox", { name: "Search local cache" }), "triage");
    expect(await screen.findByText(/Task in Inbox/)).toBeInTheDocument();
    expect(api.search.query).toHaveBeenCalledWith({ query: "triage", limit: 30 });
  });

  it("renders the schedule-backed Today timeline", async () => {
    installHcb(seededHcb());
    render(<App />);

    expect(await screen.findByText("Local cache ready")).toBeInTheDocument();
    const timeline = screen.getByRole("list", { name: "Today timeline" });

    expect(screen.getByText("Within capacity")).toBeInTheDocument();
    expect(within(timeline).getByText("Planner shell standup")).toBeInTheDocument();
    expect(within(timeline).getByText("Review calendar fixture shape")).toBeInTheDocument();
  });

  it("quick-adds a planned task from an empty Today slot", async () => {
    const api = seededHcb();
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByText("Local cache ready")).toBeInTheDocument();

    await user.click(screen.getByLabelText("Quick add at 11:00"));
    await user.type(screen.getByRole("textbox", { name: "Quick add title" }), "Write launch note");
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(api.tasks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Write launch note",
          plannedStart: expect.stringContaining("T11:00:00.000Z"),
          plannedEnd: expect.stringContaining("T11:30:00.000Z"),
          durationMinutes: 30
        })
      );
    });
  });

  it("schedules an unscheduled task from the Today focus queue", async () => {
    const api = seededHcb();
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByText("Local cache ready")).toBeInTheDocument();
    await user.click(screen.getByLabelText("Schedule Draft inbox triage rules at 10:30"));

    await waitFor(() => {
      expect(api.calendar.scheduleTaskBlock).toHaveBeenCalledWith({
        taskId: "task-inbox-rules",
        calendarId: "cal-product",
        startsAt: expect.stringContaining("T10:30:00.000Z"),
        durationMinutes: 30
      });
    });
  });

  it("surfaces Today conflicts and creates a scheduled block from keyboard moves", async () => {
    const api = seededHcb();
    api.calendar.scheduleSuggest = vi.fn(async (request) =>
      ok({
        slots: [
          {
            startsAt: `${request.date}T10:00:00.000Z`,
            endsAt: `${request.date}T10:45:00.000Z`,
            taskId: "task-inbox-rules",
            locked: false,
            conflict: true
          },
          {
            startsAt: `${request.date}T10:15:00.000Z`,
            endsAt: `${request.date}T11:00:00.000Z`,
            taskId: "task-calendar-fixtures",
            locked: false,
            conflict: true
          }
        ],
        unscheduled: [],
        overloadMinutes: 0
      })
    );
    installHcb(api);
    render(<App />);

    expect(await screen.findByText("Local cache ready")).toBeInTheDocument();
    expect(screen.getAllByText("Conflict").length).toBeGreaterThan(0);
    fireEvent.keyDown(screen.getByRole("button", { name: /Draft inbox triage rules/ }), {
      key: "ArrowDown"
    });

    await waitFor(() => {
      expect(api.calendar.scheduleTaskBlock).toHaveBeenCalledWith({
        taskId: "task-inbox-rules",
        calendarId: "cal-product",
        startsAt: expect.stringContaining("T10:15:00.000Z"),
        durationMinutes: 45
      });
    });
  });

  it("moves and unschedules existing scheduled task blocks from Today", async () => {
    const api = seededHcb();
    api.calendar.listScheduledTaskBlocks = vi.fn(async () =>
      ok({
        items: [
          {
            id: "block-inbox",
            taskId: "task-inbox-rules",
            calendarEventId: "event-task-block",
            calendarId: "cal-product",
            title: "Draft inbox triage rules",
            startsAt: `${todayDate}T10:00:00.000Z`,
            endsAt: `${todayDate}T10:30:00.000Z`,
            durationMinutes: 30,
            status: "scheduled" as const,
            updatedAt: now
          }
        ],
        page: { limit: 250, totalKnown: 1 }
      })
    );
    api.calendar.scheduleSuggest = vi.fn(async (request) =>
      ok({
        slots: [
          {
            startsAt: `${request.date}T10:00:00.000Z`,
            endsAt: `${request.date}T10:30:00.000Z`,
            taskId: "task-inbox-rules",
            locked: false,
            conflict: false
          }
        ],
        unscheduled: [],
        overloadMinutes: 0
      })
    );
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    const blocks = await screen.findByRole("list", { name: "Scheduled task blocks" });
    expect(within(blocks).getByText("Scheduled")).toBeInTheDocument();

    await user.click(within(blocks).getByLabelText("Move Draft inbox triage rules later"));
    await waitFor(() => {
      expect(api.calendar.moveScheduledTaskBlock).toHaveBeenCalledWith({
        id: "block-inbox",
        calendarId: "cal-product",
        startsAt: expect.stringContaining("T10:30:00.000Z"),
        durationMinutes: 30
      });
    });

    await user.click(within(blocks).getByLabelText("Unschedule Draft inbox triage rules"));
    await waitFor(() => {
      expect(api.calendar.unscheduleTaskBlock).toHaveBeenCalledWith({
        id: "block-inbox",
        deleteCalendarEvent: true
      });
    });
  });

  it("repairs orphaned scheduled task blocks from Today", async () => {
    const api = seededHcb();
    api.calendar.listScheduledTaskBlocks = vi.fn(async () =>
      ok({
        items: [
          {
            id: "block-orphan",
            taskId: "task-inbox-rules",
            calendarEventId: "event-missing",
            calendarId: "cal-product",
            title: "Draft inbox triage rules",
            startsAt: `${todayDate}T10:00:00.000Z`,
            endsAt: `${todayDate}T10:30:00.000Z`,
            durationMinutes: 30,
            status: "orphaned" as const,
            updatedAt: now
          }
        ],
        page: { limit: 250, totalKnown: 1 }
      })
    );
    api.calendar.scheduleSuggest = vi.fn(async () =>
      ok({
        slots: [],
        unscheduled: [],
        overloadMinutes: 0
      })
    );
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    const blocks = await screen.findByRole("list", { name: "Scheduled task blocks" });
    expect(within(blocks).getByText("Needs repair")).toBeInTheDocument();

    await user.click(within(blocks).getByLabelText("Repair Draft inbox triage rules"));
    await waitFor(() => {
      expect(api.calendar.moveScheduledTaskBlock).toHaveBeenCalledWith({
        id: "block-orphan",
        calendarId: "cal-product",
        startsAt: expect.stringContaining("T10:00:00.000Z"),
        durationMinutes: 30
      });
    });
  });

  it("quick-adds an event from Today", async () => {
    const api = seededHcb();
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByText("Local cache ready")).toBeInTheDocument();
    await user.click(screen.getByLabelText("Quick add at 12:00"));
    await user.click(screen.getByRole("button", { name: "Event" }));
    await user.type(screen.getByRole("textbox", { name: "Quick add title" }), "Design review");
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(api.calendar.create).toHaveBeenCalledWith({
        title: "Design review",
        calendarId: "cal-product",
        startsAt: expect.stringContaining("T12:00:00.000Z"),
        endsAt: expect.stringContaining("T12:30:00.000Z"),
        allDay: false,
        location: "",
        notes: "",
        guestEmails: [],
        reminderMinutes: []
      });
    });
  });

  it("renders task groups, subtasks, completion, empty state, and error state", async () => {
    const api = seededHcb();
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Tasks");

    expect(await screen.findByRole("heading", { name: "Inbox" })).toBeInTheDocument();
    const inboxTasks = screen.getByRole("list", { name: "Inbox tasks" });
    expect(within(inboxTasks).getByLabelText("Task due state Draft inbox triage rules")).toHaveTextContent("Due today");
    expect(within(inboxTasks).getByLabelText("Task priority Draft inbox triage rules")).toHaveTextContent("High priority");
    expect(screen.getByRole("heading", { name: "Planning" })).toBeInTheDocument();
    expect(screen.getByText("Map shortcut states")).toBeInTheDocument();
    expect(screen.getByText("Month grid shell")).toBeInTheDocument();

    const filters = screen.getByRole("toolbar", { name: "Task filters" });
    await user.click(screen.getByRole("button", { name: "Complete Draft inbox triage rules" }));
    expect(api.tasks.complete).toHaveBeenCalledWith({ id: "task-inbox-rules" });
    await user.click(within(filters).getByRole("button", { name: /Completed/ }));
    expect(await screen.findByRole("button", { name: "Reopen Draft inbox triage rules" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reopen Draft inbox triage rules" }));
    expect(api.tasks.reopen).toHaveBeenCalledWith({ id: "task-inbox-rules" });

    await user.click(within(filters).getByRole("button", { name: /Empty/ }));
    expect(screen.getByText("No tasks in this filter")).toBeInTheDocument();

    await user.click(within(filters).getByRole("button", { name: /Error/ }));
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong");
  });

  it("switches task perspectives and renders saved task view chips", async () => {
    const api = seededHcb();
    api.settings.get = vi.fn(async () =>
      ok(
        testSettings({
          savedTaskViews: [
            {
              id: "task-view-ops",
              name: "Ops focus",
              filters: {
                statuses: ["active"],
                tags: ["ops"]
              },
              groupBy: "tag",
              sortBy: "priority",
              createdAt: now,
              updatedAt: now
            }
          ]
        })
      )
    );
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Tasks");
    const perspectives = await screen.findByRole("tablist", { name: "Task perspectives" });

    expect(within(perspectives).getByRole("tab", { name: /Projects/ })).toHaveAttribute("aria-selected", "true");

    await user.click(within(perspectives).getByRole("tab", { name: "Tags" }));
    expect(await screen.findByRole("heading", { name: "ops" })).toBeInTheDocument();

    await user.click(within(perspectives).getByRole("tab", { name: /Saved/ }));
    const savedViews = screen.getByRole("list", { name: "Saved task perspectives" });

    expect(within(savedViews).getByText("Ops focus")).toBeInTheDocument();
    expect(within(savedViews).getByText("Tags: ops")).toBeInTheDocument();
    expect(within(savedViews).getByText("Group: tag")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "ops" })).toBeInTheDocument();
  });

  it("creates, edits, deletes, and quick-captures tasks through preload", async () => {
    const api = seededHcb();
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Tasks");
    expect(await screen.findByRole("heading", { name: "Inbox" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "New task" }));
    await user.type(screen.getByRole("textbox", { name: "Task title" }), "Send status recap");
    fireEvent.change(screen.getByLabelText("Task due date"), { target: { value: "2026-05-23" } });
    await user.selectOptions(screen.getByLabelText("Task priority"), "medium");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(api.tasks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Send status recap",
          listId: "list-inbox",
          dueDate: "2026-05-23",
          priority: "medium",
          parentId: null
        })
      );
    });

    await user.click(screen.getByRole("button", { name: /^Draft inbox triage rules / }));
    const titleInput = screen.getByRole("textbox", { name: "Task title" });
    await user.clear(titleInput);
    await user.type(titleInput, "Draft inbox triage rules v2");
    await user.selectOptions(screen.getByLabelText("Task list"), "list-planning");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(api.tasks.update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "task-inbox-rules",
          title: "Draft inbox triage rules v2",
          listId: "list-planning"
        })
      );
    });

    await user.click(screen.getByRole("button", { name: /^Review calendar fixture shape / }));
    await user.click(within(screen.getByTestId("inspector-actions")).getByRole("button", { name: "Delete" }));
    expect(api.tasks.delete).toHaveBeenCalledWith({ id: "task-calendar-fixtures" });

    await runPaletteCommand(user, "quick capture", /Quick capture/);
    await user.type(
      screen.getByRole("textbox", { name: "Quick capture task" }),
      "Review notes 2026-05-23 #Planning @2pm ~30m !locked +ops"
    );
    await user.click(screen.getByRole("button", { name: "Capture" }));

    await waitFor(() => {
      expect(api.tasks.create).toHaveBeenLastCalledWith(
        expect.objectContaining({
          title: "Review notes",
          listId: "list-planning",
          dueDate: "2026-05-23",
          durationMinutes: 30,
          lockedSchedule: true,
          plannedStart: expect.any(String),
          plannedEnd: expect.any(String),
          tags: ["ops"]
        })
      );
    });
  });

  it("opens the task inspector from a row and blocks Escape while dirty", async () => {
    installHcb(seededHcb());
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Tasks");
    await user.click(await screen.findByRole("button", { name: /^Draft inbox triage rules / }));

    const inspector = await screen.findByTestId("inspector-shell");
    expect(inspector).toHaveAttribute("data-inspector-kind", "task");
    expect(inspector).toHaveAttribute("data-inspector-id", "task-inbox-rules");

    const titleInput = within(inspector).getByRole("textbox", { name: "Task title" });
    await user.clear(titleInput);
    await user.type(titleInput, "Draft inbox triage rules v2");
    await waitFor(() => expect(within(inspector).getByText("Unsaved")).toBeInTheDocument());

    await user.keyboard("{Escape}");
    expect(screen.getByTestId("inspector-shell")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Task title" })).toHaveValue("Draft inbox triage rules v2");
  });

  it("bulk selects, moves, completes, and deletes tasks through preload", async () => {
    const api = seededHcb();
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Tasks");
    expect(await screen.findByRole("heading", { name: "Inbox" })).toBeInTheDocument();

    await user.click(screen.getByLabelText("Select Draft inbox triage rules"));
    await user.click(screen.getByLabelText("Select Review calendar fixture shape"));
    expect(screen.getByText("2 tasks selected")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Bulk move list"), "list-planning");
    await user.click(screen.getByRole("button", { name: "Move selected" }));

    await waitFor(() => {
      expect(api.tasks.move).toHaveBeenCalledWith({
        id: "task-inbox-rules",
        listId: "list-planning",
        parentId: null
      });
      expect(api.tasks.move).toHaveBeenCalledWith({
        id: "task-calendar-fixtures",
        listId: "list-planning",
        parentId: null
      });
    });

    await user.click(screen.getByLabelText("Select Draft inbox triage rules"));
    await user.click(screen.getByRole("button", { name: "Complete selected" }));

    await waitFor(() => {
      expect(api.tasks.complete).toHaveBeenCalledWith({ id: "task-inbox-rules" });
    });

    await user.click(screen.getByLabelText("Select Review calendar fixture shape"));
    await user.click(screen.getByRole("button", { name: "Delete selected" }));

    await waitFor(() => {
      expect(api.tasks.delete).toHaveBeenCalledWith({ id: "task-calendar-fixtures" });
    });
  });

  it("reverts optimistic task creation and retries recoverable task errors", async () => {
    const api = seededHcb();
    api.tasks.create = vi.fn()
      .mockResolvedValueOnce(
        err({
          code: "SERVICE_UNAVAILABLE",
          message: "Task queue is temporarily unavailable.",
          recoverable: true
        })
      )
      .mockResolvedValueOnce(
        ok({
          id: "task-retry-created",
          listId: "list-inbox",
          title: "Retry optimistic write",
          status: "active" as const,
          priority: "none" as const,
          dueAt: null,
          updatedAt: now,
          notes: "",
          parentId: null
        })
      );
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Tasks");
    expect(await screen.findByRole("heading", { name: "Inbox" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "New task" }));
    await user.type(screen.getByRole("textbox", { name: "Task title" }), "Retry optimistic write");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Task write not saved")).toBeInTheDocument();
    expect(screen.queryByText("Retry optimistic write")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(api.tasks.create).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.getAllByText("Retry optimistic write").length).toBeGreaterThan(0);
    });
    expect(screen.queryByText("Task write not saved")).not.toBeInTheDocument();
  });

  it("creates, renames, and deletes task lists through preload", async () => {
    const api = seededHcb();
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Tasks");
    expect(await screen.findByRole("heading", { name: "Inbox" })).toBeInTheDocument();

    await user.type(screen.getByRole("textbox", { name: "New task list title" }), "Errands");
    await user.click(screen.getByRole("button", { name: "Create task list" }));
    expect(api.tasks.createTaskList).toHaveBeenCalledWith({ title: "Errands" });

    const inboxTitle = screen.getByRole("textbox", { name: "Rename Inbox" });
    await user.clear(inboxTitle);
    await user.type(inboxTitle, "Inbox renamed");
    await user.click(screen.getByRole("button", { name: "Save Inbox" }));
    expect(api.tasks.renameTaskList).toHaveBeenCalledWith({
      id: "list-inbox",
      title: "Inbox renamed"
    });

    await user.click(screen.getByRole("button", { name: "Delete Planning" }));
    expect(api.tasks.deleteTaskList).toHaveBeenCalledWith({ id: "list-planning" });
  });

  it("switches calendar agenda, day, week, and month shells", async () => {
    installHcb(seededHcb());
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Calendar");
    expect(await screen.findByText("Agenda view")).toBeInTheDocument();
    const agenda = await screen.findByRole("list", { name: "Calendar agenda" });
    expect(within(agenda).getByText("Planner shell standup")).toBeInTheDocument();

    const tabs = screen.getByRole("tablist", { name: "Calendar views" });
    await user.click(within(tabs).getByRole("tab", { name: "Day" }));
    expect(screen.getByRole("grid", { name: "Calendar day view" })).toBeInTheDocument();

    await user.click(within(tabs).getByRole("tab", { name: "Week" }));
    expect(screen.getByRole("grid", { name: "Calendar week view" })).toBeInTheDocument();

    await user.click(within(tabs).getByRole("tab", { name: "Month" }));
    expect(screen.getByRole("grid", { name: "Calendar month view" })).toBeInTheDocument();
  });

  it("separates all-day calendar events and summarizes dense month cells", async () => {
    const api = seededHcb();
    api.calendar.listEvents = vi.fn(async () =>
      ok({
        items: [
          {
            id: "event-launch-freeze",
            calendarId: "cal-product",
            title: "Launch freeze",
            startsAt: now,
            endsAt: tomorrowIso,
            allDay: true,
            updatedAt: now
          },
          {
            id: "event-design-sync",
            calendarId: "cal-product",
            title: "Design sync",
            startsAt: `${todayDate}T09:00:00.000Z`,
            endsAt: `${todayDate}T09:30:00.000Z`,
            allDay: false,
            updatedAt: now
          },
          {
            id: "event-roadmap-check",
            calendarId: "cal-product",
            title: "Roadmap check",
            startsAt: `${todayDate}T10:00:00.000Z`,
            endsAt: `${todayDate}T10:30:00.000Z`,
            allDay: false,
            updatedAt: now
          },
          {
            id: "event-partner-review",
            calendarId: "cal-product",
            title: "Partner review",
            startsAt: `${todayDate}T11:00:00.000Z`,
            endsAt: `${todayDate}T11:30:00.000Z`,
            allDay: false,
            updatedAt: now
          },
          {
            id: "event-release-notes",
            calendarId: "cal-product",
            title: "Release notes",
            startsAt: `${todayDate}T12:00:00.000Z`,
            endsAt: `${todayDate}T12:30:00.000Z`,
            allDay: false,
            updatedAt: now
          }
        ],
        page: { limit: 250, totalKnown: 5 }
      })
    );
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Calendar");
    expect(await screen.findByText("Agenda view")).toBeInTheDocument();

    const tabs = screen.getByRole("tablist", { name: "Calendar views" });
    await user.click(within(tabs).getByRole("tab", { name: "Day" }));

    const allDayLane = screen.getByRole("group", { name: /All-day events/ });
    expect(within(allDayLane).getByRole("button", { name: "Launch freeze" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "09:00-09:30 Design sync" })).toBeInTheDocument();

    await user.click(within(tabs).getByRole("tab", { name: "Month" }));

    const monthGrid = screen.getByRole("grid", { name: "Calendar month view" });
    expect(within(monthGrid).getByRole("button", { name: "Launch freeze" })).toBeInTheDocument();
    expect(within(monthGrid).getByRole("button", { name: "Design sync" })).toBeInTheDocument();
    expect(within(monthGrid).getByText("2 more")).toBeInTheDocument();
  });

  it("opens calendar creation from keyboard-focused grid cells", async () => {
    installHcb(seededHcb());
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Calendar");
    expect(await screen.findByText("Agenda view")).toBeInTheDocument();

    const tabs = screen.getByRole("tablist", { name: "Calendar views" });
    await user.click(within(tabs).getByRole("tab", { name: "Week" }));
    const grid = screen.getByRole("grid", { name: "Calendar week view" });
    const firstCell = within(grid).getAllByRole("gridcell")[0];

    firstCell.focus();
    fireEvent.keyDown(firstCell, { key: "Enter" });

    expect(await screen.findByRole("heading", { level: 2, name: "New event" })).toBeInTheDocument();
    expect(screen.getByTestId("inspector-shell")).toHaveAttribute("data-inspector-kind", "event");
    expect(screen.getByRole("button", { name: "New event" })).toHaveAttribute(
      "data-action-id",
      "calendar.create"
    );
  });

  it("creates timed calendar drafts from day planning slots", async () => {
    installHcb(seededHcb());
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Calendar");
    expect(await screen.findByText("Agenda view")).toBeInTheDocument();

    const tabs = screen.getByRole("tablist", { name: "Calendar views" });
    await user.click(within(tabs).getByRole("tab", { name: "Day" }));
    await user.click(screen.getByRole("button", { name: "Create event at 11:00" }));

    expect(await screen.findByRole("heading", { level: 2, name: "New event" })).toBeInTheDocument();
    expect(screen.getByTestId("inspector-shell")).toHaveAttribute("data-inspector-kind", "event");
    expect(screen.getByLabelText("Event starts")).toHaveValue(`${todayDate}T11:00`);
    expect(screen.getByLabelText("Event ends")).toHaveValue(`${todayDate}T12:00`);
  });

  it("opens calendar events in the inspector", async () => {
    installHcb(seededHcb());
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Calendar");
    expect(await screen.findByText("Agenda view")).toBeInTheDocument();

    const agenda = await screen.findByRole("list", { name: "Calendar agenda" });
    await user.click(within(agenda).getByText("Planner shell standup"));

    const inspector = await screen.findByTestId("inspector-shell");
    expect(inspector).toHaveAttribute("data-inspector-kind", "event");
    expect(inspector).toHaveAttribute("data-inspector-id", "event-standup");

    const context = within(inspector).getByRole("group", { name: "Event context" });
    expect(within(context).getByText("Product")).toBeInTheDocument();
    expect(within(context).getByText(new RegExp(`${todayDate}.*09:30-09:50`))).toBeInTheDocument();
    expect(within(context).getByText("UTC")).toBeInTheDocument();
  });

  it("shows event pending mutation badges in rows and inspector", async () => {
    const api = seededHcb();
    api.calendar.listEvents = vi.fn(async () =>
      ok({
        items: [
          {
            id: "event-standup",
            calendarId: "cal-product",
            title: "Planner shell standup",
            startsAt: `${todayDate}T09:30:00.000Z`,
            endsAt: `${todayDate}T09:50:00.000Z`,
            allDay: false,
            mutationState: "queued" as const,
            updatedAt: now
          }
        ],
        page: { limit: 250, totalKnown: 1 }
      })
    );
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Calendar");
    const agenda = await screen.findByRole("list", { name: "Calendar agenda" });
    expect(within(agenda).getByText("Queued")).toBeInTheDocument();

    await user.click(within(agenda).getByText("Planner shell standup"));
    const inspector = await screen.findByTestId("inspector-shell");

    expect(within(inspector).getByText("Queued")).toBeInTheDocument();
  });

  it("keeps a dirty calendar event inspector open on Escape", async () => {
    installHcb(seededHcb());
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Calendar");
    expect(await screen.findByText("Agenda view")).toBeInTheDocument();
    const agenda = await screen.findByRole("list", { name: "Calendar agenda" });
    await user.click(within(agenda).getByText("Planner shell standup"));

    const titleInput = await screen.findByRole("textbox", { name: "Event title" });
    await user.clear(titleInput);
    await user.type(titleInput, "Planner shell sync");
    await user.keyboard("{Escape}");

    expect(screen.getByTestId("inspector-shell")).toHaveAttribute("data-inspector-kind", "event");
    expect(screen.getByText("Unsaved")).toBeInTheDocument();
  });

  it("filters calendar views by visible calendar source", async () => {
    const api = seededHcb();
    api.calendar.listCalendars = vi.fn(async () =>
      ok({
        items: [
          {
            id: "cal-product",
            title: "Product",
            selected: true,
            timeZone: "UTC",
            updatedAt: now,
            eventCount: 1
          },
          {
            id: "cal-engineering",
            title: "Engineering",
            selected: true,
            timeZone: "UTC",
            updatedAt: now,
            eventCount: 1
          }
        ],
        page: { limit: 100, totalKnown: 2 }
      })
    );
    api.calendar.listEvents = vi.fn(async () =>
      ok({
        items: [
          {
            id: "event-standup",
            calendarId: "cal-product",
            title: "Planner shell standup",
            startsAt: `${todayDate}T09:30:00.000Z`,
            endsAt: `${todayDate}T09:50:00.000Z`,
            allDay: false,
            updatedAt: now
          },
          {
            id: "event-engineering-sync",
            calendarId: "cal-engineering",
            title: "Engineering sync",
            startsAt: `${todayDate}T10:30:00.000Z`,
            endsAt: `${todayDate}T11:00:00.000Z`,
            allDay: false,
            updatedAt: now
          }
        ],
        page: { limit: 250, totalKnown: 2 }
      })
    );
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Calendar");
    const agenda = await screen.findByRole("list", { name: "Calendar agenda" });
    expect(await within(agenda).findByText("Planner shell standup")).toBeInTheDocument();
    expect(within(agenda).getByText("Engineering sync")).toBeInTheDocument();
    expect(screen.getAllByText("UTC").length).toBeGreaterThan(0);
    expect(screen.getByRole("status", { name: "Calendar status" })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Calendar context" })).getByText("Planner shell standup")).toBeInTheDocument();

    const visibility = screen.getByRole("group", { name: "Calendar visibility" });
    expect(within(visibility).getByText("Shown")).toBeInTheDocument();
    await user.click(within(visibility).getByLabelText(/Product/));

    await waitFor(() => {
      expect(within(agenda).queryByText("Planner shell standup")).not.toBeInTheDocument();
      expect(within(agenda).getByText("Engineering sync")).toBeInTheDocument();
      expect(within(visibility).getByText("Hidden")).toBeInTheDocument();
      expect(within(visibility).getByLabelText(/Show Product/)).toBeInTheDocument();
    });
  });

  it("drags and resizes calendar events in the day planning grid", async () => {
    const api = seededHcb();
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Calendar");
    expect(await screen.findByText("Agenda view")).toBeInTheDocument();

    const tabs = screen.getByRole("tablist", { name: "Calendar views" });
    await user.click(within(tabs).getByRole("tab", { name: "Day" }));

    const eventButton = screen.getByRole("button", {
      name: "09:30-09:50 Planner shell standup"
    });
    eventButton.focus();
    await user.keyboard("{ArrowDown}");

    await waitFor(() => {
      expect(api.calendar.update).toHaveBeenCalledWith({
        id: "event-standup",
        startsAt: `${todayDate}T09:45:00.000Z`,
        endsAt: `${todayDate}T10:05:00.000Z`,
        allDay: false
      });
    });
    expect(screen.queryByTestId("inspector-shell")).not.toBeInTheDocument();
    vi.mocked(api.calendar.update).mockClear();

    eventButton.focus();
    await user.keyboard("{ArrowUp}");

    await waitFor(() => {
      expect(api.calendar.update).toHaveBeenCalledWith({
        id: "event-standup",
        startsAt: `${todayDate}T09:15:00.000Z`,
        endsAt: `${todayDate}T09:35:00.000Z`,
        allDay: false
      });
    });
    expect(screen.queryByTestId("inspector-shell")).not.toBeInTheDocument();
    vi.mocked(api.calendar.update).mockClear();

    const moveTransfer = testDataTransfer();
    const moveTarget = screen.getByRole("row", { name: "11:00 Open slot" });

    fireEvent.dragStart(eventButton, { dataTransfer: moveTransfer });
    fireEvent.dragOver(moveTarget, { dataTransfer: moveTransfer });
    fireEvent.drop(moveTarget, { dataTransfer: moveTransfer });

    await waitFor(() => {
      expect(api.calendar.update).toHaveBeenCalledWith({
        id: "event-standup",
        startsAt: `${todayDate}T11:00:00.000Z`,
        endsAt: `${todayDate}T11:20:00.000Z`,
        allDay: false
      });
    });
    expect(screen.queryByTestId("inspector-shell")).not.toBeInTheDocument();

    const resizeHandle = screen.getByRole("button", { name: "Resize Planner shell standup end" });
    const resizeTransfer = testDataTransfer();
    const resizeTarget = screen.getByRole("row", { name: "12:00 Open slot" });

    fireEvent.dragStart(resizeHandle, { dataTransfer: resizeTransfer });
    fireEvent.dragOver(resizeTarget, { dataTransfer: resizeTransfer });
    fireEvent.drop(resizeTarget, { dataTransfer: resizeTransfer });

    await waitFor(() => {
      expect(api.calendar.update).toHaveBeenCalledWith({
        id: "event-standup",
        endsAt: `${todayDate}T12:00:00.000Z`
      });
    });
    expect(screen.queryByTestId("inspector-shell")).not.toBeInTheDocument();
  });

  it("drags calendar events across week days while preserving time", async () => {
    const api = seededHcb();
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Calendar");
    expect(await screen.findByText("Agenda view")).toBeInTheDocument();

    const tabs = screen.getByRole("tablist", { name: "Calendar views" });
    await user.click(within(tabs).getByRole("tab", { name: "Week" }));

    const eventButton = screen.getByRole("button", {
      name: "09:30 Planner shell standup"
    });
    const weekGrid = screen.getByRole("grid", { name: "Calendar week view" });
    const targetDay = within(weekGrid).getAllByRole("gridcell")[0];
    const transfer = testDataTransfer();
    const targetDate = utcWeekStartDate(now);

    fireEvent.dragStart(eventButton, { dataTransfer: transfer });
    fireEvent.dragOver(targetDay, { dataTransfer: transfer });
    fireEvent.drop(targetDay, { dataTransfer: transfer });

    await waitFor(() => {
      expect(api.calendar.update).toHaveBeenCalledWith({
        id: "event-standup",
        startsAt: `${targetDate}T09:30:00.000Z`,
        endsAt: `${targetDate}T09:50:00.000Z`,
        allDay: false
      });
    });
  });

  it("creates, edits, and deletes calendar events through preload", async () => {
    const api = seededHcb();
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Calendar");
    expect(await screen.findByText("Agenda view")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /New event/ }));
    await user.type(screen.getByRole("textbox", { name: "Event title" }), "Design review");
    fireEvent.change(screen.getByLabelText("Event starts"), { target: { value: `${todayDate}T11:00` } });
    fireEvent.change(screen.getByLabelText("Event ends"), { target: { value: `${todayDate}T12:00` } });
    await user.type(screen.getByRole("textbox", { name: "Event location" }), "Room 3");
    await user.type(screen.getByRole("textbox", { name: "Event guests" }), "ada@example.com");
    await user.selectOptions(screen.getByLabelText("Event reminder"), "15");
    await user.selectOptions(screen.getByLabelText("Event repeat frequency"), "weekly");
    fireEvent.change(screen.getByLabelText("Repeat interval"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Repeat end date"), { target: { value: "2026-12-31" } });
    expect(screen.getByText("Every 2 weeks, until 2026-12-31")).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Event notes" }), "Bring mocks.");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(api.calendar.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Design review",
          calendarId: "cal-product",
          startsAt: `${todayDate}T11:00:00.000Z`,
          endsAt: `${todayDate}T12:00:00.000Z`,
          allDay: false,
          location: "Room 3",
          notes: "Bring mocks.",
          guestEmails: ["ada@example.com"],
          reminderMinutes: [15],
          recurrence: {
            frequency: "weekly",
            interval: 2,
            endsOn: "2026-12-31",
            count: null
          }
        })
      );
    });

    const agenda = await screen.findByRole("list", { name: "Calendar agenda" });
    await user.click(within(agenda).getByText("Planner shell standup"));
    const titleInput = screen.getByRole("textbox", { name: "Event title" });
    await user.clear(titleInput);
    await user.type(titleInput, "Planner shell sync");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(api.calendar.update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "event-standup",
          title: "Planner shell sync"
        })
      );
    });

    await user.click(within(agenda).getByText("Planner shell standup"));
    await user.click(screen.getByRole("button", { name: "Delete event" }));
    expect(api.calendar.delete).toHaveBeenCalledWith({ id: "event-standup" });
  });

  it("loads existing event recurrence into the inspector and persists recurrence changes", async () => {
    const api = seededHcb();
    api.calendar.listEvents = vi.fn(async () =>
      ok({
        items: [
          {
            id: "event-recurring-review",
            calendarId: "cal-product",
            title: "Recurring release review",
            startsAt: `${todayDate}T13:00:00.000Z`,
            endsAt: `${todayDate}T14:00:00.000Z`,
            allDay: false,
            updatedAt: now,
            recurrenceRule: "RRULE:FREQ=MONTHLY;INTERVAL=2;COUNT=4"
          }
        ],
        page: { limit: 250, totalKnown: 1 }
      })
    );
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Calendar");
    const agenda = await screen.findByRole("list", { name: "Calendar agenda" });
    await user.click(await within(agenda).findByText("Recurring release review"));

    const inspector = await screen.findByTestId("inspector-shell");
    expect(inspector).toHaveAttribute("data-inspector-kind", "event");
    expect(screen.getByLabelText("Event repeat frequency")).toHaveValue("monthly");
    expect(screen.getByLabelText("Repeat interval")).toHaveValue(2);
    expect(screen.getByLabelText("Repeat count")).toHaveValue(4);
    expect(screen.getByText("Every 2 months, 4 times")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Event repeat frequency"), "none");
    expect(screen.getByLabelText("Repeat interval")).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(api.calendar.update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "event-recurring-review",
          recurrence: null
        })
      );
    });
  });

  it("generates static availability from selected calendar sources", async () => {
    const api = seededHcb();
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Calendar");
    expect(await screen.findByText("Share availability")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Availability start"), {
      target: { value: todayDate }
    });
    fireEvent.change(screen.getByLabelText("Availability end"), {
      target: { value: todayDate }
    });
    await user.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() => {
      expect(api.calendar.exportAvailability).toHaveBeenCalledWith({
        calendarIds: ["cal-product"],
        start: now,
        end: tomorrowIso,
        format: "text"
      });
    });
    expect(await screen.findByRole("textbox", { name: "Availability export" })).toHaveValue(
      `Availability from ${now} to ${tomorrowIso}`
    );
    expect(screen.getByText("2 busy blocks")).toBeInTheDocument();
  });

  it("runs calendar-focused command palette actions", async () => {
    installHcb(seededHcb());
    const user = userEvent.setup();
    render(<App />);

    await runPaletteCommand(user, "calendar week", /Calendar week view/);
    expect(await screen.findByRole("heading", { level: 1, name: "Calendar" })).toBeInTheDocument();
    expect(await screen.findByText("Week view")).toBeInTheDocument();

    await runPaletteCommand(user, "new event", /New event/);
    expect(await screen.findByRole("heading", { level: 2, name: "New event" })).toBeInTheDocument();
  });

  it("creates, edits, and deletes local notes through preload", async () => {
    const api = seededHcb();
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Notes");
    expect(await screen.findByText("Cache-first startup")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /New note/ }));
    const titleInput = await screen.findByRole("textbox", { name: "Note title" });
    const bodyInput = screen.getByRole("textbox", { name: "Note body" });

    await user.clear(titleInput);
    await user.type(titleInput, "Release note draft");
    await user.type(bodyInput, "Document local cache flow.");

    await waitFor(() => {
      expect(api.notes.create).toHaveBeenCalled();
      expect(api.notes.update).toHaveBeenCalledWith({
        id: "note-created",
        title: "Release note draft",
        body: "Document local cache flow."
      });
    });

    await user.click(screen.getByRole("button", { name: "Delete selected note" }));
    expect(api.notes.delete).toHaveBeenCalledWith({ id: "note-created" });

    await user.click(screen.getByRole("button", { name: "Delete selected note" }));
    expect(api.notes.delete).toHaveBeenCalledWith({ id: "note-cache-first" });
    expect(screen.getByText("No local notes")).toBeInTheDocument();
  });

  it("opens selected notes in the inspector and flushes pending edits on close", async () => {
    const api = seededHcb();
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Notes");
    await user.click(await screen.findByText("Cache-first startup"));

    const inspector = await screen.findByTestId("inspector-shell");
    expect(inspector).toHaveAttribute("data-inspector-kind", "note");

    const bodyInput = await screen.findByRole("textbox", { name: "Note body" });
    await user.type(bodyInput, " Pending close flush.");
    await user.click(screen.getByTestId("inspector-close"));

    await waitFor(() => {
      expect(api.notes.update).toHaveBeenCalledWith({
        id: "note-cache-first",
        title: "Cache-first startup",
        body: expect.stringContaining("Pending close flush.")
      });
    });
    expect(screen.queryByTestId("inspector-shell")).not.toBeInTheDocument();
  });

  it("flushes pending note edits before switching the selected note row", async () => {
    const api = seededHcb();
    api.notes.list = vi.fn(async () =>
      ok({
        items: [
          {
            id: "note-cache-first",
            title: "Cache-first startup",
            preview: "Renderer paints from SQLite.",
            updatedAt: now
          },
          {
            id: "note-daily",
            title: "Daily note",
            preview: "Backlink review.",
            updatedAt: now
          }
        ],
        page: { limit: 50, totalKnown: 2 }
      })
    );
    api.notes.get = vi.fn(async ({ id }) =>
      ok(
        id === "note-daily"
          ? {
              id,
              title: "Daily note",
              preview: "Backlink review.",
              body: "Review backlinks.",
              updatedAt: now
            }
          : {
              id,
              title: "Cache-first startup",
              preview: "Renderer paints from SQLite.",
              body: "Renderer paints from SQLite before fresh sync completes.",
              updatedAt: now
            }
      )
    );
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Notes");
    await user.click(await screen.findByText("Cache-first startup"));
    await user.type(await screen.findByRole("textbox", { name: "Note body" }), " Switch flush.");
    const notesList = screen.getByRole("list", { name: "Local notes" });
    await user.click(within(notesList).getByRole("button", { name: /Daily note/ }));

    await waitFor(() => {
      expect(api.notes.update).toHaveBeenCalledWith({
        id: "note-cache-first",
        title: "Cache-first startup",
        body: expect.stringContaining("Switch flush.")
      });
    });
    expect(await screen.findByDisplayValue("Daily note")).toBeInTheDocument();
  });

  it("renders note markdown preview, outgoing links, and backlinks", async () => {
    const api = seededHcb();
    api.notes.list = vi.fn(async () =>
      ok({
        items: [
          {
            id: "note-project",
            title: "Project plan",
            preview: "See [[Daily note]]",
            updatedAt: now
          },
          {
            id: "note-daily",
            title: "Daily note",
            preview: "Back to [[Project plan]]",
            updatedAt: now
          }
        ],
        page: { limit: 50, totalKnown: 2 }
      })
    );
    api.notes.get = vi.fn(async ({ id }) =>
      ok(
        id === "note-daily"
          ? {
              id,
              title: "Daily note",
              preview: "Back to [[Project plan]]",
              body: "Back to [[Project plan]]",
              updatedAt: now
            }
          : {
              id,
              title: "Project plan",
              preview: "See [[Daily note]]",
              body: "# Plan\n- [x] Kickoff\nSee [[Daily note]]",
              updatedAt: now
            }
      )
    );
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Notes");
    await user.click(await screen.findByText("Project plan"));
    expect(await screen.findByDisplayValue("Project plan")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Preview" }));

    const preview = await screen.findByRole("region", { name: "Note preview" });
    expect(within(preview).getByText("Plan")).toBeInTheDocument();
    expect(within(preview).getByText("Kickoff")).toBeInTheDocument();
    const dailyLink = within(preview).getByRole("button", { name: "Daily note" });
    expect(dailyLink).toBeInTheDocument();

    dailyLink.focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByDisplayValue("Daily note")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Open backlink Project plan" })).toBeInTheDocument();
  });

  it("inserts planner links and creates templated notes", async () => {
    const api = seededHcb();
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Notes");
    await user.click(await screen.findByText("Cache-first startup"));
    const bodyInput = await screen.findByRole("textbox", { name: "Note body" });

    await user.type(screen.getByRole("combobox", { name: "Planner link target" }), "triage");
    await user.click(await screen.findByRole("option", { name: /Draft inbox triage rules/ }));
    expect((bodyInput as HTMLTextAreaElement).value).toContain("[[task:Draft inbox triage rules]]");

    await user.click(screen.getByRole("tab", { name: "Preview" }));
    expect(screen.getAllByText("task: Draft inbox triage rules").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Daily note" }));
    await waitFor(() => {
      expect(api.notes.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringMatching(/^Daily \d{4}-\d{2}-\d{2}$/),
          body: expect.stringContaining("tags: daily")
        })
      );
    });
    expect(await screen.findByText("tags: daily")).toBeInTheDocument();
  });

  it("supports keyboard selection in the note link autocomplete", async () => {
    const api = seededHcb();
    api.notes.linkSuggest = vi.fn(async () =>
      ok({
        items: [
          { kind: "note" as const, id: "note-project", label: "Project plan" },
          { kind: "task" as const, id: "task-plan", label: "Project plan task" },
          { kind: "event" as const, id: "event-plan", label: "Project plan review" }
        ]
      })
    );
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Notes");
    await user.click(await screen.findByText("Cache-first startup"));
    const bodyInput = await screen.findByRole("textbox", { name: "Note body" });
    const linkInput = screen.getByRole("combobox", { name: "Planner link target" });

    await user.type(linkInput, "plan");
    expect(await screen.findByRole("option", { name: /Project plan task/ })).toBeInTheDocument();
    await user.keyboard("{ArrowDown}{Enter}");

    expect(api.notes.linkSuggest).toHaveBeenCalledWith({ query: "plan", limit: 8 });
    expect((bodyInput as HTMLTextAreaElement).value).toContain("[[task:Project plan task]]");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("repairs broken note links from the note inspector", async () => {
    const api = seededHcb();
    api.notes.get = vi.fn(async ({ id }) =>
      ok({
        id,
        title: "Cache-first startup",
        preview: "See [[Missing note]]",
        body: "See [[Missing note]]",
        updatedAt: now
      })
    );
    api.notes.listBrokenLinks = vi.fn(async () => ok({ items: [{ linkText: "Missing note" }] }));
    api.notes.linkSuggest = vi.fn(async (request) =>
      ok({
        items: request.query.toLowerCase().includes("replacement")
          ? [{ kind: "note" as const, id: "note-replacement", label: "Replacement note" }]
          : []
      })
    );
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Notes");
    await user.click(await screen.findByText("Cache-first startup"));
    const bodyInput = await screen.findByRole("textbox", { name: "Note body" });

    await user.click(await screen.findByRole("button", { name: "Fix link Missing note" }));
    const linkInput = screen.getByRole("combobox", { name: "Planner link target" });
    await user.clear(linkInput);
    await user.type(linkInput, "replacement");
    await user.click(await screen.findByRole("option", { name: /Replacement note/ }));

    expect((bodyInput as HTMLTextAreaElement).value).toContain("[[note:Replacement note]]");
    expect((bodyInput as HTMLTextAreaElement).value).not.toContain("[[Missing note]]");
  });

  it("renders search results for task, event, note, and empty local queries", async () => {
    const api = seededHcb();
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Search");
    const input = screen.getByRole("textbox", { name: "Search local cache" });

    await user.type(input, "review");
    expect(await screen.findByText("Renderer acceptance review")).toBeInTheDocument();
    expect(screen.getByText(/hotcrossbuns:\/\/calendar\/event-review/)).toBeInTheDocument();

    await user.clear(input);
    await user.type(input, "cache");
    expect(await screen.findByText("Cache-first startup")).toBeInTheDocument();
    expect(screen.getByText(/hotcrossbuns:\/\/notes\/note-cache-first/)).toBeInTheDocument();

    await user.clear(input);
    await user.type(input, "missing");
    expect(await screen.findByText("No matching results")).toBeInTheDocument();
    expect(api.search.query).toHaveBeenLastCalledWith({ query: "missing", limit: 30 });
  });

  it("shows structured local search filters and keeps search on the local IPC path", async () => {
    const api = seededHcb();
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByText("Local cache ready")).toBeInTheDocument();
    await goToSection("Search");

    vi.mocked(api.search.query).mockClear();
    vi.mocked(api.tasks.list).mockClear();
    vi.mocked(api.calendar.listEvents).mockClear();
    vi.mocked(api.notes.list).mockClear();

    const input = screen.getByRole("textbox", { name: "Search local cache" });
    const query = "source:tasks status:open due:today priority:high list:Inbox notes:yes triage";

    await user.type(input, query);

    expect(screen.getByText("Source: tasks")).toBeInTheDocument();
    expect(screen.getByText("Status: active")).toBeInTheDocument();
    expect(screen.getByText("Due: today")).toBeInTheDocument();
    expect(screen.getByText("Priority: high")).toBeInTheDocument();
    expect(screen.getByText("List: Inbox")).toBeInTheDocument();
    expect(await screen.findByText("Body: yes")).toBeInTheDocument();

    await waitFor(() => {
      expect(api.search.query).toHaveBeenCalledWith({ query, limit: 30 });
    });
    expect(api.tasks.list).not.toHaveBeenCalled();
    expect(api.calendar.listEvents).not.toHaveBeenCalled();
    expect(api.notes.list).not.toHaveBeenCalled();
  });

  it("saves structured local search views through settings", async () => {
    const api = seededHcb();
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Search");
    const input = screen.getByRole("textbox", { name: "Search local cache" });
    const query = "source:tasks status:open triage";

    await user.type(input, query);
    await user.type(screen.getByRole("textbox", { name: "Saved search name" }), "Open triage");
    await user.click(screen.getByRole("button", { name: "Save search" }));

    await waitFor(() => {
      expect(api.settings.update).toHaveBeenCalledWith({
        savedSearchViews: [
          expect.objectContaining({
            name: "Open triage",
            query
          })
        ]
      });
    });
    const savedViews = screen.getByRole("list", { name: "Saved search views" });
    const savedViewButton = within(savedViews).getAllByRole("button", { name: /Open triage/ })[0];
    expect(savedViewButton).toBeInTheDocument();

    await user.clear(input);
    await user.click(savedViewButton);
    expect(input).toHaveValue(query);
  });

  it("shows invalid search syntax inline without executing a search", async () => {
    const api = seededHcb();
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Search");
    vi.mocked(api.search.query).mockClear();

    await user.type(screen.getByRole("textbox", { name: "Search local cache" }), "status:blocked triage");

    expect(await screen.findByRole("alert")).toHaveTextContent("Unsupported task status");
    await new Promise((resolve) => window.setTimeout(resolve, 120));
    expect(api.search.query).not.toHaveBeenCalled();
  });

  it("discovers structured search syntax through the command palette", async () => {
    installHcb(seededHcb());
    const user = userEvent.setup();
    render(<App />);

    await runPaletteCommand(user, "source:tasks", /Search filter syntax/);

    expect(screen.getByRole("heading", { level: 1, name: "Search" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Search local cache" })).toHaveValue(
      "source:tasks status:active due:today"
    );
  });

  it("renders required settings sections and section controls", async () => {
    installHcb(seededHcb());
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Settings");

    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    expect(within(dialog).getByRole("button", { name: "General" })).toHaveAttribute("aria-pressed", "true");
    expect(within(dialog).getByRole("button", { name: "Profile" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Appearance" })).toBeInTheDocument();

    expect(screen.getByRole("combobox", { name: "App language" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Open Hot Cross Buns at login" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Sync mode" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Local MCP server" })).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Profile" }));
    expect(screen.getByRole("textbox", { name: "Google OAuth client ID" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add Google Account/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Task lists" })).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Appearance" }));
    expect(screen.getByRole("combobox", { name: "Theme" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Color theme" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Translucent background" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Layout" })).toBeInTheDocument();
  });

  it("applies base theme and color theme settings", async () => {
    const api = seededHcb();
    let settings = testSettings({
      theme: "dark",
      colorTheme: "dracula",
      uiFontName: "Inter",
      uiTextSizePoints: 15
    });
    api.settings.get = vi.fn(async () => ok(settings));
    api.settings.update = vi.fn(async (request) => {
      settings = testSettings({
        ...settings,
        ...request
      });

      return ok(settings);
    });
    api.native.listFontFamilies = vi.fn(async () =>
      ok({
        platform: "darwin" as const,
        families: ["Avenir", "JetBrains Mono", "SF Pro Text"]
      })
    );
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute("data-theme", "dark");
      expect(document.documentElement).toHaveAttribute("data-color-theme", "dracula");
      expect(document.documentElement.style.getPropertyValue("--color-accent")).toBe("#FF79C6");
      expect(document.documentElement.style.getPropertyValue("--font-family")).toContain("\"Inter\"");
      expect(document.documentElement.style.getPropertyValue("--font-family-mono")).toContain("\"Inter\"");
      expect(document.documentElement.style.getPropertyValue("--text-base")).toBe("15px");
    });

    await goToSection("Settings");
    await user.click(screen.getByRole("button", { name: "Appearance" }));
    await user.selectOptions(screen.getByLabelText("Theme"), "light");

    await waitFor(() => {
      expect(api.settings.update).toHaveBeenCalledWith({
        theme: "light",
        colorTheme: "notion"
      });
      expect(document.documentElement).toHaveAttribute("data-theme", "light");
      expect(document.documentElement).toHaveAttribute("data-color-theme", "notion");
    });

    await user.selectOptions(screen.getByLabelText("Color theme"), "githubLight");

    await waitFor(() => {
      expect(api.settings.update).toHaveBeenCalledWith({ colorTheme: "githubLight" });
      expect(document.documentElement).toHaveAttribute("data-color-theme", "githubLight");
    });
    expect(screen.queryByText("Light themes")).not.toBeInTheDocument();
    await waitFor(() => expect(api.native.listFontFamilies).toHaveBeenCalled());
    await waitFor(() => {
      expect(screen.getAllByRole("option", { name: "Avenir" }).length).toBeGreaterThan(0);
    });

    await user.selectOptions(screen.getByRole("combobox", { name: "Font family" }), "JetBrains Mono");

    await waitFor(() => {
      expect(api.settings.update).toHaveBeenCalledWith({ uiFontName: "JetBrains Mono" });
      expect(document.documentElement.style.getPropertyValue("--font-family")).toContain("\"JetBrains Mono\"");
      expect(document.documentElement.style.getPropertyValue("--font-family-mono")).toContain("\"JetBrains Mono\"");
    });

    fireEvent.change(screen.getByLabelText("Text size points"), { target: { value: "16" } });

    await waitFor(() => {
      expect(api.settings.update).toHaveBeenCalledWith({ uiTextSizePoints: 16 });
      expect(document.documentElement.style.getPropertyValue("--text-base")).toBe("16px");
    });
  });

  it("opens sanitized diagnostics details in the inspector", async () => {
    const api = seededHcb();
    const base = await api.diagnostics.summary();
    if (!base.ok) {
      throw new Error("Missing diagnostics fixture");
    }
    api.diagnostics.summary = vi.fn(async () =>
      ok({
        ...base.data,
        dangerousToken: "raw-google-token"
      } as typeof base.data & { dangerousToken: string })
    );
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Settings");
    await user.click(screen.getByRole("button", { name: /Open diagnostics/ }));

    const inspector = await screen.findByTestId("inspector-shell");
    expect(inspector).toHaveAttribute("data-inspector-kind", "diagnostics");
    const json = screen.getByLabelText("Sanitized diagnostics JSON");
    expect(json).toHaveTextContent("redaction");
    expect(json).not.toHaveTextContent("raw-google-token");
    expect(within(inspector).getByRole("button", { name: "Copy" })).toBeInTheDocument();
  });

  it("updates general settings controls through settings IPC", async () => {
    const api = seededHcb();
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Settings");
    await user.selectOptions(screen.getByRole("combobox", { name: "Sync mode" }), "manual");
    await user.click(screen.getByRole("checkbox", { name: "Local MCP server" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "MCP permission mode" }), "allow-writes");

    await waitFor(() => {
      expect(api.settings.update).toHaveBeenCalledWith({ syncMode: "manual" });
      expect(api.settings.update).toHaveBeenCalledWith({ mcpEnabled: true });
      expect(api.settings.update).toHaveBeenCalledWith({ mcpPermissionMode: "allow-writes" });
    });
  });

  it("shows onboarding for a fresh database and completes setup through settings IPC", async () => {
    const { api, getSettings } = onboardingHcb();
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    const dialog = await screen.findByRole("dialog", { name: "First-run setup" });

    expect(within(dialog).getByText("1. Google runtime")).toBeInTheDocument();
    expect(within(dialog).getByText("2. Task lists")).toBeInTheDocument();
    expect(within(dialog).getByText("3. Calendars")).toBeInTheDocument();
    expect(within(dialog).getByText("4. Sync mode")).toBeInTheDocument();
    expect(within(dialog).getByText("5. Notifications")).toBeInTheDocument();
    expect(within(dialog).getByText("6. MCP access")).toBeInTheDocument();

    await user.selectOptions(within(dialog).getByLabelText("Onboarding sync mode"), "near-real-time");
    await user.click(within(dialog).getByLabelText("Local notifications"));
    await user.click(within(dialog).getByLabelText("Enable MCP"));
    await user.click(within(dialog).getByRole("button", { name: "Finish setup" }));

    await waitFor(() => {
      expect(api.settings.update).toHaveBeenCalledWith(
        expect.objectContaining({
          selectedTaskListIds: ["list-inbox", "list-planning"],
          selectedCalendarIds: ["cal-product"],
          syncMode: "near-real-time",
          notificationsEnabled: true,
          mcpEnabled: true,
          setupCompletedAt: expect.any(String)
        })
      );
      expect(getSettings().setupCompletedAt).toEqual(expect.any(String));
      expect(screen.queryByRole("dialog", { name: "First-run setup" })).not.toBeInTheDocument();
    });
  });

  it("lets users skip Google setup and keep local notes and settings usable", async () => {
    const { api } = onboardingHcb();
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    const dialog = await screen.findByRole("dialog", { name: "First-run setup" });
    await user.click(within(dialog).getByRole("button", { name: "Use local-only" }));

    await waitFor(() => {
      expect(api.settings.update).toHaveBeenCalledWith(
        expect.objectContaining({
          selectedTaskListIds: [],
          selectedCalendarIds: [],
          syncMode: "manual",
          notificationsEnabled: false,
          mcpEnabled: false,
          mcpPermissionMode: "read-only",
          setupCompletedAt: expect.any(String)
        })
      );
      expect(screen.queryByRole("dialog", { name: "First-run setup" })).not.toBeInTheDocument();
    });

    await goToSection("Notes");
    expect(await screen.findByText("Cache-first startup")).toBeInTheDocument();

    await goToSection("Settings");
    expect(await screen.findByRole("dialog", { name: "Settings" })).toBeInTheDocument();
  });

  it("resets onboarding from Settings without deleting planner data", async () => {
    const { api } = onboardingHcb({ setupCompletedAt: now });
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Notes");
    expect(await screen.findByText("Cache-first startup")).toBeInTheDocument();

    await goToSection("Settings");
    await user.click(screen.getByRole("button", { name: "Run setup again" }));

    await waitFor(() => {
      expect(api.settings.recoveryAction).toHaveBeenCalledWith({ action: "resetOnboarding" });
    });
    expect(await screen.findByRole("dialog", { name: "First-run setup" })).toBeInTheDocument();
    expect(api.notes.delete).not.toHaveBeenCalled();
  });

  it("updates startup setting from Settings", async () => {
    const api = seededHcb();
    api.settings.get = vi.fn(async () => ok(testSettings({ startOnLogin: false })));
    api.settings.update = vi.fn(async (request) =>
      ok(testSettings({ startOnLogin: request.startOnLogin ?? false }))
    );
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Settings");
    await user.click(screen.getByRole("checkbox", { name: "Open Hot Cross Buns at login" }));

    await waitFor(() => {
      expect(api.settings.update).toHaveBeenCalledWith({ startOnLogin: true });
    });
  });

  it("requires confirmation before destructive sync recovery actions", async () => {
    const api = seededHcb();
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Settings");
    await user.click(screen.getByRole("button", { name: /Force full resync/ }));

    expect(api.settings.recoveryAction).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Confirm destructive action" })).toBeInTheDocument();

    const confirmButton = screen.getByRole("button", { name: "Confirm" });
    expect(confirmButton).toBeDisabled();

    await user.type(screen.getByRole("textbox", { name: "Confirmation phrase" }), "FULL RESYNC");
    await user.click(confirmButton);

    await waitFor(() => {
      expect(api.settings.recoveryAction).toHaveBeenCalledWith({
        action: "forceFullResync",
        confirmation: {
          accepted: true,
          phrase: "FULL RESYNC"
        }
      });
    });
  });

  it("handles an unavailable preload bridge as an offline state", async () => {
    installHcb(undefined);
    render(<App />);

    expect((await screen.findAllByText("Offline cache"))[0]).toBeInTheDocument();
    expect(screen.getByText("The preload bridge is unavailable in this renderer context.")).toBeInTheDocument();
  });
});
