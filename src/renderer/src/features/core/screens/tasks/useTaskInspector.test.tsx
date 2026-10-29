import type { ComponentProps, ReactElement } from "react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TaskCreateRequest } from "@shared/ipc/contracts";
import { InspectorProvider, useInspector } from "../../../../components/Inspector";
import type { TaskInspectorBody } from "../../inspectors/TaskInspectorBody";
import { useTaskInspector } from "./useTaskInspector";

describe("task creation acknowledgement", () => {
  it("updates the created task when a field event still carries the pre-save editor identity", async () => {
    const createTask = vi.fn(async (_request: TaskCreateRequest, onCreated?: (id: string) => void) => { onCreated?.("created-task"); return true; });
    const updateTask = vi.fn(async () => true);
    const source = {
      taskLists: [{ id: "inbox", title: "Inbox" }],
      largeTaskWindow: [],
      getTaskById: () => null,
      taskMutationPending: false,
      createTask,
      updateTask
    } as unknown as Parameters<typeof useTaskInspector>[0];
    const { result } = renderHook(() => ({
      tasks: useTaskInspector(source),
      inspector: useInspector()
    }), { wrapper: InspectorProvider });
    await act(async () => { await result.current.tasks.openNewTask({ title: "One task" }); });
    const originalEditor = result.current.inspector.current!.body as ReactElement<ComponentProps<typeof TaskInspectorBody>>;
    // The durable response can arrive between title blur and a due-date change,
    // before the editor receives/reset its new props. Exercise that boundary
    // directly instead of relying on the browser scheduler to hit the race.
    await act(async () => { expect(await result.current.inspector.current!.onSave!()).toBe(true); });
    await act(async () => {
      originalEditor.props.onDraftChange({ ...originalEditor.props.draft, dueDate: "2027-02-03" });
      expect(await result.current.inspector.close()).toBe(true);
    });
    expect(createTask).toHaveBeenCalledTimes(1);
    expect(updateTask).toHaveBeenCalledTimes(1);
    expect(updateTask).toHaveBeenCalledWith(expect.objectContaining({
      id: "created-task", title: "One task", dueDate: "2027-02-03"
    }));
    expect(result.current.inspector.current).toBeNull();
  });
});
