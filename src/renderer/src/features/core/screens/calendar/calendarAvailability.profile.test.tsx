import { CalendarNavigationProvider } from "../../../shell/CalendarNavigation";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ok } from "@shared/ipc/result";
import { InspectorProvider, InspectorShell } from "../../../../components/Inspector";
import {
  installHcb,
  seededHcb,
  testNativeCapabilities,
  testSettings
} from "../../../../test/appTestHelpers";
import { CoreDataProvider, useCoreViewModelSource } from "../../coreViewModelSource";

const timelineRenders = vi.hoisted(() => ({ day: vi.fn() }));

vi.mock("./CalendarTimelineView", () => ({
  DayView: () => {
    timelineRenders.day();
    return <div data-testid="day-calendar-grid" />;
  },
  MultiDayView: () => <div data-testid="multi-day-calendar-grid" />,
  WeekView: () => <div data-testid="week-calendar-grid" />
}));

import { CalendarView } from "./CalendarView";

function HydrationProbe() {
  const source = useCoreViewModelSource();
  return <output data-testid="hydration-status">{source.hydrationState}</output>;
}

describe("Share Availability title performance boundary", () => {
  it("does not rerender the Day calendar grid while its title draft changes", async () => {
    const api = seededHcb();
    api.sync.subscribeStatus = vi.fn(() => () => undefined);
    api.native = { capabilities: vi.fn(async () => ({ ok: true, data: testNativeCapabilities() })) } as never;
    api.diagnostics = {
      markCachedDataRendered: vi.fn(async () => ({ ok: true, data: { marked: true } })),
      recordTiming: vi.fn(async () => ({ ok: true, data: { recorded: true } }))
    } as never;
    api.settings.get = vi.fn(async () => ok(testSettings()));
    installHcb(api);

    render(
      <CoreDataProvider>
        <HydrationProbe />
        <InspectorProvider>
          <CalendarNavigationProvider paneId="default" timeZone="UTC"><CalendarView visibleCalendarIds={new Set(["cal-product"])} /></CalendarNavigationProvider>
          <InspectorShell />
        </InspectorProvider>
      </CoreDataProvider>
    );

    const day = await screen.findByRole("button", { name: "Calendar view" });
    fireEvent.keyDown(day, { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Day" }));
    await screen.findByTestId("day-calendar-grid");
    // Measure typing after startup hydration, which can independently update
    // the calendar even when the title editor is correctly isolated.
    await waitFor(() => expect(screen.getByTestId("hydration-status")).toHaveTextContent("success"));
    fireEvent.keyDown(screen.getByRole("button", { name: "Calendar tools" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Share availability" }));
    const title = await screen.findByRole("textbox", { name: "Availability title" });
    await waitFor(() => expect(api.calendar.listEvents).toHaveBeenCalled());
    // Viewport loads are debounced separately from startup hydration. Wait for
    // the current range to settle before attributing renders to title typing.
    await waitFor(() => expect(screen.getByTestId("calendar-view")).toHaveAttribute("aria-busy", "false"));

    timelineRenders.day.mockClear();
    fireEvent.change(title, { target: { value: "Fast availability title" } });

    await waitFor(() => expect(title).toHaveValue("Fast availability title"));
    expect(timelineRenders.day).not.toHaveBeenCalled();
  });
});
