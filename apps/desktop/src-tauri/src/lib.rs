mod commands;
mod db;
mod error;
mod models;
mod services;
mod state;
mod sync;

use state::AppState;

use commands::data_commands::{export_data, import_data};
use commands::sync_commands::sync_now;
use commands::tag_commands::{
    add_tag_to_task, create_tag, delete_tag, get_tags, remove_tag_from_task, update_tag,
};
use commands::task_commands::{
    complete_recurring_task, create_task, delete_task, get_overdue_tasks, get_task,
    get_tasks_by_list, get_tasks_due_today, get_tasks_in_range, move_task, preview_recurrence,
    search_tasks, update_task,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;

            db::init_db(&app_data_dir).map_err(|e| format!("Database init failed: {}", e))?;

            app.manage(AppState {
                db_path: app_data_dir,
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::create_list,
            commands::get_lists,
            commands::update_list,
            commands::delete_list,
            create_tag,
            get_tags,
            update_tag,
            delete_tag,
            add_tag_to_task,
            remove_tag_from_task,
            create_task,
            get_tasks_by_list,
            get_tasks_in_range,
            get_tasks_due_today,
            get_overdue_tasks,
            get_task,
            update_task,
            delete_task,
            move_task,
            preview_recurrence,
            complete_recurring_task,
            search_tasks,
            export_data,
            import_data,
            sync_now,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
