import type {
  TagBulkApplyRequest,
  TagCreateRequest,
  TagDeleteRequest,
  TagListRequest,
  TagListResponse,
  TagMergeRequest,
  TagMutationResponse,
  TagSummary,
  TagUpdateRequest
} from "@shared/ipc/contracts";
import type { SqliteWriteOperation } from "../sqliteConnection";
import {
  localTagIdForName,
  normalizeLocalTagName,
  normalizeLocalTagNames
} from "./plannerBase";
import { SearchLocalRepository } from "./searchRepository";
import { countRows, pageBounds, pageFromRows, parseStringArray, validationFailure } from "./shared";

interface TagRow extends Record<string, unknown> {
  id: string;
  name: string;
  normalizedName: string;
  color: string | null;
  createdAt: string;
  updatedAt: string;
  taskCount: number;
  eventCount: number;
  noteCount: number;
  totalCount: number;
}

type TagEntityKind = "task" | "event" | "note";
export type TagEntityRef = { kind: TagEntityKind; entityId: string };

export class TagLocalRepository extends SearchLocalRepository {
  listTags(request: TagListRequest): TagListResponse {
    return this.measureSqlite("tags.list", () => {
      const { limit, offset } = pageBounds(request.cursor, request.limit, 50, 100);
      const query = normalizeLocalTagName(request.query ?? "");
      const predicates = ["tags.deleted_at IS NULL"];
      const params: Array<string | number> = [];

      if (query) {
        predicates.push("tags.normalized_name LIKE ? ESCAPE '\\'");
        params.push(`%${escapeLike(query)}%`);
      }

      const where = predicates.join(" AND ");
      const rows = this.connection.query<TagRow>(
        `${tagSummarySelect()}
         WHERE ${where}
         GROUP BY tags.id
         ORDER BY tags.normalized_name ASC
         LIMIT ? OFFSET ?;`,
        [...params, limit, offset]
      );
      const totalKnown = countRows(
        this.connection,
        `SELECT COUNT(*) AS count FROM local_tags tags WHERE ${where};`,
        params
      );

      return pageFromRows(rows.map(tagSummary), limit, offset, totalKnown);
    });
  }

  createTag(request: TagCreateRequest): TagMutationResponse {
    return this.measureSqlite("tags.create", () => {
      const now = new Date().toISOString();
      const name = normalizeLocalTagNames([request.name])[0];

      if (!name) {
        throw validationFailure("Tag name is required.");
      }

      const normalized = normalizeLocalTagName(name);
      const id = localTagIdForName(normalized);
      this.connection.run(
        `INSERT INTO local_tags (id, name, normalized_name, color, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT(normalized_name) DO UPDATE SET
           name = excluded.name,
           color = excluded.color,
           updated_at = excluded.updated_at,
           deleted_at = NULL;`,
        [id, name, normalized, request.color ?? null, now, now]
      );
      this.recordHistory({
        kind: "tag.create",
        resourceId: id,
        summary: `Created tag "${name}"`,
        metadata: { queued: false }
      });

      return { id, queued: false, revision: now, tag: this.requireTag(id) };
    });
  }

  updateTag(request: TagUpdateRequest): TagMutationResponse {
    return this.measureSqlite("tags.update", () => {
      const existing = this.requireTagRow(request.id);
      const now = new Date().toISOString();
      const name = request.name === undefined ? existing.name : normalizeLocalTagNames([request.name])[0];

      if (!name) {
        throw validationFailure("Tag name is required.");
      }

      const normalized = normalizeLocalTagName(name);
      const conflict = this.connection.get<{ id: string }>(
        `SELECT id FROM local_tags
         WHERE normalized_name = ? AND id <> ? AND deleted_at IS NULL
         LIMIT 1;`,
        [normalized, request.id]
      );

      if (conflict) {
        throw validationFailure("A tag with that name already exists.");
      }

      const operations: SqliteWriteOperation[] = [
        {
          kind: "run",
          sql: `UPDATE local_tags
                SET name = ?, normalized_name = ?, color = ?, updated_at = ?, deleted_at = NULL
                WHERE id = ?;`,
          params: [name, normalized, request.color === undefined ? existing.color : request.color, now, request.id]
        },
        ...this.renameEntityTagOperations(request.id, existing.name, name, now)
      ];

      this.connection.executeTransaction(operations);
      this.recordHistory({
        kind: "tag.edit",
        resourceId: request.id,
        summary: `Edited tag "${name}"`,
        metadata: { queued: false }
      });

      return { id: request.id, queued: false, revision: now, tag: this.requireTag(request.id) };
    });
  }

