import { randomUUID } from "node:crypto";
import type {
  NoteBrokenLinksRequest,
  NoteBrokenLinksResponse,
  NoteCreateRequest,
  NoteDeleteRequest,
  NoteDetail,
  NoteLinkSuggestRequest,
  NoteLinkSuggestResponse,
  NoteListRequest,
  NoteListResponse,
  NoteUpdateRequest
} from "@shared/ipc/contracts";
import type { SqliteWriteOperation } from "../sqliteConnection";
import { noteDetail, noteListSummary, noteSummary } from "./mappers";
import { extractNoteProperties, extractPlannerLinks, type PlannerLinkReference } from "./noteLinks";
import {
  countRows,
  notFound,
  pageBounds,
  pageFromRows
} from "./shared";
import { ScheduledTaskBlockLocalRepository } from "./scheduledTaskBlockRepository";
import type { NoteListRow, NoteRow } from "./types";

const defaultNoteListId = "note-list:default";

export class NoteLocalRepository extends ScheduledTaskBlockLocalRepository {
  listNotes(request: NoteListRequest): NoteListResponse {
    return this.measureSqlite("notes.list", () => {
      const { limit, offset } = pageBounds(request.cursor, request.limit, 50, 100);
      const rows = this.connection.query<NoteRow>(
        `SELECT notes.id,
                COALESCE(notes.list_id, ?) AS listId,
                COALESCE(lists.title, 'Local notes') AS listTitle,
                notes.title,
                notes.body,
                notes.created_at AS createdAt,
                notes.updated_at AS updatedAt
         FROM local_notes notes
         LEFT JOIN local_note_lists lists ON lists.id = notes.list_id AND lists.deleted_at IS NULL
         WHERE notes.deleted_at IS NULL
         ORDER BY notes.updated_at DESC, notes.id ASC
         LIMIT ? OFFSET ?;`,
        [defaultNoteListId, limit, offset]
      );
      const totalKnown = countRows(
        this.connection,
        "SELECT COUNT(*) AS count FROM local_notes WHERE deleted_at IS NULL;"
      );

      return {
        ...pageFromRows(rows.map(noteSummary), limit, offset, totalKnown),
        lists: this.listNoteLists()
      };
    });
  }

  getNote(id: string): NoteDetail {
    return this.measureSqlite("notes.get", () => {
      const row = this.connection.get<NoteRow>(
        `SELECT notes.id,
                COALESCE(notes.list_id, ?) AS listId,
                COALESCE(lists.title, 'Local notes') AS listTitle,
                notes.title,
                notes.body,
                notes.created_at AS createdAt,
                notes.updated_at AS updatedAt
         FROM local_notes notes
         LEFT JOIN local_note_lists lists ON lists.id = notes.list_id AND lists.deleted_at IS NULL
         WHERE notes.id = ? AND notes.deleted_at IS NULL
         LIMIT 1;`,
        [defaultNoteListId, id]
      );

      if (!row) {
        throw notFound("Note was not found.");
      }

      return noteDetail(row);
    });
  }

  createNote(request: NoteCreateRequest): NoteDetail {
    return this.measureSqlite("notes.create", () => {
      const now = new Date().toISOString();
      const id = `note:${randomUUID()}`;
      const body = request.body ?? "";
      const listId = this.noteListIdOrDefault(request.listId);

      this.connection.run(
        `INSERT INTO local_notes (id, list_id, title, body, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?);`,
        [id, listId, request.title.trim(), body, now, now]
      );

      this.reindexNoteLinksAndProperties(id, body, now);
      this.recordHistory({
        kind: "note.create",
        resourceId: id,
        summary: "Created note",
        metadata: { queued: false }
      });

      return this.getNote(id);
    });
  }

  updateNote(request: NoteUpdateRequest): NoteDetail {
    return this.measureSqlite("notes.update", () => {
      const existing = this.getNote(request.id);
      const now = new Date().toISOString();
      const nextBody = request.body ?? existing.body;
      const nextListId = request.listId ? this.noteListIdOrDefault(request.listId) : existing.listId;

      this.connection.run(
        `UPDATE local_notes
         SET list_id = ?, title = ?, body = ?, updated_at = ?
         WHERE id = ? AND deleted_at IS NULL;`,
        [
          nextListId,
          request.title?.trim() ?? existing.title,
          nextBody,
          now,
          request.id
        ]
      );

      this.reindexNoteLinksAndProperties(request.id, nextBody, now);
      this.recordHistory({
        kind: "note.edit",
        resourceId: request.id,
        summary: "Edited note",
        metadata: { queued: false }
      });

      return this.getNote(request.id);
    });
  }

  private listNoteLists(): NoteListResponse["lists"] {
    const rows = this.connection.query<NoteListRow>(
      `SELECT lists.id,
              lists.title,
              lists.updated_at AS updatedAt,
              COUNT(notes.id) AS noteCount
       FROM local_note_lists lists
       LEFT JOIN local_notes notes ON notes.list_id = lists.id AND notes.deleted_at IS NULL
       WHERE lists.deleted_at IS NULL
       GROUP BY lists.id, lists.title, lists.updated_at
       ORDER BY lists.updated_at DESC, lists.id ASC;`
    );

    return rows.map(noteListSummary);
  }

  private noteListIdOrDefault(listId: string | undefined): string {
    if (!listId) {
      return defaultNoteListId;
    }

    const row = this.connection.get<{ id: string }>(
      `SELECT id FROM local_note_lists
       WHERE id = ? AND deleted_at IS NULL
       LIMIT 1;`,
      [listId]
    );

    return row?.id ?? defaultNoteListId;
  }

