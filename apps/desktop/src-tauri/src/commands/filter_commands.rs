use std::collections::HashMap;
use tauri::State;
use uuid::Uuid;

use crate::db;
use crate::models::{SavedFilter, Tag, Task};
use crate::state::AppState;

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
    let z = days as i64 + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z", y, m, d, hours, minutes, seconds)
}

const TASK_COLUMNS: &str = "id, list_id, parent_task_id, title, content, priority, status, \
    start_date, due_date, due_timezone, recurrence_rule, sort_order, heading_id, completed_at, created_at, updated_at, deleted_at, \
    scheduled_start, scheduled_end, estimated_minutes";

fn row_to_task(row: &rusqlite::Row) -> rusqlite::Result<Task> {
    Ok(Task {
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
        scheduled_start: row.get(17)?,
        scheduled_end: row.get(18)?,
        estimated_minutes: row.get(19)?,
        subtasks: Vec::new(),
        tags: Vec::new(),
    })
}

fn fetch_tags_for_tasks(
    conn: &rusqlite::Connection,
    task_ids: &[String],
) -> Result<HashMap<String, Vec<Tag>>, String> {
    if task_ids.is_empty() { return Ok(HashMap::new()); }
    let placeholders: Vec<String> = (1..=task_ids.len()).map(|i| format!("?{}", i)).collect();
    let sql = format!(
        "SELECT tt.task_id, t.id, t.name, t.color, t.created_at, t.deleted_at \
         FROM task_tags tt JOIN tags t ON t.id = tt.tag_id \
         WHERE tt.task_id IN ({}) AND t.deleted_at IS NULL ORDER BY t.name",
        placeholders.join(", ")
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| format!("Failed to prepare tag fetch: {}", e))?;
    let params: Vec<&dyn rusqlite::types::ToSql> = task_ids.iter().map(|id| id as &dyn rusqlite::types::ToSql).collect();
    let rows = stmt.query_map(params.as_slice(), |row| {
        Ok((
            row.get::<_, String>(0)?,
            Tag { id: row.get(1)?, name: row.get(2)?, color: row.get(3)?, created_at: row.get(4)?, deleted_at: row.get(5)? },
        ))
    }).map_err(|e| format!("Failed to fetch tags: {}", e))?;
    let mut map: HashMap<String, Vec<Tag>> = HashMap::new();
    for r in rows {
        let (task_id, tag) = r.map_err(|e| format!("Failed to read tag row: {}", e))?;
        map.entry(task_id).or_default().push(tag);
    }
    Ok(map)
}

fn row_to_filter(row: &rusqlite::Row) -> rusqlite::Result<SavedFilter> {
    Ok(SavedFilter {
        id: row.get(0)?,
        name: row.get(1)?,
        config: row.get(2)?,
        sort_order: row.get(3)?,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
    })
}

#[tauri::command]
pub fn create_saved_filter(
    state: State<'_, AppState>,
    name: String,
    config: String,
) -> Result<SavedFilter, String> {
    let conn = db::get_connection(&state.db_path)?;
    let id = Uuid::now_v7().to_string();
    let now = iso8601_now();
    let sort_order: i32 = conn
        .query_row("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM saved_filters", [], |row| row.get(0))
        .map_err(|e| format!("Failed to get sort order: {}", e))?;
    conn.execute(
        "INSERT INTO saved_filters (id, name, config, sort_order, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        rusqlite::params![id, name, config, sort_order, now],
    ).map_err(|e| format!("Failed to create saved filter: {}", e))?;
    Ok(SavedFilter { id, name, config, sort_order, created_at: now.clone(), updated_at: now })
}

#[tauri::command]
pub fn get_saved_filters(state: State<'_, AppState>) -> Result<Vec<SavedFilter>, String> {
    let conn = db::get_connection(&state.db_path)?;
    let mut stmt = conn.prepare(
        "SELECT id, name, config, sort_order, created_at, updated_at FROM saved_filters ORDER BY sort_order"
    ).map_err(|e| format!("Failed to prepare query: {}", e))?;
    let filters = stmt.query_map([], row_to_filter)
        .map_err(|e| format!("Failed to query filters: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to read filter row: {}", e))?;
    Ok(filters)
}

