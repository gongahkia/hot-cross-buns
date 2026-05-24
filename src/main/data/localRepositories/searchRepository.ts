import { performance } from "node:perf_hooks";
import type {
  SearchQueryRequest,
  SearchQueryResponse,
  SearchResultItem
} from "@shared/ipc/contracts";
import { HcbPublicError } from "@shared/ipc/result";
import {
  hasRunnableLocalSearch,
  parseLocalSearchQuery,
  resolveLocalSearchDomains,
  type ParsedLocalSearchQuery
} from "@shared/search/localSearch";
import { preview } from "./mappers";
import { NoteLocalRepository } from "./noteRepository";
import {
  eventSearchPredicates,
  ftsMatchQuery,
  noteSearchPredicates,
  taskSearchPredicates
} from "./searchPredicates";
import type { SearchDomain } from "./types";

export class SearchLocalRepository extends NoteLocalRepository {
  search(request: SearchQueryRequest): SearchQueryResponse {
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
        const ftsQuery = ftsMatchQuery(parsed.text);
        const results: SearchResultItem[] = [];

        if (!hasRunnableLocalSearch(parsed) || (!ftsQuery && parsed.chips.length === 0)) {
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

          return {
            items,
            page: {
              limit,
              totalKnown: items.length
            }
          };
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

        return {
          items: sorted,
          page: {
            limit,
            totalKnown: results.length
          }
        };
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

  private searchAllDomains(ftsQuery: string, limit: number): SearchResultItem[] {
    return this.connection
      .query<{
        id: string;
        domain: SearchDomain;
        title: string;
        snippet: string | null;
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
           tasks.updated_at AS updatedAt
         FROM task_ranked
         INNER JOIN google_tasks tasks ON tasks.rowid = task_ranked.taskRowid
         INNER JOIN google_task_lists lists ON lists.id = tasks.task_list_id
         WHERE tasks.deleted_at IS NULL
           AND tasks.is_hidden = 0
           AND lists.deleted_at IS NULL

         UNION ALL

         SELECT
           events.id AS id,
           'calendar' AS domain,
           events.summary AS title,
           COALESCE(events.description, events.location, calendars.summary) AS snippet,
           events.updated_at AS updatedAt
         FROM event_ranked
         INNER JOIN google_calendar_events events ON events.rowid = event_ranked.eventRowid
         INNER JOIN google_calendar_lists calendars ON calendars.id = events.calendar_id
         WHERE events.deleted_at IS NULL
           AND events.status != 'cancelled'
           AND calendars.deleted_at IS NULL

         UNION ALL

         SELECT
           notes.id AS id,
           'notes' AS domain,
           notes.title AS title,
           notes.body AS snippet,
           notes.updated_at AS updatedAt
         FROM local_notes_fts
         INNER JOIN local_notes notes ON notes.rowid = local_notes_fts.rowid
         WHERE local_notes_fts MATCH ?
           AND notes.deleted_at IS NULL

         ORDER BY updatedAt DESC, id ASC
         LIMIT ?;`,
        [ftsQuery, ftsQuery, ftsQuery, ftsQuery, ftsQuery, limit]
      )
      .map((row) => ({
        id: row.id,
        domain: row.domain,
        title: row.title,
        snippet: row.domain === "notes" ? preview(row.snippet ?? "") : row.snippet ?? undefined,
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

    if (!ftsQuery) {
      return this.connection
        .query<{
          id: string;
          title: string;
          snippet: string | null;
          updatedAt: string;
        }>(
          `SELECT
             tasks.id AS id,
             tasks.title AS title,
             COALESCE(tasks.notes, lists.title) AS snippet,
             tasks.updated_at AS updatedAt
           FROM google_tasks tasks
           INNER JOIN google_task_lists lists ON lists.id = tasks.task_list_id
           WHERE ${where}
           ORDER BY
             CASE WHEN tasks.due_at IS NULL THEN 1 ELSE 0 END,
             tasks.due_at ASC,
             tasks.updated_at DESC,
             tasks.id ASC
           LIMIT ?;`,
          [...params, limit]
        )
        .map((row) => ({
          id: row.id,
          domain: "tasks" as const,
          title: row.title,
          snippet: row.snippet ?? undefined,
          updatedAt: row.updatedAt
        }));
    }

    return this.connection
      .query<{
        id: string;
        title: string;
        snippet: string | null;
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
           tasks.updated_at AS updatedAt
         FROM ranked
         INNER JOIN google_tasks tasks ON tasks.rowid = ranked.taskRowid
         INNER JOIN google_task_lists lists ON lists.id = tasks.task_list_id
         WHERE ${where}
         ORDER BY ranked.rank ASC, tasks.updated_at DESC, tasks.id ASC
         LIMIT ?;`,
        [ftsQuery, ftsQuery, ...params, limit]
      )
      .map((row) => ({
        id: row.id,
        domain: "tasks" as const,
        title: row.title,
        snippet: row.snippet ?? undefined,
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

    if (!ftsQuery) {
      return this.connection
        .query<{
          id: string;
          title: string;
          snippet: string | null;
          updatedAt: string;
        }>(
          `SELECT
             events.id AS id,
             events.summary AS title,
             COALESCE(events.description, events.location, calendars.summary) AS snippet,
             events.updated_at AS updatedAt
           FROM google_calendar_events events
           INNER JOIN google_calendar_lists calendars ON calendars.id = events.calendar_id
           WHERE ${where}
           ORDER BY events.start_at ASC, events.updated_at DESC, events.id ASC
           LIMIT ?;`,
          [...params, limit]
        )
        .map((row) => ({
          id: row.id,
          domain: "calendar" as const,
          title: row.title,
          snippet: row.snippet ?? undefined,
          updatedAt: row.updatedAt
        }));
    }

    return this.connection
      .query<{
        id: string;
        title: string;
        snippet: string | null;
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
           events.updated_at AS updatedAt
         FROM ranked
         INNER JOIN google_calendar_events events ON events.rowid = ranked.eventRowid
         INNER JOIN google_calendar_lists calendars ON calendars.id = events.calendar_id
         WHERE ${where}
         ORDER BY ranked.rank ASC, events.updated_at DESC, events.id ASC
         LIMIT ?;`,
        [ftsQuery, ftsQuery, ...params, limit]
      )
      .map((row) => ({
        id: row.id,
        domain: "calendar" as const,
        title: row.title,
        snippet: row.snippet ?? undefined,
        updatedAt: row.updatedAt
      }));
  }

  private searchNotes(
    parsed: ParsedLocalSearchQuery,
    ftsQuery: string,
    limit: number
  ): SearchResultItem[] {
    const { predicates, params } = noteSearchPredicates(parsed);
    const where = predicates.join(" AND ");

    if (!ftsQuery) {
      return this.connection
        .query<{
          id: string;
          title: string;
          body: string;
          updatedAt: string;
        }>(
          `SELECT notes.id AS id, notes.title AS title, notes.body AS body, notes.updated_at AS updatedAt
           FROM local_notes notes
           WHERE ${where}
           ORDER BY notes.updated_at DESC, notes.id ASC
           LIMIT ?;`,
          [...params, limit]
        )
        .map((row) => ({
          id: row.id,
          domain: "notes" as const,
          title: row.title,
          snippet: preview(row.body),
          updatedAt: row.updatedAt
        }));
    }

    return this.connection
      .query<{
        id: string;
        title: string;
        body: string;
        updatedAt: string;
      }>(
        `SELECT notes.id AS id, notes.title AS title, notes.body AS body, notes.updated_at AS updatedAt
         FROM local_notes_fts
         INNER JOIN local_notes notes ON notes.rowid = local_notes_fts.rowid
         WHERE local_notes_fts MATCH ?
           AND ${where}
         ORDER BY bm25(local_notes_fts) ASC, notes.updated_at DESC, notes.id ASC
         LIMIT ?;`,
        [ftsQuery, ...params, limit]
      )
      .map((row) => ({
        id: row.id,
        domain: "notes" as const,
        title: row.title,
        snippet: preview(row.body),
        updatedAt: row.updatedAt
      }));
  }
}
