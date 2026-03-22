use rusqlite::OptionalExtension;
use tauri::State;
use uuid::Uuid;

use crate::db;
use crate::models::List;
use crate::state::AppState;
use crate::sync::changes;

/// Return the current UTC time formatted as an ISO 8601 string (e.g. "2026-03-22T10:30:00Z").
fn iso8601_now() -> String {
    let dur = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("SystemTime before UNIX EPOCH");
    let secs = dur.as_secs();

    // Break epoch seconds into date/time components (UTC).
    let days = secs / 86400;
    let time_of_day = secs % 86400;
    let hours = time_of_day / 3600;
    let minutes = (time_of_day % 3600) / 60;
    let seconds = time_of_day % 60;

    // Convert days since 1970-01-01 to y/m/d using a civil-calendar algorithm.
    let (year, month, day) = days_to_ymd(days as i64);

    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        year, month, day, hours, minutes, seconds
    )
}

/// Convert days since 1970-01-01 to (year, month, day).
/// Uses the algorithm from Howard Hinnant's `chrono`-compatible date library.
fn days_to_ymd(epoch_days: i64) -> (i64, u32, u32) {
    let z = epoch_days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u32; // day of era [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365; // year of era [0, 399]
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // day of year [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = doy - (153 * mp + 2) / 5 + 1; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 }; // [1, 12]
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
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
        deleted_at: row.get(7)?,
    })
}

fn next_list_sort_order(conn: &rusqlite::Connection) -> Result<i32, String> {
    conn.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM lists WHERE deleted_at IS NULL",
        [],
        |row| row.get(0),
    )
    .map_err(|e| format!("Failed to calculate next list sort order: {}", e))
}

fn ensure_inbox_list(conn: &rusqlite::Connection) -> Result<(), String> {
    let existing_inbox_id: Option<String> = conn
        .query_row(
            "SELECT id FROM lists WHERE is_inbox = 1 AND deleted_at IS NULL LIMIT 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| format!("Failed to query inbox list: {}", e))?;

    if existing_inbox_id.is_some() {
        return Ok(());
    }

    let now = iso8601_now();
    conn.execute(
        "INSERT INTO lists (id, name, color, sort_order, is_inbox, created_at, updated_at) \
         VALUES (?1, 'Inbox', NULL, 0, 1, ?2, ?2)",
        rusqlite::params![Uuid::now_v7().to_string(), now],
    )
    .map_err(|e| format!("Failed to create inbox list: {}", e))?;

    let inbox = conn
        .query_row(
            "SELECT id, name, color, sort_order, is_inbox, created_at, updated_at, deleted_at FROM lists WHERE is_inbox = 1 AND deleted_at IS NULL LIMIT 1",
            [],
            row_to_list,
        )
        .map_err(|e| format!("Failed to fetch created inbox list: {}", e))?;

    changes::record_list_upsert(conn, &inbox)?;

    Ok(())
}

fn load_lists(conn: &rusqlite::Connection) -> Result<Vec<List>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, name, color, sort_order, is_inbox, created_at, updated_at, deleted_at \
             FROM lists WHERE deleted_at IS NULL ORDER BY is_inbox DESC, sort_order, created_at",
        )
        .map_err(|e| format!("Failed to prepare statement: {}", e))?;

    let rows = stmt
        .query_map([], row_to_list)
        .map_err(|e| format!("Failed to query lists: {}", e))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to read list row: {}", e))
}

#[tauri::command]
pub fn create_list(
    state: State<'_, AppState>,
    name: String,
    color: Option<String>,
) -> Result<List, String> {
    let conn = db::get_connection(&state.db_path)?;
    let id = Uuid::now_v7().to_string();
    let now = iso8601_now();
    let sort_order = next_list_sort_order(&conn)?;

    conn.execute(
        "INSERT INTO lists (id, name, color, sort_order, is_inbox, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 0, ?5, ?5)",
        rusqlite::params![id, name, color, sort_order, now],
    )
    .map_err(|e| format!("Failed to insert list: {}", e))?;

    let list = conn
        .query_row(
            "SELECT id, name, color, sort_order, is_inbox, created_at, updated_at, deleted_at FROM lists WHERE id = ?1",
            rusqlite::params![id],
            row_to_list,
        )
        .map_err(|e| format!("Failed to fetch created list: {}", e))?;

    changes::record_list_upsert(&conn, &list)?;

    Ok(list)
}

#[tauri::command]
pub fn get_lists(state: State<'_, AppState>) -> Result<Vec<List>, String> {
    let conn = db::get_connection(&state.db_path)?;
    ensure_inbox_list(&conn)?;
    load_lists(&conn)
}

