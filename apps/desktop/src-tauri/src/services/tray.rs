/// System tray integration for TickClone.
///
/// Creates a tray icon with a context menu containing:
/// - "Open TickClone" -- shows/focuses the main window
/// - "Quick Add Task" -- emits a custom event for the frontend
/// - Separator
/// - "Quit" -- exits the application
///
/// Uses the built-in Tauri 2 tray API (`tauri::tray::TrayIconBuilder`).

use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager};

/// Set up the system tray icon and its context menu.
///
/// Call this from the Tauri `setup` closure, passing a reference to the `App`.
pub fn setup_tray(app: &tauri::App) -> Result<(), String> {
    let open_item = MenuItemBuilder::with_id("open", "Open TickClone")
        .build(app)
        .map_err(|e| format!("Failed to build 'Open' menu item: {e}"))?;

    let quick_add_item = MenuItemBuilder::with_id("quick_add", "Quick Add Task")
        .build(app)
        .map_err(|e| format!("Failed to build 'Quick Add' menu item: {e}"))?;

    let separator = PredefinedMenuItem::separator(app)
        .map_err(|e| format!("Failed to build separator: {e}"))?;

    let quit_item = MenuItemBuilder::with_id("quit", "Quit")
        .build(app)
        .map_err(|e| format!("Failed to build 'Quit' menu item: {e}"))?;

    let menu = MenuBuilder::new(app)
        .items(&[&open_item, &quick_add_item, &separator, &quit_item])
        .build()
        .map_err(|e| format!("Failed to build tray menu: {e}"))?;

    TrayIconBuilder::new()
        .tooltip("TickClone")
        .menu(&menu)
        .on_menu_event(|app_handle, event| match event.id().as_ref() {
            "open" => {
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "quick_add" => {
                // Emit a custom event that the frontend can listen for.
                let _ = app_handle.emit("tray://quick-add-task", ());
            }
            "quit" => {
                app_handle.exit(0);
            }
            _ => {}
        })
        .build(app)
        .map_err(|e| format!("Failed to build tray icon: {e}"))?;

    Ok(())
}
