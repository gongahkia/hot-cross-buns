import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import App from "./App";

afterEach(() => {
  cleanup();
});

function primaryNavigation(): HTMLElement {
  return screen.getByRole("navigation", { name: "Primary" });
}

async function goToSection(label: string): Promise<void> {
  const user = userEvent.setup();
  await user.click(within(primaryNavigation()).getByRole("button", { name: new RegExp(label) }));
}

describe("App shell", () => {
  it("renders the compact planner frame and primary sections", async () => {
    render(<App />);

    expect(screen.getByTestId("app-shell")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Today" })).toBeInTheDocument();
    expect(screen.getByRole("toolbar", { name: "Planner actions" })).toBeInTheDocument();
    expect(screen.getByText("Offline mock mode")).toBeInTheDocument();

    for (const label of ["Today", "Tasks", "Calendar", "Notes", "Search", "Settings"]) {
      expect(within(primaryNavigation()).getByRole("button", { name: new RegExp(label) })).toBeInTheDocument();
    }

    expect(await screen.findByText("Ready")).toBeInTheDocument();
  });

  it("navigates sections with pointer and sidebar arrow keys", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(within(primaryNavigation()).getByRole("button", { name: /Tasks/ }));
    expect(screen.getByRole("heading", { name: "Tasks" })).toBeInTheDocument();
    expect(within(primaryNavigation()).getByRole("button", { name: /Tasks/ })).toHaveAttribute(
      "aria-current",
      "page"
    );

    const tasksButton = within(primaryNavigation()).getByRole("button", { name: /Tasks/ });
    tasksButton.focus();
    await user.keyboard("{ArrowDown}");

    expect(screen.getByRole("heading", { name: "Calendar" })).toBeInTheDocument();
    expect(within(primaryNavigation()).getByRole("button", { name: /Calendar/ })).toHaveFocus();
  });

  it("opens and filters the command palette", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.keyboard("{Control>}k{/Control}");

    const dialog = await screen.findByRole("dialog", { name: "Command palette" });
    const input = within(dialog).getByRole("searchbox", { name: "Filter commands" });

    await user.type(input, "note");

    expect(within(dialog).getByRole("option", { name: /New note/ })).toBeInTheDocument();
    expect(within(dialog).getByRole("option", { name: /Go to Notes/ })).toBeInTheDocument();
    expect(within(dialog).queryByRole("option", { name: /New event/ })).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("option", { name: /Go to Notes/ }));

    expect(screen.queryByRole("dialog", { name: "Command palette" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Notes" })).toBeInTheDocument();
  });
});

describe("core screen mock coverage", () => {
  it("shows Today tasks and calendar agenda rows", () => {
    render(<App />);

    expect(screen.getByText("Open tasks")).toBeInTheDocument();
    expect(screen.getByText("Timeline")).toBeInTheDocument();
    expect(screen.getByText("Planner shell standup")).toBeInTheDocument();
    expect(screen.getAllByText("Draft inbox triage rules")[0]).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Today timeline" })).toBeInTheDocument();
  });

  it("shows task grouping, completion state, subtasks, filters, empty state, and error state", async () => {
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Tasks");

    expect(screen.getAllByText("Inbox")[0]).toBeInTheDocument();
    expect(screen.getAllByText("Planning")[0]).toBeInTheDocument();
    expect(screen.getByText("Map shortcut states")).toBeInTheDocument();

    const completeButton = screen.getByRole("button", { name: "Complete Draft inbox triage rules" });
    await user.click(completeButton);
    expect(completeButton).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: /Completed/ }));
    expect(screen.getByText("Completed history")).toBeInTheDocument();
    expect(screen.getByText("Report shell-visible timing")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Hidden/ }));
    expect(screen.getByText("Legacy import comparison")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Deleted/ }));
    expect(screen.getByText("Remove stale demo row")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Empty/ }));
    expect(screen.getByText("No tasks in this filter")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Error/ }));
    expect(screen.getByRole("alert")).toHaveTextContent("Shortcut conflict");
  });

  it("shows calendar agenda, day, week, and month view shells", async () => {
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Calendar");

    expect(screen.getByText("Agenda view shell")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Calendar agenda" })).toBeInTheDocument();
    expect(screen.getByText("Planner shell standup")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Day" }));
    expect(screen.getByText("Day view shell")).toBeInTheDocument();
    expect(screen.getByRole("grid", { name: "Calendar day view" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Week" }));
    expect(screen.getByText("Week view shell")).toBeInTheDocument();
    expect(screen.getByRole("grid", { name: "Calendar week view" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Month" }));
    expect(screen.getByText("Month view shell")).toBeInTheDocument();
    expect(screen.getByRole("grid", { name: "Calendar month view" })).toBeInTheDocument();
  });

  it("creates, edits, and deletes local notes in renderer state", async () => {
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Notes");

    expect(screen.getByDisplayValue("Cache-first startup")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /New note/ }));
    const titleInput = screen.getByRole("textbox", { name: "Note title" });
    const bodyInput = screen.getByRole("textbox", { name: "Note body" });

    expect(titleInput).toHaveValue("Untitled note");
    await user.clear(titleInput);
    await user.type(titleInput, "Release note draft");
    await user.type(bodyInput, "Document mock screens before real preload data lands.");

    expect(screen.getAllByText("Release note draft")[0]).toBeInTheDocument();
    expect(screen.getAllByText(/Document mock screens/)[0]).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete selected note" }));

    expect(screen.queryByDisplayValue("Release note draft")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("Cache-first startup")).toBeInTheDocument();
  });

  it("searches precomputed task, event, and note buckets with empty states", async () => {
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Search");

    expect(screen.getAllByText("Search waits for a local query")[0]).toBeInTheDocument();

    const searchInput = screen.getByRole("textbox", { name: "Search local mock data" });

    await user.type(searchInput, "task");
    expect(screen.getByText("Draft inbox triage rules")).toBeInTheDocument();
    expect(screen.getAllByText("task")[0]).toBeInTheDocument();

    await user.clear(searchInput);
    await user.type(searchInput, "event");
    expect(screen.getByText("Renderer acceptance review")).toBeInTheDocument();
    expect(screen.getAllByText("event")[0]).toBeInTheDocument();

    await user.clear(searchInput);
    await user.type(searchInput, "note");
    expect(screen.getByText("Command palette surface")).toBeInTheDocument();
    expect(screen.getAllByText("note")[0]).toBeInTheDocument();

    await user.clear(searchInput);
    await user.type(searchInput, "zzzz");
    expect(screen.getByText("No matching mock results")).toBeInTheDocument();
  });

  it("shows required settings sections and recoverable hotkey error state", async () => {
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Settings");

    const settingsSupport = screen.getByLabelText("Settings support");
    for (const label of [
      "Google",
      "Sync",
      "Appearance",
      "Hotkeys",
      "Tray",
      "Notifications",
      "MCP",
      "Diagnostics"
    ]) {
      expect(within(settingsSupport).getByRole("button", { name: new RegExp(label) })).toBeInTheDocument();
    }

    expect(screen.getByText("OAuth setup shell only. The renderer never receives tokens or client secrets.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Copy diagnostics/ })).toBeInTheDocument();

    await user.click(within(settingsSupport).getByRole("button", { name: /Hotkeys/ }));

    expect(screen.getByText("Quick capture shortcut state remains recoverable and visible.")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Shortcut conflict");
  });
});
