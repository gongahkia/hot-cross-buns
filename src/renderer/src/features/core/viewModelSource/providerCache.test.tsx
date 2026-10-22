import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ok } from "@shared/ipc/result";
import { CoreDataProvider, useCoreViewModelSource, type CoreViewModelSource } from "../coreViewModelSource";
import { installHcb, seededHcb, testNativeCapabilities, testSettings } from "../../../test/appTestHelpers";
import { useCalendarRangeLoader } from "../screens/calendar/useCalendarRangeLoader";

function setup(watchRange?: { start: string; end: string }) {
  const api = seededHcb();
  api.settings.get = vi.fn(async () => ok(testSettings()));
  api.native = { capabilities: vi.fn(async () => ok(testNativeCapabilities())) } as never;
  api.diagnostics = { summary: vi.fn(async () => ({ ok: false, error: { message: "No diagnostic fixture" } })), markCachedDataRendered: vi.fn(async () => ok({ marked: true })), recordTiming: vi.fn(async () => ok({ recorded: true })) } as never;
  let listener: ((status: any) => void) | undefined;
  api.sync.subscribeStatus = vi.fn((next) => { listener = next; return () => undefined; });
  installHcb(api);
  let source!: CoreViewModelSource;
  function Capture(): null {
    source = useCoreViewModelSource();
    useCalendarRangeLoader(watchRange ?? { start: "2099-05-01T00:00:00.000Z", end: "2099-06-01T00:00:00.000Z" }, Boolean(watchRange) && source.dataState !== "loading", source.calendarDataRevision, source.ensureCalendarRange);
    return null;
  }
  render(<CoreDataProvider><Capture /></CoreDataProvider>);
  return { api, getSource: () => source, status: (value: any) => listener?.(value) };
}

describe("workspace cache consistency", () => {
  it("reloads an unchanged visible range after refresh replaces the bootstrap snapshot", async () => {
    const range = { start: "2099-05-01T00:00:00.000Z", end: "2099-06-01T00:00:00.000Z" };
    const fixture = setup(range);
    const original = fixture.api.calendar.listEvents;
    let title = "Before edit";
    fixture.api.calendar.listEvents = vi.fn(request => request.start === range.start
      ? Promise.resolve(ok({ items: [{ id: "viewport-event", calendarId: "primary", title, startsAt: "2099-05-02T08:00:00Z", endsAt: "2099-05-02T09:00:00Z" }], page: { limit: 500, totalKnown: 1 } })) : original(request));
    await waitFor(() => expect(fixture.getSource().calendarEventsById["viewport-event"]?.title).toBe("Before edit"));
    title = "After edit";
    act(() => fixture.getSource().refresh());
    await waitFor(() => expect(fixture.getSource().calendarEventsById["viewport-event"]?.title).toBe("After edit"));
  });

  it("reuses collection projections for unrelated sync status updates", async () => {
    const fixture = setup();
    await waitFor(() => expect(fixture.getSource().hydrationState).toBe("success"));
    const before = fixture.getSource();
    act(() => fixture.status({ ...before.syncStatus, state: "syncing", summary: "Refreshing in background" }));
    await waitFor(() => expect(fixture.getSource().syncStatus.state).toBe("syncing"));
    const after = fixture.getSource();
    expect(after.largeTaskWindow).toBe(before.largeTaskWindow);
    expect(after.initialNotes).toBe(before.initialNotes);
    expect(after.calendarDayView).toBe(before.calendarDayView);
    expect(after.calendarWeekDays).toBe(before.calendarWeekDays);
    expect(after.calendarMonthWeeks).toBe(before.calendarMonthWeeks);
    expect(after.taskDataRevision).toBe(before.taskDataRevision);
  });

  it("serializes overlapping settings changes so older replies cannot overwrite newer preferences", async () => {
    const fixture = setup();
    await waitFor(() => expect(fixture.getSource().hydrationState).toBe("success"));
    const completions: Array<() => void> = [];
    let saved = testSettings();
    fixture.api.settings.update = vi.fn((request) => new Promise<any>((resolve) => completions.push(() => { saved = { ...saved, ...request }; resolve(ok(saved)); })));
    let first!: Promise<boolean>, second!: Promise<boolean>;
    act(() => { first = fixture.getSource().updateSettings({ uiTextSizePoints: 14 }); second = fixture.getSource().updateSettings({ syncMode: "manual" }); });
    await waitFor(() => expect(fixture.api.settings.update).toHaveBeenCalledTimes(1));
    await act(async () => { completions[0](); await first; });
    await waitFor(() => expect(fixture.api.settings.update).toHaveBeenCalledTimes(2));
    await act(async () => { completions[1](); await second; });
    expect(fixture.getSource().settings.uiTextSizePoints).toBe(14);
    expect(fixture.getSource().settings.syncMode).toBe("manual");
  });

  it("discards a calendar response from a workspace generation replaced by refresh", async () => {
    const fixture = setup();
    await waitFor(() => expect(fixture.getSource().hydrationState).toBe("success"));
    const original = fixture.api.calendar.listEvents;
    let finish: ((value: any) => void) | undefined;
    fixture.api.calendar.listEvents = vi.fn((request) => request.start.startsWith("2099-05")
      ? new Promise<any>((resolve) => { finish = resolve; }) : original(request));
    let loading!: Promise<boolean>;
    act(() => { loading = fixture.getSource().ensureCalendarRange({ start: "2099-05-01T00:00:00.000Z", end: "2099-06-01T00:00:00.000Z" }); });
    await waitFor(() => expect(finish).toBeTypeOf("function"));
    act(() => window.dispatchEvent(new Event("hcb:core-data-invalidated")));
    await act(async () => { finish?.(ok({ items: [{ id: "stale-event", title: "Old response", startsAt: "2099-05-02T08:00:00Z", endsAt: "2099-05-02T09:00:00Z" }], page: { limit: 500, totalKnown: 1 } })); });
    await expect(loading).resolves.toBe(false);
    expect(fixture.getSource().calendarEventsById["stale-event"]).toBeUndefined();
  });
});
