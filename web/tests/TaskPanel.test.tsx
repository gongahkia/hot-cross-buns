import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TaskPanel } from "@/components/TaskPanel";

describe("TaskPanel", () => {
  it("captures a title-first task in the selected Google Task list", async () => {
    const user = userEvent.setup();
    const createTask = vi.fn().mockResolvedValue(undefined);
    render(
      <TaskPanel
        taskLists={[{ id: "inbox", title: "Inbox" }]}
        tasks={[]}
        search=""
        createTaskList={vi.fn().mockResolvedValue(undefined)}
        updateTaskList={vi.fn().mockResolvedValue(undefined)}
        deleteTaskList={vi.fn().mockResolvedValue(undefined)}
        createTask={createTask}
        updateTask={vi.fn().mockResolvedValue(undefined)}
        toggleTask={vi.fn().mockResolvedValue(undefined)}
        deleteTask={vi.fn().mockResolvedValue(undefined)}
        moveTask={vi.fn().mockResolvedValue(undefined)}
      />
    );

    await user.type(screen.getByLabelText("New task title"), "Prepare launch");
    await user.click(screen.getByRole("button", { name: "Add task" }));

    expect(createTask).toHaveBeenCalledWith("inbox", {
      title: "Prepare launch"
    });
  });

  it("opens task details before exposing the editor", async () => {
    const user = userEvent.setup();
    render(
      <TaskPanel
        taskLists={[{ id: "inbox", title: "Inbox" }]}
        tasks={[{ id: "task-1", listId: "inbox", title: "Prepare launch", notes: "Brief the team", status: "needsAction" }]}
        search=""
        createTaskList={vi.fn().mockResolvedValue(undefined)}
        updateTaskList={vi.fn().mockResolvedValue(undefined)}
        deleteTaskList={vi.fn().mockResolvedValue(undefined)}
        createTask={vi.fn().mockResolvedValue(undefined)}
        updateTask={vi.fn().mockResolvedValue(undefined)}
        toggleTask={vi.fn().mockResolvedValue(undefined)}
        deleteTask={vi.fn().mockResolvedValue(undefined)}
        moveTask={vi.fn().mockResolvedValue(undefined)}
      />
    );

    await user.click(screen.getByText("Prepare launch"));
    expect(await screen.findByRole("heading", { name: "Prepare launch" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Edit task" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit task" }));
    expect(await screen.findByRole("heading", { name: "Edit task" })).toBeVisible();
  });
});
