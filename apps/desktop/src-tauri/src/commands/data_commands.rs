use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db;
use crate::models::{List, Tag};
use crate::state::AppState;

/// Result returned by the import_data command.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub lists: u32,
    pub tasks: u32,
    pub tags: u32,
}

/// A single task_tag association for export/import.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskTagEntry {
    task_id: String,
    tag_id: String,
}

/// The top-level export envelope.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportEnvelope {
    version: u32,
    exported_at: String,
    lists: Vec<List>,
    tasks: Vec<ExportTask>,
    tags: Vec<Tag>,
    task_tags: Vec<TaskTagEntry>,
}

/// A flat task representation for export (no nested subtasks/tags fields).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportTask {
    id: String,
    list_id: String,
    parent_task_id: Option<String>,
    title: String,
    content: Option<String>,
    priority: i32,
    status: i32,
    start_date: Option<String>,
    due_date: Option<String>,
    due_timezone: Option<String>,
    recurrence_rule: Option<String>,
    sort_order: i32,
    heading_id: Option<String>,
    completed_at: Option<String>,
    created_at: String,
    updated_at: String,
    deleted_at: Option<String>,
}

/// Return the current UTC time formatted as an ISO 8601 string.
fn iso8601_now() -> String {
    let dur = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("SystemTime before UNIX EPOCH");
    let secs = dur.as_secs();

    let days = secs / 86400;
    let time_of_day = secs % 86400;
    let hours = time_of_day / 3600;
    let minutes = (time_of_day % 3600) / 60;
    let seconds = time_of_day % 60;

    let (year, month, day) = days_to_ymd(days as i64);

    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        year, month, day, hours, minutes, seconds
    )
}

fn days_to_ymd(epoch_days: i64) -> (i64, u32, u32) {
    let z = epoch_days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}

fn row_to_list(row: &rusqlite::Row) -> rusqlite::Result<List> {
    let is_inbox_int: i32 = row.get(4)?;
    Ok(List {
        id: row.get(0)?,
        name: row.get(1)?,
        color: row.get(2)?,
        sort_order: row.get(3)?,
        is_inbox: is_inbox_int != 0,
        area_id: row.get(5)?,
        description: row.get(9)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
        deleted_at: row.get(8)?,
    })
}

fn row_to_export_task(row: &rusqlite::Row) -> rusqlite::Result<ExportTask> {
    Ok(ExportTask {
        id: row.get(0)?,
        list_id: row.get(1)?,
        parent_task_id: row.get(2)?,
        title: row.get(3)?,
        content: row.get(4)?,
        priority: row.get(5)?,
        status: row.get(6)?,
        start_date: row.get(7)?,
        due_date: row.get(8)?,
        due_timezone: row.get(9)?,
        recurrence_rule: row.get(10)?,
        sort_order: row.get(11)?,
        heading_id: row.get(12)?,
        completed_at: row.get(13)?,
        created_at: row.get(14)?,
        updated_at: row.get(15)?,
        deleted_at: row.get(16)?,
    })
}

fn csv_escape(value: &str) -> String {
    let escaped = value.replace('"', "\"\"");
    format!("\"{}\"", escaped)
}

fn option_csv(value: Option<String>) -> String {
    value.map_or_else(String::new, |text| csv_escape(&text))
}

