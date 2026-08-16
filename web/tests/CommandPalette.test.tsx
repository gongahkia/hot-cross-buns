import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CommandPalette } from "@/components/CommandPalette";
import { calendarSearchDocument } from "@/features/calendarSearch";

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

  it("exposes the full Google Tasks refresh command", async () => {
    const user = userEvent.setup();
    const close = vi.fn();
    const run = vi.fn();
    render(<CommandPalette open workspace={workspace} busy={false} close={close} run={run} />);

    await user.type(screen.getByRole("textbox", { name: "Search cached work and commands" }), "refresh all tasks");
    await user.keyboard("{Enter}");

    expect(close).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith({ type: "refresh-tasks" });
  });

  it("finds a historic canonical event that is not in the visible calendar range", async () => {
    const user = userEvent.setup();
    const close = vi.fn();
    const run = vi.fn();
    const historic = calendarSearchDocument({
      id: "historic-event",
      calendarId: "primary",
      summary: "Historic launch review",
      start: { dateTime: "2021-03-12T09:00:00.000Z" },
      end: { dateTime: "2021-03-12T10:00:00.000Z" }
    });
    render(
      <CommandPalette
        open
        workspace={workspace}
        busy={false}
        calendarHistory={{ status: "ready", documents: historic ? [historic] : [] }}
        close={close}
        run={run}
      />
    );

    await user.type(screen.getByRole("textbox", { name: "Search cached work and commands" }), "historic");
    await user.click(await screen.findByRole("button", { name: /Historic launch review/ }));

    expect(close).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      type: "open-event",
      event: expect.objectContaining({ id: "historic-event", calendarId: "primary" })
    }));
  });

  it("filters task results by due day and completion state while showing result context", async () => {
    const user = userEvent.setup();
    const filteredWorkspace = {
      ...workspace,
      tasks: [
        { id: "open-due", listId: "inbox", title: "Prepare launch", status: "needsAction" as const, due: "2026-08-20T00:00:00.000Z" },
        { id: "completed-due", listId: "inbox", title: "Prepare archive", status: "completed" as const, due: "2026-08-20T00:00:00.000Z" }
      ]
    };
    render(<CommandPalette open workspace={filteredWorkspace} busy={false} close={vi.fn()} run={vi.fn()} />);

    await user.type(screen.getByRole("textbox", { name: "Search cached work and commands" }), "type:task due:2026-08-20 completed:false");

    expect(screen.getByRole("button", { name: /Prepare launch.*Inbox.*Due.*Open/ })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Prepare archive/ })).not.toBeInTheDocument();
  });

  it("combines canonical event date filters with locally cached Drive metadata", async () => {
    const user = userEvent.setup();
    const run = vi.fn();
    const historic = calendarSearchDocument({
      id: "historic-event",
      calendarId: "primary",
      summary: "Historic launch review",
      start: { dateTime: "2021-03-12T09:00:00.000Z" },
      end: { dateTime: "2021-03-12T10:00:00.000Z" }
    });
    render(
      <CommandPalette
        open
        workspace={workspace}
        busy={false}
        calendarHistory={{ status: "ready", documents: historic ? [historic] : [] }}
        driveHistory={{ status: "ready", files: [{ id: "brief", name: "Launch brief", mimeType: "application/vnd.google-apps.document", webViewLink: "https://drive.example.test/brief" }] }}
        close={vi.fn()}
        run={run}
      />
    );

    const input = screen.getByRole("textbox", { name: "Search cached work and commands" });
    await user.type(input, "type:event date:2021-03-12 historic");
    expect(await screen.findByRole("button", { name: /Historic launch review.*Primary.*3\/12\/2021/ })).toBeVisible();

    await user.clear(input);
    await user.type(input, "type:drive brief");
    await user.click(screen.getByRole("button", { name: /Launch brief.*Google Doc.*Open in Drive/ }));
    expect(run).toHaveBeenLastCalledWith(expect.objectContaining({
      type: "open-drive-file",
      file: expect.objectContaining({ id: "brief" })
    }));
  });
});
