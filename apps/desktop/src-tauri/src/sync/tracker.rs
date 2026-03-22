use rusqlite::Connection;

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
    let _ = conn.execute_batch("ALTER TABLE sync_meta ADD COLUMN new_value TEXT NOT NULL DEFAULT ''");
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
/// This performs a straightforward UPDATE on the table derived from `entity_type`,
/// setting `field_name = new_value` where the row's primary key matches `entity_id`.
/// Only known entity types (lists, tasks, tags) are accepted.
pub fn apply_remote_change(conn: &Connection, change: &TrackedChange) -> Result<(), String> {
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
        "tags" => &["name", "color", "created_at"][..],
        _ => return Err(format!("Unknown table: {}", table)),
    };

    if !allowed.contains(&change.field_name.as_str()) {
        return Err(format!(
            "Field '{}' not allowed for entity type '{}'",
            change.field_name, change.entity_type
        ));
    }

    // Use the allowlisted column name directly in the SQL.  This is safe because
    // the value comes from our own allowlist, not from user input.
    let sql = format!(
        "UPDATE {} SET {} = ?1, updated_at = ?2 WHERE id = ?3",
        table, change.field_name
    );

    conn.execute(
        &sql,
        rusqlite::params![change.new_value, change.updated_at, change.entity_id],
    )
    .map_err(|e| format!("Failed to apply remote change: {}", e))?;

    // Also update sync_meta to record that we received this change.
    let _ = ensure_new_value_column(conn);
    let _ = conn.execute(
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
    );

    Ok(())
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
}
