import { performance } from "node:perf_hooks";
import type {
  NoteBrokenLinksRequest,
  NoteBrokenLinksResponse,
  NoteCreateRequest,
  NoteDeleteRequest,
  NoteDetail,
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
  parseLocalSearchQuery,
  resolveLocalSearchDomains,
  type ParsedLocalSearchQuery
} from "@shared/search/localSearch";
import { googleTaskIdFromCalendarDescription } from "./googleTaskProjection";
import { noteDetail, noteListSummary, noteSummary, preview } from "./mappers";
import { extractPlannerLinks, type PlannerLinkReference } from "./noteLinks";
import { ScheduledTaskBlockLocalRepository } from "./scheduledTaskBlockRepository";
import {
  eventSearchPredicates,
  ftsMatchQuery,
  noteSearchPredicates,
  taskSearchPredicates
} from "./searchPredicates";
import { countRows, notFound, pageBounds, pageFromRows, validationFailure } from "./shared";
import type { SearchDomain } from "./types";

interface TaskBackedNoteRow extends Record<string, unknown> {
  id: string;
  listId: string;
  listTitle: string;
  title: string;
  body: string;
  updatedAt: string;
}

interface TaskBackedNoteListRow extends Record<string, unknown> {
  id: string;
  title: string;
  updatedAt: string;
  noteCount: number;
}

export class SearchLocalRepository extends ScheduledTaskBlockLocalRepository {
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

  private calendarSearchItems(rows: Array<{
    id: string;
    title: string;
    snippet: string | null;
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
      const rows = this.connection
        .query<{
          id: string;
          title: string;
          snippet: string | null;
          accountId: string;
          description: string | null;
          updatedAt: string;
        }>(
          `SELECT
             events.id AS id,
             events.summary AS title,
             COALESCE(events.description, events.location, calendars.summary) AS snippet,
             events.account_id AS accountId,
             events.description AS description,
             events.updated_at AS updatedAt
           FROM google_calendar_events events
           INNER JOIN google_calendar_lists calendars ON calendars.id = events.calendar_id
           WHERE ${where}
           ORDER BY events.start_at ASC, events.updated_at DESC, events.id ASC
           LIMIT ?;`,
          [...params, limit]
        );

      return this.calendarSearchItems(rows);
    }

    const rows = this.connection
      .query<{
        id: string;
        title: string;
        snippet: string | null;
        accountId: string;
        description: string | null;
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
           events.account_id AS accountId,
           events.description AS description,
           events.updated_at AS updatedAt
         FROM ranked
         INNER JOIN google_calendar_events events ON events.rowid = ranked.eventRowid
         INNER JOIN google_calendar_lists calendars ON calendars.id = events.calendar_id
         WHERE ${where}
         ORDER BY ranked.rank ASC, events.updated_at DESC, events.id ASC
         LIMIT ?;`,
        [ftsQuery, ftsQuery, ...params, limit]
      );

    return this.calendarSearchItems(rows);
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
          `SELECT tasks.id AS id,
                  tasks.title AS title,
                  COALESCE(tasks.notes, '') AS body,
                  tasks.updated_at AS updatedAt
           FROM google_tasks tasks
           INNER JOIN google_task_lists lists ON lists.id = tasks.task_list_id
           WHERE ${where}
           ORDER BY tasks.updated_at DESC, tasks.id ASC
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
        `SELECT tasks.id AS id,
                tasks.title AS title,
                COALESCE(tasks.notes, '') AS body,
                tasks.updated_at AS updatedAt
         FROM google_tasks_fts
         INNER JOIN google_tasks tasks ON tasks.rowid = google_tasks_fts.rowid
         INNER JOIN google_task_lists lists ON lists.id = tasks.task_list_id
         WHERE google_tasks_fts MATCH ?
           AND ${where}
         ORDER BY bm25(google_tasks_fts) ASC, tasks.updated_at DESC, tasks.id ASC
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

  listNotes(request: NoteListRequest): NoteListResponse {
    return this.measureSqlite("notes.list", () => {
      const { limit, offset } = pageBounds(request.cursor, request.limit, 50, 100);
      const rows = this.connection.query<TaskBackedNoteRow>(
        `SELECT tasks.id AS id,
                tasks.task_list_id AS listId,
                lists.title AS listTitle,
                tasks.title AS title,
                COALESCE(tasks.notes, '') AS body,
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
        priority: "none"
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
      const note = this.getNote(request.noteId);
      const items = extractPlannerLinks(note.body)
        .filter((link) => this.resolveLinkTargetId(link) === null)
        .map((link) => ({ linkText: link.raw }));

      return { items };
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

  private resolveLinkTargetId(link: PlannerLinkReference): string | null {
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

  private notePredicate(taskAlias: string, listAlias: string): string {
    return `${taskAlias}.deleted_at IS NULL
      AND ${taskAlias}.is_hidden = 0
      AND ${taskAlias}.status != 'completed'
      AND ${taskAlias}.parent_task_id IS NULL
      AND ${taskAlias}.due_at IS NULL
      AND ${listAlias}.deleted_at IS NULL`;
  }
}
