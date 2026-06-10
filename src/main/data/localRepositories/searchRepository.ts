import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import type {
  NoteBrokenLinksRequest,
  NoteBrokenLinksResponse,
  NoteCreateRequest,
  NoteDeleteRequest,
  NoteDetail,
  NoteEntityKind,
  NoteEntityLink,
  NoteEntityLinksRequest,
  NoteEntityLinksResponse,
  NoteLinkSuggestRequest,
  NoteLinkSuggestResponse,
  NoteListCreateRequest,
  NoteListDeleteRequest,
  NoteListRenameRequest,
  NoteListRequest,
  NoteListResponse,
  NoteListSummary,
  NoteUpdateRequest,
  SearchQueryRequest,
  SearchQueryResponse,
  SearchResultItem
} from "@shared/ipc/contracts";
import { HcbPublicError } from "@shared/ipc/result";
import {
  hasRunnableLocalSearch,
  matchesLocalSearchTextRegex,
  matchesLocalSearchItem,
  parseLocalSearchQuery,
  resolveLocalSearchDomains,
  type ParsedLocalSearchQuery
} from "@shared/search/localSearch";
import { googleTaskIdFromCalendarDescription } from "./googleTaskProjection";
import { noteDetail, noteListSummary, noteSummary, parseTagsJson, preview } from "./mappers";
import { extractPlannerLinks, type PlannerLinkReference } from "./noteLinks";
import { ScheduledTaskBlockLocalRepository } from "./scheduledTaskBlockRepository";
import {
  eventSearchPredicates,
  ftsMatchQuery,
  noteSearchPredicates,
  taskSearchPredicates
} from "./searchPredicates";
import { countRows, notFound, pageBounds, pageFromRows, parseStringArray, validationFailure } from "./shared";
import type { SearchDomain } from "./types";

type SearchRepositoryRequest = SearchQueryRequest & {
  embeddingModelId?: string;
  semanticInstalled?: boolean;
};

interface TaskBackedNoteRow extends Record<string, unknown> {
  id: string;
  listId: string;
  listTitle: string;
  title: string;
  body: string;
  tagsJson?: string | null;
  updatedAt: string;
}

interface TaskBackedNoteListRow extends Record<string, unknown> {
  id: string;
  title: string;
  updatedAt: string;
  noteCount: number;
}

interface EntityLinkSourceRow extends Record<string, unknown> {
  kind: NoteEntityKind;
  id: string;
  title: string;
  body: string;
  sourceField: string;
}

interface EntityLinkRow extends Record<string, unknown> {
  sourceKind: NoteEntityKind;
  sourceId: string;
  sourceField: string;
  targetKind: NoteEntityKind;
  targetId: string | null;
  targetLabel: string;
  raw: string;
  alias: string | null;
  linkType: "wikilink" | "transclusion";
  broken: number;
}

export class SearchLocalRepository extends ScheduledTaskBlockLocalRepository {
  search(request: SearchRepositoryRequest): SearchQueryResponse {
    const startedAt = performance.now();

    try {
      const result = this.measureSqlite("search.query.sqlite", () => {
        const parsed = parseLocalSearchQuery(request.query);
        const parseError = parsed.errors[0];

        if (parseError !== undefined) {
          throw new HcbPublicError({
            code: "VALIDATION_ERROR",
            message: parseError.message,
            recoverable: true
          });
        }

        const domains = new Set<SearchDomain>(resolveLocalSearchDomains(parsed, request.domains));
        const limit = Math.max(1, Math.min(50, request.limit ?? 20));
        const mode = request.mode ?? "lexical";
        const ftsQuery = ftsMatchQuery(parsed.text);
        const results: SearchResultItem[] = [];

        if (mode === "semantic") {
          return this.semanticSearch(request.query, domains, limit, "semantic", request);
        }

        if (!hasRunnableLocalSearch(parsed) || (!ftsQuery && parsed.chips.length === 0 && parsed.boolean === undefined)) {
          return {
            items: [],
            page: {
              limit,
              totalKnown: 0
            }
          };
        }

        if (
          parsed.chips.length === 0 &&
          ftsQuery &&
          domains.size === 3 &&
          domains.has("tasks") &&
          domains.has("calendar") &&
          domains.has("notes")
        ) {
          const items = this.searchAllDomains(ftsQuery, limit);

          const lexical = {
            items,
            page: {
              limit,
              totalKnown: items.length
            }
          };
          return mode === "hybrid" ? this.hybridSearch(lexical, request.query, domains, limit, request) : lexical;
        }

        if (domains.has("tasks")) {
          results.push(...this.searchTasks(parsed, ftsQuery, limit));
        }

        if (domains.has("calendar")) {
          results.push(...this.searchEvents(parsed, ftsQuery, limit));
        }

        if (domains.has("notes")) {
          results.push(...this.searchNotes(parsed, ftsQuery, limit));
        }

        const sorted = results
          .sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""))
          .slice(0, limit);

        const lexical = {
          items: sorted,
          page: {
            limit,
            totalKnown: results.length
          }
        };
        return mode === "hybrid" ? this.hybridSearch(lexical, request.query, domains, limit, request) : lexical;
      });

      this.timings?.record({
        kind: "search",
        name: "search.query",
        durationMs: performance.now() - startedAt,
        metadata: {
          resultCount: result.items.length
        }
      });

