import { describe, expect, it } from "vitest";
import { createTemporarySqliteConnection } from "../data/sqliteConnection";
import { GoogleSyncRepository } from "./readSyncRepository";

interface ColumnInfo extends Record<string, unknown> {
  name: string;
  notnull: number;
  dflt_value: string | null;
}

function columnsOf(connection: ReturnType<typeof createTemporarySqliteConnection>["connection"]): Map<string, ColumnInfo> {
  const rows = connection.query<ColumnInfo>("PRAGMA table_info(google_tasks);");
  return new Map(rows.map((row) => [row.name, row]));
}

function eventColumnsOf(connection: ReturnType<typeof createTemporarySqliteConnection>["connection"]): Map<string, ColumnInfo> {
  const rows = connection.query<ColumnInfo>("PRAGMA table_info(google_calendar_events);");
  return new Map(rows.map((row) => [row.name, row]));
}

describe("google_tasks planning columns", () => {
  it("creates planning columns on a fresh database", () => {
    const temporary = createTemporarySqliteConnection("hcb2-task-planning-fresh-");
    try {
      new GoogleSyncRepository(temporary.connection);
      const columns = columnsOf(temporary.connection);
      expect(columns.has("local_planned_start")).toBe(true);
      expect(columns.has("local_planned_end")).toBe(true);
      expect(columns.has("local_duration_minutes")).toBe(true);
      expect(columns.has("local_locked_schedule")).toBe(true);
      expect(columns.has("local_snooze_until")).toBe(true);
      expect(columns.has("local_tags_json")).toBe(true);
      expect(columns.get("local_locked_schedule")?.notnull).toBe(1);
      expect(columns.get("local_tags_json")?.notnull).toBe(1);
    } finally {
      temporary.cleanup();
    }
  });

  it("backfills planning columns on a pre-existing schema without them", () => {
    const temporary = createTemporarySqliteConnection("hcb2-task-planning-alter-");
    try {
      temporary.connection.exec(`
        CREATE TABLE google_tasks (
          id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL,
          task_list_id TEXT NOT NULL,
          google_id TEXT NOT NULL,
          parent_task_id TEXT,
          title TEXT NOT NULL,
          notes TEXT,
          status TEXT NOT NULL,
          due_at TEXT,
          due_time_zone TEXT,
          completed_at TEXT,
          position TEXT,
          sort_order INTEGER NOT NULL DEFAULT 0,
          is_hidden INTEGER NOT NULL DEFAULT 0,
          etag TEXT,
          google_updated_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT,
          UNIQUE(account_id, task_list_id, google_id)
        );
      `);

      new GoogleSyncRepository(temporary.connection);
      const columns = columnsOf(temporary.connection);
      expect(columns.has("local_priority")).toBe(true);
      expect(columns.has("local_planned_start")).toBe(true);
      expect(columns.has("local_planned_end")).toBe(true);
      expect(columns.has("local_duration_minutes")).toBe(true);
      expect(columns.has("local_locked_schedule")).toBe(true);
      expect(columns.has("local_snooze_until")).toBe(true);
      expect(columns.has("local_tags_json")).toBe(true);
    } finally {
      temporary.cleanup();
    }
  });

  it("round-trips planning columns through direct inserts", () => {
    const temporary = createTemporarySqliteConnection("hcb2-task-planning-roundtrip-");
    try {
      new GoogleSyncRepository(temporary.connection);
      temporary.connection.run(
        `INSERT INTO google_tasks (
           id, account_id, task_list_id, google_id, title, status,
           sort_order, is_hidden, local_priority,
           local_planned_start, local_planned_end, local_duration_minutes,
           local_locked_schedule, local_snooze_until, local_tags_json,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 'needsAction', 0, 0, 'none', ?, ?, ?, 1, ?, ?, ?, ?);`,
        [
          "task-1",
          "acct-1",
          "list-1",
          "g-1",
          "Plan something",
          "2026-05-23T09:00:00.000Z",
          "2026-05-23T10:00:00.000Z",
          60,
          "2026-05-24T09:00:00.000Z",
          JSON.stringify(["focus", "review"]),
          "2026-05-23T00:00:00.000Z",
          "2026-05-23T00:00:00.000Z"
        ]
      );

      const row = temporary.connection.get<{
        local_planned_start: string | null;
        local_planned_end: string | null;
        local_duration_minutes: number | null;
        local_locked_schedule: number;
        local_snooze_until: string | null;
        local_tags_json: string;
      }>(
        `SELECT local_planned_start, local_planned_end, local_duration_minutes,
                local_locked_schedule, local_snooze_until, local_tags_json
         FROM google_tasks WHERE id = ?;`,
        ["task-1"]
      );

      expect(row?.local_planned_start).toBe("2026-05-23T09:00:00.000Z");
      expect(row?.local_planned_end).toBe("2026-05-23T10:00:00.000Z");
      expect(row?.local_duration_minutes).toBe(60);
      expect(row?.local_locked_schedule).toBe(1);
      expect(row?.local_snooze_until).toBe("2026-05-24T09:00:00.000Z");
      expect(JSON.parse(row?.local_tags_json ?? "[]")).toEqual(["focus", "review"]);
    } finally {
      temporary.cleanup();
    }
  });
});