fn build_export_envelope(conn: &rusqlite::Connection) -> Result<ExportEnvelope, String> {
    // Query all non-deleted lists.
    let mut list_stmt = conn
        .prepare(
            "SELECT id, name, color, sort_order, is_inbox, area_id, created_at, updated_at, deleted_at, description \
             FROM lists WHERE deleted_at IS NULL ORDER BY sort_order",
        )
        .map_err(|e| format!("Failed to prepare lists query: {}", e))?;
    let lists: Vec<List> = list_stmt
        .query_map([], row_to_list)
        .map_err(|e| format!("Failed to query lists: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to read list row: {}", e))?;

    // Query all non-deleted tasks (flat, no subtask nesting).
    let mut task_stmt = conn
        .prepare(
            "SELECT id, list_id, parent_task_id, title, content, priority, status, \
             start_date, due_date, due_timezone, recurrence_rule, sort_order, heading_id, completed_at, \
             created_at, updated_at, deleted_at \
             FROM tasks WHERE deleted_at IS NULL ORDER BY sort_order",
        )
        .map_err(|e| format!("Failed to prepare tasks query: {}", e))?;
    let tasks: Vec<ExportTask> = task_stmt
        .query_map([], row_to_export_task)
        .map_err(|e| format!("Failed to query tasks: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to read task row: {}", e))?;

    // Query all tags.
    let mut tag_stmt = conn
        .prepare("SELECT id, name, color, created_at, deleted_at FROM tags ORDER BY name")
        .map_err(|e| format!("Failed to prepare tags query: {}", e))?;
    let tags: Vec<Tag> = tag_stmt
        .query_map([], |row| {
            Ok(Tag {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                created_at: row.get(3)?,
                deleted_at: row.get(4)?,
            })
        })
        .map_err(|e| format!("Failed to query tags: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to read tag row: {}", e))?;

    // Query all task_tags.
    let mut tt_stmt = conn
        .prepare("SELECT task_id, tag_id FROM task_tags")
        .map_err(|e| format!("Failed to prepare task_tags query: {}", e))?;
    let task_tags: Vec<TaskTagEntry> = tt_stmt
        .query_map([], |row| {
            Ok(TaskTagEntry {
                task_id: row.get(0)?,
                tag_id: row.get(1)?,
            })
        })
        .map_err(|e| format!("Failed to query task_tags: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to read task_tag row: {}", e))?;

    Ok(ExportEnvelope {
        version: 1,
        exported_at: iso8601_now(),
        lists,
        tasks,
        tags,
        task_tags,
    })
}

fn build_csv_export(conn: &rusqlite::Connection) -> Result<String, String> {
    let mut stmt = conn
        .prepare(
            "SELECT
                t.id,
                t.list_id,
                l.name,
                t.parent_task_id,
                t.title,
                t.content,
                t.priority,
                t.status,
                t.due_date,
                t.due_timezone,
                t.recurrence_rule,
                t.sort_order,
                t.completed_at,
                t.created_at,
                t.updated_at,
                COALESCE((
                    SELECT group_concat(tags.name, '|')
                    FROM task_tags tt
                    JOIN tags ON tags.id = tt.tag_id
                    WHERE tt.task_id = t.id AND tags.deleted_at IS NULL
                    ORDER BY tags.name
                ), ''),
                COALESCE((
                    SELECT group_concat(tags.id, '|')
                    FROM task_tags tt
                    JOIN tags ON tags.id = tt.tag_id
                    WHERE tt.task_id = t.id AND tags.deleted_at IS NULL
                    ORDER BY tags.name
                ), '')
             FROM tasks t
             JOIN lists l ON l.id = t.list_id
             WHERE t.deleted_at IS NULL
             ORDER BY l.sort_order, l.created_at, t.sort_order, t.created_at",
        )
        .map_err(|e| format!("Failed to prepare CSV export query: {}", e))?;

    let mut lines = vec![[
        "taskId",
        "listId",
        "listName",
        "parentTaskId",
        "title",
        "content",
        "priority",
        "status",
        "dueDate",
        "dueTimezone",
        "recurrenceRule",
        "sortOrder",
        "completedAt",
        "createdAt",
        "updatedAt",
        "tagNames",
        "tagIds",
    ]
    .join(",")];

    let rows = stmt
        .query_map([], |row| {
            Ok(vec![
                csv_escape(&row.get::<_, String>(0)?),
                csv_escape(&row.get::<_, String>(1)?),
                csv_escape(&row.get::<_, String>(2)?),
                option_csv(row.get::<_, Option<String>>(3)?),
                csv_escape(&row.get::<_, String>(4)?),
                option_csv(row.get::<_, Option<String>>(5)?),
                csv_escape(&row.get::<_, i32>(6)?.to_string()),
                csv_escape(&row.get::<_, i32>(7)?.to_string()),
                option_csv(row.get::<_, Option<String>>(8)?),
                option_csv(row.get::<_, Option<String>>(9)?),
                option_csv(row.get::<_, Option<String>>(10)?),
                csv_escape(&row.get::<_, i32>(11)?.to_string()),
                option_csv(row.get::<_, Option<String>>(12)?),
                csv_escape(&row.get::<_, String>(13)?),
                csv_escape(&row.get::<_, String>(14)?),
                csv_escape(&row.get::<_, String>(15)?),
                csv_escape(&row.get::<_, String>(16)?),
            ])
        })
        .map_err(|e| format!("Failed to query CSV export rows: {}", e))?;

    for row in rows {
        lines.push(row.map_err(|e| format!("Failed to read CSV export row: {}", e))?.join(","));
    }

    Ok(lines.join("\n"))
}

