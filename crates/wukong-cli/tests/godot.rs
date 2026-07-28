use std::{path::Path, process::Command};

#[test]
fn invariant_godot_path_prints_explicit_selection_and_verbose_source_without_execution() {
    let executable = env!("CARGO_BIN_EXE_wukong");
    let output = Command::new(executable)
        .args([
            "godot",
            "path",
            "--godot-executable",
            executable,
            "--verbose",
        ])
        .current_dir(Path::new(env!("CARGO_MANIFEST_DIR")))
        .output()
        .expect("Godot path should run");

    assert!(output.status.success());
    let stdout = String::from_utf8(output.stdout).expect("output should be UTF-8");
    assert!(stdout.contains("selected from explicit path"));
    assert!(stdout.contains(executable));
}