describe("google_calendar_events local timezone column", () => {
  it("creates local timezone on a fresh database", () => {
    const temporary = createTemporarySqliteConnection("hcb2-event-timezone-fresh-");
    try {
      new GoogleSyncRepository(temporary.connection, { defaultTimeZone: "Asia/Singapore" });
      const columns = eventColumnsOf(temporary.connection);
      expect(columns.has("local_time_zone")).toBe(true);
      expect(columns.has("recurrence_rule")).toBe(true);
      expect(columns.has("hcb_kind")).toBe(true);
    } finally {
      temporary.cleanup();
    }
  });

  it("adds local timezone on a pre-existing schema without it", () => {
    const temporary = createTemporarySqliteConnection("hcb2-event-timezone-alter-");
    try {
      temporary.connection.exec(`
        CREATE TABLE google_calendar_events (
          id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL,
          calendar_id TEXT NOT NULL,
          google_id TEXT NOT NULL,
          recurring_event_id TEXT,
          original_start_at TEXT,
          status TEXT NOT NULL,
          summary TEXT NOT NULL,
          description TEXT,
          location TEXT,
          start_at TEXT NOT NULL,
          start_time_zone TEXT,
          end_at TEXT NOT NULL,
          end_time_zone TEXT,
          is_all_day INTEGER NOT NULL DEFAULT 0,
          recurrence_rule TEXT,
          transparency TEXT,
          visibility TEXT,
          attendee_emails_json TEXT NOT NULL DEFAULT '[]',
          reminder_minutes_json TEXT NOT NULL DEFAULT '[]',
          etag TEXT,
          sequence INTEGER,
          google_updated_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT,
          UNIQUE(account_id, calendar_id, google_id)
        );
      `);

      new GoogleSyncRepository(temporary.connection, { defaultTimeZone: "Asia/Singapore" });
      const columns = eventColumnsOf(temporary.connection);

      expect(columns.has("local_time_zone")).toBe(true);
      expect(columns.has("hcb_kind")).toBe(true);
    } finally {
      temporary.cleanup();
    }
  });

  it("adds recurrence rule on a pre-existing schema without it", () => {
    const temporary = createTemporarySqliteConnection("hcb2-event-recurrence-alter-");
    try {
      temporary.connection.exec(`
        CREATE TABLE google_calendar_events (
          id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL,
          calendar_id TEXT NOT NULL,
          google_id TEXT NOT NULL,
          status TEXT NOT NULL,
          summary TEXT NOT NULL,
          description TEXT,
          location TEXT,
          start_at TEXT NOT NULL,
          start_time_zone TEXT,
          end_at TEXT NOT NULL,
          end_time_zone TEXT,
          is_all_day INTEGER NOT NULL DEFAULT 0,
          attendee_emails_json TEXT NOT NULL DEFAULT '[]',
          reminder_minutes_json TEXT NOT NULL DEFAULT '[]',
          local_time_zone TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT,
          UNIQUE(account_id, calendar_id, google_id)
        );
      `);

      new GoogleSyncRepository(temporary.connection, { defaultTimeZone: "Asia/Singapore" });
      const columns = eventColumnsOf(temporary.connection);

      expect(columns.has("recurrence_rule")).toBe(true);
    } finally {
      temporary.cleanup();
    }
  });

  it("round-trips local timezone through mirror writes", () => {
    const temporary = createTemporarySqliteConnection("hcb2-event-timezone-roundtrip-");
    try {
      const repository = new GoogleSyncRepository(temporary.connection, { defaultTimeZone: "UTC" });
      repository.writeCalendarLists(
        "acct-1",
        [
          {
            id: "product",
            summary: "Product",
            timeZone: "Asia/Singapore",
            isSelected: true,
            isHidden: false,
            isPrimary: true,
            updatedAt: "2026-05-23T00:00:00.000Z"
          }
        ],
        "2026-05-23T00:00:00.000Z"
      );
      repository.writeCalendarEvents(
        "acct-1",
        "product",
        [
          {
            id: "event-1",
            calendarId: "product",
            status: "confirmed",
            summary: "Event",
            startAt: "2026-05-23T01:00:00.000Z",
            startTimeZone: "Asia/Singapore",
            endAt: "2026-05-23T02:00:00.000Z",
            endTimeZone: "Asia/Singapore",
            isAllDay: false,
            hcbKind: "birthday",
            updatedAt: "2026-05-23T00:00:00.000Z"
          }
        ],
        {
          fullSync: true,
          now: "2026-05-23T00:00:00.000Z",
          defaultTimeZone: "UTC"
        }
      );

      const row = temporary.connection.get<{ hcbKind: string | null; localTimeZone: string | null }>(
        "SELECT hcb_kind AS hcbKind, local_time_zone AS localTimeZone FROM google_calendar_events WHERE google_id = ?;",
        ["event-1"]
      );

      expect(row?.localTimeZone).toBe("Asia/Singapore");
      expect(row?.hcbKind).toBe("birthday");

      repository.writeCalendarEvents(
        "acct-1",
        "product",
        [
          {
            id: "event-1",
            calendarId: "product",
            status: "confirmed",
            summary: "Event",
            startAt: "2026-05-23T01:00:00.000Z",
            startTimeZone: "Asia/Singapore",
            endAt: "2026-05-23T02:00:00.000Z",
            endTimeZone: "Asia/Singapore",
            isAllDay: false,
            updatedAt: "2026-05-24T00:00:00.000Z"
          }
        ],
        {
          fullSync: false,
          now: "2026-05-24T00:00:00.000Z",
          defaultTimeZone: "UTC"
        }
      );

      const preserved = temporary.connection.get<{ hcbKind: string | null }>(
        "SELECT hcb_kind AS hcbKind FROM google_calendar_events WHERE google_id = ?;",
        ["event-1"]
      );
      expect(preserved?.hcbKind).toBe("birthday");
    } finally {
      temporary.cleanup();
    }
  });
});