      return result;
    } catch (error) {
      this.timings?.record({
        kind: "search",
        name: "search.query",
        durationMs: performance.now() - startedAt,
        metadata: {
          failed: true
        }
      });
      throw error;
    }
  }

  private hybridSearch(
    lexical: SearchQueryResponse,
    query: string,
    domains: Set<SearchDomain>,
    limit: number,
    request: SearchRepositoryRequest
  ): SearchQueryResponse {
    const semantic = this.semanticSearch(query, domains, limit, "hybrid", request);
    const byKey = new Map<string, SearchResultItem>();

    for (const item of lexical.items) {
      byKey.set(`${item.domain}:${item.id}`, {
        ...item,
        matchKind: "lexical",
        score: 1
      });
    }

    for (const item of semantic.items) {
      const key = `${item.domain}:${item.id}`;
      const existing = byKey.get(key);
      byKey.set(key, existing
        ? {
            ...existing,
            score: Math.max(existing.score ?? 0, item.score ?? 0),
            matchKind: "hybrid"
          }
        : item);
    }

    const items = [...byKey.values()]
      .sort((left, right) =>
        (right.score ?? 0) - (left.score ?? 0) ||
        (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "")
      )
      .slice(0, limit);

    return {
      items,
      page: {
        limit,
        totalKnown: byKey.size
      },
      diagnostics: semantic.diagnostics
    };
  }

  private semanticSearch(
    query: string,
    domains: Set<SearchDomain>,
    limit: number,
    mode: "semantic" | "hybrid",
    request: Pick<SearchRepositoryRequest, "embeddingModelId" | "semanticInstalled"> = {}
  ): SearchQueryResponse {
    const modelId = request.embeddingModelId ?? "hcb-local-hash-384";

    if (request.semanticInstalled === false) {
      const stats = this.semanticIndexStats(modelId);
      return {
        items: [],
        page: {
          limit,
          totalKnown: 0
        },
        diagnostics: {
          mode,
          semanticEnabled: true,
          indexedCount: stats.indexedCount,
          staleCount: stats.staleCount,
          modelId,
          fallbackReason: "model-not-installed"
        }
      };
    }

    const indexedCount = this.refreshSemanticIndex(modelId);
    const stats = this.semanticIndexStats(modelId);
    const queryVector = hashedEmbedding(query);
    const rows = this.connection.query<{
      id: string;
      domain: SearchDomain;
      title: string;
      snippet: string | null;
      tagsJson: string | null;
      updatedAt: string;
      vectorJson: string;
    }>(
      `SELECT
         entity_id AS id,
         entity_kind AS domain,
         title,
         title AS snippet,
         NULL AS tagsJson,
         generated_at AS updatedAt,
         vector_json AS vectorJson
       FROM local_semantic_embeddings
       WHERE model_id = ?
         AND entity_kind IN (${[...domains].map(() => "?").join(", ")})
       LIMIT 1000;`,
      [modelId, ...domains]
    );
    const items = rows
      .map((row) => ({
        id: row.id,
        domain: row.domain,
        title: row.title,
        snippet: row.snippet ?? undefined,
        tags: parseStringArray(row.tagsJson),
        updatedAt: row.updatedAt,
        score: cosine(queryVector, parseVector(row.vectorJson)),
        matchKind: mode
      }))
      .filter((item) => item.score > 0.05)
      .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
      .slice(0, limit);

    return {
      items,
      page: {
        limit,
        totalKnown: rows.length
      },
      diagnostics: {
        mode,
        semanticEnabled: true,
        indexedCount,
        staleCount: stats.staleCount,
        modelId
      }
    };
  }

  rebuildSemanticIndex(modelId: string): { indexedCount: number; staleCount: number } {
    return {
      indexedCount: this.refreshSemanticIndex(modelId),
      staleCount: this.semanticIndexStats(modelId).staleCount
    };
  }

  semanticIndexStats(modelId: string): { indexedCount: number; staleCount: number } {
    const entities = this.semanticEntities();
    let staleCount = 0;

    for (const entity of entities) {
      const existing = this.connection.get<{ textHash: string }>(
        `SELECT text_hash AS textHash
         FROM local_semantic_embeddings
         WHERE entity_kind = ? AND entity_id = ? AND model_id = ?
         LIMIT 1;`,
        [entity.domain, entity.id, modelId]
      );

      if (existing?.textHash !== sha256(entity.text)) {
        staleCount += 1;
      }
    }

    return {
      indexedCount: this.connection.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM local_semantic_embeddings WHERE model_id = ?;",
        [modelId]
      )?.count ?? 0,
      staleCount
    };
  }

  private refreshSemanticIndex(modelId: string): number {
    const now = new Date().toISOString();
    const entities = this.semanticEntities();

    for (const entity of entities) {
      const textHash = sha256(entity.text);
      const existing = this.connection.get<{ textHash: string }>(
        `SELECT text_hash AS textHash
         FROM local_semantic_embeddings
         WHERE entity_kind = ? AND entity_id = ? AND model_id = ?
         LIMIT 1;`,
        [entity.domain, entity.id, modelId]
      );

      if (existing?.textHash === textHash) {
        continue;
      }

      this.connection.run(
        `INSERT INTO local_semantic_embeddings (
           entity_kind, entity_id, title, text_hash, model_id, vector_json, generated_at, last_error
         ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT(entity_kind, entity_id, model_id) DO UPDATE SET
           title = excluded.title,
           text_hash = excluded.text_hash,
           vector_json = excluded.vector_json,
           generated_at = excluded.generated_at,
           last_error = NULL;`,
        [
          entity.domain,
          entity.id,
          entity.title,
          textHash,
          modelId,
          JSON.stringify(hashedEmbedding(entity.text)),
          now
        ]
      );
    }

    return this.connection.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM local_semantic_embeddings WHERE model_id = ?;",
      [modelId]
    )?.count ?? 0;
  }

  private semanticEntities(): Array<{ domain: SearchDomain; id: string; title: string; text: string }> {
    const tasks = this.connection.query<{ id: string; title: string; notes: string | null; listTitle: string }>(
      `SELECT tasks.id, tasks.title, tasks.notes, lists.title AS listTitle
       FROM google_tasks tasks
       INNER JOIN google_task_lists lists ON lists.id = tasks.task_list_id
       WHERE tasks.deleted_at IS NULL
         AND tasks.is_hidden = 0
         AND tasks.status != 'completed'
         AND NOT (tasks.due_at IS NULL AND tasks.parent_task_id IS NULL);`
    ).map((row) => ({
      domain: "tasks" as const,
      id: row.id,
      title: row.title,
      text: [row.title, row.notes ?? "", row.listTitle].join("\n")
    }));
    const notes = this.connection.query<{ id: string; title: string; body: string | null; listTitle: string }>(
      `SELECT tasks.id, tasks.title, tasks.notes AS body, lists.title AS listTitle
       FROM google_tasks tasks
       INNER JOIN google_task_lists lists ON lists.id = tasks.task_list_id
       WHERE ${this.notePredicate("tasks", "lists")};`
    ).map((row) => ({
      domain: "notes" as const,
      id: row.id,
      title: row.title,
      text: [row.title, row.body ?? "", row.listTitle].join("\n")
    }));
    const events = this.connection.query<{ id: string; title: string; description: string | null; location: string | null; calendarTitle: string }>(
      `SELECT events.id, events.summary AS title, events.description, events.location, calendars.summary AS calendarTitle
       FROM google_calendar_events events
       INNER JOIN google_calendar_lists calendars ON calendars.id = events.calendar_id
       WHERE events.deleted_at IS NULL
         AND events.status != 'cancelled'
         AND calendars.deleted_at IS NULL;`
    ).map((row) => ({
      domain: "calendar" as const,
      id: row.id,
      title: row.title,
      text: [row.title, row.description ?? "", row.location ?? "", row.calendarTitle].join("\n")
    }));

    return [...tasks, ...notes, ...events];
  }

  private searchAllDomains(ftsQuery: string, limit: number): SearchResultItem[] {
    return this.connection
      .query<{
        id: string;
        domain: SearchDomain;
        title: string;
        snippet: string | null;
        snoozeUntil: string | null;
        tagsJson: string | null;
        accountId: string | null;
        description: string | null;
        updatedAt: string;
      }>(
        `WITH task_matches AS (
           SELECT tasks.rowid AS taskRowid, bm25(google_tasks_fts) AS rank
           FROM google_tasks_fts
           INNER JOIN google_tasks tasks ON tasks.rowid = google_tasks_fts.rowid
           WHERE google_tasks_fts MATCH ?

           UNION ALL

           SELECT tasks.rowid AS taskRowid, bm25(google_task_lists_fts) + 2.0 AS rank
           FROM google_task_lists_fts
           INNER JOIN google_task_lists lists ON lists.rowid = google_task_lists_fts.rowid
           INNER JOIN google_tasks tasks ON tasks.task_list_id = lists.id
           WHERE google_task_lists_fts MATCH ?
         ),
         task_ranked AS (
           SELECT taskRowid, MIN(rank) AS rank
           FROM task_matches
           GROUP BY taskRowid
         ),
         note_matches AS (
           SELECT tasks.rowid AS taskRowid, bm25(google_tasks_fts) AS rank
           FROM google_tasks_fts
           INNER JOIN google_tasks tasks ON tasks.rowid = google_tasks_fts.rowid
           WHERE google_tasks_fts MATCH ?

           UNION ALL

           SELECT tasks.rowid AS taskRowid, bm25(google_task_lists_fts) + 2.0 AS rank
           FROM google_task_lists_fts
           INNER JOIN google_task_lists lists ON lists.rowid = google_task_lists_fts.rowid
           INNER JOIN google_tasks tasks ON tasks.task_list_id = lists.id
           WHERE google_task_lists_fts MATCH ?
         ),
         note_ranked AS (
           SELECT taskRowid, MIN(rank) AS rank
           FROM note_matches
           GROUP BY taskRowid
         ),
         event_matches AS (
           SELECT events.rowid AS eventRowid, bm25(google_calendar_events_fts) AS rank
           FROM google_calendar_events_fts
           INNER JOIN google_calendar_events events ON events.rowid = google_calendar_events_fts.rowid
           WHERE google_calendar_events_fts MATCH ?

           UNION ALL

           SELECT events.rowid AS eventRowid, bm25(google_calendar_lists_fts) + 2.0 AS rank
           FROM google_calendar_lists_fts
           INNER JOIN google_calendar_lists calendars ON calendars.rowid = google_calendar_lists_fts.rowid
           INNER JOIN google_calendar_events events ON events.calendar_id = calendars.id
           WHERE google_calendar_lists_fts MATCH ?
         ),
         event_ranked AS (
           SELECT eventRowid, MIN(rank) AS rank
           FROM event_matches
           GROUP BY eventRowid
         )
         SELECT
           tasks.id AS id,
           'tasks' AS domain,
           tasks.title AS title,
           COALESCE(tasks.notes, lists.title) AS snippet,
           tasks.local_snooze_until AS snoozeUntil,
           tasks.local_tags_json AS tagsJson,
           NULL AS accountId,
           NULL AS description,
           tasks.updated_at AS updatedAt
         FROM task_ranked
         INNER JOIN google_tasks tasks ON tasks.rowid = task_ranked.taskRowid
         INNER JOIN google_task_lists lists ON lists.id = tasks.task_list_id
         WHERE tasks.deleted_at IS NULL
           AND tasks.is_hidden = 0
           AND NOT (tasks.due_at IS NULL AND tasks.parent_task_id IS NULL AND tasks.status != 'completed')
           AND lists.deleted_at IS NULL

         UNION ALL

         SELECT
           events.id AS id,
           'calendar' AS domain,
           events.summary AS title,
           COALESCE(events.description, events.location, calendars.summary) AS snippet,
           NULL AS snoozeUntil,
           events.local_tags_json AS tagsJson,
           events.account_id AS accountId,
           events.description AS description,
           events.updated_at AS updatedAt
         FROM event_ranked
         INNER JOIN google_calendar_events events ON events.rowid = event_ranked.eventRowid
         INNER JOIN google_calendar_lists calendars ON calendars.id = events.calendar_id
         WHERE events.deleted_at IS NULL
           AND events.status != 'cancelled'
           AND calendars.deleted_at IS NULL

         UNION ALL

         SELECT
           tasks.id AS id,
           'notes' AS domain,
           tasks.title AS title,
           COALESCE(tasks.notes, '') AS snippet,
           NULL AS snoozeUntil,
           tasks.local_tags_json AS tagsJson,
           NULL AS accountId,
           NULL AS description,
           tasks.updated_at AS updatedAt
         FROM note_ranked
         INNER JOIN google_tasks tasks ON tasks.rowid = note_ranked.taskRowid
         INNER JOIN google_task_lists lists ON lists.id = tasks.task_list_id
         WHERE tasks.deleted_at IS NULL
           AND tasks.is_hidden = 0
           AND tasks.status != 'completed'
           AND tasks.parent_task_id IS NULL
           AND tasks.due_at IS NULL
           AND lists.deleted_at IS NULL

         ORDER BY updatedAt DESC, id ASC
         LIMIT ?;`,
        [ftsQuery, ftsQuery, ftsQuery, ftsQuery, ftsQuery, ftsQuery, limit]
      )
      .filter((row) => row.domain !== "calendar" || !this.isLinkedTaskProjection(row))
      .map((row) => ({
        id: row.id,
        domain: row.domain,
        title: row.title,
        snippet: row.domain === "notes" ? preview(row.snippet ?? "") : row.snippet ?? undefined,
        snoozeUntil: row.domain === "tasks" ? row.snoozeUntil : undefined,
        tags: parseTagsJson(row.tagsJson),
        updatedAt: row.updatedAt
      }));
  }

  private isLinkedTaskProjection(row: { accountId: string | null; description: string | null }): boolean {
    const googleId = googleTaskIdFromCalendarDescription(row.description);

    if (!googleId || !row.accountId) {
      return false;
    }

    return this.connection.get<{ id: string }>(
      `SELECT id
       FROM google_tasks
       WHERE account_id = ?
         AND google_id = ?
         AND deleted_at IS NULL
       LIMIT 1;`,
      [row.accountId, googleId]
    ) !== undefined;
  }

  private queryLimitClause(parsed: ParsedLocalSearchQuery, limit: number): { sql: string; params: number[] } {
    return parsed.filters.regex === undefined && parsed.boolean === undefined
      ? { sql: "LIMIT ?", params: [limit] }
      : parsed.boolean === undefined
        ? { sql: "", params: [] }
        : { sql: "LIMIT ?", params: [Math.max(200, limit * 10)] };
  }

  private filterSearchRows<T extends { title: string }>(
    parsed: ParsedLocalSearchQuery,
    rows: T[],
    bodyForRow: (row: T) => string | null | undefined,
    itemForRow: (row: T) => Parameters<typeof matchesLocalSearchItem>[1]
  ): T[] {
    const regexFiltered = this.filterRegexRows(parsed, rows, bodyForRow);

    return parsed.boolean === undefined
      ? regexFiltered
      : regexFiltered.filter((row) => matchesLocalSearchItem(parsed, itemForRow(row)));
  }

  private filterRegexRows<T extends { title: string }>(
    parsed: ParsedLocalSearchQuery,
    rows: T[],
    bodyForRow: (row: T) => string | null | undefined
  ): T[] {
    const pattern = parsed.filters.regex;

    if (pattern === undefined) {
      return rows;
    }

    return rows.filter((row) => matchesLocalSearchTextRegex(pattern, row.title, bodyForRow(row)));
  }

  private calendarSearchItems(rows: Array<{
    id: string;
    title: string;
    snippet: string | null;
    tagsJson: string | null;
    accountId: string;
    description: string | null;
    updatedAt: string;
  }>): SearchResultItem[] {
    return rows
      .filter((row) => !this.isLinkedTaskProjection(row))
      .map((row) => ({
        id: row.id,
        domain: "calendar" as const,
        title: row.title,
        snippet: row.snippet ?? undefined,
        tags: parseTagsJson(row.tagsJson),
        updatedAt: row.updatedAt
      }));
  }

  private searchTasks(
    parsed: ParsedLocalSearchQuery,
    ftsQuery: string,
    limit: number
  ): SearchResultItem[] {
    const { predicates, params } = taskSearchPredicates(parsed);
    const where = predicates.join(" AND ");
    const limitClause = this.queryLimitClause(parsed, limit);

    if (!ftsQuery) {
      const rows = this.connection
        .query<{
          id: string;
          title: string;
          snippet: string | null;
          body: string | null;
          snoozeUntil: string | null;
          tagsJson: string | null;
          listTitle: string | null;
          taskStatus: "active" | "completed" | "hidden" | "deleted";
          dueAt: string | null;
          priority: "none" | "low" | "medium" | "high" | null;
          durationMinutes: number | null;
          updatedAt: string;
        }>(
          `SELECT
             tasks.id AS id,
             tasks.title AS title,
             COALESCE(tasks.notes, lists.title) AS snippet,
             tasks.notes AS body,
             tasks.local_snooze_until AS snoozeUntil,
             tasks.local_tags_json AS tagsJson,
             lists.title AS listTitle,
             CASE
               WHEN tasks.deleted_at IS NOT NULL THEN 'deleted'
               WHEN tasks.is_hidden = 1 THEN 'hidden'
               WHEN tasks.status = 'completed' THEN 'completed'
               ELSE 'active'
             END AS taskStatus,
             tasks.due_at AS dueAt,
             COALESCE(tasks.local_priority, 'none') AS priority,
             tasks.local_duration_minutes AS durationMinutes,
             tasks.updated_at AS updatedAt
           FROM google_tasks tasks
           INNER JOIN google_task_lists lists ON lists.id = tasks.task_list_id
           WHERE ${where}
           ORDER BY
             CASE WHEN tasks.due_at IS NULL THEN 1 ELSE 0 END,
             tasks.due_at ASC,
             tasks.updated_at DESC,
             tasks.id ASC
           ${limitClause.sql};`,
          [...params, ...limitClause.params]
        );

      return this.filterSearchRows(parsed, rows, (row) => row.body, taskBooleanItem).slice(0, limit)
        .map((row) => ({
          id: row.id,
          domain: "tasks" as const,
          title: row.title,
          snippet: row.snippet ?? undefined,
          snoozeUntil: row.snoozeUntil,
          tags: parseTagsJson(row.tagsJson),
          updatedAt: row.updatedAt
        }));
    }

    const rows = this.connection
      .query<{
        id: string;
        title: string;
        snippet: string | null;
        body: string | null;
        snoozeUntil: string | null;
        tagsJson: string | null;
        listTitle: string | null;
        taskStatus: "active" | "completed" | "hidden" | "deleted";
        dueAt: string | null;
        priority: "none" | "low" | "medium" | "high" | null;
        durationMinutes: number | null;
        updatedAt: string;
      }>(
        `WITH matches AS (
           SELECT tasks.rowid AS taskRowid, bm25(google_tasks_fts) AS rank
           FROM google_tasks_fts
           INNER JOIN google_tasks tasks ON tasks.rowid = google_tasks_fts.rowid
           WHERE google_tasks_fts MATCH ?

           UNION ALL

           SELECT tasks.rowid AS taskRowid, bm25(google_task_lists_fts) + 2.0 AS rank
           FROM google_task_lists_fts
           INNER JOIN google_task_lists lists ON lists.rowid = google_task_lists_fts.rowid
           INNER JOIN google_tasks tasks ON tasks.task_list_id = lists.id
           WHERE google_task_lists_fts MATCH ?
         ),
         ranked AS (
           SELECT taskRowid, MIN(rank) AS rank
           FROM matches
           GROUP BY taskRowid
         )
           SELECT
             tasks.id AS id,
             tasks.title AS title,
             COALESCE(tasks.notes, lists.title) AS snippet,
             tasks.notes AS body,
             tasks.local_snooze_until AS snoozeUntil,
             tasks.local_tags_json AS tagsJson,
             lists.title AS listTitle,
             CASE
               WHEN tasks.deleted_at IS NOT NULL THEN 'deleted'
               WHEN tasks.is_hidden = 1 THEN 'hidden'
               WHEN tasks.status = 'completed' THEN 'completed'
               ELSE 'active'
             END AS taskStatus,
             tasks.due_at AS dueAt,
             COALESCE(tasks.local_priority, 'none') AS priority,
             tasks.local_duration_minutes AS durationMinutes,
             tasks.updated_at AS updatedAt
         FROM ranked
         INNER JOIN google_tasks tasks ON tasks.rowid = ranked.taskRowid
         INNER JOIN google_task_lists lists ON lists.id = tasks.task_list_id
         WHERE ${where}
         ORDER BY ranked.rank ASC, tasks.updated_at DESC, tasks.id ASC
         ${limitClause.sql};`,
        [ftsQuery, ftsQuery, ...params, ...limitClause.params]
      );

    return this.filterSearchRows(parsed, rows, (row) => row.body, taskBooleanItem).slice(0, limit)
      .map((row) => ({
        id: row.id,
        domain: "tasks" as const,
        title: row.title,
        snippet: row.snippet ?? undefined,
        snoozeUntil: row.snoozeUntil,
        tags: parseTagsJson(row.tagsJson),
        updatedAt: row.updatedAt
      }));
  }

  private searchEvents(
    parsed: ParsedLocalSearchQuery,
    ftsQuery: string,
    limit: number
  ): SearchResultItem[] {
    const { predicates, params } = eventSearchPredicates(parsed);
    const where = predicates.join(" AND ");
    const limitClause = this.queryLimitClause(parsed, limit);

    if (!ftsQuery) {
      const rows = this.connection
        .query<{
          id: string;
          title: string;
          snippet: string | null;
          tagsJson: string | null;
          accountId: string;
          calendarTitle: string | null;
          description: string | null;
          startAt: string | null;
          attendeeEmailsJson: string | null;
          updatedAt: string;
        }>(
          `SELECT
             events.id AS id,
             events.summary AS title,
             COALESCE(events.description, events.location, calendars.summary) AS snippet,
             events.local_tags_json AS tagsJson,
             events.account_id AS accountId,
             calendars.summary AS calendarTitle,
             events.description AS description,
             events.start_at AS startAt,
             events.attendee_emails_json AS attendeeEmailsJson,
             events.updated_at AS updatedAt
           FROM google_calendar_events events
           INNER JOIN google_calendar_lists calendars ON calendars.id = events.calendar_id
           WHERE ${where}
           ORDER BY events.start_at ASC, events.updated_at DESC, events.id ASC
           ${limitClause.sql};`,
          [...params, ...limitClause.params]
        );

      return this.calendarSearchItems(this.filterSearchRows(parsed, rows, (row) => row.description, eventBooleanItem)).slice(0, limit);
    }

    const rows = this.connection
      .query<{
        id: string;
        title: string;
        snippet: string | null;
        tagsJson: string | null;
        accountId: string;
        calendarTitle: string | null;
        description: string | null;
        startAt: string | null;
        attendeeEmailsJson: string | null;
        updatedAt: string;
      }>(
        `WITH matches AS (
           SELECT events.rowid AS eventRowid, bm25(google_calendar_events_fts) AS rank
           FROM google_calendar_events_fts
           INNER JOIN google_calendar_events events ON events.rowid = google_calendar_events_fts.rowid
           WHERE google_calendar_events_fts MATCH ?

           UNION ALL

           SELECT events.rowid AS eventRowid, bm25(google_calendar_lists_fts) + 2.0 AS rank
           FROM google_calendar_lists_fts
           INNER JOIN google_calendar_lists calendars ON calendars.rowid = google_calendar_lists_fts.rowid
           INNER JOIN google_calendar_events events ON events.calendar_id = calendars.id
           WHERE google_calendar_lists_fts MATCH ?
         ),
         ranked AS (
           SELECT eventRowid, MIN(rank) AS rank
           FROM matches
           GROUP BY eventRowid
         )
         SELECT
           events.id AS id,
           events.summary AS title,
           COALESCE(events.description, events.location, calendars.summary) AS snippet,
           events.local_tags_json AS tagsJson,
           events.account_id AS accountId,
           calendars.summary AS calendarTitle,
           events.description AS description,
           events.start_at AS startAt,
           events.attendee_emails_json AS attendeeEmailsJson,
           events.updated_at AS updatedAt
         FROM ranked
         INNER JOIN google_calendar_events events ON events.rowid = ranked.eventRowid
         INNER JOIN google_calendar_lists calendars ON calendars.id = events.calendar_id
         WHERE ${where}
         ORDER BY ranked.rank ASC, events.updated_at DESC, events.id ASC
         ${limitClause.sql};`,
        [ftsQuery, ftsQuery, ...params, ...limitClause.params]
      );

    return this.calendarSearchItems(this.filterSearchRows(parsed, rows, (row) => row.description, eventBooleanItem)).slice(0, limit);
  }

  private searchNotes(
    parsed: ParsedLocalSearchQuery,
    ftsQuery: string,
    limit: number
  ): SearchResultItem[] {
    const { predicates, params } = noteSearchPredicates(parsed);
    const where = predicates.join(" AND ");
    const limitClause = this.queryLimitClause(parsed, limit);

    if (!ftsQuery) {
      const rows = this.connection
        .query<{
          id: string;
          title: string;
          body: string;
          tagsJson: string | null;
          updatedAt: string;
        }>(
          `SELECT tasks.id AS id,
                  tasks.title AS title,
                  COALESCE(tasks.notes, '') AS body,
                  tasks.local_tags_json AS tagsJson,
                  tasks.updated_at AS updatedAt
           FROM google_tasks tasks
           INNER JOIN google_task_lists lists ON lists.id = tasks.task_list_id
           WHERE ${where}
           ORDER BY tasks.updated_at DESC, tasks.id ASC
           ${limitClause.sql};`,
          [...params, ...limitClause.params]
        );

      return this.filterSearchRows(parsed, rows, (row) => row.body, noteBooleanItem).slice(0, limit)
        .map((row) => ({
          id: row.id,
          domain: "notes" as const,
          title: row.title,
          snippet: preview(row.body),
          tags: parseTagsJson(row.tagsJson),
          updatedAt: row.updatedAt
        }));
    }

    const rows = this.connection
      .query<{
        id: string;
        title: string;
        body: string;
        tagsJson: string | null;
        updatedAt: string;
      }>(
        `SELECT tasks.id AS id,
                tasks.title AS title,
                COALESCE(tasks.notes, '') AS body,
                tasks.local_tags_json AS tagsJson,
                tasks.updated_at AS updatedAt
         FROM google_tasks_fts
         INNER JOIN google_tasks tasks ON tasks.rowid = google_tasks_fts.rowid
         INNER JOIN google_task_lists lists ON lists.id = tasks.task_list_id
         WHERE google_tasks_fts MATCH ?
           AND ${where}
         ORDER BY bm25(google_tasks_fts) ASC, tasks.updated_at DESC, tasks.id ASC
         ${limitClause.sql};`,
        [ftsQuery, ...params, ...limitClause.params]
      );

    return this.filterSearchRows(parsed, rows, (row) => row.body, noteBooleanItem).slice(0, limit)
      .map((row) => ({
        id: row.id,
        domain: "notes" as const,
        title: row.title,
        snippet: preview(row.body),
        tags: parseTagsJson(row.tagsJson),
        updatedAt: row.updatedAt
      }));
  }

  listNotes(request: NoteListRequest): NoteListResponse {
    return this.measureSqlite("notes.list", () => {
      const { limit, offset } = pageBounds(request.cursor, request.limit, 50, 100);
      const rows = this.connection.query<TaskBackedNoteRow>(
        `SELECT tasks.id AS id,
                tasks.task_list_id AS listId,
                lists.title AS listTitle,
                tasks.title AS title,
                COALESCE(tasks.notes, '') AS body,
                tasks.local_tags_json AS tagsJson,
                tasks.updated_at AS updatedAt
         FROM google_tasks tasks
         INNER JOIN google_task_lists lists ON lists.id = tasks.task_list_id
         WHERE ${this.notePredicate("tasks", "lists")}
         ORDER BY tasks.updated_at DESC, tasks.id ASC
         LIMIT ? OFFSET ?;`,
        [limit, offset]
      );
      const totalKnown = countRows(
        this.connection,
        `SELECT COUNT(*) AS count
         FROM google_tasks tasks
         INNER JOIN google_task_lists lists ON lists.id = tasks.task_list_id
         WHERE ${this.notePredicate("tasks", "lists")};`
      );

      return {
        ...pageFromRows(rows.map(noteSummary), limit, offset, totalKnown),
        lists: this.listNoteLists()
      };
    });
  }

  getNote(id: string): NoteDetail {
    return this.measureSqlite("notes.get", () => {
      const row = this.noteRowById(id);

      if (!row) {
        throw notFound("Note was not found.");
      }

      return noteDetail(row);
    });
  }

  createNoteList(request: NoteListCreateRequest): NoteListSummary {
    const created = this.createTaskList(request);
    return this.requireNoteListSummary(created.id);
  }

  renameNoteList(request: NoteListRenameRequest): NoteListSummary {
    const renamed = this.renameTaskList(request);
    return this.requireNoteListSummary(renamed.id);
  }

  deleteNoteList(request: NoteListDeleteRequest): { id: string; queued: boolean; revision: string } {
    return this.deleteTaskList(request);
  }

  createNote(request: NoteCreateRequest): NoteDetail {
    return this.measureSqlite("notes.create", () => {
      const created = this.createTask({
        title: request.title,
        notes: request.body ?? "",
        listId: this.noteListIdOrDefault(request.listId),
        dueDate: null,
        parentId: null,
        priority: "none",
        tags: request.tags ?? []
      });

      return this.getNote(created.id);
    });
  }

  updateNote(request: NoteUpdateRequest): NoteDetail {
    return this.measureSqlite("notes.update", () => {
      const existing = this.requireTaskForMutation(request.id);

      if (existing.status === "completed") {
        this.reopenTask({ id: request.id });
      }

      this.updateTask({
        id: request.id,
        ...(request.title === undefined ? {} : { title: request.title }),
        ...(request.body === undefined ? {} : { notes: request.body }),
        ...(request.listId === undefined ? {} : { listId: this.noteListIdOrDefault(request.listId) }),
        ...(request.tags === undefined ? {} : { tags: request.tags }),
        dueDate: null,
        parentId: null
      });

      return this.getNote(request.id);
    });
  }

  deleteNote(request: NoteDeleteRequest): { id: string; queued: boolean; revision: string } {
    return this.deleteTask(request);
  }

  suggestLinkTargets(request: NoteLinkSuggestRequest): NoteLinkSuggestResponse {
    return this.measureSqlite("notes.linkSuggest", () => {
      const query = `%${request.query}%`;
      const kinds = new Set(request.kinds ?? ["note", "task", "event"]);
      const limit = request.limit ?? 8;
      const items: NoteLinkSuggestResponse["items"] = [];

      if (kinds.has("note")) {
        const rows = this.connection.query<{ id: string; label: string }>(
          `SELECT tasks.id, tasks.title AS label
           FROM google_tasks tasks
           INNER JOIN google_task_lists lists ON lists.id = tasks.task_list_id
           WHERE ${this.notePredicate("tasks", "lists")}
             AND tasks.title LIKE ? COLLATE NOCASE
           ORDER BY tasks.updated_at DESC, tasks.id ASC
           LIMIT ?;`,
          [query, limit]
        );
        items.push(...rows.map((row) => ({ kind: "note" as const, id: row.id, label: row.label })));
      }

      if (kinds.has("task") && items.length < limit) {
        const rows = this.connection.query<{ id: string; label: string }>(
          `SELECT tasks.id, tasks.title AS label
           FROM google_tasks tasks
           INNER JOIN google_task_lists lists ON lists.id = tasks.task_list_id
           WHERE tasks.deleted_at IS NULL
             AND tasks.is_hidden = 0
             AND lists.deleted_at IS NULL
             AND NOT (tasks.due_at IS NULL AND tasks.parent_task_id IS NULL AND tasks.status != 'completed')
             AND tasks.title LIKE ? COLLATE NOCASE
           ORDER BY tasks.updated_at DESC, tasks.id ASC
           LIMIT ?;`,
          [query, limit - items.length]
        );
        items.push(...rows.map((row) => ({ kind: "task" as const, id: row.id, label: row.label })));
      }

      if (kinds.has("event") && items.length < limit) {
        const rows = this.connection.query<{ id: string; label: string }>(
          `SELECT id, summary AS label
           FROM google_calendar_events
           WHERE deleted_at IS NULL
             AND status != 'cancelled'
             AND summary LIKE ? COLLATE NOCASE
           ORDER BY updated_at DESC, id ASC
           LIMIT ?;`,
          [query, limit - items.length]
        );
        items.push(...rows.map((row) => ({ kind: "event" as const, id: row.id, label: row.label })));
      }

      return { items: items.slice(0, limit) };
    });
  }

  listBrokenNoteLinks(request: NoteBrokenLinksRequest): NoteBrokenLinksResponse {
    return this.measureSqlite("notes.listBrokenLinks", () => {
      const entityKind = request.entityKind ?? "note";
      const entityId = request.entityId ?? request.noteId;

      if (!entityId) {
        throw validationFailure("An entity id is required.");
      }

      const links = this.listEntityLinks({ entityKind, entityId });
      const items = links.broken.map((link) => ({ linkText: link.raw, link }));

      return { items };
    });
  }

  listEntityLinks(request: NoteEntityLinksRequest): NoteEntityLinksResponse {
    return this.measureSqlite("notes.entityLinks", () => {
      this.refreshEntityLinks();

      const params = [request.entityKind, request.entityId];
      const outgoing = this.connection
        .query<EntityLinkRow>(
          `SELECT source_kind AS sourceKind,
                  source_id AS sourceId,
                  source_field AS sourceField,
                  target_kind AS targetKind,
                  target_id AS targetId,
                  target_label AS targetLabel,
                  raw,
                  alias,
                  link_type AS linkType,
                  broken
           FROM local_entity_links
           WHERE source_kind = ?
             AND source_id = ?
           ORDER BY source_field ASC, link_type ASC, target_kind ASC, target_label COLLATE NOCASE ASC, raw ASC;`,
          params
        )
        .map(entityLink);
      const backlinks = this.connection
        .query<EntityLinkRow>(
          `SELECT source_kind AS sourceKind,
                  source_id AS sourceId,
                  source_field AS sourceField,
                  target_kind AS targetKind,
                  target_id AS targetId,
                  target_label AS targetLabel,
                  raw,
                  alias,
                  link_type AS linkType,
                  broken
           FROM local_entity_links
           WHERE target_kind = ?
             AND target_id = ?
             AND broken = 0
           ORDER BY source_kind ASC, source_id ASC, source_field ASC, raw ASC;`,
          params
        )
        .map(entityLink);

      return {
        outgoing,
        backlinks,
        broken: outgoing.filter((link) => link.broken)
      };
    });
  }

  private listNoteLists(): NoteListResponse["lists"] {
    const rows = this.connection.query<TaskBackedNoteListRow>(
      `SELECT lists.id,
              lists.title,
              lists.updated_at AS updatedAt,
              COALESCE(SUM(CASE WHEN ${this.notePredicate("tasks", "lists")} THEN 1 ELSE 0 END), 0) AS noteCount
       FROM google_task_lists lists
       LEFT JOIN google_tasks tasks ON tasks.task_list_id = lists.id
       WHERE lists.deleted_at IS NULL
       GROUP BY lists.id, lists.title, lists.updated_at, lists.sort_order
       ORDER BY lists.sort_order ASC, lists.title COLLATE NOCASE ASC, lists.id ASC;`
    );

    return rows.map(noteListSummary);
  }

  private requireNoteListSummary(id: string): NoteListSummary {
    const list = this.listNoteLists().find((candidate) => candidate.id === id);

    if (!list) {
      throw notFound("Note list was not found.");
    }

    return list;
  }

  private noteRowById(id: string): TaskBackedNoteRow | null {
    return this.connection.get<TaskBackedNoteRow>(
      `SELECT tasks.id AS id,
              tasks.task_list_id AS listId,
              lists.title AS listTitle,
              tasks.title AS title,
              COALESCE(tasks.notes, '') AS body,
              tasks.local_tags_json AS tagsJson,
              tasks.updated_at AS updatedAt
       FROM google_tasks tasks
       INNER JOIN google_task_lists lists ON lists.id = tasks.task_list_id
       WHERE tasks.id = ?
         AND ${this.notePredicate("tasks", "lists")}
       LIMIT 1;`,
      [id]
    ) ?? null;
  }

  private noteListIdOrDefault(listId: string | undefined): string {
    if (listId !== undefined) {
      const existing = this.connection.get<{ id: string }>(
        `SELECT id
         FROM google_task_lists
         WHERE id = ? AND deleted_at IS NULL
         LIMIT 1;`,
        [listId]
      );

      if (!existing) {
        throw notFound("Note list was not found.");
      }

      return existing.id;
    }

    const first = this.connection.get<{ id: string }>(
      `SELECT id
       FROM google_task_lists
       WHERE deleted_at IS NULL
       ORDER BY sort_order ASC, title COLLATE NOCASE ASC, id ASC
       LIMIT 1;`
    );

    if (!first) {
      throw validationFailure("No task list is available for notes.");
    }

    return first.id;
  }

  private refreshEntityLinks(): void {
    const now = new Date().toISOString();
    const operations = this.entityLinkSources().flatMap((source) =>
      extractPlannerLinks(source.body).map((link) => {
        const targetId = this.resolveLinkTargetId(link);
        const id = createHash("sha256")
          .update([
            source.kind,
            source.id,
            source.sourceField,
            link.kind,
            link.type,
            link.raw,
            link.label
          ].join("\n"))
          .digest("hex");

        return {
          kind: "run" as const,
          sql: `INSERT INTO local_entity_links (
                  id, source_kind, source_id, source_field, target_kind, target_id,
                  target_label, raw, alias, link_type, broken, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  target_id = excluded.target_id,
                  target_label = excluded.target_label,
                  raw = excluded.raw,
                  alias = excluded.alias,
                  link_type = excluded.link_type,
                  broken = excluded.broken,
                  updated_at = excluded.updated_at;`,
          params: [
            id,
            source.kind,
            source.id,
            source.sourceField,
            link.kind,
            targetId,
            link.label,
            link.raw,
            link.alias,
            link.type,
            targetId === null ? 1 : 0,
            now
          ]
        };
      })
    );

    this.connection.executeTransaction([
      {
        kind: "run",
        sql: "DELETE FROM local_entity_links;"
      },
      ...operations
    ]);
  }

  private entityLinkSources(): EntityLinkSourceRow[] {
    const notes = this.connection.query<EntityLinkSourceRow>(
      `SELECT 'note' AS kind,
              tasks.id AS id,
              tasks.title AS title,
              COALESCE(tasks.notes, '') AS body,
              'body' AS sourceField
       FROM google_tasks tasks
       INNER JOIN google_task_lists lists ON lists.id = tasks.task_list_id
       WHERE ${this.notePredicate("tasks", "lists")};`
    );
    const tasks = this.connection.query<EntityLinkSourceRow>(
      `SELECT 'task' AS kind,
              tasks.id AS id,
              tasks.title AS title,
              COALESCE(tasks.notes, '') AS body,
              'notes' AS sourceField
       FROM google_tasks tasks
       INNER JOIN google_task_lists lists ON lists.id = tasks.task_list_id
       WHERE tasks.deleted_at IS NULL
         AND tasks.is_hidden = 0
         AND lists.deleted_at IS NULL
         AND NOT (${this.notePredicate("tasks", "lists")});`
    );
    const events = this.connection.query<EntityLinkSourceRow>(
      `SELECT 'event' AS kind,
              id,
              summary AS title,
              COALESCE(description, '') AS body,
              'description' AS sourceField
       FROM google_calendar_events
       WHERE deleted_at IS NULL
         AND status != 'cancelled';`
    );
    const lists = this.connection.query<EntityLinkSourceRow>(
      `SELECT 'list' AS kind,
              id,
              title,
              title AS body,
              'title' AS sourceField
       FROM google_task_lists
       WHERE deleted_at IS NULL;`
    );
    const calendars = this.connection.query<EntityLinkSourceRow>(
      `SELECT 'calendar' AS kind,
              id,
              summary AS title,
              summary AS body,
              'title' AS sourceField
       FROM google_calendar_lists
       WHERE deleted_at IS NULL;`
    );

    return [...notes, ...tasks, ...events, ...lists, ...calendars];
  }

  private resolveLinkTargetId(link: PlannerLinkReference): string | null {
    if (link.targetId) {
      return this.entityExists(link.kind, link.targetId) ? link.targetId : null;
    }

    if (link.kind === "note") {
      return this.connection.get<{ id: string }>(
        `SELECT tasks.id
         FROM google_tasks tasks
         INNER JOIN google_task_lists lists ON lists.id = tasks.task_list_id
         WHERE ${this.notePredicate("tasks", "lists")}
           AND (tasks.id = ? OR LOWER(tasks.title) = LOWER(?))
         LIMIT 1;`,
        [link.label, link.label]
      )?.id ?? null;
    }

    if (link.kind === "task") {
      return this.connection.get<{ id: string }>(
        `SELECT tasks.id
         FROM google_tasks tasks
         INNER JOIN google_task_lists lists ON lists.id = tasks.task_list_id
         WHERE tasks.deleted_at IS NULL
           AND tasks.is_hidden = 0
           AND lists.deleted_at IS NULL
           AND NOT (tasks.due_at IS NULL AND tasks.parent_task_id IS NULL AND tasks.status != 'completed')
           AND (tasks.id = ? OR LOWER(tasks.title) = LOWER(?))
         LIMIT 1;`,
        [link.label, link.label]
      )?.id ?? null;
    }

    if (link.kind === "event") {
      return this.connection.get<{ id: string }>(
      `SELECT id
       FROM google_calendar_events
       WHERE deleted_at IS NULL
         AND status != 'cancelled'
         AND (id = ? OR LOWER(summary) = LOWER(?))
       LIMIT 1;`,
        [link.label, link.label]
      )?.id ?? null;
    }

    if (link.kind === "list") {
      return this.connection.get<{ id: string }>(
        `SELECT id
         FROM google_task_lists
         WHERE deleted_at IS NULL
           AND (id = ? OR LOWER(title) = LOWER(?))
         LIMIT 1;`,
        [link.label, link.label]
      )?.id ?? null;
    }

    return this.connection.get<{ id: string }>(
      `SELECT id
       FROM google_calendar_lists
       WHERE deleted_at IS NULL
         AND (id = ? OR LOWER(summary) = LOWER(?))
       LIMIT 1;`,
      [link.label, link.label]
    )?.id ?? null;
  }

  private entityExists(kind: NoteEntityKind, id: string): boolean {
    return this.resolveLinkTargetId({
      alias: null,
      kind,
      label: id,
      raw: id,
      targetId: null,
      type: "wikilink"
    }) === id;
  }

  private notePredicate(taskAlias: string, listAlias: string): string {
    return `${taskAlias}.deleted_at IS NULL
      AND ${taskAlias}.is_hidden = 0
      AND ${taskAlias}.status != 'completed'
      AND ${taskAlias}.parent_task_id IS NULL
      AND ${taskAlias}.due_at IS NULL
      AND ${listAlias}.deleted_at IS NULL`;
  }
}

