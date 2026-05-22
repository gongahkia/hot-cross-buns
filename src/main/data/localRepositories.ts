import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type {
  CalendarEventSummary,
  CalendarListRequest,
  CalendarListResponse,
  CalendarListSummary,
  CalendarRangeRequest,
  CalendarRangeResponse,
  LocalPerformanceTiming,
  NoteCreateRequest,
  NoteDeleteRequest,
  NoteDetail,
  NoteListRequest,
  NoteListResponse,
  NoteSummary,
  NoteUpdateRequest,
  SearchQueryRequest,
  SearchQueryResponse,
  SearchResultItem,
  SettingsSnapshot,
  SettingsUpdateRequest,
  TaskDetail,
  TaskListsRequest,
  TaskListsResponse,
  TaskListRequest,
  TaskListResponse,
  TaskListSummary,
  TaskSummary
} from "@shared/ipc/contracts";
import { HcbPublicError } from "@shared/ipc/result";
import type { SqliteConnection, SqliteParams } from "./sqliteConnection";

interface PageWindow<T> {
  items: T[];
  page: {
    limit: number;
    nextCursor?: string;
    totalKnown: number;
  };
}

type SearchDomain = SearchResultItem["domain"];

interface TaskListRow {
  id: string;
  title: string;
  updatedAt: string;
  taskCount: number;
  activeTaskCount: number;
}

interface TaskRow {
  id: string;
  listId: string;
  listTitle: string;
  title: string;
  status: "needsAction" | "completed";
  notes: string | null;
  dueAt: string | null;
  parentId: string | null;
  updatedAt: string;
}

interface CalendarListRow {
  id: string;
  title: string;
  selected: number;
  timeZone: string | null;
  updatedAt: string;
  eventCount: number;
}

interface CalendarEventRow {
  id: string;
  calendarId: string;
  calendarTitle: string;
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: number;
  updatedAt: string;
  location: string | null;
  notes: string | null;
}

interface NoteRow {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

const DEFAULT_SETTINGS: SettingsSnapshot = {
  theme: "system",
  startOnLogin: false,
  quickCaptureShortcut: "Ctrl+Space",
  mcpEnabled: false
};

export class LocalPerformanceRepository {
  constructor(private readonly connection: SqliteConnection) {}

  record(timing: {
    kind: LocalPerformanceTiming["kind"];
    name: string;
    durationMs: number;
    metadata?: Record<string, string | number | boolean | null>;
    createdAt?: string;
  }): void {
    try {
      this.connection.run(
        `INSERT INTO local_performance_timings
          (kind, name, duration_ms, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?);`,
        [
          timing.kind,
          timing.name,
          Math.max(0, Math.round(timing.durationMs * 100) / 100),
          JSON.stringify(timing.metadata ?? {}),
          timing.createdAt ?? new Date().toISOString()
        ]
      );
    } catch {
      // Diagnostics must not break the user-facing read path.
    }
  }

  listRecent(limit = 50): LocalPerformanceTiming[] {
    const safeLimit = Math.max(1, Math.min(100, limit));
    return this.connection.query<{
      id: number;
      kind: LocalPerformanceTiming["kind"];
      name: string;
      durationMs: number;
      createdAt: string;
    }>(
      `SELECT id, kind, name, duration_ms AS durationMs, created_at AS createdAt
       FROM local_performance_timings
       ORDER BY created_at DESC, id DESC
       LIMIT ?;`,
      [safeLimit]
    );
  }
}

export class LocalPlannerRepository {
  constructor(
    private readonly connection: SqliteConnection,
    private readonly timings?: LocalPerformanceRepository
  ) {}

  listTaskLists(request: TaskListsRequest): TaskListsResponse {
    return this.measureSqlite("tasks.listTaskLists", () => {
      const { limit, offset } = pageBounds(request.cursor, request.limit, 50, 100);
      const rows = this.connection.query<TaskListRow>(
        `SELECT
           lists.id AS id,
           lists.title AS title,
           lists.updated_at AS updatedAt,
           COUNT(tasks.id) AS taskCount,
           COALESCE(SUM(CASE WHEN tasks.status != 'completed'
                              AND tasks.deleted_at IS NULL
                              AND tasks.is_hidden = 0
                              THEN 1 ELSE 0 END), 0) AS activeTaskCount
         FROM google_task_lists lists
         LEFT JOIN google_tasks tasks
           ON tasks.task_list_id = lists.id
          AND tasks.deleted_at IS NULL
         WHERE lists.deleted_at IS NULL
         GROUP BY lists.id
         ORDER BY lists.sort_order ASC, lists.title COLLATE NOCASE ASC, lists.id ASC
         LIMIT ? OFFSET ?;`,
        [limit, offset]
      );
      const totalKnown = countRows(
        this.connection,
        "SELECT COUNT(*) AS count FROM google_task_lists WHERE deleted_at IS NULL;"
      );

      return pageFromRows(rows.map(taskListSummary), limit, offset, totalKnown);
    });
  }

