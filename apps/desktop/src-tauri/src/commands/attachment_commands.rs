use std::path::PathBuf;
use tauri::State;
use uuid::Uuid;

use crate::db;
use crate::models::Attachment;
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

fn guess_mime(filename: &str) -> Option<String> {
    let ext = filename.rsplit('.').next()?.to_lowercase();
    match ext.as_str() {
        "png" => Some("image/png".into()),
        "jpg" | "jpeg" => Some("image/jpeg".into()),
        "gif" => Some("image/gif".into()),
        "webp" => Some("image/webp".into()),
        "svg" => Some("image/svg+xml".into()),
        "pdf" => Some("application/pdf".into()),
        "txt" => Some("text/plain".into()),
        "json" => Some("application/json".into()),
        "zip" => Some("application/zip".into()),
        _ => None,
    }
}

#[tauri::command]
pub fn add_attachment(
    state: State<'_, AppState>,
    task_id: String,
    source_path: String,
) -> Result<Attachment, String> {
    let conn = db::get_connection(&state.db_path)?;
    let source = PathBuf::from(&source_path);
    let filename = source.file_name()
        .ok_or("Invalid file path")?
        .to_string_lossy()
        .to_string();
    let id = Uuid::now_v7().to_string();
    let dest_dir = state.db_path.join("attachments").join(&id);
    std::fs::create_dir_all(&dest_dir)
        .map_err(|e| format!("Failed to create attachment dir: {}", e))?;
    let dest_path = dest_dir.join(&filename);
    std::fs::copy(&source, &dest_path)
        .map_err(|e| format!("Failed to copy file: {}", e))?;
    let metadata = std::fs::metadata(&dest_path)
        .map_err(|e| format!("Failed to read file metadata: {}", e))?;
    let size = metadata.len() as i64;
    let mime_type = guess_mime(&filename);
    let created_at = iso8601_now();
    let file_path_str = dest_path.to_string_lossy().to_string();
    conn.execute(
        "INSERT INTO task_attachments (id, task_id, filename, file_path, mime_type, size, created_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![id, task_id, filename, file_path_str, mime_type, size, created_at],
    ).map_err(|e| format!("Failed to insert attachment: {}", e))?;
    Ok(Attachment { id, task_id, filename, file_path: file_path_str, mime_type, size, created_at })
}

#[tauri::command]
pub fn list_attachments(
    state: State<'_, AppState>,
    task_id: String,
) -> Result<Vec<Attachment>, String> {
    let conn = db::get_connection(&state.db_path)?;
    let mut stmt = conn.prepare(
        "SELECT id, task_id, filename, file_path, mime_type, size, created_at \
         FROM task_attachments WHERE task_id = ?1 ORDER BY created_at"
    ).map_err(|e| format!("Failed to prepare query: {}", e))?;
    let attachments = stmt.query_map(rusqlite::params![task_id], |row| {
        Ok(Attachment {
            id: row.get(0)?,
            task_id: row.get(1)?,
            filename: row.get(2)?,
            file_path: row.get(3)?,
            mime_type: row.get(4)?,
            size: row.get(5)?,
            created_at: row.get(6)?,
        })
    }).map_err(|e| format!("Failed to query attachments: {}", e))?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| format!("Failed to read attachment row: {}", e))?;
    Ok(attachments)
}

#[tauri::command]
pub fn remove_attachment(
    state: State<'_, AppState>,
    attachment_id: String,
) -> Result<(), String> {
    let conn = db::get_connection(&state.db_path)?;
    let file_path: String = conn.query_row(
        "SELECT file_path FROM task_attachments WHERE id = ?1",
        rusqlite::params![attachment_id],
        |row| row.get(0),
    ).map_err(|e| format!("Attachment not found: {}", e))?;
    let _ = std::fs::remove_file(&file_path);
    let parent = PathBuf::from(&file_path).parent().map(|p| p.to_path_buf());
    if let Some(dir) = parent {
        let _ = std::fs::remove_dir(&dir); // only removes if empty
    }
    conn.execute("DELETE FROM task_attachments WHERE id = ?1", rusqlite::params![attachment_id])
        .map_err(|e| format!("Failed to delete attachment: {}", e))?;
    Ok(())
}