#[tauri::command]
pub fn update_saved_filter(
    state: State<'_, AppState>,
    id: String,
    name: Option<String>,
    config: Option<String>,
) -> Result<SavedFilter, String> {
    let conn = db::get_connection(&state.db_path)?;
    let now = iso8601_now();
    let mut set_clauses: Vec<String> = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    if let Some(ref n) = name {
        set_clauses.push(format!("name = ?{}", params.len() + 1));
        params.push(Box::new(n.clone()));
    }
    if let Some(ref c) = config {
        set_clauses.push(format!("config = ?{}", params.len() + 1));
        params.push(Box::new(c.clone()));
    }
    if set_clauses.is_empty() { return Err("No fields to update".into()); }
    set_clauses.push(format!("updated_at = ?{}", params.len() + 1));
    params.push(Box::new(now));
    let id_idx = params.len() + 1;
    params.push(Box::new(id.clone()));
    let sql = format!("UPDATE saved_filters SET {} WHERE id = ?{}", set_clauses.join(", "), id_idx);
    let params_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    conn.execute(&sql, params_refs.as_slice()).map_err(|e| format!("Failed to update filter: {}", e))?;
    let filter = conn.query_row(
        "SELECT id, name, config, sort_order, created_at, updated_at FROM saved_filters WHERE id = ?1",
        rusqlite::params![id], row_to_filter,
    ).map_err(|e| format!("Filter not found: {}", e))?;
    Ok(filter)
}

#[tauri::command]
pub fn delete_saved_filter(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let conn = db::get_connection(&state.db_path)?;
    conn.execute("DELETE FROM saved_filters WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| format!("Failed to delete filter: {}", e))?;
    Ok(())
}

#[derive(serde::Deserialize)]
struct FilterConfig {
    priorities: Option<Vec<i32>>,
    #[serde(rename = "tagIds")]
    tag_ids: Option<Vec<String>>,
    #[serde(rename = "dueBefore")]
    due_before: Option<String>,
    #[serde(rename = "dueAfter")]
    due_after: Option<String>,
}

#[tauri::command]
pub fn get_tasks_by_saved_filter(state: State<'_, AppState>, filter_id: String) -> Result<Vec<Task>, String> {
    let conn = db::get_connection(&state.db_path)?;
    let config_json: String = conn.query_row(
        "SELECT config FROM saved_filters WHERE id = ?1",
        rusqlite::params![filter_id], |row| row.get(0),
    ).map_err(|e| format!("Filter not found: {}", e))?;
    let config: FilterConfig = serde_json::from_str(&config_json)
        .map_err(|e| format!("Invalid filter config: {}", e))?;
    let mut where_clauses = vec![
        "deleted_at IS NULL".to_string(),
        "status = 0".to_string(),
        "parent_task_id IS NULL".to_string(),
    ];
    if let Some(ref prios) = config.priorities {
        if !prios.is_empty() {
            let p: Vec<String> = prios.iter().map(|p| p.to_string()).collect();
            where_clauses.push(format!("priority IN ({})", p.join(",")));
        }
    }
    if let Some(ref tags) = config.tag_ids {
        if !tags.is_empty() {
            let quoted: Vec<String> = tags.iter().map(|t| format!("'{}'", t.replace('\'', "''"))).collect();
            where_clauses.push(format!("id IN (SELECT task_id FROM task_tags WHERE tag_id IN ({}))", quoted.join(",")));
        }
    }
    if let Some(ref db) = config.due_before {
        where_clauses.push(format!("date(due_date) <= '{}'", db.replace('\'', "''")));
    }
    if let Some(ref da) = config.due_after {
        where_clauses.push(format!("date(due_date) >= '{}'", da.replace('\'', "''")));
    }
    let sql = format!(
        "SELECT {} FROM tasks WHERE {} ORDER BY priority DESC, created_at DESC",
        TASK_COLUMNS, where_clauses.join(" AND ")
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| format!("Failed to prepare query: {}", e))?;
    let mut tasks: Vec<Task> = stmt.query_map([], row_to_task)
        .map_err(|e| format!("Failed to query: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to read row: {}", e))?;
    if tasks.is_empty() { return Ok(tasks); }
    let all_ids: Vec<String> = tasks.iter().map(|t| t.id.clone()).collect();
    let tag_map = fetch_tags_for_tasks(&conn, &all_ids)?;
    for t in &mut tasks { t.tags = tag_map.get(&t.id).cloned().unwrap_or_default(); }
    Ok(tasks)
}
