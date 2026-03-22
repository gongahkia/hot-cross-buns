use tauri::State;
use uuid::Uuid;

use crate::db;
use crate::models::List;
use crate::state::AppState;

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
    let yoe =
        (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365; // year of era [0, 399]
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

#[tauri::command]
pub fn create_list(
    state: State<'_, AppState>,
    name: String,
    color: Option<String>,
) -> Result<List, String> {
    let conn = db::get_connection(&state.db_path)?;
    let id = Uuid::now_v7().to_string();
    let now = iso8601_now();

    conn.execute(
        "INSERT INTO lists (id, name, color, sort_order, is_inbox, created_at, updated_at) VALUES (?1, ?2, ?3, 0, 0, ?4, ?5)",
        rusqlite::params![id, name, color, now, now],
    )
    .map_err(|e| format!("Failed to insert list: {}", e))?;

    let list = conn
        .query_row(
            "SELECT id, name, color, sort_order, is_inbox, created_at, updated_at, deleted_at FROM lists WHERE id = ?1",
            rusqlite::params![id],
            row_to_list,
        )
        .map_err(|e| format!("Failed to fetch created list: {}", e))?;

    Ok(list)
}

#[tauri::command]
pub fn get_lists(state: State<'_, AppState>) -> Result<Vec<List>, String> {
    let conn = db::get_connection(&state.db_path)?;

    let mut stmt = conn
        .prepare(
            "SELECT id, name, color, sort_order, is_inbox, created_at, updated_at, deleted_at FROM lists WHERE deleted_at IS NULL ORDER BY sort_order",
        )
        .map_err(|e| format!("Failed to prepare statement: {}", e))?;

    let lists = stmt
        .query_map([], row_to_list)
        .map_err(|e| format!("Failed to query lists: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to read list row: {}", e))?;

    Ok(lists)
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

    Ok(())
}
