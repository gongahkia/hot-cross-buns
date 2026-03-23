use tauri::State;
use uuid::Uuid;

use crate::db;
use crate::models::Area;
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

fn row_to_area(row: &rusqlite::Row) -> rusqlite::Result<Area> {
    Ok(Area {
        id: row.get(0)?,
        name: row.get(1)?,
        color: row.get(2)?,
        sort_order: row.get(3)?,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
        deleted_at: row.get(6)?,
    })
}

const AREA_COLUMNS: &str = "id, name, color, sort_order, created_at, updated_at, deleted_at";

#[tauri::command]
pub fn create_area(
    state: State<'_, AppState>,
    name: String,
    color: Option<String>,
) -> Result<Area, String> {
    let conn = db::get_connection(&state.db_path)?;
    let id = Uuid::now_v7().to_string();
    let now = iso8601_now();
    let sort_order: i32 = conn
        .query_row(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM areas WHERE deleted_at IS NULL",
            [],
            |row| row.get(0),
        )
        .map_err(|e| format!("Failed to calculate next area sort order: {}", e))?;
    conn.execute(
        "INSERT INTO areas (id, name, color, sort_order, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        rusqlite::params![id, name, color, sort_order, now],
    )
    .map_err(|e| format!("Failed to insert area: {}", e))?;
    let area = conn
        .query_row(
            &format!("SELECT {} FROM areas WHERE id = ?1", AREA_COLUMNS),
            rusqlite::params![id],
            row_to_area,
        )
        .map_err(|e| format!("Failed to fetch created area: {}", e))?;
    changes::record_serialized_change(&conn, "area", &area.id, "_upsert", &area)?;
    Ok(area)
}

#[tauri::command]
pub fn get_areas(state: State<'_, AppState>) -> Result<Vec<Area>, String> {
    let conn = db::get_connection(&state.db_path)?;
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {} FROM areas WHERE deleted_at IS NULL ORDER BY sort_order, created_at",
            AREA_COLUMNS
        ))
        .map_err(|e| format!("Failed to prepare statement: {}", e))?;
    let rows = stmt
        .query_map([], row_to_area)
        .map_err(|e| format!("Failed to query areas: {}", e))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to read area row: {}", e))
}

#[tauri::command]
pub fn update_area(
    state: State<'_, AppState>,
    id: String,
    name: Option<String>,
    color: Option<String>,
    sort_order: Option<i32>,
) -> Result<Area, String> {
    let conn = db::get_connection(&state.db_path)?;
    let now = iso8601_now();
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
    set_clauses.push(format!("updated_at = ?{}", params.len() + 1));
    params.push(Box::new(now));
    let id_param_index = params.len() + 1;
    params.push(Box::new(id.clone()));
    let sql = format!(
        "UPDATE areas SET {} WHERE id = ?{} AND deleted_at IS NULL",
        set_clauses.join(", "),
        id_param_index
    );
    let params_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    let rows_affected = conn
        .execute(&sql, params_refs.as_slice())
        .map_err(|e| format!("Failed to update area: {}", e))?;
    if rows_affected == 0 {
        return Err("Area not found or already deleted".to_string());
    }
    let area = conn
        .query_row(
            &format!("SELECT {} FROM areas WHERE id = ?1", AREA_COLUMNS),
            rusqlite::params![id],
            row_to_area,
        )
        .map_err(|e| format!("Failed to fetch updated area: {}", e))?;
    changes::record_serialized_change(&conn, "area", &area.id, "_upsert", &area)?;
    Ok(area)
}

#[tauri::command]
pub fn delete_area(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let conn = db::get_connection(&state.db_path)?;
    let now = iso8601_now();
    let rows_affected = conn
        .execute(
            "UPDATE areas SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2 AND deleted_at IS NULL",
            rusqlite::params![now, id],
        )
        .map_err(|e| format!("Failed to soft-delete area: {}", e))?;
    if rows_affected == 0 {
        return Err("Area not found or already deleted".to_string());
    }
    conn.execute(
        "UPDATE lists SET area_id = NULL, updated_at = ?1 WHERE area_id = ?2 AND deleted_at IS NULL",
        rusqlite::params![now, id],
    )
    .map_err(|e| format!("Failed to disassociate lists from deleted area: {}", e))?;
    changes::record_deleted_at(&conn, "area", &id, &now)?;
    Ok(())
}
