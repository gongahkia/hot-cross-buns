mod commands;
mod db;
mod error;
mod models;
mod services;
mod state;
mod sync;

use state::AppState;
use tauri::Manager;

use commands::bench_commands::seed_benchmark_data;
use commands::data_commands::{export_csv, export_data, import_data};
use commands::list_commands::{create_list, delete_list, get_lists, update_list};
use commands::reminder_commands::drain_due_notifications;
use commands::sync_commands::{
    dismiss_sync_conflict, get_sync_health, get_sync_settings, list_sync_conflicts,
    resolve_sync_conflict, save_sync_settings, sync_now,
};
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
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let setup_started = std::time::Instant::now();
            let app_data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;

            let db_started = std::time::Instant::now();
            db::init_db(&app_data_dir).map_err(|e| format!("Database init failed: {}", e))?;
            services::startup::log_startup_timing("db init", db_started);

            app.manage(AppState {
                db_path: app_data_dir,
            });

            if let Some(task_count) = std::env::var("TICKCLONE_BENCHMARK_SEED")
                .ok()
                .and_then(|value| value.parse::<u32>().ok())
            {
                let conn = db::get_connection(
                    &app
                        .state::<AppState>()
                        .inner()
                        .db_path,
                )
                .map_err(|e| format!("Benchmark seed database open failed: {}", e))?;

                let existing_tasks: i64 = conn
                    .query_row("SELECT COUNT(*) FROM tasks", [], |row| row.get(0))
                    .map_err(|e| format!("Benchmark seed count query failed: {}", e))?;

                if existing_tasks == 0 && task_count > 0 {
                    seed_benchmark_data(app.state::<AppState>(), task_count)
                        .map_err(|e| format!("Benchmark seed failed: {}", e))?;
                }
            }

            services::startup::log_startup_timing("tauri setup", setup_started);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_list,
            get_lists,
            update_list,
            delete_list,
            seed_benchmark_data,
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
            export_csv,
            export_data,
            import_data,
            drain_due_notifications,
            get_sync_settings,
            get_sync_health,
            save_sync_settings,
            list_sync_conflicts,
            resolve_sync_conflict,
            dismiss_sync_conflict,
            sync_now,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
