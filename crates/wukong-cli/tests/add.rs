use std::{fs, path::Path, process::Command};
use tempfile::TempDir;
use wukong_core::lockfile::Lockfile;

#[test]
fn invariant_add_runtime_local_path_rolls_back_without_lock_or_project_mutation() {
    let fixture = Fixture::new();
    fixture.addon("addon", "extends Node\n");
    let manifest_before = fixture.manifest();

    let output = command(&fixture)
        .args(["addon", "--path", "addon"])
        .output()
        .expect("add should run");

    assert_eq!(output.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&output.stderr).contains("only in [dev-dependencies]"));
    assert_eq!(fixture.manifest(), manifest_before);
    assert!(!fixture.root().join("wukong.lock").exists());
    assert!(!fixture.root().join("addons/addon").exists());
}

#[test]
fn invariant_add_dev_marks_the_lock_and_installs_the_new_development_dependency() {
    let fixture = Fixture::new();
    fixture.addon("dev-tool", "extends Node\n");

    let output = command(&fixture)
        .args(["dev-tool", "--path", "dev-tool", "--dev"])
        .output()
        .expect("add should run");
    let lock = Lockfile::parse(
        &fixture.root().join("wukong.lock"),
        &fs::read_to_string(fixture.root().join("wukong.lock")).expect("lock should read"),
    )
    .expect("lock should parse");

    assert!(
        output.status.success(),
        "add failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(fixture.manifest().contains("[dev-dependencies]"));
    assert!(
        lock.packages()
            .get("dev-tool")
            .expect("development lock entry should exist")
            .development()
    );
    assert!(fixture.root().join("addons/dev-tool/plugin.gd").is_file());
}

#[test]
fn invariant_failed_add_restores_manifest_and_removes_new_lockfile() {
    let fixture = Fixture::new();
    fixture.addon("addon", "package content\n");
    fs::create_dir_all(fixture.root().join("addons/addon")).expect("project path should create");
    fs::write(
        fixture.root().join("addons/addon/plugin.gd"),
        "user content\n",
    )
    .expect("unowned file should write");
    let manifest_before = fixture.manifest();

    let output = command(&fixture)
        .args(["addon", "--path", "addon"])
        .output()
        .expect("add should run");

    assert_eq!(
        output.status.code(),
        Some(2),
        "add failed unexpectedly: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(fixture.manifest(), manifest_before);
    assert!(!fixture.root().join("wukong.lock").exists());
    assert_eq!(
        fs::read_to_string(fixture.root().join("addons/addon/plugin.gd"))
            .expect("user file should remain"),
        "user content\n"
    );
}

fn command(fixture: &Fixture) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_wukong"));
    command
        .arg("add")
        .current_dir(fixture.root())
        .env("WUKONG_CACHE_DIR", fixture.cache_root());
    command
}

struct Fixture {
    directory: TempDir,
    root: std::path::PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let directory = TempDir::new().expect("fixture directory should exist");
        let root = directory.path().join("game");
        fs::create_dir(&root).expect("project should create");
        fs::write(
            root.join("project.godot"),
            "[application]\nconfig/name=\"fixture\"\n",
        )
        .expect("project marker should write");
        fs::write(
            root.join("wukong.toml"),
            "[project]\nname=\"fixture\"\ngodot=\"4\"\n",
        )
        .expect("manifest should write");
        Self { directory, root }
    }

    fn root(&self) -> &Path {
        &self.root
    }

    fn cache_root(&self) -> std::path::PathBuf {
        self.directory.path().join("cache")
    }

    fn addon(&self, name: &str, content: &str) {
        let path = self.root.join(name);
        fs::create_dir(&path).expect("addon should create");
        fs::write(path.join("plugin.gd"), content).expect("addon should write");
    }

    fn manifest(&self) -> String {
        fs::read_to_string(self.root.join("wukong.toml")).expect("manifest should read")
    }
}
