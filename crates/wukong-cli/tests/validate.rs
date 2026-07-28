#![cfg(unix)]

use std::{
    fs,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    process::Command,
};
use tempfile::TempDir;

#[test]
fn invariant_validate_runs_only_when_explicitly_requested() {
    let fixture = Fixture::new();
    let executable = fixture.script("passing-godot", "exit 0");
    let output = Command::new(env!("CARGO_BIN_EXE_wukong"))
        .args(["validate", "--project"])
        .arg(fixture.project())
        .args(["--godot-executable"])
        .arg(executable)
        .args(["--verbose"])
        .output()
        .expect("validation command should run");

    assert!(output.status.success());
    let stdout = String::from_utf8(output.stdout).expect("stdout should be UTF-8");
    assert!(stdout.contains("selected from explicit path"));
    assert!(stdout.contains("validation: passed"));
}

#[test]
fn invariant_validate_redacts_project_paths_from_verbose_failure_diagnostics() {
    let fixture = Fixture::new();
    let executable = fixture.script("failing-godot", "printf '%s' \"$3\"; exit 7");
    let output = Command::new(env!("CARGO_BIN_EXE_wukong"))
        .args(["validate", "--project"])
        .arg(fixture.project())
        .args(["--godot-executable"])
        .arg(executable)
        .args(["--verbose"])
        .output()
        .expect("validation command should run");

    assert_eq!(output.status.code(), Some(3));
    let stderr = String::from_utf8(output.stderr).expect("stderr should be UTF-8");
    assert!(stderr.contains("<project>"));
    assert!(!stderr.contains(&fixture.project().display().to_string()));
}

struct Fixture {
    directory: TempDir,
    project: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let directory = TempDir::new().expect("fixture directory should exist");
        let project = directory.path().join("project");
        fs::create_dir(&project).expect("project directory should exist");
        fs::write(
            project.join("project.godot"),
            "[application]\nconfig/name=\"test\"\n",
        )
        .expect("project marker should write");
        Self { directory, project }
    }

    fn project(&self) -> &Path {
        &self.project
    }

    fn script(&self, name: &str, body: &str) -> PathBuf {
        let path = self.directory.path().join(name);
        fs::write(&path, format!("#!/bin/sh\n{body}\n")).expect("script should write");
        let mut permissions = fs::metadata(&path)
            .expect("script should stat")
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&path, permissions).expect("script should chmod");
        path
    }
}
