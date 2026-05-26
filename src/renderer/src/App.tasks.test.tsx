import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { err, ok } from "@shared/ipc/result";
import App from "./App";
import {
  goToSection,
  installHcb,
  now,
  runPaletteCommand,
  seededHcb
} from "./test/appTestHelpers";

describe("App tasks", () => {
  it("renders Google Tasks-style list columns, row actions, completion, and starred tasks", async () => {
    const api = seededHcb();
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Tasks");

    expect(await screen.findByRole("heading", { name: "Inbox" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Planning" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All tasks" })).toHaveAttribute("aria-current", "page");

    const inboxTasks = screen.getByRole("list", { name: "Inbox tasks" });
    expect(within(inboxTasks).getByText("Draft inbox triage rules")).toBeInTheDocument();
    expect(within(inboxTasks).getByText("Today")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Complete Draft inbox triage rules" }));
    expect(api.tasks.complete).toHaveBeenCalledWith({ id: "task-inbox-rules" });

    await user.click(screen.getByRole("button", { name: "Star Draft inbox triage rules" }));
    await user.click(screen.getByRole("button", { name: "Starred" }));

    expect(await screen.findByRole("heading", { name: "Starred tasks" })).toBeInTheDocument();
    expect(screen.getByText("Draft inbox triage rules")).toBeInTheDocument();
  });

  it("opens task and list action menus for move, delete, sorting, rename, and list creation", async () => {
    const api = seededHcb();
    installHcb(api);
    const promptSpy = vi.spyOn(window, "prompt");
    const confirmSpy = vi.spyOn(window, "confirm");
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Tasks");
    expect(await screen.findByRole("heading", { name: "Inbox" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open actions for Draft inbox triage rules" }));
    expect(screen.getByRole("button", { name: "Add deadline" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add a subtask" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Planning" }));
    expect(api.tasks.move).toHaveBeenCalledWith({
      id: "task-inbox-rules",
      listId: "list-planning",
      parentId: null
    });

    await user.click(screen.getByRole("button", { name: "Open actions for Review calendar fixture shape" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(api.tasks.delete).toHaveBeenCalledWith({ id: "task-calendar-fixtures" });

    await user.click(screen.getByRole("button", { name: "Open Inbox list menu" }));
    expect(screen.getByText("Sort by")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Title" }));

    promptSpy.mockReturnValueOnce("Inbox renamed");
    await user.click(screen.getByRole("button", { name: "Open Inbox list menu" }));
    await user.click(screen.getByRole("button", { name: "Rename list" }));
    expect(api.tasks.renameTaskList).toHaveBeenCalledWith({
      id: "list-inbox",
      title: "Inbox renamed"
    });

    promptSpy.mockReturnValueOnce("Errands");
    await user.click(screen.getByRole("button", { name: "Create new list" }));
    expect(api.tasks.createTaskList).toHaveBeenCalledWith({ title: "Errands" });

    confirmSpy.mockReturnValueOnce(true);
    await user.click(screen.getByRole("button", { name: "Open Planning list menu" }));
    await user.click(screen.getByRole("button", { name: "Delete list" }));
    expect(api.tasks.deleteTaskList).toHaveBeenCalledWith({ id: "list-planning" });
  });

  it("creates, edits, deletes, and quick-captures tasks through preload", async () => {
    const api = seededHcb();
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Tasks");
    expect(await screen.findByRole("heading", { name: "Inbox" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Create" }));
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

    await user.click(screen.getByRole("button", { name: "Create" }));
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
});
