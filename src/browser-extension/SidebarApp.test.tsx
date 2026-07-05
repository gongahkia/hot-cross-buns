// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarApp, groupResults } from "./SidebarApp";
import { sendExtensionMessage } from "./extensionApi";
import type { SearchResult } from "./types";

vi.mock("./extensionApi", () => ({
  openOptionsPage: vi.fn(),
  sendExtensionMessage: vi.fn()
}));

const results: SearchResult[] = [
  {
    id: "today-task",
    kind: "task",
    title: "Today task",
    subtitle: "Inbox",
    dueAt: "2026-07-05T00:00:00.000Z",
    sourceUrl: "https://tasks.google.com/",
    score: 10
  },
  {
    id: "future-event",
    kind: "event",
    title: "Future event",
    subtitle: "Work",
    startsAt: "2026-07-06T02:00:00.000Z",
    sourceUrl: "https://calendar.google.com/event?eid=1",
    score: 9
  },
  {
    id: "old-task",
    kind: "task",
    title: "Old task",
    subtitle: "Inbox",
    dueAt: "2026-07-04T00:00:00.000Z",
    sourceUrl: "https://tasks.google.com/",
    score: 8
  },
  {
    id: "floating-task",
    kind: "task",
    title: "Floating task",
    subtitle: "Inbox",
    sourceUrl: "https://tasks.google.com/",
    score: 7
  }
];

describe("browser extension sidebar", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    vi.spyOn(window, "open").mockImplementation(() => null);
    vi.mocked(sendExtensionMessage).mockImplementation(async (message: unknown) => {
      const type = (message as { type: string }).type;

      switch (type) {
        case "auth.status":
          return {
            configured: true,
            signedIn: true,
            redirectUri: "https://extension.test/google",
            accountEmail: "person@example.com"
          };
        case "cache.summary":
          return {
            fetchedAt: "2026-07-05T00:00:00.000Z",
            taskCount: 3,
            eventCount: 1,
            accountEmail: "person@example.com"
          };
        case "data.search":
          return results;
        case "data.refresh":
          return {
            fetchedAt: "2026-07-05T00:00:00.000Z",
            windowStart: "2026-06-05T00:00:00.000Z",
            windowEnd: "2027-01-01T00:00:00.000Z",
            accountEmail: "person@example.com",
            taskLists: [],
            calendars: [],
            tasks: [{ id: "task" }],
            events: [{ id: "event" }]
          };
        default:
          throw new Error(`Unhandled message ${type}`);
      }
    });
  });

  it("groups results by date bucket", async () => {
    render(<SidebarApp />);

    await screen.findByText("Today task");
    expect(screen.getByRole("heading", { name: "Today" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Upcoming" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Later" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "No date" })).toBeInTheDocument();
  });

  it("moves active result with arrow keys and opens it with Enter", async () => {
    const user = userEvent.setup();
    render(<SidebarApp />);

    await screen.findByText("Today task");
    await user.keyboard("{ArrowDown}{Enter}");

    expect(window.open).toHaveBeenCalledWith("https://calendar.google.com/event?eid=1", "_blank", "noreferrer");
  });

  it("focuses search with slash and clears it with Escape", async () => {
    const user = userEvent.setup();
    render(<SidebarApp />);

    await screen.findByText("Today task");
    await user.keyboard("/");
    const search = screen.getByRole("textbox", { name: "Search tasks and events" });
    expect(search).toHaveFocus();

    await user.type(search, "calendar");
    expect(search).toHaveValue("calendar");
    await user.keyboard("{Escape}");
    expect(search).toHaveValue("");
  });

  it("refreshes with r when not typing", async () => {
    const user = userEvent.setup();
    render(<SidebarApp />);

    await screen.findByText("Today task");
    await user.keyboard("r");

    await waitFor(() => {
      expect(vi.mocked(sendExtensionMessage)).toHaveBeenCalledWith({ type: "data.refresh" });
    });
  });

  it("marks the active result for assistive tech", async () => {
    const user = userEvent.setup();
    render(<SidebarApp />);

    await screen.findByText("Today task");
    await user.keyboard("{ArrowDown}");

    const listbox = screen.getByRole("listbox", { name: "Results" });
    const active = within(listbox).getByRole("option", { selected: true });
    expect(active).toHaveTextContent("Future event");
  });
});

describe("groupResults", () => {
  it("uses stable buckets from the supplied date", () => {
    expect(groupResults(results, new Date("2026-07-05T12:00:00.000Z")).map((group) => group.name))
      .toEqual(["Today", "Upcoming", "Later", "No date"]);
  });
});
