use rusqlite::params;
use tauri::State;
use uuid::Uuid;

use crate::db;
use crate::models::Heading;
use crate::state::AppState;
use crate::sync::changes;

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

fn row_to_heading(row: &rusqlite::Row) -> rusqlite::Result<Heading> {
    Ok(Heading {
        id: row.get(0)?,
        list_id: row.get(1)?,
        name: row.get(2)?,
        sort_order: row.get(3)?,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
        deleted_at: row.get(6)?,
    })
}

#[tauri::command]
pub fn create_heading(
    state: State<'_, AppState>,
    list_id: String,
    name: String,
) -> Result<Heading, String> {
    let conn = db::get_connection(&state.db_path)?;
    let id = Uuid::now_v7().to_string();
    let now = iso8601_now();
    conn.execute(
        "INSERT INTO headings (id, list_id, name, sort_order, created_at, updated_at) \
         VALUES (?1, ?2, ?3, 0, ?4, ?5)",
        params![id, list_id, name, now, now],
    )
    .map_err(|e| format!("Failed to insert heading: {}", e))?;
    let heading = conn
        .query_row(
            "SELECT id, list_id, name, sort_order, created_at, updated_at, deleted_at \
             FROM headings WHERE id = ?1",
            params![id],
            row_to_heading,
        )
        .map_err(|e| format!("Failed to read heading: {}", e))?;
    changes::record_serialized_change(&conn, "heading", &heading.id, "_upsert", &heading)?;
    Ok(heading)
}

#[tauri::command]
pub fn get_headings_by_list(
    state: State<'_, AppState>,
    list_id: String,
) -> Result<Vec<Heading>, String> {
    let conn = db::get_connection(&state.db_path)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, list_id, name, sort_order, created_at, updated_at, deleted_at \
             FROM headings WHERE list_id = ?1 AND deleted_at IS NULL ORDER BY sort_order",
        )
        .map_err(|e| format!("Failed to prepare heading query: {}", e))?;
    let headings: Vec<Heading> = stmt
        .query_map(params![list_id], row_to_heading)
        .map_err(|e| format!("Failed to query headings: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to read heading row: {}", e))?;
    Ok(headings)
}

#[tauri::command]
pub fn update_heading(
    state: State<'_, AppState>,
    id: String,
    name: Option<String>,
    sort_order: Option<i32>,
) -> Result<Heading, String> {
    let conn = db::get_connection(&state.db_path)?;
    let now = iso8601_now();
    let mut set_clauses: Vec<String> = Vec::new();
    let mut params_boxed: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    if let Some(ref v) = name {
        set_clauses.push(format!("name = ?{}", params_boxed.len() + 1));
        params_boxed.push(Box::new(v.clone()));
    }
    if let Some(v) = sort_order {
        set_clauses.push(format!("sort_order = ?{}", params_boxed.len() + 1));
        params_boxed.push(Box::new(v));
    }
    if set_clauses.is_empty() {
        return Err("No fields to update".to_string());
    }
    set_clauses.push(format!("updated_at = ?{}", params_boxed.len() + 1));
    params_boxed.push(Box::new(now));
    let id_idx = params_boxed.len() + 1;
    params_boxed.push(Box::new(id.clone()));
    let sql = format!(
        "UPDATE headings SET {} WHERE id = ?{} AND deleted_at IS NULL",
        set_clauses.join(", "),
        id_idx
    );
    let params_refs: Vec<&dyn rusqlite::types::ToSql> =
        params_boxed.iter().map(|p| p.as_ref()).collect();
    let rows_affected = conn
        .execute(&sql, params_refs.as_slice())
        .map_err(|e| format!("Failed to update heading: {}", e))?;
    if rows_affected == 0 {
        return Err("Heading not found or already deleted".to_string());
    }
    let heading = conn
        .query_row(
            "SELECT id, list_id, name, sort_order, created_at, updated_at, deleted_at \
             FROM headings WHERE id = ?1",
            params![id],
            row_to_heading,
        )
        .map_err(|e| format!("Failed to read heading: {}", e))?;
    changes::record_serialized_change(&conn, "heading", &heading.id, "_upsert", &heading)?;
    Ok(heading)
}

#[tauri::command]
pub fn delete_heading(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let conn = db::get_connection(&state.db_path)?;
    let now = iso8601_now();
    let rows_affected = conn
        .execute(
            "UPDATE headings SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2 AND deleted_at IS NULL",
            params![now, id],
        )
        .map_err(|e| format!("Failed to soft-delete heading: {}", e))?;
    if rows_affected == 0 {
        return Err("Heading not found or already deleted".to_string());
    }
    conn.execute(
        "UPDATE tasks SET heading_id = NULL, updated_at = ?1 WHERE heading_id = ?2 AND deleted_at IS NULL",
        params![now, id],
    )
    .map_err(|e| format!("Failed to clear heading_id on tasks: {}", e))?;
    changes::record_deleted_at(&conn, "heading", &id, &now)?;
    Ok(())
}