function entityLink(row: EntityLinkRow): NoteEntityLink {
  return {
    sourceKind: row.sourceKind,
    sourceId: row.sourceId,
    sourceField: row.sourceField,
    targetKind: row.targetKind,
    targetId: row.targetId,
    targetLabel: row.targetLabel,
    raw: row.raw,
    alias: row.alias,
    linkType: row.linkType,
    broken: row.broken === 1
  };
}

function taskBooleanItem(row: {
  title: string;
  body: string | null;
  tagsJson: string | null;
  listTitle: string | null;
  taskStatus: "active" | "completed" | "hidden" | "deleted";
  dueAt: string | null;
  priority: "none" | "low" | "medium" | "high" | null;
  durationMinutes: number | null;
}): Parameters<typeof matchesLocalSearchItem>[1] {
  return {
    domain: "tasks",
    title: row.title,
    body: row.body,
    tags: parseTagsJson(row.tagsJson),
    listTitle: row.listTitle,
    taskStatus: row.taskStatus,
    dueAt: row.dueAt,
    priority: row.priority,
    durationMinutes: row.durationMinutes
  };
}

function eventBooleanItem(row: {
  title: string;
  description: string | null;
  tagsJson: string | null;
  calendarTitle: string | null;
  startAt: string | null;
  attendeeEmailsJson: string | null;
}): Parameters<typeof matchesLocalSearchItem>[1] {
  return {
    domain: "calendar",
    title: row.title,
    body: row.description,
    tags: parseTagsJson(row.tagsJson),
    calendarTitle: row.calendarTitle,
    startAt: row.startAt,
    attendeeEmails: parseStringArray(row.attendeeEmailsJson)
  };
}