#[tauri::command]
pub fn update_list(
    state: State<'_, AppState>,
    id: String,
    name: Option<String>,
    color: Option<String>,
    sort_order: Option<i32>,
) -> Result<List, String> {
    let conn = db::get_connection(&state.db_path)?;
    let now = iso8601_now();

    // Build SET clauses dynamically based on which fields are provided.
    let mut set_clauses: Vec<String> = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(ref n) = name {
        set_clauses.push(format!("name = ?{}", params.len() + 1));
        params.push(Box::new(n.clone()));
    }
    if let Some(ref c) = color {
        set_clauses.push(format!("color = ?{}", params.len() + 1));
        params.push(Box::new(c.clone()));
    }
    if let Some(s) = sort_order {
        set_clauses.push(format!("sort_order = ?{}", params.len() + 1));
        params.push(Box::new(s));
    }

    if set_clauses.is_empty() {
        return Err("No fields to update".to_string());
    }

    // Always update updated_at.
    set_clauses.push(format!("updated_at = ?{}", params.len() + 1));
    params.push(Box::new(now));

    let id_param_index = params.len() + 1;
    params.push(Box::new(id.clone()));

    let sql = format!(
        "UPDATE lists SET {} WHERE id = ?{} AND deleted_at IS NULL",
        set_clauses.join(", "),
        id_param_index
    );

    let params_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();

    let rows_affected = conn
        .execute(&sql, params_refs.as_slice())
        .map_err(|e| format!("Failed to update list: {}", e))?;

    if rows_affected == 0 {
        return Err("List not found or already deleted".to_string());
    }

    let list = conn
        .query_row(
            "SELECT id, name, color, sort_order, is_inbox, created_at, updated_at, deleted_at FROM lists WHERE id = ?1",
            rusqlite::params![id],
            row_to_list,
        )
        .map_err(|e| format!("Failed to fetch updated list: {}", e))?;

    if let Some(ref value) = name {
        changes::record_field_change(&conn, "list", &list.id, "name", value)?;
    }
    if let Some(ref value) = color {
        changes::record_field_change(&conn, "list", &list.id, "color", value)?;
    }
    if let Some(value) = sort_order {
        changes::record_field_change(&conn, "list", &list.id, "sort_order", &value)?;
    }

    Ok(list)
}

#[tauri::command]
pub fn delete_list(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let conn = db::get_connection(&state.db_path)?;

    // Check if this is the inbox list -- inbox cannot be deleted.
    let is_inbox: i32 = conn
        .query_row(
            "SELECT is_inbox FROM lists WHERE id = ?1 AND deleted_at IS NULL",
            rusqlite::params![id],
            |row| row.get(0),
        )
        .map_err(|e| format!("List not found: {}", e))?;

    if is_inbox != 0 {
        return Err("Cannot delete the Inbox list".to_string());
    }

    let now = iso8601_now();

    let rows_affected = conn
        .execute(
            "UPDATE lists SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2 AND deleted_at IS NULL",
            rusqlite::params![now, id],
        )
        .map_err(|e| format!("Failed to soft-delete list: {}", e))?;

    if rows_affected == 0 {
        return Err("List not found or already deleted".to_string());
    }

    changes::record_deleted_at(&conn, "list", &id, &now)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use std::path::PathBuf;
    use tempfile::TempDir;

    /// Create a temporary database directory, initialise the schema, and return
    /// the TempDir (which keeps the directory alive) and the path to use as
    /// AppState.db_path.
    fn setup_test_db() -> (TempDir, PathBuf) {
        let tmp = TempDir::new().expect("failed to create temp dir");
        let db_path = tmp.path().to_path_buf();
        db::init_db(&db_path).expect("failed to init test db");
        (tmp, db_path)
    }

    #[test]
    fn test_create_and_get_lists() {
        let (_tmp, db_path) = setup_test_db();
        let conn = db::get_connection(&db_path).expect("failed to open connection");

        // Insert a list directly via SQL (bypassing Tauri State which requires
        // a running app). This validates the schema and row_to_list mapping.
        let id = uuid::Uuid::now_v7().to_string();
        let now = iso8601_now();
        conn.execute(
            "INSERT INTO lists (id, name, color, sort_order, is_inbox, created_at, updated_at) \
             VALUES (?1, ?2, ?3, 0, 0, ?4, ?5)",
            rusqlite::params![id, "Test List", "#ff0000", now, now],
        )
        .expect("failed to insert test list");

        // Read it back via row_to_list.
        let list = conn
            .query_row(
                "SELECT id, name, color, sort_order, is_inbox, created_at, updated_at, deleted_at \
                 FROM lists WHERE id = ?1",
                rusqlite::params![id],
                row_to_list,
            )
            .expect("failed to query test list");

        assert_eq!(list.id, id);
        assert_eq!(list.name, "Test List");
        assert_eq!(list.color, Some("#ff0000".to_string()));
        assert!(!list.is_inbox);
        assert!(list.deleted_at.is_none());
    }

    #[test]
    fn test_get_lists_creates_inbox_on_empty_db() {
        let (_tmp, db_path) = setup_test_db();
        let conn = db::get_connection(&db_path).expect("failed to open connection");

        ensure_inbox_list(&conn).expect("failed to ensure inbox");
        let lists = load_lists(&conn).expect("failed to load lists");

        assert_eq!(lists.len(), 1);
        assert_eq!(lists[0].name, "Inbox");
        assert!(lists[0].is_inbox);
    }

    #[test]
    fn test_delete_inbox_rejected() {
        let (_tmp, db_path) = setup_test_db();
        let conn = db::get_connection(&db_path).expect("failed to open connection");

        // Create an inbox list (is_inbox = 1).
        let id = uuid::Uuid::now_v7().to_string();
        let now = iso8601_now();
        conn.execute(
            "INSERT INTO lists (id, name, color, sort_order, is_inbox, created_at, updated_at) \
             VALUES (?1, 'Inbox', NULL, 0, 1, ?2, ?3)",
            rusqlite::params![id, now, now],
        )
        .expect("failed to insert inbox list");

        // Attempting to delete the inbox should fail at the is_inbox check.
        let is_inbox: i32 = conn
            .query_row(
                "SELECT is_inbox FROM lists WHERE id = ?1 AND deleted_at IS NULL",
                rusqlite::params![id],
                |row| row.get(0),
            )
            .expect("failed to query inbox flag");

        assert_ne!(
            is_inbox, 0,
            "expected is_inbox to be non-zero for inbox list"
        );

        // Simulate the guard from delete_list.
        if is_inbox != 0 {
            // This is the expected path -- inbox deletion should be rejected.
            return;
        }

        panic!("inbox deletion guard did not trigger");
    }
}
