import { Profiler, type ProfilerOnRenderCallback } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ok } from "@shared/ipc/result";
import { InspectorProvider, InspectorShell } from "../../../../components/Inspector";
import { CoreDataProvider } from "../../coreViewModelSource";
import { installHcb, seededHcb, testNativeCapabilities, testSettings } from "../../../../test/appTestHelpers";
import { TasksView } from "./TasksView";

function renderTaskSurface({
  onTaskSurfaceRender,
  taskCount
}: {
  onTaskSurfaceRender?: ProfilerOnRenderCallback;
  taskCount?: number;
} = {}) {
  const api = seededHcb();
  api.sync.subscribeStatus = vi.fn(() => () => undefined);
  api.native = { capabilities: vi.fn(async () => ({ ok: true, data: testNativeCapabilities() })) } as never;
  api.diagnostics = {
    markCachedDataRendered: vi.fn(async () => ok({ marked: true })),
    recordTiming: vi.fn(async () => ok({ recorded: true }))
  } as never;
  api.settings.get = vi.fn(async () => ok(testSettings()));

  if (taskCount !== undefined) {
    const tasks = Array.from({ length: taskCount }, (_, index) => ({
      id: `task-performance-${index}`,
      listId: "list-inbox",
      title: `Synthetic performance task ${index}`,
      status: "active" as const,
      priority: "none" as const,
      dueAt: null,
      notes: "",
      parentId: null,
      updatedAt: "2026-10-02T00:00:00.000Z"
    }));
    api.tasks.listTaskLists = vi.fn(async () => ok({
      items: [{
        id: "list-inbox",
        title: "Inbox",
        updatedAt: "2026-10-02T00:00:00.000Z",
        taskCount,
        activeTaskCount: taskCount
      }],
      page: { limit: 100, totalKnown: 1 }
    })) as never;
    api.tasks.list = vi.fn(async (request) => ok({
      items: request.status === "all" ? tasks : [],
      page: { limit: 100, totalKnown: request.status === "all" ? taskCount : 0 }
    })) as never;
  }
  installHcb(api);

  render(
    <CoreDataProvider>
      <InspectorProvider>
        <Profiler id="tasks-surface" onRender={onTaskSurfaceRender ?? (() => undefined)}>
          <TasksView />
        </Profiler>
        <InspectorShell />
      </InspectorProvider>
    </CoreDataProvider>
  );

  return api;
}

describe("Task inspector draft persistence", () => {
  it("keeps New Task typing local and creates once with Cmd/Ctrl+Enter", async () => {
    const api = renderTaskSurface();
    await waitFor(() => expect(screen.getByRole("button", { name: "New task" })).toBeTruthy());
    window.dispatchEvent(new CustomEvent("hcb:task-command", { detail: { action: "new-task" } }));
    const title = await screen.findByRole("textbox", { name: "Task title" });
    const notes = await screen.findByRole("textbox", { name: "Task notes" });

    fireEvent.change(title, { target: { value: "Write release notes" } });
    fireEvent.change(notes, { target: { value: "Keep this local until Save." } });

    expect(api.tasks.create).not.toHaveBeenCalled();
    expect(api.tasks.update).not.toHaveBeenCalled();
    const taskListReadsBeforeSubmit = vi.mocked(api.tasks.listTaskLists).mock.calls.length;

    fireEvent.keyDown(title, { key: "Enter", metaKey: true });

    await waitFor(() => expect(api.tasks.create).toHaveBeenCalledTimes(1));
    expect(api.tasks.create).toHaveBeenCalledWith(expect.objectContaining({
      listId: "list-inbox",
      notes: "Keep this local until Save.",
      title: "Write release notes"
    }));
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Task title" })).toBeNull());
    expect(screen.getByRole("button", { name: /^All tasks/ })).toHaveTextContent("4");
    expect(api.tasks.listTaskLists).toHaveBeenCalledTimes(taskListReadsBeforeSubmit);
  });

  it("keeps existing Task title and notes local until Save changes", async () => {
    const api = renderTaskSurface();
    const task = await screen.findByRole("button", { name: "Draft inbox triage rules" });
    fireEvent.click(task);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const title = await screen.findByRole("textbox", { name: "Task title" });
    const notes = await screen.findByRole("textbox", { name: "Task notes" });
    fireEvent.change(title, { target: { value: "Revise inbox triage rules" } });
    fireEvent.change(notes, { target: { value: "Updated notes" } });

    expect(api.tasks.update).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(api.tasks.update).toHaveBeenCalledTimes(1));
    expect(api.tasks.update).toHaveBeenCalledWith(expect.objectContaining({
      id: "task-inbox-rules",
      notes: "Updated notes",
      title: "Revise inbox triage rules"
    }));
  });

  it("keeps populated task-workspace work out of New Task title typing", async () => {
    const commits: Array<{ actualDuration: number; phase: string }> = [];
    const api = renderTaskSurface({
      taskCount: 100,
      onTaskSurfaceRender: (_id, phase, actualDuration) => {
        commits.push({ actualDuration, phase });
      }
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "New task" })).toBeTruthy());
    const taskBoard = screen.getByLabelText("Task board navigation");
    const allTasks = within(taskBoard).getByRole("button", { name: /^All tasks/ });
    window.dispatchEvent(new CustomEvent("hcb:task-command", { detail: { action: "new-task" } }));
    const inspector = await screen.findByTestId("inspector-shell");
    const inspectorQueries = within(inspector);
    const title = inspectorQueries.getByRole("textbox", { name: "Task title" });
    const addTask = inspectorQueries.getByRole("button", { name: "Add task" });
    await act(async () => {
      await Promise.resolve();
    });
    commits.length = 0;

    fireEvent.change(title, { target: { value: "A" } });

    await waitFor(() => expect(addTask).toBeEnabled());
    expect(commits).toEqual([]);
    expect(api.tasks.create).not.toHaveBeenCalled();
    expect(api.tasks.update).not.toHaveBeenCalled();
    expect(inspectorQueries.getByText("Unsaved")).toBeTruthy();

    fireEvent.click(inspectorQueries.getByRole("button", { name: "Close inspector" }));

    expect(title.isConnected).toBe(true);

    fireEvent.keyDown(title, { key: "Enter", metaKey: true });

    await waitFor(() => expect(api.tasks.create).toHaveBeenCalledTimes(1));
    expect(api.tasks.create).toHaveBeenCalledWith(expect.objectContaining({
      listId: "list-inbox",
      title: "A"
    }));
    await waitFor(() => expect(title.isConnected).toBe(false));
    expect(allTasks).toHaveTextContent("101");
    cleanup();
  });
});