  suggestLinkTargets(request: NoteLinkSuggestRequest): NoteLinkSuggestResponse {
    return this.measureSqlite("notes.linkSuggest", () => {
      const query = `%${request.query}%`;
      const kinds = new Set(request.kinds ?? ["note", "task", "event"]);
      const limit = request.limit ?? 8;
      const items: NoteLinkSuggestResponse["items"] = [];

      if (kinds.has("note")) {
        const rows = this.connection.query<{ id: string; label: string }>(
          `SELECT id, title AS label
           FROM local_notes
           WHERE deleted_at IS NULL AND title LIKE ? COLLATE NOCASE
           ORDER BY updated_at DESC, id ASC
           LIMIT ?;`,
          [query, limit]
        );
        items.push(...rows.map((row) => ({ kind: "note" as const, id: row.id, label: row.label })));
      }

      if (kinds.has("task") && items.length < limit) {
        const rows = this.connection.query<{ id: string; label: string }>(
          `SELECT id, title AS label
           FROM google_tasks
           WHERE deleted_at IS NULL AND title LIKE ? COLLATE NOCASE
           ORDER BY updated_at DESC, id ASC
           LIMIT ?;`,
          [query, limit]
        );
        items.push(...rows.map((row) => ({ kind: "task" as const, id: row.id, label: row.label })));
      }

      if (kinds.has("event") && items.length < limit) {
        const rows = this.connection.query<{ id: string; label: string }>(
          `SELECT id, summary AS label
           FROM google_calendar_events
           WHERE deleted_at IS NULL AND summary LIKE ? COLLATE NOCASE
           ORDER BY updated_at DESC, id ASC
           LIMIT ?;`,
          [query, limit]
        );
        items.push(...rows.map((row) => ({ kind: "event" as const, id: row.id, label: row.label })));
      }

      return { items: items.slice(0, limit) };
    });
  }

  listBrokenNoteLinks(request: NoteBrokenLinksRequest): NoteBrokenLinksResponse {
    return this.measureSqlite("notes.listBrokenLinks", () => {
      this.getNote(request.noteId);
      const rows = this.connection.query<{ linkText: string }>(
        `SELECT link_text AS linkText
         FROM local_note_links
         WHERE source_note_id = ? AND is_broken = 1
         ORDER BY id ASC;`,
        [request.noteId]
      );

      return { items: rows.map((row) => ({ linkText: row.linkText })) };
    });
  }

  private reindexNoteLinksAndProperties(noteId: string, body: string, now: string): void {
    const links = extractPlannerLinks(body);
    const properties = extractNoteProperties(body);
    const operations: SqliteWriteOperation[] = [
      { kind: "run", sql: `DELETE FROM local_note_links WHERE source_note_id = ?;`, params: [noteId] },
      { kind: "run", sql: `DELETE FROM local_note_properties WHERE note_id = ?;`, params: [noteId] }
    ];

    for (const link of links) {
      const resolvedTargetId = this.resolveLinkTargetId(link);
      operations.push({
        kind: "run",
        sql: `INSERT INTO local_note_links
              (source_note_id, target_kind, target_id, link_text, is_broken, created_at)
              VALUES (?, ?, ?, ?, ?, ?);`,
        params: [
          noteId,
          link.kind,
          resolvedTargetId,
          link.raw,
          resolvedTargetId === null ? 1 : 0,
          now
        ]
      });
    }

    for (const property of properties) {
      operations.push({
        kind: "run",
        sql: `INSERT INTO local_note_properties
              (note_id, property_key, property_value, updated_at)
              VALUES (?, ?, ?, ?)
              ON CONFLICT(note_id, property_key) DO UPDATE SET
                property_value = excluded.property_value,
                updated_at = excluded.updated_at;`,
        params: [noteId, property.key, property.value, now]
      });
    }

    this.connection.executeTransaction(operations);
  }

  private resolveLinkTargetId(link: PlannerLinkReference): string | null {
    if (link.kind === "note") {
      const row = this.connection.get<{ id: string }>(
        `SELECT id FROM local_notes
         WHERE deleted_at IS NULL AND LOWER(title) = LOWER(?)
         LIMIT 1;`,
        [link.label]
      );
      return row?.id ?? null;
    }

    if (link.kind === "task") {
      const row = this.connection.get<{ id: string }>(
        `SELECT id FROM google_tasks
         WHERE deleted_at IS NULL AND (id = ? OR LOWER(title) = LOWER(?))
         LIMIT 1;`,
        [link.label, link.label]
      );
      return row?.id ?? null;
    }

    if (link.kind === "event") {
      const row = this.connection.get<{ id: string }>(
        `SELECT id FROM google_calendar_events
         WHERE deleted_at IS NULL AND (id = ? OR LOWER(title) = LOWER(?))
         LIMIT 1;`,
        [link.label, link.label]
      );
      return row?.id ?? null;
    }

    return null;
  }

  deleteNote(request: NoteDeleteRequest): { id: string; queued: boolean; revision: string } {
    return this.measureSqlite("notes.delete", () => {
      const now = new Date().toISOString();
      const result = this.connection.run(
        `UPDATE local_notes
         SET deleted_at = ?, updated_at = ?
         WHERE id = ? AND deleted_at IS NULL;`,
        [now, now, request.id]
      );

      if (result.changes === 0) {
        throw notFound("Note was not found.");
      }
      this.recordHistory({
        kind: "note.delete",
        resourceId: request.id,
        summary: "Deleted note",
        metadata: { queued: false }
      });

      return {
        id: request.id,
        queued: false,
        revision: now
      };
    });
  }
}
