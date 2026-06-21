import { describe, expect, it } from "vitest";
import { LocalPlannerRepository } from "./localRepositories";
import { runLocalDataMigrations } from "./migrations";
import { createTemporarySqliteConnection, type SqliteConnection } from "./sqliteConnection";
import { GoogleSyncRepository } from "../sync/readSyncRepository";

const now = "2026-05-23T00:00:00.000Z";

function setupRepository(): { connection: SqliteConnection; cleanup: () => void; repository: LocalPlannerRepository; syncRepository: GoogleSyncRepository } {
  const temporary = createTemporarySqliteConnection("hcb-note-links-");
  runLocalDataMigrations(temporary.connection);
  const syncRepository = new GoogleSyncRepository(temporary.connection);
  syncRepository.writeTaskLists(
    "acct-1",
    [{ id: "inbox", title: "Inbox", updatedAt: now }],
    now
  );
  syncRepository.writeCalendarLists(
    "acct-1",
    [{
      id: "primary",
      summary: "Primary",
      timeZone: "UTC",
      isSelected: true,
      isHidden: false,
      isPrimary: true,
      updatedAt: now
    }],
    now
  );
  return {
    connection: temporary.connection,
    cleanup: temporary.cleanup,
    repository: new LocalPlannerRepository(temporary.connection),
    syncRepository
  };
}

describe("task-backed note links", () => {
  it("does not create deprecated local note tables on migrate", () => {
    const { connection, cleanup } = setupRepository();
    try {
      const names = connection
        .query<{ name: string }>(
          `SELECT name
           FROM sqlite_master
           WHERE name IN ('local_notes', 'local_notes_fts', 'local_note_links', 'local_note_properties', 'local_note_lists')
           ORDER BY name;`
        )
        .map((row) => row.name);

      expect(names).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it("resolves broken links from task-backed note bodies", () => {
    const { cleanup, repository } = setupRepository();
    try {
      repository.createNote({ title: "Target", body: "" });
      const sourceNote = repository.createNote({
        title: "Daily 2026-05-23",
        body: "See [[Target]] for context\n[[task:missing-task]]\n"
      });

      expect(repository.listBrokenNoteLinks({ noteId: sourceNote.id })).toEqual({
        items: [{
          link: expect.objectContaining({
            broken: true,
            linkType: "wikilink",
            raw: "task:missing-task",
            sourceId: sourceNote.id,
            sourceKind: "note",
            targetId: null,
            targetKind: "task",
            targetLabel: "missing-task"
          }),
          linkText: "task:missing-task"
        }]
      });

      repository.updateNote({ id: sourceNote.id, body: "See [[Missing note]]." });
      expect(repository.listBrokenNoteLinks({ noteId: sourceNote.id })).toEqual({
        items: [{
          link: expect.objectContaining({
            broken: true,
            linkType: "wikilink",
            raw: "Missing note",
            sourceId: sourceNote.id,
            sourceKind: "note",
            targetId: null,
            targetKind: "note",
            targetLabel: "Missing note"
          }),
          linkText: "Missing note"
        }]
      });
    } finally {
      cleanup();
    }
  });

  it("suggests note, task, and event link targets in ranked order", () => {
    const { cleanup, repository, syncRepository } = setupRepository();
    try {
      const note = repository.createNote({ title: "Project plan", body: "" });
      syncRepository.writeTasks(
        "acct-1",
        "inbox",
        [{
          id: "task-plan",
          taskListId: "inbox",
          title: "Project plan task",
          status: "needsAction",
          dueAt: "2026-05-23T00:00:00.000Z",
          deleted: false,
          hidden: false,
          updatedAt: now
        }],
        { fullSync: false, now }
      );
      syncRepository.writeCalendarEvents(
        "acct-1",
        "primary",
        [{
          id: "event-plan",
          calendarId: "primary",
          status: "confirmed",
          summary: "Project plan review",
          startAt: "2026-05-23T10:00:00.000Z",
          endAt: "2026-05-23T11:00:00.000Z",
          isAllDay: false,
          updatedAt: now
        }],
        { fullSync: false, now, defaultTimeZone: "UTC" }
      );

      expect(repository.suggestLinkTargets({ query: "plan", limit: 8 }).items).toEqual([
        { kind: "note", id: note.id, label: "Project plan" },
        { kind: "task", id: "acct-1:task:inbox:task-plan", label: "Project plan task" },
        { kind: "event", id: "acct-1:event:primary:event-plan", label: "Project plan review" }
      ]);
      expect(repository.suggestLinkTargets({ query: "plan", kinds: ["event"], limit: 8 }).items).toEqual([
        { kind: "event", id: "acct-1:event:primary:event-plan", label: "Project plan review" }
      ]);
    } finally {
      cleanup();
    }
  });

  it("indexes universal entity links, backlinks, broken links, and transclusions", () => {
    const { cleanup, repository, syncRepository } = setupRepository();
    try {
      const targetNote = repository.createNote({ title: "Target note", body: "embedded body" });
      syncRepository.writeTasks(
        "acct-1",
        "inbox",
        [{
          id: "task-graph",
          taskListId: "inbox",
          title: "Graph task",
          notes: "See [[note:Target note]], ![[note:Target note]], [[event:Project launch]], [[list:Inbox]], [[calendar:Primary]], [[task:Missing task]].",
          status: "needsAction",
          dueAt: "2026-05-24T00:00:00.000Z",
          deleted: false,
          hidden: false,
          updatedAt: now
        }],
        { fullSync: false, now }
      );
      syncRepository.writeCalendarEvents(
        "acct-1",
        "primary",
        [{
          id: "event-launch",
          calendarId: "primary",
          status: "confirmed",
          summary: "Project launch",
          description: "Back to [[task:Graph task]].",
          startAt: "2026-05-24T10:00:00.000Z",
          endAt: "2026-05-24T11:00:00.000Z",
          isAllDay: false,
          updatedAt: now
        }],
        { fullSync: false, now, defaultTimeZone: "UTC" }
      );

      const taskId = "acct-1:task:inbox:task-graph";
      const eventId = "acct-1:event:primary:event-launch";
      const taskLinks = repository.listEntityLinks({ entityKind: "task", entityId: taskId });

      expect(taskLinks.outgoing.map((link) => [link.targetKind, link.targetLabel, link.linkType, link.broken])).toEqual([
        ["note", "Target note", "transclusion", false],
        ["calendar", "Primary", "wikilink", false],
        ["event", "Project launch", "wikilink", false],
        ["list", "Inbox", "wikilink", false],
        ["note", "Target note", "wikilink", false],
        ["task", "Missing task", "wikilink", true]
      ]);
      expect(repository.listEntityLinks({ entityKind: "note", entityId: targetNote.id }).backlinks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ sourceKind: "task", sourceId: taskId, targetId: targetNote.id })
        ])
      );
      expect(repository.listEntityLinks({ entityKind: "event", entityId: eventId }).backlinks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ sourceKind: "task", sourceId: taskId, targetId: eventId })
        ])
      );
      expect(repository.listBrokenNoteLinks({ entityKind: "task", entityId: taskId })).toEqual({
        items: [
          expect.objectContaining({
            linkText: "task:Missing task",
            link: expect.objectContaining({ targetKind: "task", broken: true })
          })
        ]
      });
    } finally {
      cleanup();
    }
  });
});
