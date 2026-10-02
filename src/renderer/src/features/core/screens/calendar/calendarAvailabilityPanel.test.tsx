import { useRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { installHcb, seededHcb } from "../../../../test/appTestHelpers";
import { ShareAvailabilityPanel } from "./CalendarSidebar";
import { calendarTimeBlockLabel } from "./calendarGrid";
import type { CalendarTimeBlock } from "./types";

const slots: CalendarTimeBlock[] = [{
  dayKey: "2026-10-02",
  endsAt: "2026-10-02T09:00:00.000Z",
  id: "availability-slot",
  startsAt: "2026-10-02T05:00:00.000Z"
}];

function AvailabilityPanelHost({ onRender }: { onRender: () => void }): JSX.Element {
  onRender();
  const titleRef = useRef("Meeting");

  return (
    <ShareAvailabilityPanel
      calendarId="calendar-primary"
      calendars={[{
        backgroundColor: "#34a853",
        eventCount: 0,
        foregroundColor: "#ffffff",
        id: "calendar-primary",
        selected: true,
        timeZone: "Asia/Singapore",
        title: "Personal",
        updatedAt: "2026-10-02T00:00:00.000Z"
      }]}
      durationMinutes={30}
      endDate="2026-10-02"
      exportBusyBlockCount={null}
      exportPending={false}
      exportText=""
      initialTitle="Meeting"
      onCalendarChange={() => undefined}
      onClose={() => undefined}
      onCreateHolds={() => undefined}
      onDurationChange={() => undefined}
      onEndDateChange={() => undefined}
      onExportAvailability={() => undefined}
      onRemoveSlot={() => undefined}
      onStartDateChange={() => undefined}
      onTitleChange={(title) => {
        titleRef.current = title;
      }}
      pending={false}
      slots={slots}
      startDate="2026-10-02"
      timeZone="Asia/Singapore"
    />
  );
}

describe("Share Availability title draft", () => {
  it("keeps rapid title typing local to the panel without invoking persistence or its parent surface", () => {
    const api = seededHcb();
    const create = vi.fn();
    const exportAvailability = vi.fn();
    const freeBusy = vi.fn();
    const listEvents = vi.fn();
    api.calendar = { ...api.calendar, create, exportAvailability, freeBusy, listEvents } as never;
    installHcb(api);
    const hostRender = vi.fn();

    render(<AvailabilityPanelHost onRender={hostRender} />);
    const title = screen.getByRole("textbox", { name: "Availability title" });
    expect(screen.getByText("1 selected")).toBeTruthy();
    expect(screen.getByText(calendarTimeBlockLabel(slots[0]!, "Asia/Singapore"))).toBeTruthy();
    expect(screen.queryByText(calendarTimeBlockLabel(slots[0]!, "UTC"))).toBeNull();

    hostRender.mockClear();
    fireEvent.change(title, { target: { value: "Pairing" } });
    fireEvent.change(title, { target: { value: "Pairing review" } });

    expect(title).toHaveValue("Pairing review");
    expect(screen.getByText((_content, element) =>
      element?.tagName === "PRE" && element.textContent?.startsWith("Pairing review\n") === true
    )).toBeTruthy();
    expect(hostRender).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(exportAvailability).not.toHaveBeenCalled();
    expect(freeBusy).not.toHaveBeenCalled();
    expect(listEvents).not.toHaveBeenCalled();
  });
});
