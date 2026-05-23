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
  Object.defineProperty(window, "hcb", {
    configurable: true,
    value: originalHcb
  });
});

function primaryNavigation(): HTMLElement {
  return screen.getByRole("navigation", { name: "Primary" });
}

async function goToSection(label: string): Promise<void> {
  const user = userEvent.setup();
  await user.click(within(primaryNavigation()).getByRole("button", { name: new RegExp(label) }));
}

async function runPaletteCommand(user: ReturnType<typeof userEvent.setup>, query: string, label: RegExp): Promise<void> {
  await user.keyboard("{Meta>}p{/Meta}");
  const dialog = await screen.findByRole("dialog", { name: "Command palette" });
  const input = within(dialog).getByRole("searchbox", { name: "Filter commands" });

  await user.type(input, query);
  await user.click(within(dialog).getByRole("option", { name: label }));
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
    startOnLogin: false,
    selectedTaskListIds: [],
    selectedCalendarIds: [],
    setupCompletedAt: now,
    syncMode: "balanced",
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
    diagnosticsIncludePerformance: true,
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
      )
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

describe("App shell", () => {
  it("renders the loading cache state while preload reads are pending", () => {
    installHcb(loadingHcb());
    render(<App />);

    expect(screen.getByText("Loading local cache")).toBeInTheDocument();
    expect(screen.getByText("Reading cached planner data from SQLite.")).toBeInTheDocument();
  });

  it("renders from an empty fresh local cache and invokes preload read APIs", async () => {
    render(<App />);

    expect(screen.getByTestId("app-shell")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "Today" })[0]).toBeInTheDocument();

    for (const label of ["Today", "Tasks", "Calendar", "Notes", "Search", "Notifications", "Settings"]) {
      expect(within(primaryNavigation()).getByRole("button", { name: new RegExp(label) })).toBeInTheDocument();
    }

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
    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();

    await runPaletteCommand(user, "mcp", /Toggle MCP server/);
    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();

    await runPaletteCommand(user, "diagnostics", /Copy diagnostics summary/);
    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
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

  it("groups the Today timeline into local planner sections", async () => {
    installHcb(seededHcb());
    render(<App />);

    expect(await screen.findByText("Local cache ready")).toBeInTheDocument();
    const timeline = screen.getByRole("list", { name: "Today timeline" });

    expect(within(timeline).getByText("Unscheduled")).toBeInTheDocument();
    expect(within(timeline).getByText("Tasks without a planned time")).toBeInTheDocument();
  });

  it("schedules an unscheduled task into the Today timeline", async () => {
    const api = seededHcb();
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByText("Local cache ready")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Task to schedule"), "task-calendar-fixtures");
    fireEvent.change(screen.getByLabelText("Schedule starts"), {
      target: { value: `${todayDate}T10:00` }
    });
    await user.selectOptions(screen.getByLabelText("Schedule duration"), "45");
    await user.click(screen.getByRole("button", { name: "Schedule" }));

    await waitFor(() => {
      expect(api.calendar.scheduleTaskBlock).toHaveBeenCalledWith({
        taskId: "task-calendar-fixtures",
        calendarId: "cal-product",
        startsAt: `${todayDate}T10:00:00.000Z`,
        durationMinutes: 45
      });
    });
    expect(await screen.findByText("Review calendar fixture shape")).toBeInTheDocument();
    expect(screen.getByText("Scheduled")).toBeInTheDocument();
  });

  it("surfaces scheduled task conflicts and moves blocks earlier or later", async () => {
    const api = seededHcb();
    api.calendar.listScheduledTaskBlocks = vi.fn(async () =>
      ok({
        items: [
          {
            id: "block-conflict",
            taskId: "task-inbox-rules",
            calendarEventId: "event-task-block",
            calendarId: "cal-product",
            title: "Draft inbox triage rules",
            startsAt: `${todayDate}T09:40:00.000Z`,
            endsAt: `${todayDate}T10:10:00.000Z`,
            durationMinutes: 30,
            status: "scheduled" as const,
            mutationState: "synced" as const,
            updatedAt: now
          }
        ],
        page: { limit: 250, totalKnown: 1 }
      })
    );
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByText("Local cache ready")).toBeInTheDocument();
    expect(screen.getByText("Conflict")).toBeInTheDocument();
    expect(screen.getByText(/Conflicts with Planner shell standup/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Move Draft inbox triage rules earlier" }));

    await waitFor(() => {
      expect(api.calendar.moveScheduledTaskBlock).toHaveBeenCalledWith({
        id: "block-conflict",
        startsAt: `${todayDate}T09:10:00.000Z`
      });
    });

    await user.click(screen.getByRole("button", { name: "Lengthen Draft inbox triage rules" }));

    await waitFor(() => {
      expect(api.calendar.moveScheduledTaskBlock).toHaveBeenCalledWith({
        id: "block-conflict",
        durationMinutes: 45
      });
    });
  });

  it("repairs orphaned scheduled task blocks from Today", async () => {
    const api = seededHcb();
    api.calendar.listScheduledTaskBlocks = vi.fn(async () =>
      ok({
        items: [
          {
            id: "block-orphaned",
            taskId: "task-inbox-rules",
            calendarEventId: "event-task-block-missing",
            calendarId: "cal-product",
            title: "Draft inbox triage rules",
            startsAt: `${todayDate}T13:00:00.000Z`,
            endsAt: `${todayDate}T13:30:00.000Z`,
            durationMinutes: 30,
            status: "orphaned" as const,
            mutationState: "synced" as const,
            updatedAt: now
          }
        ],
        page: { limit: 250, totalKnown: 1 }
      })
    );
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByText("Needs repair")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Repair Draft inbox triage rules" }));

    await waitFor(() => {
      expect(api.calendar.moveScheduledTaskBlock).toHaveBeenCalledWith({
        id: "block-orphaned",
        calendarId: "cal-product",
        startsAt: `${todayDate}T13:00:00.000Z`,
        durationMinutes: 30
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
    expect(screen.getByText("Planner shell standup")).toBeInTheDocument();

    const tabs = screen.getByRole("tablist", { name: "Calendar views" });
    await user.click(within(tabs).getByRole("tab", { name: "Day" }));
    expect(screen.getByRole("grid", { name: "Calendar day view" })).toBeInTheDocument();

    await user.click(within(tabs).getByRole("tab", { name: "Week" }));
    expect(screen.getByRole("grid", { name: "Calendar week view" })).toBeInTheDocument();

    await user.click(within(tabs).getByRole("tab", { name: "Month" }));
    expect(screen.getByRole("grid", { name: "Calendar month view" })).toBeInTheDocument();
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
    expect(screen.getByLabelText("Event starts")).toHaveValue(`${todayDate}T11:00`);
    expect(screen.getByLabelText("Event ends")).toHaveValue(`${todayDate}T12:00`);
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
    expect(await screen.findByText("Planner shell standup")).toBeInTheDocument();
    expect(screen.getByText("Engineering sync")).toBeInTheDocument();
    expect(screen.getAllByText("UTC").length).toBeGreaterThan(0);

    const visibility = screen.getByRole("group", { name: "Calendar visibility" });
    await user.click(within(visibility).getByLabelText(/Product/));

    await waitFor(() => {
      expect(screen.queryByText("Planner shell standup")).not.toBeInTheDocument();
      expect(screen.getByText("Engineering sync")).toBeInTheDocument();
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
          reminderMinutes: [15]
        })
      );
    });

    await user.click(screen.getByText("Planner shell standup"));
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

    await user.click(screen.getByText("Planner shell standup"));
    await user.click(screen.getByRole("button", { name: "Delete event" }));
    expect(api.calendar.delete).toHaveBeenCalledWith({ id: "event-standup" });
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
    expect(await screen.findByDisplayValue("Cache-first startup")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /New note/ }));
    const titleInput = await screen.findByRole("textbox", { name: "Note title" });
    const bodyInput = screen.getByRole("textbox", { name: "Note body" });

    await user.clear(titleInput);
    await user.type(titleInput, "Release note draft");
    await user.type(bodyInput, "Document local cache flow.");
    await user.tab();

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
    expect(screen.getAllByText("No note selected").length).toBeGreaterThan(0);
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
    expect(await screen.findByDisplayValue("Project plan")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Preview" }));

    const preview = await screen.findByRole("region", { name: "Note preview" });
    expect(within(preview).getByText("Plan")).toBeInTheDocument();
    expect(within(preview).getByText("Kickoff")).toBeInTheDocument();
    expect(within(preview).getByRole("button", { name: "Daily note" })).toBeInTheDocument();

    await user.click(await screen.findByRole("button", { name: "Open linked note Daily note" }));
    expect(await screen.findByDisplayValue("Daily note")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Open backlink Project plan" })).toBeInTheDocument();
  });

  it("inserts planner links and creates templated notes", async () => {
    const api = seededHcb();
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Notes");
    const bodyInput = await screen.findByRole("textbox", { name: "Note body" });

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Planner link target" }),
      "task:Draft inbox triage rules"
    );
    await user.click(screen.getByRole("button", { name: "Insert link" }));
    expect((bodyInput as HTMLTextAreaElement).value).toContain("[[task:Draft inbox triage rules]]");

    await user.click(screen.getByRole("button", { name: "Preview" }));
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

    const settingsSupport = screen.getByRole("complementary", { name: "Settings support" });
    for (const label of [
      "Google",
      "Resources",
      "Sync",
      "Appearance",
      "Hotkeys",
      "Tray",
      "Notifications",
      "Local data",
      "MCP",
      "Platform",
      "Diagnostics"
    ]) {
      expect(within(settingsSupport).getByRole("button", { name: new RegExp(label) })).toBeInTheDocument();
    }

    await user.click(within(settingsSupport).getByRole("button", { name: /Hotkeys/ }));
    expect(screen.getByText("Shortcut attention")).toBeInTheDocument();

    await user.click(within(settingsSupport).getByRole("button", { name: /Sync/ }));
    expect(screen.getAllByText("Pending").length).toBeGreaterThan(0);
    expect(screen.getByText("Applying")).toBeInTheDocument();
    expect(screen.getByText("Auth paused")).toBeInTheDocument();

    await user.click(within(settingsSupport).getByRole("button", { name: /Local data/ }));
    expect(screen.getByText("Privacy boundary")).toBeInTheDocument();

    await user.click(within(settingsSupport).getByRole("button", { name: /Platform/ }));
    expect(screen.getByText("No capability rows")).toBeInTheDocument();

    await user.click(within(settingsSupport).getByRole("button", { name: /Diagnostics/ }));
    expect(screen.getByRole("button", { name: /Copy diagnostics/ })).toBeInTheDocument();
    expect(screen.getByText("Credentials")).toBeInTheDocument();
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
    expect(await screen.findByDisplayValue("Cache-first startup")).toBeInTheDocument();

    await goToSection("Settings");
    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
  });

  it("resets onboarding from Settings without deleting planner data", async () => {
    const { api } = onboardingHcb({ setupCompletedAt: now });
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Notes");
    expect(await screen.findByDisplayValue("Cache-first startup")).toBeInTheDocument();

    await goToSection("Settings");
    const settingsSupport = screen.getByRole("complementary", { name: "Settings support" });
    await user.click(within(settingsSupport).getByRole("button", { name: /Local data/ }));
    await user.click(screen.getByRole("button", { name: "Reset onboarding" }));

    await waitFor(() => {
      expect(api.settings.recoveryAction).toHaveBeenCalledWith({ action: "resetOnboarding" });
    });
    expect(await screen.findByRole("dialog", { name: "First-run setup" })).toBeInTheDocument();
    expect(api.notes.delete).not.toHaveBeenCalled();
  });

  it("refreshes native status after settings changes", async () => {
    const api = seededHcb();
    api.settings.get = vi.fn(async () => ok(testSettings({ showTrayIcon: true })));
    api.settings.update = vi.fn(async (request) =>
      ok(testSettings({ showTrayIcon: request.showTrayIcon ?? true }))
    );
    api.native.capabilities = vi
      .fn()
      .mockResolvedValueOnce(ok(testNativeCapabilities()))
      .mockResolvedValueOnce(
        ok(
          testNativeCapabilities({
            trayStatus: {
              state: "disabled",
              message: "Menu bar icon is disabled in Settings."
            }
          })
        )
      );
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Settings");
    const settingsSupport = screen.getByRole("complementary", { name: "Settings support" });
    await user.click(within(settingsSupport).getByRole("button", { name: /Tray/ }));
    await user.click(screen.getByLabelText("Show menu bar icon"));

    await waitFor(() => {
      expect(api.settings.update).toHaveBeenCalledWith({ showTrayIcon: false });
      expect(api.native.capabilities).toHaveBeenCalledTimes(2);
      expect(within(settingsSupport).getByRole("button", { name: /Tray Disabled/ })).toBeInTheDocument();
    });
  });

  it("requires confirmation before destructive local data recovery actions", async () => {
    const api = seededHcb();
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Settings");
    const settingsSupport = screen.getByRole("complementary", { name: "Settings support" });

    await user.click(within(settingsSupport).getByRole("button", { name: /Local data/ }));
    await user.click(screen.getByRole("button", { name: /Clear local Google cache/ }));

    expect(api.settings.recoveryAction).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Confirm destructive action" })).toBeInTheDocument();

    const confirmButton = screen.getByRole("button", { name: "Confirm" });
    expect(confirmButton).toBeDisabled();

    await user.type(screen.getByRole("textbox", { name: "Confirmation phrase" }), "CLEAR CACHE");
    await user.click(confirmButton);

    await waitFor(() => {
      expect(api.settings.recoveryAction).toHaveBeenCalledWith({
        action: "clearGoogleCache",
        confirmation: {
          accepted: true,
          phrase: "CLEAR CACHE"
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