  listTasks(request: TaskListRequest): TaskListResponse {
    return this.measureSqlite("tasks.list", () => {
      const { limit, offset } = pageBounds(request.cursor, request.limit, 50, 100);
      const predicates = [
        "tasks.deleted_at IS NULL",
        "tasks.is_hidden = 0",
        "lists.deleted_at IS NULL"
      ];
      const params: Array<string | number | boolean | null> = [];

      if (request.listId !== undefined) {
        predicates.push("tasks.task_list_id = ?");
        params.push(request.listId);
      }

      if ((request.status ?? "active") === "active") {
        predicates.push("tasks.status != 'completed'");
      } else if (request.status === "completed") {
        predicates.push("tasks.status = 'completed'");
      }

      const where = predicates.join(" AND ");
      const rows = this.connection.query<TaskRow>(
        `SELECT
           tasks.id AS id,
           tasks.task_list_id AS listId,
           lists.title AS listTitle,
           tasks.title AS title,
           tasks.status AS status,
           tasks.notes AS notes,
           tasks.due_at AS dueAt,
           tasks.parent_task_id AS parentId,
           tasks.updated_at AS updatedAt
         FROM google_tasks tasks
         INNER JOIN google_task_lists lists ON lists.id = tasks.task_list_id
         WHERE ${where}
         ORDER BY
           CASE WHEN tasks.due_at IS NULL THEN 1 ELSE 0 END,
           tasks.due_at ASC,
           tasks.sort_order ASC,
           tasks.updated_at DESC,
           tasks.id ASC
         LIMIT ? OFFSET ?;`,
        [...params, limit, offset]
      );
      const totalKnown = countRows(
        this.connection,
        `SELECT COUNT(*) AS count
         FROM google_tasks tasks
         INNER JOIN google_task_lists lists ON lists.id = tasks.task_list_id
         WHERE ${where};`,
        params
      );

      return pageFromRows(rows.map(taskSummary), limit, offset, totalKnown);
    });
  }

  getTask(id: string): TaskDetail {
    return this.measureSqlite("tasks.get", () => {
      const row = this.connection.get<TaskRow>(
        `SELECT
           tasks.id AS id,
           tasks.task_list_id AS listId,
           lists.title AS listTitle,
           tasks.title AS title,
           tasks.status AS status,
           tasks.notes AS notes,
           tasks.due_at AS dueAt,
           tasks.parent_task_id AS parentId,
           tasks.updated_at AS updatedAt
         FROM google_tasks tasks
         INNER JOIN google_task_lists lists ON lists.id = tasks.task_list_id
         WHERE tasks.id = ?
           AND tasks.deleted_at IS NULL
           AND lists.deleted_at IS NULL
         LIMIT 1;`,
        [id]
      );

      if (!row) {
        throw notFound("Task was not found.");
      }

      return taskDetail(row);
    });
  }

  listCalendars(request: CalendarListRequest): CalendarListResponse {
    return this.measureSqlite("calendar.listCalendars", () => {
      const { limit, offset } = pageBounds(request.cursor, request.limit, 50, 100);
      const rows = this.connection.query<CalendarListRow>(
        `SELECT
           calendars.id AS id,
           calendars.summary AS title,
           calendars.is_selected AS selected,
           calendars.time_zone AS timeZone,
           calendars.updated_at AS updatedAt,
           COUNT(events.id) AS eventCount
         FROM google_calendar_lists calendars
         LEFT JOIN google_calendar_events events
           ON events.calendar_id = calendars.id
          AND events.deleted_at IS NULL
          AND events.status != 'cancelled'
         WHERE calendars.deleted_at IS NULL
           AND calendars.is_hidden = 0
         GROUP BY calendars.id
         ORDER BY calendars.is_primary DESC, calendars.summary COLLATE NOCASE ASC, calendars.id ASC
         LIMIT ? OFFSET ?;`,
        [limit, offset]
      );
      const totalKnown = countRows(
        this.connection,
        `SELECT COUNT(*) AS count
         FROM google_calendar_lists
         WHERE deleted_at IS NULL AND is_hidden = 0;`
      );

      return pageFromRows(rows.map(calendarListSummary), limit, offset, totalKnown);
    });
  }

