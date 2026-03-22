use rusqlite::Connection;

use crate::models::{List, Task};

use super::changes::{parse_task_tag_entity_id, TagSnapshot};
use super::settings;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrackedChange {
    pub entity_type: String,
    pub entity_id: String,
    pub field_name: String,
    pub new_value: String,
    pub updated_at: String,
    pub device_id: String,
}

/// Ensure the sync_meta table has the new_value column.
/// This is safe to call repeatedly -- it silently ignores the ALTER if the column exists.
pub fn ensure_new_value_column(conn: &Connection) -> Result<(), String> {
    // SQLite returns an error if the column already exists; we just ignore that.
    let _ =
        conn.execute_batch("ALTER TABLE sync_meta ADD COLUMN new_value TEXT NOT NULL DEFAULT ''");
    Ok(())
}

/// Record a field-level change in sync_meta so it can be pushed later.
pub fn record_change(
    conn: &Connection,
    entity_type: &str,
    entity_id: &str,
    field_name: &str,
    new_value: &str,
) -> Result<(), String> {
    ensure_new_value_column(conn)?;

    let now = iso8601_now();
    let device_id = settings::get_or_create_sync_settings(conn)?.device_id;

    conn.execute(
        "INSERT INTO sync_meta (entity_type, entity_id, field_name, new_value, updated_at, device_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT (entity_type, entity_id, field_name)
         DO UPDATE SET new_value = ?4, updated_at = ?5, device_id = ?6",
        rusqlite::params![entity_type, entity_id, field_name, new_value, now, device_id],
    )
    .map_err(|e| format!("Failed to record change: {}", e))?;

    Ok(())
}

/// Fetch all pending changes that were recorded at or after `since`.
pub fn get_pending_changes(conn: &Connection, since: &str) -> Vec<TrackedChange> {
    let _ = ensure_new_value_column(conn);

    let mut stmt = match conn.prepare(
        "SELECT entity_type, entity_id, field_name, new_value, updated_at, device_id
         FROM sync_meta
         WHERE updated_at >= ?1
         ORDER BY updated_at ASC",
    ) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };

    let rows = match stmt.query_map(rusqlite::params![since], |row| {
        Ok(TrackedChange {
            entity_type: row.get(0)?,
            entity_id: row.get(1)?,
            field_name: row.get(2)?,
            new_value: row.get(3)?,
            updated_at: row.get(4)?,
            device_id: row.get(5)?,
        })
    }) {
        Ok(r) => r,
        Err(_) => return Vec::new(),
    };

    rows.filter_map(|r| r.ok()).collect()
}

/// Apply a single remote change to the local database.
///
pub fn apply_remote_change(conn: &Connection, change: &TrackedChange) -> Result<(), String> {
    ensure_new_value_column(conn)?;

    match (change.entity_type.as_str(), change.field_name.as_str()) {
        ("list", "_upsert") => apply_list_upsert(conn, change)?,
        ("task", "_upsert") => apply_task_upsert(conn, change)?,
        ("tag", "_upsert") => apply_tag_upsert(conn, change)?,
        ("task_tag", "present") => apply_task_tag_change(conn, change)?,
        _ => apply_field_change(conn, change)?,
    }

    record_applied_change(conn, change)?;

    Ok(())
}

fn apply_field_change(conn: &Connection, change: &TrackedChange) -> Result<(), String> {
    let table = match change.entity_type.as_str() {
        "list" => "lists",
        "task" => "tasks",
        "tag" => "tags",
        other => return Err(format!("Unknown entity type: {}", other)),
    };

    // Allowlist of columns that may be synced for each table.
    let allowed = match table {
        "lists" => &[
            "name",
            "color",
            "sort_order",
            "is_inbox",
            "created_at",
            "updated_at",
            "deleted_at",
        ][..],
        "tasks" => &[
            "list_id",
            "parent_task_id",
            "title",
            "content",
            "priority",
            "status",
            "due_date",
            "due_timezone",
            "recurrence_rule",
            "sort_order",
            "completed_at",
            "created_at",
            "updated_at",
            "deleted_at",
        ][..],
        "tags" => &["name", "color", "created_at", "deleted_at"][..],
        _ => return Err(format!("Unknown table: {}", table)),
    };

    if !allowed.contains(&change.field_name.as_str()) {
        return Err(format!(
            "Field '{}' not allowed for entity type '{}'",
            change.field_name, change.entity_type
        ));
    }

    let sql_value = json_text_to_sql_value(&change.new_value)?;

    if table == "tags" {
        let sql = format!(
            "UPDATE {} SET {} = ?1 WHERE id = ?2",
            table, change.field_name
        );
        conn.execute(&sql, rusqlite::params![sql_value, change.entity_id.clone()])
            .map_err(|e| format!("Failed to apply remote change: {}", e))?;
    } else {
        let sql = format!(
            "UPDATE {} SET {} = ?1, updated_at = ?2 WHERE id = ?3",
            table, change.field_name
        );
        conn.execute(
            &sql,
            rusqlite::params![
                sql_value,
                change.updated_at.clone(),
                change.entity_id.clone()
            ],
        )
        .map_err(|e| format!("Failed to apply remote change: {}", e))?;
    }

    Ok(())
}

