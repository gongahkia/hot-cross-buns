import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ok } from "@shared/ipc/result";
import { InspectorProvider, InspectorShell } from "../../../../components/Inspector";
import {
  installHcb,
  seededHcb,
  testNativeCapabilities,
  testSettings
} from "../../../../test/appTestHelpers";
import { CoreDataProvider } from "../../coreViewModelSource";

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
        <InspectorProvider>
          <CalendarView visibleCalendarIds={new Set(["cal-product"])} />
          <InspectorShell />
        </InspectorProvider>
      </CoreDataProvider>
    );

    const day = await screen.findByRole("tab", { name: "Day" });
    fireEvent.click(day);
    await screen.findByTestId("day-calendar-grid");
    fireEvent.click(screen.getByRole("button", { name: "Share availability" }));
    const title = await screen.findByRole("textbox", { name: "Availability title" });
    await waitFor(() => expect(api.calendar.listEvents).toHaveBeenCalled());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    timelineRenders.day.mockClear();
    fireEvent.change(title, { target: { value: "Fast availability title" } });

    await waitFor(() => expect(title).toHaveValue("Fast availability title"));
    expect(timelineRenders.day).not.toHaveBeenCalled();
  });
});