  deleteTag(request: TagDeleteRequest): TagMutationResponse {
    return this.measureSqlite("tags.delete", () => {
      const existing = this.requireTagRow(request.id);
      const now = new Date().toISOString();
      const operations: SqliteWriteOperation[] = [
        ...this.removeEntityTagOperations(request.id, existing.name, now),
        {
          kind: "run",
          sql: "DELETE FROM local_entity_tags WHERE tag_id = ?;",
          params: [request.id]
        },
        {
          kind: "run",
          sql: "UPDATE local_tags SET deleted_at = ?, updated_at = ? WHERE id = ?;",
          params: [now, now, request.id]
        }
      ];

      this.connection.executeTransaction(operations);
      this.recordHistory({
        kind: "tag.delete",
        resourceId: request.id,
        summary: `Deleted tag "${existing.name}"`,
        metadata: { queued: false }
      });

      return { id: request.id, queued: false, revision: now };
    });
  }

  mergeTags(request: TagMergeRequest): TagMutationResponse {
    return this.measureSqlite("tags.merge", () => {
      const source = this.requireTagRow(request.sourceId);
      const target = this.requireTagRow(request.targetId);
      const now = new Date().toISOString();
      const operations: SqliteWriteOperation[] = [
        ...this.renameEntityTagOperations(source.id, source.name, target.name, now),
        {
          kind: "run",
          sql: `INSERT OR IGNORE INTO local_entity_tags (tag_id, entity_kind, entity_id, created_at)
                SELECT ?, entity_kind, entity_id, ?
                FROM local_entity_tags
                WHERE tag_id = ?;`,
          params: [target.id, now, source.id]
        },
        {
          kind: "run",
          sql: "DELETE FROM local_entity_tags WHERE tag_id = ?;",
          params: [source.id]
        },
        {
          kind: "run",
          sql: "UPDATE local_tags SET deleted_at = ?, updated_at = ? WHERE id = ?;",
          params: [now, now, source.id]
        },
        {
          kind: "run",
          sql: "UPDATE local_tags SET updated_at = ?, deleted_at = NULL WHERE id = ?;",
          params: [now, target.id]
        }
      ];

      this.connection.executeTransaction(operations);
      this.recordHistory({
        kind: "tag.merge",
        resourceId: target.id,
        summary: `Merged tag "${source.name}" into "${target.name}"`,
        metadata: { queued: false, sourceTagId: source.id }
      });

      return { id: target.id, queued: false, revision: now, tag: this.requireTag(target.id) };
    });
  }

  bulkApplyTags(request: TagBulkApplyRequest): TagMutationResponse {
    return this.measureSqlite("tags.bulkApply", () => {
      const now = new Date().toISOString();
      const tagRows = request.tagIds.map((id) => this.requireTagRow(id));
      const tagNames = tagRows.map((tag) => tag.name);
      const operations: SqliteWriteOperation[] = [];

      for (const entityId of [...new Set(request.entityIds)]) {
        const existing = this.readEntityTags(request.entityKind, entityId);
        const next = request.mode === "replace"
          ? tagNames
          : request.mode === "add"
            ? normalizeLocalTagNames([...existing, ...tagNames])
            : existing.filter((tag) => !tagNames.some((remove) => normalizeLocalTagName(remove) === normalizeLocalTagName(tag)));

        operations.push(
          ...this.entityTagArrayUpdateOperations(request.entityKind, entityId, next, now),
          ...this.tagSyncOperations({
            entityKind: request.entityKind,
            entityId,
            tags: next,
            now
          })
        );
      }

      this.connection.executeTransaction(operations);
      this.recordHistory({
        kind: "tag.bulk_apply",
        summary: `${request.mode} ${tagRows.length} tag${tagRows.length === 1 ? "" : "s"}`,
        metadata: { queued: false, entityKind: request.entityKind, entityCount: request.entityIds.length }
      });

      return { id: tagRows[0]?.id ?? "tags", queued: false, revision: now, tag: tagRows[0] ? this.requireTag(tagRows[0].id) : undefined };
    });
  }