fn apply_list_upsert(conn: &Connection, change: &TrackedChange) -> Result<(), String> {
    let list: List = serde_json::from_str(&change.new_value)
        .map_err(|e| format!("Failed to decode list upsert payload: {}", e))?;

    conn.execute(
        "INSERT INTO lists (id, name, color, sort_order, is_inbox, created_at, updated_at, deleted_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           color = excluded.color,
           sort_order = excluded.sort_order,
           is_inbox = excluded.is_inbox,
           created_at = excluded.created_at,
           updated_at = excluded.updated_at,
           deleted_at = excluded.deleted_at",
        rusqlite::params![
            list.id,
            list.name,
            list.color,
            list.sort_order,
            if list.is_inbox { 1 } else { 0 },
            list.created_at,
            list.updated_at,
            list.deleted_at
        ],
    )
    .map_err(|e| format!("Failed to apply list upsert: {}", e))?;

    Ok(())
}

fn apply_task_upsert(conn: &Connection, change: &TrackedChange) -> Result<(), String> {
    let task: Task = serde_json::from_str(&change.new_value)
        .map_err(|e| format!("Failed to decode task upsert payload: {}", e))?;

    conn.execute(
        "INSERT INTO tasks (
            id, list_id, parent_task_id, title, content, priority, status,
            due_date, due_timezone, recurrence_rule, sort_order, completed_at,
            created_at, updated_at, deleted_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
         ON CONFLICT(id) DO UPDATE SET
            list_id = excluded.list_id,
            parent_task_id = excluded.parent_task_id,
            title = excluded.title,
            content = excluded.content,
            priority = excluded.priority,
            status = excluded.status,
            due_date = excluded.due_date,
            due_timezone = excluded.due_timezone,
            recurrence_rule = excluded.recurrence_rule,
            sort_order = excluded.sort_order,
            completed_at = excluded.completed_at,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at,
            deleted_at = excluded.deleted_at",
        rusqlite::params![
            task.id,
            task.list_id,
            task.parent_task_id,
            task.title,
            task.content,
            task.priority,
            task.status,
            task.due_date,
            task.due_timezone,
            task.recurrence_rule,
            task.sort_order,
            task.completed_at,
            task.created_at,
            task.updated_at,
            task.deleted_at
        ],
    )
    .map_err(|e| format!("Failed to apply task upsert: {}", e))?;

    Ok(())
}

fn apply_tag_upsert(conn: &Connection, change: &TrackedChange) -> Result<(), String> {
    let tag: TagSnapshot = serde_json::from_str(&change.new_value)
        .map_err(|e| format!("Failed to decode tag upsert payload: {}", e))?;

    conn.execute(
        "INSERT INTO tags (id, name, color, created_at, deleted_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            color = excluded.color,
            created_at = excluded.created_at,
            deleted_at = excluded.deleted_at",
        rusqlite::params![tag.id, tag.name, tag.color, tag.created_at, tag.deleted_at],
    )
    .map_err(|e| format!("Failed to apply tag upsert: {}", e))?;

    Ok(())
}

fn apply_task_tag_change(conn: &Connection, change: &TrackedChange) -> Result<(), String> {
    let (task_id, tag_id) = parse_task_tag_entity_id(&change.entity_id)?;
    let is_present = json_text_to_bool(&change.new_value)?;

    if is_present {
        conn.execute(
            "INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?1, ?2)",
            rusqlite::params![task_id, tag_id],
        )
        .map_err(|e| format!("Failed to add task tag association: {}", e))?;
    } else {
        conn.execute(
            "DELETE FROM task_tags WHERE task_id = ?1 AND tag_id = ?2",
            rusqlite::params![task_id, tag_id],
        )
        .map_err(|e| format!("Failed to remove task tag association: {}", e))?;
    }

    Ok(())
}

