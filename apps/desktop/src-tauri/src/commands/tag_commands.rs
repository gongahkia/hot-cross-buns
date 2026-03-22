use tauri::State;
use uuid::Uuid;

use crate::db;
use crate::models::Tag;
use crate::state::AppState;

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

    Ok(Tag {
        id,
        name,
        color,
        created_at,
    })
}

#[tauri::command]
pub fn get_tags(state: State<'_, AppState>) -> Result<Vec<Tag>, String> {
    let conn = db::get_connection(&state.db_path)?;

    let mut stmt = conn
        .prepare("SELECT id, name, color, created_at FROM tags ORDER BY name")
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let tags = stmt
        .query_map([], |row| {
            Ok(Tag {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                created_at: row.get(3)?,
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
            "SELECT id, name, color, created_at FROM tags WHERE id = ?1",
            rusqlite::params![id],
            |row| {
                Ok(Tag {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    color: row.get(2)?,
                    created_at: row.get(3)?,
                })
            },
        )
        .map_err(|e| format!("Tag not found: {}", e))?;

    if let Some(new_name) = name {
        tag.name = new_name;
    }
    if let Some(new_color) = color {
        tag.color = Some(new_color);
    }

    conn.execute(
        "UPDATE tags SET name = ?1, color = ?2 WHERE id = ?3",
        rusqlite::params![tag.name, tag.color, tag.id],
    )
    .map_err(|e| format!("Failed to update tag: {}", e))?;

    Ok(tag)
}

#[tauri::command]
pub fn delete_tag(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let conn = db::get_connection(&state.db_path)?;

    conn.execute(
        "DELETE FROM task_tags WHERE tag_id = ?1",
        rusqlite::params![id],
    )
    .map_err(|e| format!("Failed to delete task_tags: {}", e))?;

    let rows = conn
        .execute("DELETE FROM tags WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| format!("Failed to delete tag: {}", e))?;

    if rows == 0 {
        return Err(format!("Tag with id '{}' not found", id));
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

    Ok(())
}
