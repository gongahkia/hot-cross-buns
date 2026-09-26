import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CoreViewModelSource } from "../features/core/coreViewModelSource";
import { QuickAddDialog, type QuickAddSubmitPayload } from "./QuickAddDialog";

const source = {
  calendarSources: [{ id: "calendar-primary", title: "Primary" }],
  taskLists: [{ id: "tasks-inbox", title: "Inbox" }],
  noteLists: [{ id: "notes", title: "Notes" }],
  settings: { eventTemplates: [], taskTemplates: [] }
} as unknown as CoreViewModelSource;

describe("QuickAddDialog", () => {
  it("previews and hands a zoned event with email guests to the full editor", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<(payload: QuickAddSubmitPayload) => void>();

    render(<QuickAddDialog onClose={vi.fn()} onSubmit={onSubmit} open source={source} />);

    await user.type(
      screen.getByRole("textbox", { name: "Quick add text" }),
      "Launch at 13:00 tz Asia/Singapore with jane@example.com and Jay@example.com"
    );

    expect(screen.getByText("TZ Asia/Singapore")).toBeInTheDocument();
    expect(screen.getByText("2 guests")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0]?.[0];

    expect(payload).toMatchObject({
      mode: "event",
      title: "Launch",
      calendarId: "calendar-primary",
      guestEmails: ["jane@example.com", "jay@example.com"],
      timeZone: "Asia/Singapore"
    });

    if (!payload || payload.mode === "task" || payload.mode === "note") {
      throw new Error("Expected a Quick Add event payload.");
    }

    const formatter = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      hourCycle: "h23",
      minute: "2-digit",
      timeZone: payload.timeZone
    });

    expect(formatter.format(new Date(payload.startsAt))).toBe("13:00");
    expect(formatter.format(new Date(payload.endsAt))).toBe("14:00");
  });
});