fn record_applied_change(conn: &Connection, change: &TrackedChange) -> Result<(), String> {
    conn.execute(
        "INSERT INTO sync_meta (entity_type, entity_id, field_name, new_value, updated_at, device_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT (entity_type, entity_id, field_name)
         DO UPDATE SET new_value = ?4, updated_at = ?5, device_id = ?6",
        rusqlite::params![
            change.entity_type,
            change.entity_id,
            change.field_name,
            change.new_value,
            change.updated_at,
            change.device_id
        ],
    )
    .map_err(|e| format!("Failed to record applied sync change: {}", e))?;

    Ok(())
}

fn json_text_to_sql_value(raw: &str) -> Result<rusqlite::types::Value, String> {
    let parsed = serde_json::from_str::<serde_json::Value>(raw)
        .unwrap_or_else(|_| serde_json::Value::String(raw.to_string()));

    match parsed {
        serde_json::Value::Null => Ok(rusqlite::types::Value::Null),
        serde_json::Value::Bool(flag) => {
            Ok(rusqlite::types::Value::Integer(if flag { 1 } else { 0 }))
        }
        serde_json::Value::Number(number) => {
            if let Some(int_value) = number.as_i64() {
                Ok(rusqlite::types::Value::Integer(int_value))
            } else if let Some(float_value) = number.as_f64() {
                Ok(rusqlite::types::Value::Real(float_value))
            } else {
                Err(format!("Unsupported numeric sync value: {}", number))
            }
        }
        serde_json::Value::String(text) => Ok(rusqlite::types::Value::Text(text)),
        serde_json::Value::Array(_) | serde_json::Value::Object(_) => {
            Ok(rusqlite::types::Value::Text(raw.to_string()))
        }
    }
}