function noteBooleanItem(row: {
  title: string;
  body: string;
  tagsJson: string | null;
}): Parameters<typeof matchesLocalSearchItem>[1] {
  return {
    domain: "notes",
    title: row.title,
    body: row.body,
    tags: parseTagsJson(row.tagsJson)
  };
}

const EMBEDDING_DIMENSIONS = 384;

function hashedEmbedding(text: string): number[] {
  const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0);
  const tokens = text
    .toLocaleLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length > 1);

  for (const token of tokens) {
    const digest = createHash("sha256").update(token).digest();
    const index = digest.readUInt16BE(0) % EMBEDDING_DIMENSIONS;
    const sign = digest[2] % 2 === 0 ? 1 : -1;
    vector[index] += sign;
  }

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return magnitude === 0 ? vector : vector.map((value) => value / magnitude);
}

function parseVector(value: string): number[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.map((entry) => typeof entry === "number" ? entry : 0).slice(0, EMBEDDING_DIMENSIONS)
      : [];
  } catch {
    return [];
  }
}

function cosine(left: readonly number[], right: readonly number[]): number {
  const length = Math.min(left.length, right.length);
  let sum = 0;

  for (let index = 0; index < length; index += 1) {
    sum += (left[index] ?? 0) * (right[index] ?? 0);
  }

  return Math.max(0, sum);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
