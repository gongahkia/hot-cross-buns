use tauri::State;

use crate::db;
use crate::models::Task;
use crate::services::reminder;
use crate::state::AppState;

#[tauri::command]
pub fn drain_due_notifications(state: State<'_, AppState>) -> Result<Vec<Task>, String> {
    let conn = db::get_connection(&state.db_path)?;
    let due_tasks = reminder::check_due_tasks(&conn);

    for task in &due_tasks {
        reminder::mark_notified(&conn, &task.id);
    }

    Ok(due_tasks)
}
