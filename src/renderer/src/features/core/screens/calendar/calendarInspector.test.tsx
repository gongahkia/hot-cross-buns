import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { internalError, ok } from "@shared/ipc/result";
import { InspectorProvider, InspectorShell } from "../../../../components/Inspector";
import { CoreDataProvider, useCoreViewModelSource } from "../../coreViewModelSource";
import { installHcb, seededHcb, testSettings, testNativeCapabilities } from "../../../../test/appTestHelpers";
import { useCalendarEventInspector } from "./useCalendarEventInspector";

function Harness() {
  const source = useCoreViewModelSource();
  const inspector = useCalendarEventInspector(source);
  return <button disabled={!source.calendarSources.length} onClick={() => inspector.openCreate()}>Open event</button>;
}
function surface() {
  const api = seededHcb();
  api.settings.get = vi.fn(async () => ok(testSettings()));
  api.sync.subscribeStatus = vi.fn(() => () => undefined);
  api.native = { capabilities: vi.fn(async () => ok(testNativeCapabilities())) } as never;
  api.diagnostics = { markCachedDataRendered: vi.fn(async () => ok({ marked: true })), recordTiming: vi.fn(async () => ok({ recorded: true })) } as never;
  api.calendar.create = vi.fn(async (request) => ok({ ...request, id: "created-event" }));
  api.calendar.update = vi.fn(async (request) => ok(request));
  installHcb(api);
  render(<CoreDataProvider><InspectorProvider><Harness /><InspectorShell /></InspectorProvider></CoreDataProvider>);
  return api;
}
async function openEvent() {
  await waitFor(() => expect(screen.getByRole("button", { name: "Open event" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Open event" }));
  return screen.findByRole("textbox", { name: "Event title" });
}

describe("Calendar inspector autosave", () => {
  it("creates once and drains typing entered during a slow save before closing", async () => {
    const api = surface();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    api.calendar.create = vi.fn(async (request) => { await gate; return ok({ ...request, id: "created-event" }); });
    const title = await openEvent();
    fireEvent.change(title, { target: { value: "First title" } });
    expect(api.calendar.create).not.toHaveBeenCalled();
    fireEvent.blur(title);
    await waitFor(() => expect(api.calendar.create).toHaveBeenCalledOnce());
    fireEvent.change(title, { target: { value: "Typing while saving" } });
    fireEvent.blur(title);
    fireEvent.click(screen.getByRole("button", { name: "Close inspector" }));
    expect(title).toHaveValue("Typing while saving");
    await act(async () => { release?.(); });
    await waitFor(() => expect(screen.queryByTestId("inspector-shell")).toBeNull());
    expect(api.calendar.create).toHaveBeenCalledOnce();
    expect(api.calendar.update).toHaveBeenCalledOnce();
    expect(api.calendar.update).toHaveBeenLastCalledWith(expect.objectContaining({ id: "created-event", title: "Typing while saving" }));
  });

  it("keeps a failed draft open and retries without a second create after success", async () => {
    const api = surface();
    api.calendar.create = vi.fn().mockResolvedValueOnce(internalError("Disk is full")).mockImplementation(async (request) => ok({ ...request, id: "created-event" }));
    const title = await openEvent();
    fireEvent.change(title, { target: { value: "Keep this event" } });
    fireEvent.blur(title);
    await screen.findByText("Disk is full");
    expect(title).toHaveValue("Keep this event");
    fireEvent.click(screen.getByRole("button", { name: "Retry", exact: true }));
    await waitFor(() => expect(screen.getByTestId("inspector-shell")).toHaveAttribute("data-inspector-id", "created-event"));
    expect(title).toHaveValue("Keep this event");
    fireEvent.blur(title);
    await act(async () => { await Promise.resolve(); });
    expect(api.calendar.create).toHaveBeenCalledTimes(2);
    expect(api.calendar.update).not.toHaveBeenCalled();
  });
});