#[tauri::command]
pub fn export_data(state: State<'_, AppState>) -> Result<String, String> {
    let conn = db::get_connection(&state.db_path)?;
    let envelope = build_export_envelope(&conn)?;

    serde_json::to_string_pretty(&envelope)
        .map_err(|e| format!("Failed to serialize export data: {}", e))
}

#[tauri::command]
pub fn export_csv(state: State<'_, AppState>) -> Result<String, String> {
    let conn = db::get_connection(&state.db_path)?;
    build_csv_export(&conn)
}

#[tauri::command]
pub fn import_data(
    state: State<'_, AppState>,
    json_data: String,
) -> Result<ImportResult, String> {
    let envelope: ExportEnvelope = serde_json::from_str(&json_data)
        .map_err(|e| format!("Failed to parse import JSON: {}", e))?;

    if envelope.version != 1 {
        return Err(format!(
            "Unsupported export version: {}. Expected 1.",
            envelope.version
        ));
    }

    let conn = db::get_connection(&state.db_path)?;

    conn.execute_batch("BEGIN TRANSACTION")
        .map_err(|e| format!("Failed to begin transaction: {}", e))?;

    let result = (|| -> Result<ImportResult, String> {
        let mut list_count: u32 = 0;
        for list in &envelope.lists {
            let is_inbox: i32 = if list.is_inbox { 1 } else { 0 };
            conn.execute(
                "INSERT OR REPLACE INTO lists (id, name, color, sort_order, is_inbox, created_at, updated_at, deleted_at, description) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                rusqlite::params![
                    list.id,
                    list.name,
                    list.color,
                    list.sort_order,
                    is_inbox,
                    list.created_at,
                    list.updated_at,
                    list.deleted_at,
                    list.description,
                ],
            )
            .map_err(|e| format!("Failed to import list '{}': {}", list.id, e))?;
            list_count += 1;
        }

        let mut task_count: u32 = 0;
        for task in &envelope.tasks {
            conn.execute(
                "INSERT OR REPLACE INTO tasks (id, list_id, parent_task_id, title, content, \
                 priority, status, start_date, due_date, due_timezone, recurrence_rule, sort_order, \
                 heading_id, completed_at, created_at, updated_at, deleted_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
                rusqlite::params![
                    task.id,
                    task.list_id,
                    task.parent_task_id,
                    task.title,
                    task.content,
                    task.priority,
                    task.status,
                    task.start_date,
                    task.due_date,
                    task.due_timezone,
                    task.recurrence_rule,
                    task.sort_order,
                    task.heading_id,
                    task.completed_at,
                    task.created_at,
                    task.updated_at,
                    task.deleted_at,
                ],
            )
            .map_err(|e| format!("Failed to import task '{}': {}", task.id, e))?;
            task_count += 1;
        }

        let mut tag_count: u32 = 0;
        for tag in &envelope.tags {
            conn.execute(
                "INSERT OR REPLACE INTO tags (id, name, color, created_at, deleted_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                rusqlite::params![tag.id, tag.name, tag.color, tag.created_at, tag.deleted_at],
            )
            .map_err(|e| format!("Failed to import tag '{}': {}", tag.id, e))?;
            tag_count += 1;
        }

        for tt in &envelope.task_tags {
            conn.execute(
                "INSERT OR REPLACE INTO task_tags (task_id, tag_id) VALUES (?1, ?2)",
                rusqlite::params![tt.task_id, tt.tag_id],
            )
            .map_err(|e| format!("Failed to import task_tag: {}", e))?;
        }

        Ok(ImportResult {
            lists: list_count,
            tasks: task_count,
            tags: tag_count,
        })
    })();

    match result {
        Ok(import_result) => {
            conn.execute_batch("COMMIT")
                .map_err(|e| format!("Failed to commit transaction: {}", e))?;
            Ok(import_result)
        }
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK");
            Err(e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use std::path::PathBuf;
    use tempfile::TempDir;

    fn setup_test_db() -> (TempDir, PathBuf) {
        let tmp = TempDir::new().expect("failed to create temp dir");
        let db_path = tmp.path().to_path_buf();
        db::init_db(&db_path).expect("failed to init test db");
        (tmp, db_path)
    }

    fn seed_export_fixture(conn: &rusqlite::Connection) {
        conn.execute(
            "INSERT INTO lists (id, name, color, sort_order, is_inbox, created_at, updated_at)
             VALUES ('list-1', 'Inbox', NULL, 0, 1, '2026-03-22T00:00:00Z', '2026-03-22T00:00:00Z')",
            [],
        )
        .expect("insert list");
        conn.execute(
            "INSERT INTO tasks (id, list_id, title, content, priority, status, due_date, recurrence_rule, sort_order, created_at, updated_at)
             VALUES ('task-1', 'list-1', 'Draft spec', 'Ship offline mode', 2, 0, '2026-03-23', 'FREQ=WEEKLY', 0, '2026-03-22T00:00:00Z', '2026-03-22T00:00:00Z')",
            [],
        )
        .expect("insert task");
        conn.execute(
            "INSERT INTO tags (id, name, color, created_at, deleted_at)
             VALUES ('tag-1', 'Urgent', '#ff0000', '2026-03-22T00:00:00Z', NULL)",
            [],
        )
        .expect("insert active tag");
        conn.execute(
            "INSERT INTO tags (id, name, color, created_at, deleted_at)
             VALUES ('tag-2', 'Archive', '#999999', '2026-03-22T00:00:00Z', '2026-03-24T00:00:00Z')",
            [],
        )
        .expect("insert deleted tag");
        conn.execute(
            "INSERT INTO task_tags (task_id, tag_id) VALUES ('task-1', 'tag-1')",
            [],
        )
        .expect("insert task_tag");
    }

    #[test]
    fn test_export_envelope_includes_soft_deleted_tags() {
        let (_tmp, db_path) = setup_test_db();
        let conn = db::get_connection(&db_path).expect("open db");
        seed_export_fixture(&conn);

        let envelope = build_export_envelope(&conn).expect("build export envelope");
        let deleted_tag = envelope
            .tags
            .iter()
            .find(|tag| tag.id == "tag-2")
            .expect("deleted tag present in export");

        assert_eq!(
            deleted_tag.deleted_at.as_deref(),
            Some("2026-03-24T00:00:00Z")
        );
    }

    #[test]
    fn test_export_csv_includes_stable_interop_columns() {
        let (_tmp, db_path) = setup_test_db();
        let conn = db::get_connection(&db_path).expect("open db");
        seed_export_fixture(&conn);

        let csv = build_csv_export(&conn).expect("build csv export");
        let lines: Vec<&str> = csv.lines().collect();

        assert_eq!(
            lines[0],
            "taskId,listId,listName,parentTaskId,title,content,priority,status,dueDate,dueTimezone,recurrenceRule,sortOrder,completedAt,createdAt,updatedAt,tagNames,tagIds"
        );
        assert!(lines[1].contains("\"Inbox\""));
        assert!(lines[1].contains("\"Urgent\""));
        assert!(lines[1].contains("\"FREQ=WEEKLY\""));
        assert!(!lines[1].contains("Archive"));
    }

    #[test]
    fn test_import_preserves_tag_deleted_at() {
        let (_tmp, db_path) = setup_test_db();
        let conn = db::get_connection(&db_path).expect("open db");
        let payload = serde_json::json!({
            "version": 1,
            "exportedAt": "2026-03-24T00:00:00Z",
            "lists": [],
            "tasks": [],
            "tags": [
                {
                    "id": "tag-1",
                    "name": "Archive",
                    "color": "#999999",
                    "createdAt": "2026-03-22T00:00:00Z",
                    "deletedAt": "2026-03-24T00:00:00Z"
                }
            ],
            "taskTags": []
        });

        let envelope: ExportEnvelope =
            serde_json::from_value(payload).expect("decode export envelope");
        for tag in &envelope.tags {
            conn.execute(
                "INSERT OR REPLACE INTO tags (id, name, color, created_at, deleted_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                rusqlite::params![tag.id, tag.name, tag.color, tag.created_at, tag.deleted_at],
            )
            .expect("import tag");
        }

        let deleted_at: Option<String> = conn
            .query_row(
                "SELECT deleted_at FROM tags WHERE id = 'tag-1'",
                [],
                |row| row.get(0),
            )
            .expect("read deleted_at");

        assert_eq!(deleted_at.as_deref(), Some("2026-03-24T00:00:00Z"));
    }
}
