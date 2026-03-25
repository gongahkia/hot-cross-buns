use std::collections::HashMap;
use tauri::State;
use uuid::Uuid;

use crate::db;
use crate::models::{Tag, Task};
use crate::state::AppState;
use crate::sync::changes;

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

fn iso8601_now() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system clock before UNIX epoch");
    let secs = now.as_secs();

    // Break epoch seconds into date-time components (UTC).
    const SECS_PER_DAY: u64 = 86_400;
    let days = secs / SECS_PER_DAY;
    let day_secs = secs % SECS_PER_DAY;

    let hours = day_secs / 3600;
    let minutes = (day_secs % 3600) / 60;
    let seconds = day_secs % 60;

    // Convert days since 1970-01-01 to (year, month, day) using a civil calendar algorithm.
    let (year, month, day) = {
        // Algorithm from Howard Hinnant (public domain).
        let z = days as i64 + 719_468;
        let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
        let doe = (z - era * 146_097) as u64; // day of era [0, 146096]
        let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
        let y = yoe as i64 + era * 400;
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        let mp = (5 * doy + 2) / 153;
        let d = doy - (153 * mp + 2) / 5 + 1;
        let m = if mp < 10 { mp + 3 } else { mp - 9 };
        let y = if m <= 2 { y + 1 } else { y };
        (y, m as u32, d as u32)
    };

    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        year, month, day, hours, minutes, seconds,
    )
}

fn get_associated_task_ids(
    conn: &rusqlite::Connection,
    tag_id: &str,
) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare("SELECT task_id FROM task_tags WHERE tag_id = ?1 ORDER BY task_id")
        .map_err(|e| format!("Failed to prepare task tag query: {}", e))?;

    let rows = stmt
        .query_map(rusqlite::params![tag_id], |row| row.get(0))
        .map_err(|e| format!("Failed to query tag associations: {}", e))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to read tag association row: {}", e))
}

#[tauri::command]
pub fn create_tag(
    state: State<'_, AppState>,
    name: String,
    color: Option<String>,
) -> Result<Tag, String> {
    let conn = db::get_connection(&state.db_path)?;

    let id = Uuid::now_v7().to_string();
    let created_at = iso8601_now();

    conn.execute(
        "INSERT INTO tags (id, name, color, created_at) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![id, name, color, created_at],
    )
    .map_err(|e| format!("Failed to create tag: {}", e))?;

    let tag = Tag {
        id,
        name,
        color,
        created_at,
        deleted_at: None,
    };
    changes::record_tag_upsert(&conn, &tag)?;

    Ok(tag)
}

#[tauri::command]
pub fn get_tags(state: State<'_, AppState>) -> Result<Vec<Tag>, String> {
    let conn = db::get_connection(&state.db_path)?;

    let mut stmt = conn
        .prepare(
            "SELECT id, name, color, created_at, deleted_at FROM tags WHERE deleted_at IS NULL ORDER BY name",
        )
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let tags = stmt
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

    Ok(tags)
}

#[tauri::command]
pub fn update_tag(
    state: State<'_, AppState>,
    id: String,
    name: Option<String>,
    color: Option<String>,
) -> Result<Tag, String> {
    let conn = db::get_connection(&state.db_path)?;

    // Fetch the existing tag first.
    let mut tag: Tag = conn
        .query_row(
            "SELECT id, name, color, created_at, deleted_at FROM tags WHERE id = ?1 AND deleted_at IS NULL",
            rusqlite::params![id],
            |row| {
                Ok(Tag {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    color: row.get(2)?,
                    created_at: row.get(3)?,
                    deleted_at: row.get(4)?,
                })
            },
        )
        .map_err(|e| format!("Tag not found: {}", e))?;

    if let Some(ref new_name) = name {
        tag.name = new_name.clone();
    }
    if let Some(ref new_color) = color {
        tag.color = Some(new_color.clone());
    }

    conn.execute(
        "UPDATE tags SET name = ?1, color = ?2 WHERE id = ?3 AND deleted_at IS NULL",
        rusqlite::params![tag.name, tag.color, tag.id],
    )
    .map_err(|e| format!("Failed to update tag: {}", e))?;

    if name.is_some() {
        changes::record_field_change(&conn, "tag", &tag.id, "name", &tag.name)?;
    }
    if color.is_some() {
        changes::record_field_change(&conn, "tag", &tag.id, "color", &tag.color)?;
    }

    Ok(tag)
}

