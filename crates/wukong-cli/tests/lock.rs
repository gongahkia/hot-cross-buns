use std::{fs, path::Path, process::Command};
use tempfile::TempDir;

#[test]
fn invariant_lock_writes_local_lock_without_materialising_packages() {
    let fixture = Fixture::new();
    fixture.addon("addon", "first");
    fixture.manifest("[dev-dependencies]\naddon = { path = \"addon\" }\n");

    let output = command(fixture.root()).output().expect("lock should run");

    assert!(output.status.success());
    assert!(fixture.root().join("wukong.lock").is_file());
    assert!(!fixture.root().join("addons").exists());
}

#[test]
fn invariant_repeated_offline_lock_reuses_existing_bytes_without_source_access() {
    let fixture = Fixture::new();
    let addon = fixture.addon("addon", "first");
    fixture.manifest("[dev-dependencies]\naddon = { path = \"addon\" }\n");
    let first = command(fixture.root())
        .output()
        .expect("first lock should run");
    let lock = fs::read(fixture.root().join("wukong.lock")).expect("lock should exist");
    fs::remove_dir_all(addon).expect("source should be removable");

    let second = command(fixture.root())
        .arg("--offline")
        .output()
        .expect("offline lock should run");

    assert!(first.status.success());
    assert!(second.status.success());
    assert!(String::from_utf8_lossy(&second.stdout).contains("unchanged"));
    assert_eq!(
        fs::read(fixture.root().join("wukong.lock")).expect("lock should remain"),
        lock
    );
}

#[test]
fn invariant_lock_refreshes_changed_local_source() {
    let fixture = Fixture::new();
    let addon = fixture.addon("addon", "first");
    fixture.manifest("[dev-dependencies]\naddon = { path = \"addon\" }\n");
    let first = command(fixture.root())
        .output()
        .expect("first lock should run");
    let initial_lock = fs::read(fixture.root().join("wukong.lock")).expect("lock should exist");
    fs::write(addon.join("plugin.gd"), "second").expect("source should change");

    let refreshed = command(fixture.root())
        .output()
        .expect("refreshed lock should run");
    let refreshed_lock = fs::read(fixture.root().join("wukong.lock")).expect("lock should exist");

    assert!(first.status.success());
    assert!(refreshed.status.success());
    assert_ne!(initial_lock, refreshed_lock);
    assert!(String::from_utf8_lossy(&refreshed.stdout).contains("locked"));
}

#[test]
fn invariant_locked_refuses_manifest_lock_mismatch() {
    let fixture = Fixture::new();
    fixture.addon("first", "first");
    fixture.addon("second", "second");
    fixture.manifest("[dev-dependencies]\naddon = { path = \"first\" }\n");
    assert!(
        command(fixture.root())
            .output()
            .expect("first lock should run")
            .status
            .success()
    );
    fixture.manifest("[dev-dependencies]\naddon = { path = \"second\" }\n");

    let output = command(fixture.root())
        .arg("--locked")
        .output()
        .expect("locked command should run");

    assert_eq!(output.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&output.stderr).contains("manifest and lockfile differ"));
}

fn command(current_directory: &Path) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_wukong"));
    command.arg("lock").current_dir(current_directory);
    command
}
struct Fixture {
    _directory: TempDir,
    root: std::path::PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let directory = TempDir::new().expect("fixture should exist");
        let root = directory.path().join("game");
        fs::create_dir(&root).expect("project should exist");
        fs::write(
            root.join("project.godot"),
            "[application]\nconfig/name=\"fixture\"\n",
        )
        .expect("project marker should write");
        Self {
            _directory: directory,
            root,
        }
    }
    fn root(&self) -> &Path {
        &self.root
    }
    fn manifest(&self, dependencies: &str) {
        fs::write(
            self.root.join("wukong.toml"),
            format!("[project]\nname=\"fixture\"\ngodot=\"4\"\n\n{dependencies}"),
        )
        .expect("manifest should write");
    }
    fn addon(&self, name: &str, contents: &str) -> std::path::PathBuf {
        let addon = self.root.join(name);
        fs::create_dir(&addon).expect("addon should create");
        fs::write(addon.join("plugin.gd"), contents).expect("addon should write");
        addon
    }
}
