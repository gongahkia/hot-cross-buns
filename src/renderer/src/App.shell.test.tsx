import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import App from "./App";
import {
  goToSection,
  installHcb,
  loadingHcb,
  originalHcb,
  primaryNavigation,
  runPaletteCommand,
  seededHcb,
  settingsLoadingHcb
} from "./test/appTestHelpers";

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
    expect(await screen.findByRole("dialog", { name: "Diagnostics" })).toBeInTheDocument();
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

  it("handles an unavailable preload bridge as an offline state", async () => {
    installHcb(undefined);
    render(<App />);

    expect((await screen.findAllByText("Offline cache"))[0]).toBeInTheDocument();
    expect(screen.getByText("The preload bridge is unavailable in this renderer context.")).toBeInTheDocument();
  });
});
