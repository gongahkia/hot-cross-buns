import { describe, expect, it } from "vitest";
import { createTemporarySqliteConnection, type SqliteConnection } from "./sqliteConnection";
import { runLocalDataMigrations } from "./migrations";
import { LocalPlannerRepository } from "./localRepositories";
import { GoogleSyncRepository } from "../sync/readSyncRepository";

interface ColumnInfo extends Record<string, unknown> {
  name: string;
}

function setupRepository(): { connection: SqliteConnection; cleanup: () => void; repository: LocalPlannerRepository } {
  const temporary = createTemporarySqliteConnection("hcb2-note-links-");
  runLocalDataMigrations(temporary.connection);
  new GoogleSyncRepository(temporary.connection);
  const repository = new LocalPlannerRepository(temporary.connection);
  return { connection: temporary.connection, cleanup: temporary.cleanup, repository };
}

describe("note links + properties", () => {
  it("creates the link and property tables on migrate", () => {
    const { connection, cleanup } = setupRepository();
    try {
      const linkColumns = connection.query<ColumnInfo>("PRAGMA table_info(local_note_links);");
      const propColumns = connection.query<ColumnInfo>("PRAGMA table_info(local_note_properties);");
      expect(linkColumns.map((column) => column.name)).toEqual(
        expect.arrayContaining(["source_note_id", "target_kind", "target_id", "link_text", "is_broken"])
      );
      expect(propColumns.map((column) => column.name)).toEqual(
        expect.arrayContaining(["note_id", "property_key", "property_value"])
      );
    } finally {
      cleanup();
    }
  });

  it("indexes links and properties on note create and update", () => {
    const { connection, cleanup, repository } = setupRepository();
    try {
      const targetNote = repository.createNote({ title: "Target", body: "" });
      const sourceNote = repository.createNote({
        title: "Daily 2026-05-23",
        body: `status: open\ntags: daily\n\nSee [[Target]] for context\n[[task:abc-task]]\n`
      });

      const links = connection.query<{ target_kind: string; target_id: string | null; is_broken: number }>(
        "SELECT target_kind, target_id, is_broken FROM local_note_links WHERE source_note_id = ? ORDER BY id;",
        [sourceNote.id]
      );
      expect(links).toHaveLength(2);
      expect(links[0].target_kind).toBe("note");
      expect(links[0].target_id).toBe(targetNote.id);
      expect(links[0].is_broken).toBe(0);
      expect(links[1].target_kind).toBe("task");
      expect(links[1].target_id).toBeNull();
      expect(links[1].is_broken).toBe(1);

      const props = connection.query<{ property_key: string; property_value: string }>(
        "SELECT property_key, property_value FROM local_note_properties WHERE note_id = ? ORDER BY property_key;",
        [sourceNote.id]
      );
      expect(props).toEqual([
        { property_key: "status", property_value: "open" },
        { property_key: "tags", property_value: "daily" }
      ]);

      repository.updateNote({ id: sourceNote.id, body: "status: closed\n\nNothing else here.\n" });
      const refreshedLinks = connection.query<{ id: number }>(
        "SELECT id FROM local_note_links WHERE source_note_id = ?;",
        [sourceNote.id]
      );
      expect(refreshedLinks).toHaveLength(0);
      const refreshedProps = connection.query<{ property_key: string; property_value: string }>(
        "SELECT property_key, property_value FROM local_note_properties WHERE note_id = ?;",
        [sourceNote.id]
      );
      expect(refreshedProps).toEqual([{ property_key: "status", property_value: "closed" }]);
    } finally {
      cleanup();
    }
  });
});
