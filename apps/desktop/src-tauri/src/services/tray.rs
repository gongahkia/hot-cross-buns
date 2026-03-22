/// System tray integration (stub).
///
/// A full implementation requires the `tauri-plugin-tray` plugin to be added
/// to `Cargo.toml` and initialised in the Tauri builder.  This module provides
/// the scaffolding so the rest of the codebase can reference it.
///
/// NOTE (Task 56 – Global shortcut): Global shortcut registration
/// (e.g. Ctrl+Shift+T to show/hide the window) would also be wired up here
/// using the `tauri-plugin-global-shortcut` plugin once it is added as a
/// dependency.  The setup would look roughly like:
///
/// ```ignore
/// use tauri_plugin_global_shortcut::GlobalShortcutExt;
///
/// app.global_shortcut().register("CmdOrCtrl+Shift+T", |_app, _shortcut, _event| {
///     // toggle main window visibility
/// });
/// ```

/// Placeholder for system tray setup.
///
/// Call this from the Tauri builder chain once `tauri-plugin-tray` is available.
/// Currently a no-op.
pub fn setup_tray() {
    // TODO: Implement once tauri-plugin-tray is added.
    //
    // Typical steps:
    //   1. Create a TrayIconBuilder with icon, tooltip and menu items.
    //   2. Attach on_tray_icon_event for click / double-click.
    //   3. Attach on_menu_event for context-menu actions (Show, Quit, etc.).
}
