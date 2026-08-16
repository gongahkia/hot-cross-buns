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
});
