import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { TaskListSummary, TaskSummary } from "@shared/ipc/contracts";
import { err, ok } from "@shared/ipc/result";
import App from "./App";
import {
  goToSection,
  installHcb,
  now,
  runPaletteCommand,
  seededTaskDetail,
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
    expect(screen.getByRole("button", { name: /All tasks/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("checkbox", { name: "Inbox" })).toHaveAttribute("aria-checked", "true");
    const planningToggle = screen.getByRole("checkbox", { name: "Planning" });
    expect(planningToggle).toHaveAttribute("aria-checked", "true");

    await user.click(planningToggle);
    expect(planningToggle).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByRole("heading", { name: "Planning" })).not.toBeInTheDocument();

    await user.click(planningToggle);
    expect(planningToggle).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("heading", { name: "Planning" })).toBeInTheDocument();

    const inboxTasks = screen.getByRole("list", { name: "Inbox tasks" });
    expect(within(inboxTasks).getByText("Draft inbox triage rules")).toBeInTheDocument();
    expect(within(inboxTasks).getByText("Today")).toBeInTheDocument();
    const completedToggle = screen.getByRole("button", { name: "Completed (1)" });
    expect(completedToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Report shell-visible timing")).not.toBeInTheDocument();
    await user.click(completedToggle);
    expect(completedToggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Report shell-visible timing")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Star Draft inbox triage rules" }));
    await user.click(screen.getByRole("button", { name: /Starred/ }));

    expect(await screen.findByRole("heading", { name: "Starred tasks" })).toBeInTheDocument();
    expect(screen.getByText("Draft inbox triage rules")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Complete Draft inbox triage rules" }));
    expect(api.tasks.complete).toHaveBeenCalledWith({ id: "task-inbox-rules" });
  });

  it("loads subsequent task pages during startup", async () => {
    const api = seededHcb();
    api.tasks.listTaskLists = vi.fn(async () =>
      ok({
        items: [
          {
            id: "list-inbox",
            title: "Inbox",
            updatedAt: now,
            taskCount: 2,
            activeTaskCount: 2
          }
        ],
        page: { limit: 100, totalKnown: 1 }
      })
    );
    api.tasks.list = vi.fn(async (request = {}) => {
      if (request.status === "hidden" || request.status === "deleted") {
        return ok({ items: [], page: { limit: 100, totalKnown: 0 } });
      }

      if (request.cursor === "page-2") {
        return ok({
          items: [
            {
              id: "task-page-2",
              listId: "list-inbox",
              title: "Second page task",
              status: "active" as const,
              priority: "none" as const,
              dueAt: now,
              updatedAt: now
            }
          ],
          page: { limit: 100, totalKnown: 2 }
        });
      }

      return ok({
        items: [
          {
            id: "task-page-1",
            listId: "list-inbox",
            title: "First page task",
            status: "active" as const,
            priority: "none" as const,
            dueAt: now,
            updatedAt: now
          }
        ],
        page: { limit: 100, nextCursor: "page-2", totalKnown: 2 }
      });
    });
    installHcb(api);
    render(<App />);

    await goToSection("Tasks");

    expect(await screen.findByText("First page task")).toBeInTheDocument();
    expect(screen.getByText("Second page task")).toBeInTheDocument();
    expect(api.tasks.list).toHaveBeenCalledWith({ status: "all", limit: 100 });
    expect(api.tasks.list).toHaveBeenCalledWith({ status: "all", limit: 100, cursor: "page-2" });
  });

  it("shows hidden completed Google tasks in completed disclosure", async () => {
    const api = seededHcb();
    const inbox: TaskListSummary = {
      id: "list-inbox",
      title: "Inbox",
      updatedAt: now,
      taskCount: 2,
      activeTaskCount: 1
    };
    const openTask: TaskSummary = {
      id: "task-open",
      listId: inbox.id,
      title: "Open dated task",
      status: "active",
      priority: "none",
      dueAt: now,
      updatedAt: now
    };
    const hiddenCompletedTask: TaskSummary = {
      id: "task-hidden-completed",
      listId: inbox.id,
      title: "Old completed task",
      status: "completed",
      priority: "none",
      dueAt: null,
      updatedAt: now
    };
    api.tasks.listTaskLists = vi.fn(async () =>
      ok({ items: [inbox], page: { limit: 100, totalKnown: 1 } })
    );
    api.tasks.list = vi.fn(async (request = {}) => {
      if (request.status === "hidden") {
        return ok({ items: [hiddenCompletedTask], page: { limit: 100, totalKnown: 1 } });
      }
      if (request.status === "deleted") {
        return ok({ items: [], page: { limit: 100, totalKnown: 0 } });
      }
      return ok({ items: [openTask], page: { limit: 100, totalKnown: 1 } });
    });
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Tasks");

    expect(await screen.findByRole("button", { name: "All tasks 1" })).toBeInTheDocument();
    const completedToggle = screen.getByRole("button", { name: "Completed (1)" });
    await user.click(completedToggle);
    expect(screen.getByText("Old completed task")).toBeInTheDocument();
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

    const draftRow = screen.getByRole("button", { name: /^Draft inbox triage rules / }).closest("[role='listitem']") as HTMLElement;
    const reviewRow = screen.getByRole("button", { name: /^Review calendar fixture shape / }).closest("[role='listitem']") as HTMLElement;

    fireEvent.contextMenu(draftRow, { clientX: 120, clientY: 160 });
    expect(screen.getByRole("button", { name: "Add deadline" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add a subtask" })).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("button", { name: "Add deadline" })).not.toBeInTheDocument();
    fireEvent.contextMenu(draftRow, { clientX: 120, clientY: 160 });
    fireEvent.contextMenu(reviewRow, { clientX: 140, clientY: 220 });
    expect(screen.getAllByRole("button", { name: "Add deadline" })).toHaveLength(1);
    fireEvent.contextMenu(draftRow, { clientX: 120, clientY: 160 });

    await user.click(screen.getByRole("button", { name: "Planning" }));
    expect(api.tasks.move).toHaveBeenCalledWith({
      id: "task-inbox-rules",
      listId: "list-planning",
      parentId: null
    });

    fireEvent.contextMenu(reviewRow, { clientX: 120, clientY: 220 });
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

  it("creates, edits, and deletes tasks through preload", async () => {
    const api = seededHcb();
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Tasks");
    expect(await screen.findByRole("heading", { name: "Inbox" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Create tasks" }));
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
    const editInspector = await screen.findByTestId("inspector-shell");
    const editInspectorBody = within(editInspector).getByTestId("inspector-body");
    expect(within(editInspectorBody).getByRole("heading", { name: "Draft inbox triage rules" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Task title" })).not.toBeInTheDocument();
    await user.click(
      within(screen.getByTestId("inspector-actions")).getByRole("button", { name: "Edit" })
    );
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
    const inspectorBody = within(inspector).getByTestId("inspector-body");
    expect(within(inspectorBody).getByRole("heading", { name: "Draft inbox triage rules" })).toBeInTheDocument();
    expect(within(inspector).queryByRole("textbox", { name: "Task title" })).not.toBeInTheDocument();

    await user.click(
      within(screen.getByTestId("inspector-actions")).getByRole("button", { name: "Edit" })
    );
    const titleInput = await within(inspector).findByRole("textbox", { name: "Task title" });
    await user.clear(titleInput);
    await user.type(titleInput, "Draft inbox triage rules v2");
    await waitFor(() => expect(within(inspector).getByText("Unsaved")).toBeInTheDocument());

    await user.keyboard("{Escape}");
    expect(screen.getByTestId("inspector-shell")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Task title" })).toHaveValue("Draft inbox triage rules v2");
  });

  it("strikes through completed task titles in read-only details", async () => {
    installHcb(seededHcb());
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Tasks");
    await user.click(await screen.findByRole("button", { name: "Completed (1)" }));
    await user.click(screen.getByRole("button", { name: "Report shell-visible timing" }));

    const inspector = await screen.findByTestId("inspector-shell");
    expect(within(inspector).getByRole("heading", { name: "Report shell-visible timing" })).toHaveClass("line-through");
  });

  it("renders existing task notes as markdown in read-only details", async () => {
    const api = seededHcb();
    api.tasks.list = vi.fn(async () =>
      ok({
        items: [
          {
            ...seededTaskDetail("task-inbox-rules", {
              notes: "# Checklist\n\n- [x] Capture **context**\n- [ ] Ship"
            }),
            listId: "list-inbox"
          }
        ],
        page: { limit: 100, totalKnown: 1 }
      })
    );
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Tasks");
    await user.click(await screen.findByRole("button", { name: /^Draft inbox triage rules / }));

    const inspector = await screen.findByTestId("inspector-shell");
    const preview = within(inspector).getByRole("region", { name: "Task notes preview" });
    expect(within(preview).getByRole("heading", { name: "Checklist" })).toBeInTheDocument();
    expect(within(preview).getByText("context")).toBeInTheDocument();
    expect(within(preview).getAllByRole("checkbox")).toHaveLength(2);
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

    await user.click(screen.getByRole("button", { name: "Create tasks" }));
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
