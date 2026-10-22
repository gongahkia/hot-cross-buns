import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { internalError, ok } from "@shared/ipc/result";
import { InspectorProvider, InspectorShell } from "../../../components/Inspector";
import { CoreDataProvider } from "../coreViewModelSource";
import { installHcb, seededHcb, testNativeCapabilities, testSettings } from "../../../test/appTestHelpers";
import { NotesView } from "./NotesView";

function surface() {
  const api = seededHcb();
  localStorage.clear();
  api.settings.get = vi.fn(async () => ok(testSettings()));
  api.settings.update = vi.fn(async (request) => ok(testSettings(request)));
  api.native = { capabilities: vi.fn(async () => ok(testNativeCapabilities())) } as never;
  api.diagnostics = { markCachedDataRendered: vi.fn(async () => ok({ marked: true })), recordTiming: vi.fn(async () => ok({ recorded: true })) } as never;
  api.notes.legacyMigrationPreview = vi.fn(async () => ok({ foundCount: 0, items: [] }));
  api.sync.subscribeStatus = vi.fn(() => () => undefined);
  installHcb(api);
  render(<CoreDataProvider><InspectorProvider><NotesView /><InspectorShell /></InspectorProvider></CoreDataProvider>);
  return api;
}

async function editOffscreenNote() {
  await screen.findByRole("button", { name: "Open note Startup data flow" });
  act(() => window.dispatchEvent(new CustomEvent("hcb:note-command", { detail: { action: "open-note", noteId: "note-outside-cache" } })));
  await waitFor(() => expect(screen.getByTestId("inspector-shell")).toHaveAttribute("data-inspector-id", "note-outside-cache"));
  await screen.findByRole("textbox", { name: "Note body" }, { timeout: 5000 });
  fireEvent.click(await screen.findByRole("button", { name: "Source" }));
  return screen.findByRole("textbox", { name: "Note body" });
}

describe("Paged note editing", () => {
  it("reads the full offscreen note and leaves a failed save open", async () => {
    const api = surface();
    const fullBody = "Full content beyond the preview. ".repeat(100);
    api.notes.get = vi.fn(async ({ id }) => ok({ id, listId: "list-inbox", title: "Full offscreen note", body: fullBody, updatedAt: new Date().toISOString() }));
    const editor = await editOffscreenNote();
    expect(editor).toHaveValue(fullBody);
    expect(api.notes.get).toHaveBeenCalledWith({ id: "note-outside-cache" });
    api.notes.update = vi.fn(async () => internalError("Disk write failed"));
    fireEvent.change(editor, { target: { value: `${fullBody}unsaved` } });
    fireEvent.keyDown(editor, { key: "Escape" });
    await waitFor(() => expect(api.notes.update).toHaveBeenCalled());
    expect(screen.getByRole("textbox", { name: "Note body" })).toHaveValue(`${fullBody}unsaved`);
    expect(screen.getAllByText(/changes are still open|Disk write failed/).length).toBeGreaterThan(0);
  });

  it("creates a draft once and transitions to the saved editor", async () => {
    const api = surface();
    await screen.findByRole("button", { name: "New note" });
    await waitFor(() => expect(screen.getByRole("button", { name: "New note" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "New note" }));
    const title = await screen.findByRole("textbox", { name: "Note title" });
    fireEvent.change(title, { target: { value: "Created once" } });
    fireEvent.click(await screen.findByRole("button", { name: "Source" }));
    const body = screen.getByRole("textbox", { name: "Note body" });
    fireEvent.change(body, { target: { value: "Keep this content" } });
    let finish: ((value: any) => void) | undefined;
    api.notes.create = vi.fn(() => new Promise<any>((resolve) => { finish = resolve; }));
    fireEvent.blur(body); fireEvent.blur(body);
    await waitFor(() => expect(api.notes.create).toHaveBeenCalledOnce());
    expect(title).toBeEnabled();
    fireEvent.change(body, { target: { value: "Keep this content and new typing" } });
    await act(async () => { finish?.(ok({ id: "saved-note", listId: "list-inbox", title: "Created once", body: "Keep this content" })); });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Create note" })).toBeNull());
    if (screen.queryByRole("button", { name: "Source" })) fireEvent.click(screen.getByRole("button", { name: "Source" }));
    expect(screen.getByRole("textbox", { name: "Note body" })).toHaveValue("Keep this content and new typing");
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Note body" }), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("preserves typing made while an autosave is pending", async () => {
    const api = surface();
    const editor = await editOffscreenNote();
    let finish: ((result: any) => void) | undefined;
    api.notes.update = vi.fn().mockImplementationOnce(() => new Promise<any>((resolve) => { finish = resolve; })).mockImplementation(async (request) => ok({ ...request }));
    fireEvent.change(editor, { target: { value: "First edit" } });
    expect(api.notes.update).not.toHaveBeenCalled();
    fireEvent.blur(editor);
    await waitFor(() => expect(api.notes.update).toHaveBeenCalledTimes(1));
    fireEvent.change(editor, { target: { value: "Second edit while writing" } });
    await act(async () => { finish?.(ok({ id: "note-outside-cache" })); await Promise.resolve(); });
    await waitFor(() => expect(api.notes.update).toHaveBeenLastCalledWith(expect.objectContaining({ body: "Second edit while writing" })));
    expect(screen.getByRole("textbox", { name: "Note body" })).toHaveValue("Second edit while writing");
  });
  it("keeps the original when conversion fails and removes it only after retry succeeds", async () => {
    const api = surface();
    api.notes.create = vi.fn().mockResolvedValueOnce(internalError("Disk is full")).mockImplementation(async (request) => ok({ ...request, id: "converted-note" }));
    await screen.findByRole("button", { name: "New note" });
    act(() => window.dispatchEvent(new CustomEvent("hcb:note-command", { detail: { action: "convert-to-note", draft: { title: "Converted task", body: "Keep all writing" }, cleanup: { kind: "task", id: "original-task" } } })));
    await screen.findByText("Disk is full", {}, { timeout: 5000 });
    expect(api.tasks.delete).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Note title" })).toHaveValue("Converted task");
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByTestId("inspector-shell")).toHaveAttribute("data-inspector-id", "converted-note"));
    expect(api.tasks.delete).toHaveBeenCalledOnce();
    expect(api.tasks.delete).toHaveBeenCalledWith({ id: "original-task" });
  });

});
