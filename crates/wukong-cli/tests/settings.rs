use std::{fs, process::Command};
use tempfile::TempDir;

fn command(config_root: &std::path::Path) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_wukong"));
    command.env("WUKONG_CONFIG_DIR", config_root);
    command
}

#[test]
fn invariant_settings_persist_global_presentation_without_project_mutation() {
    let fixture = TempDir::new().expect("fixture should exist");
    let config = fixture.path().join("config");

    let listed = command(&config)
        .args(["settings", "list-spinners"])
        .output()
        .expect("settings list should run");
    assert!(listed.status.success());
    let names = String::from_utf8(listed.stdout).expect("names should be UTF-8");
    assert_eq!(names.lines().count(), 54);
    assert!(names.lines().any(|name| name == "simple-dots"));

    let set = command(&config)
        .args(["settings", "set", "progress.spinner", "dots"])
        .output()
        .expect("settings set should run");
    assert!(set.status.success());
    assert!(String::from_utf8_lossy(&set.stdout).contains("updated progress.spinner"));

    let get = command(&config)
        .args(["settings", "get", "progress.spinner"])
        .output()
        .expect("settings get should run");
    assert!(get.status.success());
    assert_eq!(
        String::from_utf8(get.stdout).expect("setting should be UTF-8"),
        "dots\n"
    );
    assert!(config.join("wukong/settings.toml").exists());

    let reset = command(&config)
        .args(["settings", "reset", "progress.spinner"])
        .output()
        .expect("settings reset should run");
    assert!(reset.status.success());
    let restored = command(&config)
        .args(["settings", "get", "progress.spinner"])
        .output()
        .expect("settings get should run");
    assert_eq!(
        String::from_utf8(restored.stdout).expect("setting should be UTF-8"),
        "simple-dots\n"
    );
}

#[test]
fn invariant_unknown_global_progress_style_fails_without_writing_settings() {
    let fixture = TempDir::new().expect("fixture should exist");
    let config = fixture.path().join("config");
    let output = command(&config)
        .args([
            "--progress-spinner",
            "not-a-spinner",
            "settings",
            "list-bars",
        ])
        .output()
        .expect("command should run");

    assert_eq!(output.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&output.stderr).contains("unknown Rattles spinner"));
    assert!(!config.exists());
}

#[cfg(unix)]
#[test]
fn invariant_run_forwards_only_explicit_godot_arguments() {
    use std::os::unix::fs::PermissionsExt;

    let fixture = TempDir::new().expect("fixture should exist");
    let project = fixture.path().join("project");
    let config = fixture.path().join("config");
    let record = fixture.path().join("arguments.txt");
    fs::create_dir_all(&project).expect("project should create");
    fs::write(
        project.join("project.godot"),
        "[application]\nconfig/name=\"fixture\"\n",
    )
    .expect("project file should write");
    let executable = fixture.path().join("godot-fixture");
    fs::write(
        &executable,
        "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$WUKONG_TEST_RECORD\"\n",
    )
    .expect("fixture executable should write");
    let mut permissions = fs::metadata(&executable)
        .expect("fixture executable should stat")
        .permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(&executable, permissions)
        .expect("fixture executable should become executable");

    let output = command(&config)
        .env("WUKONG_TEST_RECORD", &record)
        .args([
            "run",
            "--project",
            project.to_str().expect("UTF-8 project path"),
            "--godot-executable",
            executable.to_str().expect("UTF-8 executable path"),
            "--headless",
            "--scene",
            "res://main.tscn",
            "--",
            "--rendering-method",
            "gl_compatibility",
        ])
        .output()
        .expect("run should execute fixture Godot");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let arguments = fs::read_to_string(record).expect("fixture should record arguments");
    let canonical_project = project.canonicalize().expect("project should canonicalise");
    assert_eq!(
        arguments.lines().collect::<Vec<_>>(),
        vec![
            "--path",
            canonical_project.to_str().expect("UTF-8 project path"),
            "--headless",
            "--scene",
            "res://main.tscn",
            "--rendering-method",
            "gl_compatibility",
        ]
    );
}

#[cfg(unix)]
#[test]
fn invariant_persisted_godot_selection_launches_editor_without_project_state_changes() {
    use std::os::unix::fs::PermissionsExt;

    let fixture = TempDir::new().expect("fixture should exist");
    let project = fixture.path().join("project");
    let config = fixture.path().join("config");
    let record = fixture.path().join("arguments.txt");
    fs::create_dir_all(&project).expect("project should create");
    fs::write(
        project.join("project.godot"),
        "[application]\nconfig/name=\"fixture\"\n",
    )
    .expect("project file should write");
    let executable = fixture.path().join("godot-fixture");
    fs::write(
        &executable,
        "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$WUKONG_TEST_RECORD\"\n",
    )
    .expect("fixture executable should write");
    let mut permissions = fs::metadata(&executable)
        .expect("fixture executable should stat")
        .permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(&executable, permissions)
        .expect("fixture executable should become executable");

    let configured = command(&config)
        .args([
            "settings",
            "set",
            "godot.executable",
            executable.to_str().expect("UTF-8 executable path"),
        ])
        .output()
        .expect("settings set should run");
    assert!(
        configured.status.success(),
        "{}",
        String::from_utf8_lossy(&configured.stderr)
    );

    let output = command(&config)
        .env("WUKONG_TEST_RECORD", &record)
        .args([
            "editor",
            "--project",
            project.to_str().expect("UTF-8 project path"),
        ])
        .output()
        .expect("editor should execute configured Godot");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let arguments = fs::read_to_string(record).expect("fixture should record arguments");
    let canonical_project = project.canonicalize().expect("project should canonicalise");
    assert_eq!(
        arguments.lines().collect::<Vec<_>>(),
        vec![
            "--path",
            canonical_project.to_str().expect("UTF-8 project path"),
            "--editor",
        ]
    );
    assert!(!project.join("wukong.toml").exists());
    assert!(!project.join("wukong.lock").exists());
}
