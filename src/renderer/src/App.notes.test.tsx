import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ok } from "@shared/ipc/result";
import App from "./App";
import {
  goToSection,
  installHcb,
  now,
  seededHcb
} from "./test/appTestHelpers";

describe("App notes", () => {
  it("creates, edits, and deletes local notes through preload", async () => {
    const api = seededHcb();
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Notes");
    expect(screen.getByRole("checkbox", { name: "All notes" })).toHaveAttribute("aria-checked", "true");
    const starredToggle = screen.getByRole("checkbox", { name: "Starred" });
    expect(starredToggle).toHaveAttribute("aria-checked", "false");
    await user.click(starredToggle);
    expect(starredToggle).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("heading", { name: "Starred notes" })).toBeInTheDocument();
    await user.click(starredToggle);
    expect(await screen.findByText("Cache-first startup")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /New note/ }));
    const titleInput = await screen.findByRole("textbox", { name: "Note title" });
    const bodyInput = screen.getByRole("textbox", { name: "Note body" });

    await user.clear(titleInput);
    await user.type(titleInput, "Release note draft");
    await user.type(bodyInput, "Document local cache flow.");

    await waitFor(() => {
      expect(api.notes.create).toHaveBeenCalled();
      expect(api.notes.update).toHaveBeenCalledWith({
        id: "note-created",
        title: "Release note draft",
        body: "Document local cache flow."
      });
    });

    await user.click(screen.getByRole("button", { name: "Delete selected note" }));
    expect(api.notes.delete).toHaveBeenCalledWith({ id: "note-created" });

    await user.click(screen.getByRole("button", { name: "Delete selected note" }));
    expect(api.notes.delete).toHaveBeenCalledWith({ id: "note-cache-first" });
    expect(screen.getByText("No local notes")).toBeInTheDocument();
  });

  it("opens selected notes in the inspector and flushes pending edits on close", async () => {
    const api = seededHcb();
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Notes");
    await user.click(await screen.findByText("Cache-first startup"));

    const inspector = await screen.findByTestId("inspector-shell");
    expect(inspector).toHaveAttribute("data-inspector-kind", "note");
    const inspectorBody = within(inspector).getByTestId("inspector-body");
    expect(within(inspectorBody).getByRole("heading", { name: "Cache-first startup" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Note body" })).not.toBeInTheDocument();

    await user.click(
      within(screen.getByTestId("inspector-actions")).getByRole("button", { name: "Edit" })
    );
    const bodyInput = await screen.findByRole("textbox", { name: "Note body" });
    await user.type(bodyInput, " Pending close flush.");
    await user.click(screen.getByTestId("inspector-close"));

    await waitFor(() => {
      expect(api.notes.update).toHaveBeenCalledWith({
        id: "note-cache-first",
        title: "Cache-first startup",
        body: expect.stringContaining("Pending close flush.")
      });
    });
    expect(screen.queryByTestId("inspector-shell")).not.toBeInTheDocument();
  });

  it("flushes pending note edits before switching the selected note row", async () => {
    const api = seededHcb();
    api.notes.list = vi.fn(async () =>
      ok({
        items: [
          {
            id: "note-cache-first",
            title: "Cache-first startup",
            preview: "Renderer paints from SQLite.",
            updatedAt: now
          },
          {
            id: "note-daily",
            title: "Daily note",
            preview: "Backlink review.",
            updatedAt: now
          }
        ],
        page: { limit: 50, totalKnown: 2 }
      })
    );
    api.notes.get = vi.fn(async ({ id }) =>
      ok(
        id === "note-daily"
          ? {
              id,
              title: "Daily note",
              preview: "Backlink review.",
              body: "Review backlinks.",
              updatedAt: now
            }
          : {
              id,
              title: "Cache-first startup",
              preview: "Renderer paints from SQLite.",
              body: "Renderer paints from SQLite before fresh sync completes.",
              updatedAt: now
            }
      )
    );
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Notes");
    await user.click(await screen.findByText("Cache-first startup"));
    await user.click(
      within(screen.getByTestId("inspector-actions")).getByRole("button", { name: "Edit" })
    );
    await user.type(await screen.findByRole("textbox", { name: "Note body" }), " Switch flush.");
    const notesList = screen.getByRole("list", { name: "Local notes" });
    await user.click(within(notesList).getByRole("button", { name: "Open note Daily note" }));

    await waitFor(() => {
      expect(api.notes.update).toHaveBeenCalledWith({
        id: "note-cache-first",
        title: "Cache-first startup",
        body: expect.stringContaining("Switch flush.")
      });
    });
    const inspector = await screen.findByTestId("inspector-shell");
    const inspectorBody = within(inspector).getByTestId("inspector-body");
    expect(within(inspectorBody).getByRole("heading", { name: "Daily note" })).toBeInTheDocument();
  });

  it("renders note markdown preview, outgoing links, and backlinks", async () => {
    const api = seededHcb();
    api.notes.list = vi.fn(async () =>
      ok({
        items: [
          {
            id: "note-project",
            title: "Project plan",
            preview: "See [[Daily note]]",
            updatedAt: now
          },
          {
            id: "note-daily",
            title: "Daily note",
            preview: "Back to [[Project plan]]",
            updatedAt: now
          }
        ],
        page: { limit: 50, totalKnown: 2 }
      })
    );
    api.notes.get = vi.fn(async ({ id }) =>
      ok(
        id === "note-daily"
          ? {
              id,
              title: "Daily note",
              preview: "Back to [[Project plan]]",
              body: "Back to [[Project plan]]",
              updatedAt: now
            }
          : {
              id,
              title: "Project plan",
              preview: "See [[Daily note]]",
              body: "# Plan\n- [x] Kickoff\nSee [[Daily note]]",
              updatedAt: now
            }
      )
    );
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Notes");
    await user.click(await screen.findByText("Project plan"));

    const preview = await screen.findByRole("region", { name: "Note preview" });
    expect(within(preview).getByText("Plan")).toBeInTheDocument();
    expect(within(preview).getByRole("checkbox")).toBeChecked();
    expect(preview).toHaveTextContent("Kickoff");
    expect(preview).toHaveTextContent("See [[Daily note]]");
    const dailyLink = screen.getByRole("button", { name: "Open linked note Daily note" });

    dailyLink.focus();
    await user.keyboard("{Enter}");
    const inspector = await screen.findByTestId("inspector-shell");
    const inspectorBody = within(inspector).getByTestId("inspector-body");
    expect(within(inspectorBody).getByRole("heading", { name: "Daily note" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Open backlink Project plan" })).toBeInTheDocument();
  });

  it("inserts planner links and creates templated notes", async () => {
    const api = seededHcb();
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Notes");
    await user.click(await screen.findByText("Cache-first startup"));
    await user.click(
      within(screen.getByTestId("inspector-actions")).getByRole("button", { name: "Edit" })
    );
    const bodyInput = await screen.findByRole("textbox", { name: "Note body" });

    await user.type(screen.getByRole("combobox", { name: "Planner link target" }), "triage");
    await user.click(await screen.findByRole("option", { name: /Draft inbox triage rules/ }));
    expect((bodyInput as HTMLTextAreaElement).value).toContain("[[task:Draft inbox triage rules]]");

    await user.click(screen.getByRole("tab", { name: "Preview" }));
    expect(screen.getAllByText("task: Draft inbox triage rules").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Daily note" }));
    await waitFor(() => {
      expect(api.notes.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringMatching(/^Daily \d{4}-\d{2}-\d{2}$/),
          body: expect.stringContaining("tags: daily")
        })
      );
    });
    expect(await screen.findByText("tags: daily")).toBeInTheDocument();
  });

  it("supports keyboard selection in the note link autocomplete", async () => {
    const api = seededHcb();
    api.notes.linkSuggest = vi.fn(async () =>
      ok({
        items: [
          { kind: "note" as const, id: "note-project", label: "Project plan" },
          { kind: "task" as const, id: "task-plan", label: "Project plan task" },
          { kind: "event" as const, id: "event-plan", label: "Project plan review" }
        ]
      })
    );
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Notes");
    await user.click(await screen.findByText("Cache-first startup"));
    await user.click(
      within(screen.getByTestId("inspector-actions")).getByRole("button", { name: "Edit" })
    );
    const bodyInput = await screen.findByRole("textbox", { name: "Note body" });
    const linkInput = screen.getByRole("combobox", { name: "Planner link target" });

    await user.type(linkInput, "plan");
    expect(await screen.findByRole("option", { name: /Project plan task/ })).toBeInTheDocument();
    await user.keyboard("{ArrowDown}{Enter}");

    expect(api.notes.linkSuggest).toHaveBeenCalledWith({ query: "plan", limit: 8 });
    expect((bodyInput as HTMLTextAreaElement).value).toContain("[[task:Project plan task]]");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("repairs broken note links from the note inspector", async () => {
    const api = seededHcb();
    api.notes.get = vi.fn(async ({ id }) =>
      ok({
        id,
        title: "Cache-first startup",
        preview: "See [[Missing note]]",
        body: "See [[Missing note]]",
        updatedAt: now
      })
    );
    api.notes.listBrokenLinks = vi.fn(async () => ok({ items: [{ linkText: "Missing note" }] }));
    api.notes.linkSuggest = vi.fn(async (request) =>
      ok({
        items: request.query.toLowerCase().includes("replacement")
          ? [{ kind: "note" as const, id: "note-replacement", label: "Replacement note" }]
          : []
      })
    );
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Notes");
    await user.click(await screen.findByText("Cache-first startup"));
    await user.click(
      within(screen.getByTestId("inspector-actions")).getByRole("button", { name: "Edit" })
    );
    const bodyInput = await screen.findByRole("textbox", { name: "Note body" });

    await user.click(await screen.findByRole("button", { name: "Fix link Missing note" }));
    const linkInput = screen.getByRole("combobox", { name: "Planner link target" });
    await user.clear(linkInput);
    await user.type(linkInput, "replacement");
    await user.click(await screen.findByRole("option", { name: /Replacement note/ }));

    expect((bodyInput as HTMLTextAreaElement).value).toContain("[[note:Replacement note]]");
    expect((bodyInput as HTMLTextAreaElement).value).not.toContain("[[Missing note]]");
  });
});