fn json_text_to_bool(raw: &str) -> Result<bool, String> {
    match serde_json::from_str::<serde_json::Value>(raw)
        .unwrap_or_else(|_| serde_json::Value::String(raw.to_string()))
    {
        serde_json::Value::Bool(flag) => Ok(flag),
        serde_json::Value::Number(number) => Ok(number.as_i64().unwrap_or_default() != 0),
        serde_json::Value::String(text) => match text.as_str() {
            "true" | "1" => Ok(true),
            "false" | "0" => Ok(false),
            other => Err(format!("Invalid boolean sync value: {}", other)),
        },
        other => Err(format!("Invalid boolean sync value: {}", other)),
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Return the current UTC time as an ISO 8601 string.
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::models::SyncSettings;
    use crate::sync::settings::save_sync_settings_record;
    use std::path::PathBuf;
    use tempfile::TempDir;

    fn setup_test_db() -> (TempDir, PathBuf) {
        let tmp = TempDir::new().expect("failed to create temp dir");
        let db_path = tmp.path().to_path_buf();
        db::init_db(&db_path).expect("failed to init test db");
        (tmp, db_path)
    }

    #[test]
    fn test_record_change_uses_persisted_device_id() {
        let (_tmp, db_path) = setup_test_db();
        let conn = db::get_connection(&db_path).expect("failed to open connection");
        let settings = SyncSettings {
            server_url: "https://sync.example.com".to_string(),
            auth_token: "secret-token".to_string(),
            device_id: "desktop-123".to_string(),
            auto_sync_enabled: true,
            last_synced_at: None,
        };

        save_sync_settings_record(&conn, &settings).expect("save sync settings");
        record_change(&conn, "task", "task-1", "title", "Updated title")
            .expect("record sync change");

        let device_id: String = conn
            .query_row(
                "SELECT device_id FROM sync_meta
                 WHERE entity_type = 'task' AND entity_id = 'task-1' AND field_name = 'title'",
                [],
                |row| row.get(0),
            )
            .expect("read recorded device id");

        assert_eq!(device_id, "desktop-123");
    }

    #[test]
    fn test_apply_remote_list_upsert_creates_missing_row() {
        let (_tmp, db_path) = setup_test_db();
        let conn = db::get_connection(&db_path).expect("failed to open connection");
        let change = TrackedChange {
            entity_type: "list".to_string(),
            entity_id: "list-1".to_string(),
            field_name: "_upsert".to_string(),
            new_value: serde_json::json!({
                "id": "list-1",
                "name": "Roadmap",
                "color": "#00ff00",
                "sortOrder": 3,
                "isInbox": false,
                "createdAt": "2026-03-22T00:00:00Z",
                "updatedAt": "2026-03-22T00:00:00Z",
                "deletedAt": null
            })
            .to_string(),
            updated_at: "2026-03-22T00:00:00Z".to_string(),
            device_id: "device-b".to_string(),
        };

        apply_remote_change(&conn, &change).expect("apply list upsert");

        let row: (String, i32) = conn
            .query_row(
                "SELECT name, sort_order FROM lists WHERE id = 'list-1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("read upserted list");

        assert_eq!(row.0, "Roadmap");
        assert_eq!(row.1, 3);
    }

    #[test]
    fn test_apply_remote_deleted_at_sets_null_and_timestamp_values() {
        let (_tmp, db_path) = setup_test_db();
        let conn = db::get_connection(&db_path).expect("failed to open connection");
        conn.execute(
            "INSERT INTO lists (id, name, color, sort_order, is_inbox, created_at, updated_at)
             VALUES ('list-1', 'Inbox', NULL, 0, 0, '2026-03-22T00:00:00Z', '2026-03-22T00:00:00Z')",
            [],
        )
        .expect("insert list");

        let delete_change = TrackedChange {
            entity_type: "list".to_string(),
            entity_id: "list-1".to_string(),
            field_name: "deleted_at".to_string(),
            new_value: "\"2026-03-23T00:00:00Z\"".to_string(),
            updated_at: "2026-03-23T00:00:00Z".to_string(),
            device_id: "device-b".to_string(),
        };
        apply_remote_change(&conn, &delete_change).expect("apply delete timestamp");

        let deleted_at: Option<String> = conn
            .query_row(
                "SELECT deleted_at FROM lists WHERE id = 'list-1'",
                [],
                |row| row.get(0),
            )
            .expect("read deleted_at");
        assert_eq!(deleted_at.as_deref(), Some("2026-03-23T00:00:00Z"));

        let restore_change = TrackedChange {
            new_value: "null".to_string(),
            updated_at: "2026-03-24T00:00:00Z".to_string(),
            ..delete_change
        };
        apply_remote_change(&conn, &restore_change).expect("apply null deleted_at");

        let restored_deleted_at: Option<String> = conn
            .query_row(
                "SELECT deleted_at FROM lists WHERE id = 'list-1'",
                [],
                |row| row.get(0),
            )
            .expect("read restored deleted_at");
        assert!(restored_deleted_at.is_none());
    }

    #[test]
    fn test_apply_remote_task_tag_change_updates_join_table() {
        let (_tmp, db_path) = setup_test_db();
        let conn = db::get_connection(&db_path).expect("failed to open connection");
        conn.execute(
            "INSERT INTO lists (id, name, color, sort_order, is_inbox, created_at, updated_at)
             VALUES ('list-1', 'Inbox', NULL, 0, 1, '2026-03-22T00:00:00Z', '2026-03-22T00:00:00Z')",
            [],
        )
        .expect("insert list");
        conn.execute(
            "INSERT INTO tasks (id, list_id, title, priority, status, sort_order, created_at, updated_at)
             VALUES ('task-1', 'list-1', 'Draft spec', 0, 0, 0, '2026-03-22T00:00:00Z', '2026-03-22T00:00:00Z')",
            [],
        )
        .expect("insert task");
        conn.execute(
            "INSERT INTO tags (id, name, color, created_at, deleted_at)
             VALUES ('tag-1', 'Urgent', '#ff0000', '2026-03-22T00:00:00Z', NULL)",
            [],
        )
        .expect("insert tag");

        let add_change = TrackedChange {
            entity_type: "task_tag".to_string(),
            entity_id: "task-1:tag-1".to_string(),
            field_name: "present".to_string(),
            new_value: "true".to_string(),
            updated_at: "2026-03-22T00:00:00Z".to_string(),
            device_id: "device-b".to_string(),
        };
        apply_remote_change(&conn, &add_change).expect("apply task_tag add");

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM task_tags WHERE task_id = 'task-1' AND tag_id = 'tag-1'",
                [],
                |row| row.get(0),
            )
            .expect("count task_tags after add");
        assert_eq!(count, 1);

        let remove_change = TrackedChange {
            new_value: "false".to_string(),
            updated_at: "2026-03-22T00:01:00Z".to_string(),
            ..add_change
        };
        apply_remote_change(&conn, &remove_change).expect("apply task_tag remove");

        let count_after_remove: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM task_tags WHERE task_id = 'task-1' AND tag_id = 'tag-1'",
                [],
                |row| row.get(0),
            )
            .expect("count task_tags after remove");
        assert_eq!(count_after_remove, 0);
    }
}
