import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ok } from "@shared/ipc/result";
import App from "./App";
import {
  goToSection,
  installHcb,
  loadingHcb,
  now,
  originalHcb,
  primaryNavigation,
  runPaletteCommand,
  seededHcb,
  settingsLoadingHcb,
  testDataTransfer,
  todayDate
} from "./test/appTestHelpers";

function expectSyncOverlayTitle(): void {
  expect(
    screen.getAllByRole("status").some((status) =>
      within(status).queryByText("Hot Cross Buns 2") !== null
    )
  ).toBe(true);
}

describe("App shell", () => {
  it("renders the syncing state while preload reads are pending", () => {
    installHcb(loadingHcb());
    render(<App />);

    expectSyncOverlayTitle();
    expect(screen.getByText("Reading planner data.")).toBeInTheDocument();
  });

  it("waits for settings before reporting the shell visible", async () => {
    const api = settingsLoadingHcb();

    installHcb(api);
    render(<App />);

    await waitFor(() => expect(api.tasks.listTaskLists).toHaveBeenCalled());
    await new Promise((resolve) => window.setTimeout(resolve, 25));

    expect(api.diagnostics.markShellVisible).not.toHaveBeenCalled();
  });

  it("reports the shell visible after settings load while other reads continue", async () => {
    const api = loadingHcb();

    installHcb(api);
    render(<App />);

    await waitFor(() => expect(api.diagnostics.markShellVisible).toHaveBeenCalledTimes(1));
    expectSyncOverlayTitle();
  });

  it("reports the shell visible after the settings theme can be applied", async () => {
    const api = seededHcb();

    installHcb(api);
    render(<App />);

    await waitFor(() => expect(api.diagnostics.markShellVisible).toHaveBeenCalledTimes(1));
  });

  it("renders from empty planner data and invokes preload read APIs", async () => {
    render(<App />);

    expect(screen.getByTestId("app-shell")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Calendar" })).toBeInTheDocument();

    for (const label of ["Calendar", "Tasks", "Notes"]) {
      expect(within(primaryNavigation()).getByRole("button", { name: new RegExp(label) })).toBeInTheDocument();
    }
    expect(screen.queryByText("Runtime")).not.toBeInTheDocument();
    expect(within(primaryNavigation()).queryByRole("button", { name: /Settings/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
    expect(within(primaryNavigation()).queryByRole("button", { name: /Notifications/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Notifications, \d+ active/ })).toBeInTheDocument();

    expect(await screen.findByText("No agenda items")).toBeInTheDocument();

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

  it("opens quick add from the command palette and fills the event inspector", async () => {
    const user = userEvent.setup();
    installHcb(seededHcb());
    render(<App />);

    await screen.findByText("Planner shell standup");
    await user.keyboard("{Meta>}p{/Meta}");
    const palette = await screen.findByRole("dialog", { name: "Command palette" });

    await user.type(within(palette).getByRole("searchbox", { name: "Filter commands" }), "quick add");
    await user.click(within(palette).getByRole("option", { name: /Quick add/ }));

    const quickAdd = await screen.findByRole("dialog", { name: "Quick add" });
    await user.type(
      within(quickAdd).getByRole("textbox", { name: "Quick add text" }),
      "Lunch with Bob tomorrow 1pm at Philz #Product"
    );
    await user.click(within(quickAdd).getByRole("button", { name: "Add" }));

    expect(await screen.findByRole("textbox", { name: "Event title" })).toHaveValue("Lunch with Bob");
    expect(screen.getByRole("textbox", { name: "Event location" })).toHaveValue("Philz");
  });

  it("opens a split view chooser for other app tabs", async () => {
    const user = userEvent.setup();
    installHcb(seededHcb());
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Split view" }));

    let splitPane = await screen.findByRole("region", { name: "Choose split view pane" });
    expect(within(splitPane).getByRole("heading", { name: "Choose split view" })).toBeInTheDocument();
    expect(within(splitPane).getByRole("button", { name: /Tasks/ })).toBeInTheDocument();
    expect(within(splitPane).getByRole("button", { name: /Notes/ })).toBeInTheDocument();
    expect(within(splitPane).queryByRole("button", { name: /Calendar/ })).not.toBeInTheDocument();

    await user.click(within(splitPane).getByRole("button", { name: /Tasks/ }));

    splitPane = await screen.findByRole("region", { name: "Tasks pane" });
    expect(within(splitPane).getByRole("heading", { name: "Tasks" })).toBeInTheDocument();
    expect(within(splitPane).getByRole("list", { name: "Task lists" })).toBeInTheDocument();

    expect(within(splitPane).queryByRole("button", { name: /Split Tasks/ })).not.toBeInTheDocument();
    expect(within(splitPane).queryByRole("button", { name: "Choose content for Tasks" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Split view" }));
    splitPane = await screen.findByRole("region", { name: "Choose split view pane" });
    expect(within(splitPane).queryByText("Recent webpages")).not.toBeInTheDocument();
    expect(within(splitPane).queryByRole("button", { name: /Tasks/ })).not.toBeInTheDocument();
    expect(within(splitPane).queryByRole("button", { name: /Calendar/ })).not.toBeInTheDocument();
    expect(within(splitPane).getByRole("button", { name: /Notes/ })).toBeInTheDocument();
  });

  it("opens typed webpages from the split view chooser", async () => {
    const user = userEvent.setup();
    window.localStorage.clear();
    installHcb(seededHcb());
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Split view" }));
    const chooserPane = await screen.findByRole("region", { name: "Choose split view pane" });

    await user.type(within(chooserPane).getByLabelText("Webpage URL"), "example.com");
    await user.click(within(chooserPane).getByRole("button", { name: "Open" }));

    const webPane = await screen.findByRole("region", { name: "example.com pane" });
    expect(within(webPane).getByTestId("split-webview")).toHaveAttribute("src", "https://example.com/");

    fireEvent.keyDown(window, { key: "t", metaKey: true });
    expect(screen.getAllByTestId("pane-leaf")).toHaveLength(2);
    expect(within(webPane).getByRole("button", { name: "Select New tab" })).toBeInTheDocument();
    expect(within(webPane).getByLabelText("Webpage URL")).toBeInTheDocument();
  });

  it("uses pane and diagnostics hotkeys", async () => {
    window.localStorage.clear();
    installHcb(seededHcb());
    render(<App />);

    fireEvent.keyDown(window, { key: ".", metaKey: true });
    expect(await screen.findByRole("dialog", { name: "Diagnostics" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close diagnostics" }));

    fireEvent.keyDown(window, { key: "d", metaKey: true });
    await waitFor(() => expect(screen.getAllByTestId("pane-leaf")).toHaveLength(2));
    expect(screen.getByTestId("pane-split")).toHaveAttribute("data-pane-direction", "row");

    fireEvent.keyDown(window, { key: "d", metaKey: true, shiftKey: true });
    await waitFor(() => expect(screen.getAllByTestId("pane-leaf")).toHaveLength(3));
    expect(screen.getAllByTestId("pane-split").some((split) => split.getAttribute("data-pane-direction") === "column")).toBe(true);

    fireEvent.keyDown(window, { key: "w", metaKey: true });
    await waitFor(() => expect(screen.getAllByTestId("pane-leaf")).toHaveLength(2));

    fireEvent.keyDown(window, { key: "t", metaKey: true });
    await waitFor(() => expect(screen.getAllByTestId("pane-leaf")).toHaveLength(2));
  });

  it("closes a single pane to the chooser before closing the window", async () => {
    window.localStorage.clear();
    const closeSpy = vi.spyOn(window, "close").mockImplementation(() => undefined);
    installHcb(seededHcb());
    render(<App />);

    const calendarPane = await screen.findByRole("region", { name: "Calendar pane" });
    expect(within(calendarPane).getByRole("button", { name: "Close Calendar pane" })).toBeEnabled();

    fireEvent.keyDown(window, { key: "w", metaKey: true });
    const chooserPane = await screen.findByRole("region", { name: "Choose split view pane" });
    expect(within(chooserPane).getByRole("heading", { name: "Choose split view" })).toBeInTheDocument();
    expect(closeSpy).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "w", metaKey: true });
    expect(closeSpy).toHaveBeenCalledTimes(1);
    closeSpy.mockRestore();
  });

  it("splits, closes, drags, and restores pane layouts", async () => {
    const user = userEvent.setup();
    window.localStorage.clear();
    installHcb(seededHcb());
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Split view" }));
    let chooserPane = await screen.findByRole("region", { name: "Choose split view pane" });
    await user.click(within(chooserPane).getByRole("button", { name: /Tasks/ }));
    const tasksPane = await screen.findByRole("region", { name: "Tasks pane" });

    fireEvent.keyDown(window, { key: "d", metaKey: true, shiftKey: true });
    expect(await screen.findAllByTestId("pane-leaf")).toHaveLength(3);

    chooserPane = await screen.findByRole("region", { name: "Choose split view pane" });
    await user.click(within(chooserPane).getByRole("button", { name: "Close Choose split view pane" }));
    expect(await screen.findAllByTestId("pane-leaf")).toHaveLength(2);

    const calendarPane = screen.getByRole("region", { name: "Calendar pane" });
    calendarPane.getBoundingClientRect = () => ({
      bottom: 500,
      height: 500,
      left: 0,
      right: 500,
      top: 0,
      width: 500,
      x: 0,
      y: 0,
      toJSON: () => ({})
    });
    const transfer = testDataTransfer();
    fireEvent.dragStart(within(tasksPane).getByRole("button", { name: "Drag pane Tasks" }), {
      dataTransfer: transfer
    });
    fireEvent.dragOver(calendarPane, { clientX: 250, clientY: 10, dataTransfer: transfer });

    await waitFor(() => {
      expect(calendarPane.querySelector("[data-pane-drop-preview]")).toBeInTheDocument();
    });

    fireEvent.drop(calendarPane, { clientX: 250, clientY: 10, dataTransfer: transfer });

    expect(screen.getAllByTestId("pane-leaf")).toHaveLength(2);
    expect(window.localStorage.getItem("hcb.paneWorkspace.v1")).toContain("tasks");
  });

  it("restores a persisted pane layout", async () => {
    window.localStorage.setItem(
      "hcb.paneWorkspace.v1",
      JSON.stringify({
        focusedPaneId: "pane-notes",
        root: {
          id: "split-root",
          kind: "split",
          direction: "row",
          ratio: 0.42,
          children: [
            { id: "pane-calendar", kind: "leaf", content: { kind: "section", sectionId: "calendar" } },
            { id: "pane-notes", kind: "leaf", content: { kind: "section", sectionId: "notes" } }
          ]
        }
      })
    );
    installHcb(seededHcb());
    render(<App />);

    expect(await screen.findByRole("heading", { level: 1, name: "Notes" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Calendar pane" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Notes pane" })).toBeInTheDocument();
    expect(screen.getAllByTestId("pane-leaf")).toHaveLength(2);
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

  it("uses total resource counts in primary navigation badges", async () => {
    const api = seededHcb();

    api.tasks.listTaskLists = async () =>
      ok({
        items: [
          {
            id: "list-inbox",
            title: "Inbox",
            updatedAt: now,
            taskCount: 1200,
            activeTaskCount: 900
          }
        ],
        page: { limit: 100, totalKnown: 1 }
      });
    api.calendar.listCalendars = async () =>
      ok({
        items: [
          {
            id: "cal-product",
            title: "Product",
            selected: true,
            timeZone: "UTC",
            backgroundColor: "#34a853",
            foregroundColor: "#ffffff",
            updatedAt: now,
            eventCount: 18000
          }
        ],
        page: { limit: 100, totalKnown: 1 }
      });
    api.calendar.listEvents = async () =>
      ok({
        items: [
          {
            id: "event-visible",
            calendarId: "cal-product",
            title: "Visible window event",
            startsAt: `${todayDate}T09:00:00.000Z`,
            endsAt: `${todayDate}T09:30:00.000Z`,
            allDay: false,
            updatedAt: now
          }
        ],
        page: { limit: 250, totalKnown: 250 }
      });
    api.notes.list = async () =>
      ok({
        items: [
          {
            id: "note-cache-first",
            listId: "note-list:default",
            listTitle: "Notes",
            title: "Startup data flow",
            preview: "Renderer paints from SQLite.",
            updatedAt: now
          }
        ],
        lists: [{ id: "note-list:default", title: "Notes", noteCount: 1, updatedAt: now }],
        page: { limit: 50, totalKnown: 321 }
      });
    installHcb(api);
    render(<App />);

    const navigation = primaryNavigation();

    await waitFor(() => {
      expect(within(within(navigation).getByRole("button", { name: "Tasks" })).getByText("1200")).toBeInTheDocument();
      expect(within(within(navigation).getByRole("button", { name: "Calendar" })).getByText("18000")).toBeInTheDocument();
      expect(within(within(navigation).getByRole("button", { name: "Notes" })).getByText("321")).toBeInTheDocument();
    });
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

    await user.click(within(dialog).getByRole("button", { name: "Dismiss all" }));
    expect(within(dialog).getByText("No app notices.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Notifications, 0 active" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Notifications" })).not.toBeInTheDocument();
  });

  it("opens settings as a centered opaque overlay with a blurred backdrop", async () => {
    const user = userEvent.setup();
    installHcb(seededHcb());
    render(<App />);

    expect(within(primaryNavigation()).queryByRole("button", { name: /Settings/ })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Calendar" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Settings" }));

    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    expect(dialog.parentElement).toHaveClass("place-items-center", "bg-bg-tertiary/45", "backdrop-blur-sm");
    expect(dialog).toHaveClass("max-w-[1120px]", "bg-bg-primary");
    expect(dialog).not.toHaveClass("bg-bg-primary/90", "backdrop-blur-xl");
    expect(within(dialog).getByRole("button", { name: "General" })).toHaveAttribute("aria-pressed", "true");
    expect(within(dialog).getByRole("button", { name: "Profile" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Appearance" })).toBeInTheDocument();
    expect(within(dialog).getByRole("heading", { level: 2, name: "Language" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Calendar" })).toBeInTheDocument();

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
    expect(screen.getByRole("heading", { level: 1, name: "Tasks" })).toBeInTheDocument();

    await runPaletteCommand(user, "force", /Force full resync/);
    expect(await screen.findByRole("dialog", { name: "Settings" })).toBeInTheDocument();

    await runPaletteCommand(user, "mcp", /Toggle MCP server/);
    expect(await screen.findByRole("dialog", { name: "Settings" })).toBeInTheDocument();

    await runPaletteCommand(user, "diagnostics", /Copy diagnostics summary/);
    expect(await screen.findByRole("dialog", { name: "Diagnostics" })).toBeInTheDocument();
  });

  it("exposes task command action IDs through the command palette", async () => {
    const user = userEvent.setup();
    installHcb(seededHcb());
    render(<App />);

    await goToSection("Tasks");
    expect(await screen.findByRole("heading", { name: "Inbox" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create" })).toBeInTheDocument();

    await user.keyboard("{Meta>}p{/Meta}");
    const dialog = await screen.findByRole("dialog", { name: "Command palette" });
    const input = within(dialog).getByRole("searchbox", { name: "Filter commands" });

    await user.type(input, "new task");
    expect(within(dialog).getByRole("option", { name: /New task/ })).toHaveAttribute(
      "data-action-id",
      "task.create"
    );

    await user.clear(input);
    await user.type(input, "quick capture");
    expect(within(dialog).getByRole("option", { name: /Quick capture/ })).toHaveAttribute(
      "data-action-id",
      "task.quickCapture"
    );

    await user.clear(input);
    await user.type(input, "complete selected");
    const completeCommand = within(dialog).getByRole("option", { name: /Complete selected task/ });

    expect(completeCommand).toHaveAttribute("data-action-id", "task.completeSelected");
    expect(completeCommand).toBeDisabled();
    expect(completeCommand).toHaveTextContent("No selected task");
  });

  it("renders seeded planner data and uses search", async () => {
    const api = seededHcb();
    installHcb(api);
    render(<App />);

    expect(await screen.findByText("Planner shell standup")).toBeInTheDocument();

    await goToSection("Tasks");
    expect(screen.getByRole("heading", { name: "Inbox" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Planning" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Inbox" })).toHaveAttribute("aria-checked", "true");

    await goToSection("Calendar");
    expect(screen.getByText("Agenda view")).toBeInTheDocument();
    expect(screen.getAllByText("Product").length).toBeGreaterThan(0);

    const user = userEvent.setup();
    await user.keyboard("{Meta>}p{/Meta}");
    const dialog = await screen.findByRole("dialog", { name: "Command palette" });
    await user.type(within(dialog).getByRole("searchbox", { name: "Filter commands" }), "triage");

    expect(await within(dialog).findByText(/Task in Inbox/)).toBeInTheDocument();
    expect(api.search.query).toHaveBeenCalledWith({ query: "triage", limit: 30 });
  });

  it("handles an unavailable preload bridge as an offline state", async () => {
    installHcb(undefined);
    render(<App />);

    expect((await screen.findAllByText("Offline"))[0]).toBeInTheDocument();
    expect(screen.getByText("The preload bridge is unavailable in this renderer context.")).toBeInTheDocument();
  });
});
