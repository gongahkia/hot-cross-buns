import type {
  AutoTagReapplyApplyRequest,
  AutoTagReapplyApplyResponse,
  AutoTagReapplyPreviewRequest,
  AutoTagReapplyPreviewResponse,
  AutoTagRule,
  TagAnalyticsResponse,
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
import {
  applyAutoTagRules,
  validateAutoTagRule,
  type AutoTagTargetKind
} from "@shared/ipc/autoTags";
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
  firstUsedAt: string | null;
  lastUsedAt: string | null;
  taskCount: number;
  eventCount: number;
  noteCount: number;
  totalCount: number;
}

type TagEntityKind = "task" | "event" | "note";
export type TagEntityRef = { kind: TagEntityKind; entityId: string };

interface AutoTagCandidate {
  kind: TagEntityKind;
  id: string;
  title: string;
  body: string;
  tags: string[];
  eventColorId?: string | null;
}

interface AutoTagChange extends AutoTagCandidate {
  nextTitle: string;
  nextBody: string;
  nextTags: string[];
  nextEventColorId?: string | null;
}

interface DuplicateCleanupMutationRow extends Record<string, unknown> {
  id: string;
  resourceId: string;
  operation: string;
  payloadJson: string;
  createdAt: string;
}

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

  tagAnalytics(): TagAnalyticsResponse {
    return this.measureSqlite("tags.analytics", () => {
      const tags = this.connection.query<TagRow>(
        `${tagSummarySelect()}
         WHERE tags.deleted_at IS NULL
         GROUP BY tags.id
         ORDER BY totalCount DESC, tags.normalized_name ASC;`
      ).map(tagSummary);

      return {
        totalTags: tags.length,
        unusedTags: tags.filter((tag) => tag.totalCount === 0).length,
        linkedEntities: tags.reduce((total, tag) => total + tag.totalCount, 0),
        topTags: tags.filter((tag) => tag.totalCount > 0).slice(0, 10),
        staleTags: [...tags]
          .filter((tag) => tag.totalCount > 0)
          .sort((left, right) =>
            (left.lastUsedAt ?? "").localeCompare(right.lastUsedAt ?? "") ||
            left.name.localeCompare(right.name)
          )
          .slice(0, 10)
      };
    });
  }

  previewAutoTagReapply(
    rules: readonly AutoTagRule[],
    request: AutoTagReapplyPreviewRequest
  ): AutoTagReapplyPreviewResponse {
    return this.measureSqlite("tags.autoReapplyPreview", () =>
      this.autoTagReapplyPreview(rules, this.autoTagReapplyChanges(rules, request.kind), request)
    );
  }

  applyAutoTagReapply(
    rules: readonly AutoTagRule[],
    request: AutoTagReapplyApplyRequest
  ): AutoTagReapplyApplyResponse & { changedRefs: TagEntityRef[] } {
    return this.measureSqlite("tags.autoReapplyApply", () => {
      const now = new Date().toISOString();
      const changes = this.autoTagReapplyChanges(rules, request.kind);
      const preview = this.autoTagReapplyPreview(rules, changes, request);

      if (preview.blocked || changes.length === 0) {
        return {
          ...preview,
          queued: false,
          revision: now,
          changedRefs: []
        };
      }

      let failed = 0;
      const changedRefs: TagEntityRef[] = [];

      for (const change of changes) {
        try {
          if (change.kind === "event") {
            this.updateCalendarEvent({
              id: change.id,
              ...(change.nextTitle === change.title ? {} : { title: change.nextTitle }),
              ...(change.nextBody === change.body ? {} : { notes: change.nextBody }),
              tags: change.nextTags,
              ...((change.nextEventColorId ?? null) === (change.eventColorId ?? null)
                ? {}
                : { colorId: change.nextEventColorId ?? null }),
              scope: "seriesAll"
            });
          } else if (change.kind === "note") {
            this.updateNote({
              id: change.id,
              title: change.nextTitle,
              body: change.nextBody,
              tags: change.nextTags
            });
          } else {
            this.updateTask({
              id: change.id,
              ...(change.nextTitle === change.title ? {} : { title: change.nextTitle }),
              ...(change.nextBody === change.body ? {} : { notes: change.nextBody }),
              tags: change.nextTags
            });
          }
          changedRefs.push({ kind: change.kind, entityId: change.id });
        } catch {
          failed += 1;
        }
      }

      return {
        ...preview,
        changed: changedRefs.length,
        failed,
        skipped: preview.scanned - changedRefs.length - failed,
        queued: changedRefs.length > 0,
        revision: now,
        undoLabel: changedRefs.length > 0 ? "Auto-tag reapply" : undefined,
        changedRefs
      };
    });
  }

  autoTagReapplyChangedRefs(
    rules: readonly AutoTagRule[],
    request: AutoTagReapplyPreviewRequest
  ): TagEntityRef[] {
    return this.autoTagReapplyChanges(rules, request.kind)
      .map((change) => ({ kind: change.kind, entityId: change.id }));
  }

  markDuplicateCleanupMutations(input: {
    kind: TagEntityKind;
    winnerId: string;
    loserIds: readonly string[];
    cleanupGroupId: string;
  }): void {
    const resourceType = input.kind === "event" ? "event" : "task";
    const ids = [input.winnerId, ...input.loserIds];
    const rows = this.connection.query<DuplicateCleanupMutationRow>(
      `SELECT id,
              resource_id AS resourceId,
              operation,
              payload_json AS payloadJson,
              created_at AS createdAt
       FROM google_pending_mutations
       WHERE resource_type = ?
         AND resource_id IN (${ids.map(() => "?").join(", ")})
         AND status IN ('pending', 'failed')
       ORDER BY created_at ASC, id ASC;`,
      [resourceType, ...ids]
    );
    const now = new Date().toISOString();
    const compactedIds = duplicateCleanupCompactedMutationIds(rows, input);
    const cleanupMetadata = {
      cleanupGroupId: input.cleanupGroupId,
      cleanupKind: input.kind,
      cleanupWinnerId: input.winnerId,
      cleanupLoserIds: input.loserIds
    };

    this.connection.executeTransaction(rows.map((row) => {
      const compacted = compactedIds.has(row.id);
      const payload = JSON.stringify({
        ...parsePayloadObject(row.payloadJson),
        ...cleanupMetadata,
        ...(compacted ? { cleanupCompacted: true } : {})
      });

      return compacted
        ? {
            kind: "run" as const,
            sql: `UPDATE google_pending_mutations
                  SET status = 'cancelled',
                      next_retry_at = NULL,
                      payload_json = ?,
                      updated_at = ?
                  WHERE id = ?
                    AND status IN ('pending', 'failed');`,
            params: [payload, now, row.id]
          }
        : {
            kind: "run" as const,
            sql: `UPDATE google_pending_mutations
                  SET payload_json = ?,
                      updated_at = ?
                  WHERE id = ?
                    AND status IN ('pending', 'failed');`,
            params: [payload, now, row.id]
          };
    }));
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

  private autoTagReapplyChanges(
    rules: readonly AutoTagRule[],
    kind: AutoTagTargetKind
  ): AutoTagChange[] {
    if (rules.some((rule) => validateAutoTagRule(rule).some((issue) => issue.severity === "error"))) {
      return [];
    }

    return this.autoTagCandidates(kind).flatMap((candidate) => {
      const applied = applyAutoTagRules(rules, {
        kind: candidate.kind,
        title: candidate.title,
        body: candidate.body,
        existingTags: candidate.tags,
        existingEventColorId: candidate.eventColorId ?? null
      });
      const nextEventColorId = candidate.kind === "event"
        ? applied.eventColorId ?? candidate.eventColorId ?? null
        : undefined;

      if (
        applied.title === candidate.title &&
        applied.body === candidate.body &&
        sameStringSet(applied.tags, candidate.tags) &&
        (candidate.kind !== "event" || nextEventColorId === (candidate.eventColorId ?? null))
      ) {
        return [];
      }

      return [{
        ...candidate,
        nextTitle: applied.title,
        nextBody: applied.body,
        nextTags: applied.tags,
        nextEventColorId
      }];
    });
  }

  private autoTagReapplyPreview(
    rules: readonly AutoTagRule[],
    changes: AutoTagChange[],
    request: AutoTagReapplyPreviewRequest
  ): AutoTagReapplyPreviewResponse {
    const invalid = this.autoTagReapplyBlocked(rules);
    const scanned = invalid.blocked ? 0 : this.autoTagCandidates(request.kind).length;

    if (invalid.blocked) {
      return {
        kind: request.kind,
        scope: "all",
        scanned,
        changed: 0,
        skipped: 0,
        failed: 0,
        blocked: true,
        message: invalid.message,
        sample: []
      };
    }

    return {
      kind: request.kind,
      scope: "all",
      scanned,
      changed: changes.length,
      skipped: Math.max(0, scanned - changes.length),
      failed: 0,
      blocked: false,
      message: `${changes.length} ${request.kind}${changes.length === 1 ? "" : "s"} would change.`,
      sample: changes.slice(0, 20).map((change) => ({
        id: change.id,
        title: change.title,
        nextTitle: change.nextTitle,
        tags: change.tags,
        nextTags: change.nextTags
      }))
    };
  }

  private autoTagReapplyBlocked(rules: readonly AutoTagRule[]): { blocked: boolean; message: string } {
    const errorCount = rules.reduce(
      (count, rule) =>
        count + validateAutoTagRule(rule).filter((issue) => issue.severity === "error").length,
      0
    );

    return errorCount > 0
      ? { blocked: true, message: `${errorCount} auto-tag rule error${errorCount === 1 ? "" : "s"} need review.` }
      : { blocked: false, message: "Auto-tag reapply ready." };
  }

  private autoTagCandidates(kind: AutoTagTargetKind): AutoTagCandidate[] {
    if (kind === "event") {
      return this.connection.query<{
        id: string;
        title: string;
        body: string | null;
        tagsJson: string | null;
        colorId: string | null;
      }>(
        `SELECT id,
                summary AS title,
                description AS body,
                local_tags_json AS tagsJson,
                color_id AS colorId
         FROM google_calendar_events
         WHERE deleted_at IS NULL
           AND status != 'cancelled'
           AND COALESCE(hcb_kind, '') != 'birthday';`
      ).map((row) => ({
        kind,
        id: row.id,
        title: row.title,
        body: row.body ?? "",
        tags: normalizeLocalTagNames(parseStringArray(row.tagsJson)),
        eventColorId: row.colorId
      }));
    }

    const notePredicate = kind === "note"
      ? "tasks.parent_task_id IS NULL AND tasks.due_at IS NULL"
      : "NOT (tasks.parent_task_id IS NULL AND tasks.due_at IS NULL)";

    return this.connection.query<{
      id: string;
      title: string;
      body: string | null;
      tagsJson: string | null;
    }>(
      `SELECT tasks.id,
              tasks.title,
              tasks.notes AS body,
              tasks.local_tags_json AS tagsJson
       FROM google_tasks tasks
       INNER JOIN google_task_lists lists ON lists.id = tasks.task_list_id
       WHERE tasks.deleted_at IS NULL
         AND tasks.is_hidden = 0
         AND tasks.status != 'completed'
         AND lists.deleted_at IS NULL
         AND ${notePredicate};`
    ).map((row) => ({
      kind,
      id: row.id,
      title: row.title,
      body: row.body ?? "",
      tags: normalizeLocalTagNames(parseStringArray(row.tagsJson))
    }));
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
    firstUsedAt: row.firstUsedAt,
    lastUsedAt: row.lastUsedAt,
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
           MIN(refs.created_at) AS firstUsedAt,
           MAX(refs.created_at) AS lastUsedAt,
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

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  const leftSet = new Set(left.map((value) => value.trim().toLocaleLowerCase()).filter(Boolean));
  const rightSet = new Set(right.map((value) => value.trim().toLocaleLowerCase()).filter(Boolean));

  if (leftSet.size !== rightSet.size) {
    return false;
  }

  for (const value of leftSet) {
    if (!rightSet.has(value)) {
      return false;
    }
  }

  return true;
}

function duplicateCleanupCompactedMutationIds(
  rows: readonly DuplicateCleanupMutationRow[],
  input: {
    kind: TagEntityKind;
    winnerId: string;
    loserIds: readonly string[];
  }
): Set<string> {
  const compactedIds = new Set<string>();
  const loserIds = new Set(input.loserIds);

  for (const row of rows) {
    if (loserIds.has(row.resourceId) && isDuplicateCleanupLoserCompactionOperation(row.operation)) {
      compactedIds.add(row.id);
    }
  }

  const winnerHasCreate = rows.some((row) =>
    row.resourceId === input.winnerId &&
    isDuplicateCleanupCreateOperation(row.operation)
  );
  const winnerUpdateOperation = duplicateCleanupWinnerUpdateOperation(input.kind);
  const winnerUpdates = rows.filter((row) =>
    row.resourceId === input.winnerId &&
    row.operation === winnerUpdateOperation
  );

  if (!winnerHasCreate && winnerUpdates.length > 1) {
    for (const row of winnerUpdates.slice(0, -1)) {
      compactedIds.add(row.id);
    }
  }

  return compactedIds;
}

function isDuplicateCleanupLoserCompactionOperation(operation: string): boolean {
  return !isDuplicateCleanupCreateOperation(operation) &&
    !isDuplicateCleanupDeleteOperation(operation);
}

function isDuplicateCleanupCreateOperation(operation: string): boolean {
  return operation === "task.create" ||
    operation === "calendar.events.create";
}

function isDuplicateCleanupDeleteOperation(operation: string): boolean {
  return operation === "task.delete" ||
    operation === "calendar.events.delete";
}

function duplicateCleanupWinnerUpdateOperation(kind: TagEntityKind): string {
  return kind === "event" ? "calendar.events.update" : "task.update";
}

function parsePayloadObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}