  tagEntityRefsForIds(tagIds: readonly string[]): TagEntityRef[] {
    const ids = [...new Set(tagIds)].filter((id) => id.length > 0);
    if (ids.length === 0) {
      return [];
    }
    return this.connection.query<{ kind: TagEntityKind; entityId: string }>(
      `SELECT DISTINCT entity_kind AS kind, entity_id AS entityId
       FROM local_entity_tags
       WHERE tag_id IN (${ids.map(() => "?").join(", ")});`,
      ids
    );
  }

  private requireTag(id: string): TagSummary {
    return tagSummary(this.requireTagRow(id));
  }

  private requireTagRow(id: string): TagRow {
    const row = this.connection.get<TagRow>(
      `${tagSummarySelect()}
       WHERE tags.id = ? AND tags.deleted_at IS NULL
       GROUP BY tags.id
       LIMIT 1;`,
      [id]
    );

    if (!row) {
      throw validationFailure("Tag was not found.");
    }

    return row;
  }

  private renameEntityTagOperations(tagId: string, fromName: string, toName: string, now: string): SqliteWriteOperation[] {
    return this.entityRefs(tagId).flatMap((ref) => {
      const tags = this.readEntityTags(ref.kind, ref.entityId);
      const next = normalizeLocalTagNames(tags.map((tag) =>
        normalizeLocalTagName(tag) === normalizeLocalTagName(fromName) ? toName : tag
      ));
      return [
        ...this.entityTagArrayUpdateOperations(ref.kind, ref.entityId, next, now),
        ...this.tagSyncOperations({
          entityKind: ref.kind,
          entityId: ref.entityId,
          tags: next,
          now
        })
      ];
    });
  }

  private removeEntityTagOperations(tagId: string, tagName: string, now: string): SqliteWriteOperation[] {
    return this.entityRefs(tagId).flatMap((ref) => {
      const tags = this.readEntityTags(ref.kind, ref.entityId);
      const next = tags.filter((tag) => normalizeLocalTagName(tag) !== normalizeLocalTagName(tagName));
      return [
        ...this.entityTagArrayUpdateOperations(ref.kind, ref.entityId, next, now),
        ...this.tagSyncOperations({
          entityKind: ref.kind,
          entityId: ref.entityId,
          tags: next,
          now
        })
      ];
    });
  }

  private entityRefs(tagId: string): TagEntityRef[] {
    return this.connection.query<{ kind: TagEntityKind; entityId: string }>(
      `SELECT entity_kind AS kind, entity_id AS entityId
       FROM local_entity_tags
       WHERE tag_id = ?;`,
      [tagId]
    );
  }

  private readEntityTags(kind: TagEntityKind, entityId: string): string[] {
    const table = kind === "event" ? "google_calendar_events" : "google_tasks";
    const row = this.connection.get<{ tagsJson: string | null }>(
      `SELECT local_tags_json AS tagsJson FROM ${table} WHERE id = ? LIMIT 1;`,
      [entityId]
    );

    return normalizeLocalTagNames(parseStringArray(row?.tagsJson ?? null));
  }

  private entityTagArrayUpdateOperations(
    kind: TagEntityKind,
    entityId: string,
    tags: readonly string[],
    now: string
  ): SqliteWriteOperation[] {
    const table = kind === "event" ? "google_calendar_events" : "google_tasks";
    return [
      {
        kind: "run",
        sql: `UPDATE ${table}
              SET local_tags_json = ?, updated_at = ?
              WHERE id = ? AND deleted_at IS NULL;`,
        params: [JSON.stringify(normalizeLocalTagNames(tags)), now, entityId]
      }
    ];
  }
}

function tagSummary(row: TagRow): TagSummary {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    taskCount: row.taskCount,
    eventCount: row.eventCount,
    noteCount: row.noteCount,
    totalCount: row.totalCount
  };
}

function tagSummarySelect(): string {
  return `SELECT
           tags.id AS id,
           tags.name AS name,
           tags.normalized_name AS normalizedName,
           tags.color AS color,
           tags.created_at AS createdAt,
           tags.updated_at AS updatedAt,
           COALESCE(SUM(CASE WHEN refs.entity_kind = 'task' THEN 1 ELSE 0 END), 0) AS taskCount,
           COALESCE(SUM(CASE WHEN refs.entity_kind = 'event' THEN 1 ELSE 0 END), 0) AS eventCount,
           COALESCE(SUM(CASE WHEN refs.entity_kind = 'note' THEN 1 ELSE 0 END), 0) AS noteCount,
           COUNT(refs.entity_id) AS totalCount
         FROM local_tags tags
         LEFT JOIN local_entity_tags refs ON refs.tag_id = tags.id`;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}
