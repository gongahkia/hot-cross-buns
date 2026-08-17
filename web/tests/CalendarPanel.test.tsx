import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CalendarPanel } from "@/components/CalendarPanel";

function panel(overrides: Partial<React.ComponentProps<typeof CalendarPanel>> = {}): React.JSX.Element {
  return (
    <CalendarPanel
      calendars={[{ id: "primary", summary: "Primary", primary: true, backgroundColor: "#ff0000" }]}
      events={[]}
      search=""
      driveAuthorized={false}
      eventConflict={undefined}
      createCalendar={vi.fn().mockResolvedValue(undefined)}
      subscribeCalendar={vi.fn().mockResolvedValue(undefined)}
      removeCalendarFromList={vi.fn().mockResolvedValue(undefined)}
      queryAvailability={vi.fn().mockResolvedValue({ timeMin: "2026-08-16T09:00:00.000Z", timeMax: "2026-08-16T10:00:00.000Z", calendars: {} })}
      createEvent={vi.fn().mockResolvedValue(undefined)}
      updateEvent={vi.fn().mockResolvedValue("updated")}
      deleteEvent={vi.fn().mockResolvedValue("deleted")}
      getEvent={vi.fn()}
      respondToEvent={vi.fn().mockResolvedValue({
        id: "event-1",
        calendarId: "primary",
        summary: "Updated invitation",
        start: { dateTime: "2026-08-16T09:00:00.000Z" },
        end: { dateTime: "2026-08-16T10:00:00.000Z" }
      })}
      loadCalendarRange={vi.fn().mockResolvedValue(undefined)}
      resolveEventConflict={vi.fn().mockResolvedValue(undefined)}
      dismissEventConflict={vi.fn()}
      authorizeDrive={vi.fn().mockResolvedValue(undefined)}
      searchDrive={vi.fn().mockResolvedValue([])}
      {...overrides}
    />
  );
}

describe("CalendarPanel", () => {
  it("creates all-day recurring events with date-only Google fields", async () => {
    const user = userEvent.setup();
    const createEvent = vi.fn().mockResolvedValue(undefined);
    render(panel({ createEvent }));

    await user.click(screen.getByRole("button", { name: "New event" }));
    await user.type(screen.getByLabelText("Title"), "Weekly planning");
    await user.click(screen.getByLabelText("All-day event"));
    await user.clear(screen.getByLabelText("Starts"));
    await user.type(screen.getByLabelText("Starts"), "2026-08-16");
    await user.clear(screen.getByLabelText("Ends on"));
    await user.type(screen.getByLabelText("Ends on"), "2026-08-17");
    await user.selectOptions(screen.getByLabelText("Schedule"), "weekly");
    await user.click(screen.getByLabelText("Mon"));
    await user.click(screen.getByRole("button", { name: "Create event" }));

    expect(createEvent).toHaveBeenCalledWith("primary", expect.objectContaining({
      summary: "Weekly planning",
      start: { date: "2026-08-16" },
      end: { date: "2026-08-18" },
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"]
    }));
  });

  it("explains Calendar conflicts in plain language", async () => {
    const user = userEvent.setup();
    const resolveEventConflict = vi.fn().mockResolvedValue(undefined);
    render(panel({
      eventConflict: {
        kind: "update",
        latest: {
          id: "event-1",
          calendarId: "primary",
          summary: "Changed planning",
          start: { dateTime: "2026-08-16T09:00:00.000Z" },
          end: { dateTime: "2026-08-16T10:00:00.000Z" }
        },
        localInput: {
          summary: "My planning",
          start: { dateTime: "2026-08-16T09:00:00.000Z" },
          end: { dateTime: "2026-08-16T10:00:00.000Z" }
        }
      },
      resolveEventConflict
    }));

    expect(screen.getByText("This event changed in Google")).toBeVisible();
    expect(screen.getByText(/Use your changes to update Google/i)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Use my changes" }));
    expect(resolveEventConflict).toHaveBeenCalledWith("keep-local");
  });

  it("opens a canonical historic result and anchors Calendar on its date", async () => {
    render(panel({
      command: {
        id: "open-historic-event",
        type: "open-event",
        event: {
          id: "historic-event",
          calendarId: "primary",
          summary: "Historic launch review",
          start: { dateTime: "2021-03-12T09:00:00.000Z" },
          end: { dateTime: "2021-03-12T10:00:00.000Z" }
        }
      }
    }));

    expect(await screen.findByRole("heading", { name: "Historic launch review" })).toBeVisible();
    await userEvent.setup().click(screen.getByRole("button", { name: "Edit event" }));
    expect(await screen.findByRole("heading", { name: "Edit event" })).toBeVisible();
    expect(screen.getByLabelText("Title")).toHaveValue("Historic launch review");
    expect(screen.getByRole("button", { name: "Day" })).toHaveClass("active");
  });
});
