import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CommandPalette } from "@/components/CommandPalette";

const workspace = {
  identity: { subject: "person" },
  taskLists: [{ id: "inbox", title: "Inbox" }],
  tasks: [{ id: "task-1", listId: "inbox", title: "Prepare launch", notes: "Draft the announcement", status: "needsAction" as const }],
  calendars: [{ id: "primary", summary: "Primary" }],
  events: [{
    id: "event-1",
    calendarId: "primary",
    summary: "Launch planning",
    description: "Review the draft",
    start: { dateTime: "2026-08-16T09:00:00.000Z" },
    end: { dateTime: "2026-08-16T10:00:00.000Z" }
  }],
  updatedAt: "2026-08-16T00:00:00.000Z"
};

describe("CommandPalette", () => {
  it("opens a title-first local result with the keyboard", async () => {
    const user = userEvent.setup();
    const close = vi.fn();
    const run = vi.fn();
    render(<CommandPalette open workspace={workspace} busy={false} close={close} run={run} />);

    await user.type(screen.getByRole("textbox", { name: "Search cached work and commands" }), "prepare");
    expect(screen.getByRole("button", { name: /Prepare launch/ })).toBeVisible();
    await user.keyboard("{Enter}");

    expect(close).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      type: "open-task",
      task: expect.objectContaining({ id: "task-1" })
    }));
  });

  it("keeps body-text search explicit", async () => {
    const user = userEvent.setup();
    render(<CommandPalette open workspace={workspace} busy={false} close={vi.fn()} run={vi.fn()} />);

    await user.type(screen.getByRole("textbox", { name: "Search cached work and commands" }), "announcement");
    expect(screen.queryByRole("button", { name: /Prepare launch/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Search notes and descriptions/ }));
    expect(screen.getByRole("button", { name: /Prepare launch/ })).toBeVisible();
  });

  it("closes with Escape", async () => {
    const user = userEvent.setup();
    const close = vi.fn();
    render(<CommandPalette open workspace={workspace} busy={false} close={close} run={vi.fn()} />);

    await user.keyboard("{Escape}");

    expect(close).toHaveBeenCalledOnce();
  });
});