#[tauri::command]
pub fn delete_tag(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let conn = db::get_connection(&state.db_path)?;
    let deleted_at = iso8601_now();
    let associated_task_ids = get_associated_task_ids(&conn, &id)?;

    conn.execute(
        "DELETE FROM task_tags WHERE tag_id = ?1",
        rusqlite::params![id],
    )
    .map_err(|e| format!("Failed to delete task_tags: {}", e))?;

    let rows = conn
        .execute(
            "UPDATE tags SET deleted_at = ?1 WHERE id = ?2 AND deleted_at IS NULL",
            rusqlite::params![deleted_at, id],
        )
        .map_err(|e| format!("Failed to delete tag: {}", e))?;

    if rows == 0 {
        return Err(format!("Tag with id '{}' not found", id));
    }

    changes::record_deleted_at(&conn, "tag", &id, &deleted_at)?;
    for task_id in associated_task_ids {
        changes::record_task_tag_presence(&conn, &task_id, &id, false)?;
    }

    Ok(())
}

#[tauri::command]
pub fn add_tag_to_task(
    state: State<'_, AppState>,
    task_id: String,
    tag_id: String,
) -> Result<(), String> {
    let conn = db::get_connection(&state.db_path)?;

    conn.execute(
        "INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?1, ?2)",
        rusqlite::params![task_id, tag_id],
    )
    .map_err(|e| format!("Failed to add tag to task: {}", e))?;

    changes::record_task_tag_presence(&conn, &task_id, &tag_id, true)?;

    Ok(())
}

#[tauri::command]
pub fn remove_tag_from_task(
    state: State<'_, AppState>,
    task_id: String,
    tag_id: String,
) -> Result<(), String> {
    let conn = db::get_connection(&state.db_path)?;

    conn.execute(
        "DELETE FROM task_tags WHERE task_id = ?1 AND tag_id = ?2",
        rusqlite::params![task_id, tag_id],
    )
    .map_err(|e| format!("Failed to remove tag from task: {}", e))?;

    changes::record_task_tag_presence(&conn, &task_id, &tag_id, false)?;

    Ok(())
}

#[derive(serde::Serialize)]
pub struct TagTaskCount {
    pub tag_id: String,
    pub count: i64,
}

#[tauri::command]
pub fn get_tag_task_counts(state: State<'_, AppState>) -> Result<Vec<TagTaskCount>, String> {
    let conn = db::get_connection(&state.db_path)?;
    let mut stmt = conn.prepare(
        "SELECT tt.tag_id, COUNT(*) FROM task_tags tt \
         JOIN tasks t ON t.id = tt.task_id \
         WHERE t.deleted_at IS NULL AND t.status = 0 \
         GROUP BY tt.tag_id"
    ).map_err(|e| format!("Failed to prepare tag count query: {}", e))?;
    let counts = stmt.query_map([], |row| {
        Ok(TagTaskCount { tag_id: row.get(0)?, count: row.get(1)? })
    }).map_err(|e| format!("Failed to query tag counts: {}", e))?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| format!("Failed to read tag count row: {}", e))?;
    Ok(counts)
}

#[tauri::command]
pub fn get_tasks_by_tag(state: State<'_, AppState>, tag_id: String) -> Result<Vec<Task>, String> {
    let conn = db::get_connection(&state.db_path)?;
    let sql = format!(
        "SELECT {} FROM tasks WHERE id IN \
         (SELECT task_id FROM task_tags WHERE tag_id = ?1) \
         AND deleted_at IS NULL AND status = 0 AND parent_task_id IS NULL \
         ORDER BY priority DESC, created_at DESC",
        TASK_COLUMNS
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| format!("Failed to prepare query: {}", e))?;
    let mut tasks: Vec<Task> = stmt.query_map(rusqlite::params![tag_id], row_to_task)
        .map_err(|e| format!("Failed to query tasks by tag: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to read task row: {}", e))?;
    if tasks.is_empty() { return Ok(tasks); }
    let all_ids: Vec<String> = tasks.iter().map(|t| t.id.clone()).collect();
    let tag_map = fetch_tags_for_tasks(&conn, &all_ids)?;
    for t in &mut tasks {
        t.tags = tag_map.get(&t.id).cloned().unwrap_or_default();
    }
    Ok(tasks)
}
