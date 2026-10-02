import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ok } from "@shared/ipc/result";
import { InspectorProvider, InspectorShell } from "../../../../components/Inspector";
import { CoreDataProvider } from "../../coreViewModelSource";
import { installHcb, seededHcb, testNativeCapabilities, testSettings } from "../../../../test/appTestHelpers";
import { TasksView } from "./TasksView";

function renderTaskSurface() {
  const api = seededHcb();
  api.sync.subscribeStatus = vi.fn(() => () => undefined);
  api.native = { capabilities: vi.fn(async () => ({ ok: true, data: testNativeCapabilities() })) } as never;
  api.diagnostics = {
    markCachedDataRendered: vi.fn(async () => ok({ marked: true })),
    recordTiming: vi.fn(async () => ok({ recorded: true }))
  } as never;
  api.settings.get = vi.fn(async () => ok(testSettings()));
  installHcb(api);

  render(
    <CoreDataProvider>
      <InspectorProvider>
        <TasksView />
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

    fireEvent.keyDown(title, { key: "Enter", metaKey: true });

    await waitFor(() => expect(api.tasks.create).toHaveBeenCalledTimes(1));
    expect(api.tasks.create).toHaveBeenCalledWith(expect.objectContaining({
      listId: "list-inbox",
      notes: "Keep this local until Save.",
      title: "Write release notes"
    }));
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Task title" })).toBeNull());
    expect(screen.getByRole("button", { name: /^All tasks/ })).toHaveTextContent("4");
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
});
