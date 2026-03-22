mod commands;
mod db;
mod error;
mod models;
mod state;

use state::AppState;

use commands::tag_commands::{
    add_tag_to_task, create_tag, delete_tag, get_tags, remove_tag_from_task, update_tag,
};
use commands::task_commands::{
    create_task, delete_task, get_task, get_tasks_by_list, move_task, update_task,
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
            get_task,
            update_task,
            delete_task,
            move_task,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
