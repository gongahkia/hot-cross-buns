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
  await user.keyboard("{Control>}k{/Control}");
  const dialog = await screen.findByRole("dialog", { name: "Command palette" });
  const input = within(dialog).getByRole("searchbox", { name: "Filter commands" });

  await user.type(input, query);
  await user.click(within(dialog).getByRole("option", { name: label }));
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
    diagnosticsIncludePerformance: true,
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
              updatedAt: now
            },
            {
              id: "task-calendar-fixtures",
              listId: "list-planning",
              title: "Review calendar fixture shape",
              status: "active" as const,
              priority: "medium" as const,
              dueAt: now,
              updatedAt: now
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
          parentId: request.parentId ?? null
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
            ...(request.priority === undefined ? {} : { priority: request.priority })
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

    for (const label of ["Today", "Tasks", "Calendar", "Notes", "Search", "Settings"]) {
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

    await user.keyboard("{Control>}k{/Control}");
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

    await user.keyboard("{Control>}k{/Control}");
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
    expect(screen.getByText("Product")).toBeInTheDocument();

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

  it("creates, edits, deletes, and quick-captures tasks through preload", async () => {
    const api = seededHcb();
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Tasks");
    expect(await screen.findByRole("heading", { name: "Inbox" })).toBeInTheDocument();

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
    await user.click(screen.getByRole("button", { name: "Delete selected task" }));
    expect(api.tasks.delete).toHaveBeenCalledWith({ id: "task-calendar-fixtures" });

    await runPaletteCommand(user, "quick capture", /Quick capture/);
    await user.type(screen.getByRole("textbox", { name: "Quick capture task" }), "Review notes 2026-05-23 #Planning");
    await user.click(screen.getByRole("button", { name: "Capture" }));

    await waitFor(() => {
      expect(api.tasks.create).toHaveBeenLastCalledWith(
        expect.objectContaining({
          title: "Review notes",
          listId: "list-planning",
          dueDate: "2026-05-23"
        })
      );
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
    expect(screen.getByText("No note selected")).toBeInTheDocument();
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