  listCalendarEvents(request: CalendarRangeRequest): CalendarRangeResponse {
    return this.measureSqlite("calendar.listEvents", () => {
      const { limit, offset } = pageBounds(request.cursor, request.limit, 100, 500);
      const params: Array<string | number | boolean | null> = [request.end, request.start];
      const predicates = [
        "events.deleted_at IS NULL",
        "events.status != 'cancelled'",
        "calendars.deleted_at IS NULL",
        "events.start_at < ?",
        "events.end_at > ?"
      ];

      if (request.calendarIds !== undefined && request.calendarIds.length > 0) {
        predicates.push(`events.calendar_id IN (${request.calendarIds.map(() => "?").join(", ")})`);
        params.push(...request.calendarIds);
      }

      const where = predicates.join(" AND ");
      const rows = this.connection.query<CalendarEventRow>(
        `SELECT
           events.id AS id,
           events.calendar_id AS calendarId,
           calendars.summary AS calendarTitle,
           events.summary AS title,
           events.start_at AS startsAt,
           events.end_at AS endsAt,
           events.is_all_day AS allDay,
           events.updated_at AS updatedAt,
           events.location AS location,
           events.description AS notes
         FROM google_calendar_events events
         INNER JOIN google_calendar_lists calendars ON calendars.id = events.calendar_id
         WHERE ${where}
         ORDER BY events.start_at ASC, events.end_at ASC, events.id ASC
         LIMIT ? OFFSET ?;`,
        [...params, limit, offset]
      );
      const totalKnown = countRows(
        this.connection,
        `SELECT COUNT(*) AS count
         FROM google_calendar_events events
         INNER JOIN google_calendar_lists calendars ON calendars.id = events.calendar_id
         WHERE ${where};`,
        params
      );

      return pageFromRows(rows.map(calendarEventSummary), limit, offset, totalKnown);
    });
  }

  getCalendarEvent(id: string): Record<string, string | number | boolean | null> {
    return this.measureSqlite("calendar.getEvent", () => {
      const row = this.connection.get<CalendarEventRow>(
        `SELECT
           events.id AS id,
           events.calendar_id AS calendarId,
           calendars.summary AS calendarTitle,
           events.summary AS title,
           events.start_at AS startsAt,
           events.end_at AS endsAt,
           events.is_all_day AS allDay,
           events.updated_at AS updatedAt,
           events.location AS location,
           events.description AS notes
         FROM google_calendar_events events
         INNER JOIN google_calendar_lists calendars ON calendars.id = events.calendar_id
         WHERE events.id = ?
           AND events.deleted_at IS NULL
           AND calendars.deleted_at IS NULL
         LIMIT 1;`,
        [id]
      );

      if (!row) {
        throw notFound("Calendar event was not found.");
      }

      return {
        kind: "event",
        id: row.id,
        calendarId: row.calendarId,
        calendarTitle: row.calendarTitle,
        title: row.title,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        allDay: row.allDay === 1,
        updatedAt: row.updatedAt,
        location: row.location ?? "",
        notes: row.notes ?? "",
        deepLink: `hotcrossbuns://event/${row.id}`
      };
    });
  }

  listNotes(request: NoteListRequest): NoteListResponse {
    return this.measureSqlite("notes.list", () => {
      const { limit, offset } = pageBounds(request.cursor, request.limit, 50, 100);
      const rows = this.connection.query<NoteRow>(
        `SELECT id, title, body, created_at AS createdAt, updated_at AS updatedAt
         FROM local_notes
         WHERE deleted_at IS NULL
         ORDER BY updated_at DESC, id ASC
         LIMIT ? OFFSET ?;`,
        [limit, offset]
      );
      const totalKnown = countRows(
        this.connection,
        "SELECT COUNT(*) AS count FROM local_notes WHERE deleted_at IS NULL;"
      );

      return pageFromRows(rows.map(noteSummary), limit, offset, totalKnown);
    });
  }

