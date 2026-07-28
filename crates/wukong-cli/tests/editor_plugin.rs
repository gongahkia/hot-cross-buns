use std::{fs, path::PathBuf};

#[test]
fn invariant_editor_plugin_delegates_state_and_sync_to_versioned_cli_events() {
    let plugin = plugin_directory();
    let configuration = fs::read_to_string(plugin.join("plugin.cfg"))
        .expect("plugin configuration should be readable");
    let entrypoint = fs::read_to_string(plugin.join("wukong_plugin.gd"))
        .expect("plugin entrypoint should be readable");
    let dock =
        fs::read_to_string(plugin.join("wukong_dock.gd")).expect("plugin dock should be readable");

    assert!(configuration.contains("script=\"wukong_plugin.gd\""));
    assert!(entrypoint.contains("add_control_to_dock"));
    assert!(entrypoint.contains("remove_control_from_docks"));
    assert!(dock.contains("OS.execute_with_pipe"));
    assert!(dock.contains("[\"status\", \"--json\", \"--project\", _project_path()]"));
    assert!(dock.contains("[\"sync\", \"--json\", \"--project\", _project_path()]"));
    assert!(dock.contains("const PROTOCOL_VERSION := 1"));
    assert!(dock.contains("_show_diagnostic"));
    assert!(dock.contains("navigate_to_path"));
    assert!(!dock.contains("ConfigFile"));
    assert!(!dock.contains("FileAccess.open"));
}

fn plugin_directory() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join("editor-plugin/addons/wukong")
}