  getNote(id: string): NoteDetail {
    return this.measureSqlite("notes.get", () => {
      const row = this.connection.get<NoteRow>(
        `SELECT id, title, body, created_at AS createdAt, updated_at AS updatedAt
         FROM local_notes
         WHERE id = ? AND deleted_at IS NULL
         LIMIT 1;`,
        [id]
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

      this.connection.run(
        `INSERT INTO local_notes (id, title, body, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?);`,
        [id, request.title.trim(), body, now, now]
      );

      return this.getNote(id);
    });
  }

  updateNote(request: NoteUpdateRequest): NoteDetail {
    return this.measureSqlite("notes.update", () => {
      const existing = this.getNote(request.id);
      const now = new Date().toISOString();

      this.connection.run(
        `UPDATE local_notes
         SET title = ?, body = ?, updated_at = ?
         WHERE id = ? AND deleted_at IS NULL;`,
        [
          request.title?.trim() ?? existing.title,
          request.body ?? existing.body,
          now,
          request.id
        ]
      );

      return this.getNote(request.id);
    });
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

      return {
        id: request.id,
        queued: false,
        revision: now
      };
    });
  }

  search(request: SearchQueryRequest): SearchQueryResponse {
    const startedAt = performance.now();

    try {
      const result = this.measureSqlite("search.query.sqlite", () => {
        const domains = new Set<SearchDomain>(request.domains ?? ["tasks", "calendar", "notes"]);
        const limit = Math.max(1, Math.min(50, request.limit ?? 20));
        const like = `%${escapeLike(request.query.trim().toLowerCase())}%`;
        const results: SearchResultItem[] = [];

        if (domains.has("tasks")) {
          results.push(...this.searchTasks(like, limit));
        }

        if (domains.has("calendar")) {
          results.push(...this.searchEvents(like, limit));
        }

        if (domains.has("notes")) {
          results.push(...this.searchNotes(like, limit));
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

  private searchTasks(like: string, limit: number): SearchResultItem[] {
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
         WHERE tasks.deleted_at IS NULL
           AND tasks.is_hidden = 0
           AND lists.deleted_at IS NULL
           AND (
             lower(tasks.title) LIKE ? ESCAPE '\\'
             OR lower(COALESCE(tasks.notes, '')) LIKE ? ESCAPE '\\'
             OR lower(lists.title) LIKE ? ESCAPE '\\'
           )
         ORDER BY tasks.updated_at DESC, tasks.id ASC
         LIMIT ?;`,
        [like, like, like, limit]
      )
      .map((row) => ({
        id: row.id,
        domain: "tasks" as const,
        title: row.title,
        snippet: row.snippet ?? undefined,
        updatedAt: row.updatedAt
      }));
  }

  private searchEvents(like: string, limit: number): SearchResultItem[] {
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
         WHERE events.deleted_at IS NULL
           AND events.status != 'cancelled'
           AND calendars.deleted_at IS NULL
           AND (
             lower(events.summary) LIKE ? ESCAPE '\\'
             OR lower(COALESCE(events.description, '')) LIKE ? ESCAPE '\\'
             OR lower(COALESCE(events.location, '')) LIKE ? ESCAPE '\\'
             OR lower(calendars.summary) LIKE ? ESCAPE '\\'
           )
         ORDER BY events.updated_at DESC, events.id ASC
         LIMIT ?;`,
        [like, like, like, like, limit]
      )
      .map((row) => ({
        id: row.id,
        domain: "calendar" as const,
        title: row.title,
        snippet: row.snippet ?? undefined,
        updatedAt: row.updatedAt
      }));
  }

  private searchNotes(like: string, limit: number): SearchResultItem[] {
    return this.connection
      .query<{
        id: string;
        title: string;
        body: string;
        updatedAt: string;
      }>(
        `SELECT id, title, body, updated_at AS updatedAt
         FROM local_notes
         WHERE deleted_at IS NULL
           AND (
             lower(title) LIKE ? ESCAPE '\\'
             OR lower(body) LIKE ? ESCAPE '\\'
           )
         ORDER BY updated_at DESC, id ASC
         LIMIT ?;`,
        [like, like, limit]
      )
      .map((row) => ({
        id: row.id,
        domain: "notes" as const,
        title: row.title,
        snippet: preview(row.body),
        updatedAt: row.updatedAt
      }));
  }

  private measureSqlite<T>(name: string, operation: () => T): T {
    const startedAt = performance.now();

    try {
      return operation();
    } finally {
      this.timings?.record({
        kind: "sqlite_query",
        name,
        durationMs: performance.now() - startedAt
      });
    }
  }
}

export class LocalSettingsRepository {
  constructor(private readonly connection: SqliteConnection) {}

  get(): SettingsSnapshot {
    return {
      theme: this.readSetting("appearance", "theme", DEFAULT_SETTINGS.theme),
      startOnLogin: this.readSetting("app", "startOnLogin", DEFAULT_SETTINGS.startOnLogin),
      quickCaptureShortcut: this.readSetting(
        "hotkeys",
        "quickCaptureShortcut",
        DEFAULT_SETTINGS.quickCaptureShortcut
      ),
      mcpEnabled: this.readSetting("mcp", "enabled", DEFAULT_SETTINGS.mcpEnabled)
    };
  }

  update(request: SettingsUpdateRequest): SettingsSnapshot {
    const now = new Date().toISOString();

    if (request.theme !== undefined) {
      this.writeSetting("appearance", "theme", request.theme, now);
    }

    if (request.startOnLogin !== undefined) {
      this.writeSetting("app", "startOnLogin", request.startOnLogin, now);
    }

    if (request.quickCaptureShortcut !== undefined) {
      this.writeSetting("hotkeys", "quickCaptureShortcut", request.quickCaptureShortcut, now);
    }

    if (request.mcpEnabled !== undefined) {
      this.writeSetting("mcp", "enabled", request.mcpEnabled, now);
    }

    return this.get();
  }

  private readSetting<T>(scope: string, key: string, fallback: T): T {
    const row = this.connection.get<{ valueJson: string }>(
      `SELECT value_json AS valueJson
       FROM local_settings
       WHERE scope = ? AND key = ?
       LIMIT 1;`,
      [scope, key]
    );

    if (!row) {
      return fallback;
    }

    try {
      return JSON.parse(row.valueJson) as T;
    } catch {
      return fallback;
    }
  }

  private writeSetting(scope: string, key: string, value: unknown, now: string): void {
    this.connection.run(
      `INSERT INTO local_settings (scope, key, value_json, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(scope, key) DO UPDATE SET
         value_json = excluded.value_json,
         updated_at = excluded.updated_at;`,
      [scope, key, JSON.stringify(value), now]
    );
  }
}

function pageBounds(
  cursor: string | undefined,
  requestedLimit: number | undefined,
  defaultLimit: number,
  maxLimit: number
): { limit: number; offset: number } {
  const limit = Math.max(1, Math.min(maxLimit, requestedLimit ?? defaultLimit));
  const parsed = cursor === undefined ? 0 : Number.parseInt(cursor, 10);

  return {
    limit,
    offset: Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
  };
}

function pageFromRows<T>(
  items: T[],
  limit: number,
  offset: number,
  totalKnown: number
): PageWindow<T> {
  const nextOffset = offset + items.length;

  return {
    items,
    page: {
      limit,
      ...(nextOffset < totalKnown ? { nextCursor: String(nextOffset) } : {}),
      totalKnown
    }
  };
}

function countRows(connection: SqliteConnection, sql: string, params?: SqliteParams): number {
  return connection.get<{ count: number }>(sql, params)?.count ?? 0;
}

function taskListSummary(row: TaskListRow): TaskListSummary {
  return {
    id: row.id,
    title: row.title,
    updatedAt: row.updatedAt,
    taskCount: row.taskCount,
    activeTaskCount: row.activeTaskCount
  };
}

function taskSummary(row: TaskRow): TaskSummary {
  return {
    id: row.id,
    listId: row.listId,
    title: row.title,
    status: row.status === "completed" ? "completed" : "active",
    dueAt: row.dueAt,
    updatedAt: row.updatedAt
  };
}

function taskDetail(row: TaskRow): TaskDetail {
  return {
    ...taskSummary(row),
    notes: row.notes ?? undefined,
    parentId: row.parentId
  };
}

function calendarListSummary(row: CalendarListRow): CalendarListSummary {
  return {
    id: row.id,
    title: row.title,
    selected: row.selected === 1,
    timeZone: row.timeZone,
    updatedAt: row.updatedAt,
    eventCount: row.eventCount
  };
}

function calendarEventSummary(row: CalendarEventRow): CalendarEventSummary {
  return {
    id: row.id,
    calendarId: row.calendarId,
    title: row.title,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    allDay: row.allDay === 1,
    updatedAt: row.updatedAt
  };
}

function noteSummary(row: NoteRow): NoteSummary {
  return {
    id: row.id,
    title: row.title,
    preview: preview(row.body),
    updatedAt: row.updatedAt
  };
}

function noteDetail(row: NoteRow): NoteDetail {
  return {
    ...noteSummary(row),
    body: row.body
  };
}

function preview(body: string): string {
  const trimmed = body.trim();

  if (!trimmed) {
    return "Empty local note";
  }

  return trimmed.length > 120 ? `${trimmed.slice(0, 117)}...` : trimmed;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function notFound(message: string): HcbPublicError {
  return new HcbPublicError({
    code: "VALIDATION_ERROR",
    message,
    recoverable: true
  });
}
