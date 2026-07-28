use std::{fs, path::Path, process::Command};
use tempfile::TempDir;
use wukong_core::lockfile::Lockfile;

#[test]
fn invariant_selected_dry_run_preserves_lockfile_and_project_files() {
    let fixture = Fixture::new();
    fixture.addon("alpha", "first\n");
    fixture.addon("beta", "first\n");
    add(&fixture, "alpha");
    add(&fixture, "beta");
    let lock_before = fixture.lock();
    fixture.set_addon_content("alpha", "second\n");

    let output = command(fixture.root())
        .args(["alpha", "--dry-run"])
        .output()
        .expect("dry-run should run");

    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(fixture.lock(), lock_before);
    assert_eq!(fixture.installed_content("alpha"), "first\n");
    assert!(String::from_utf8_lossy(&output.stdout).contains("would update alpha:"));
}

#[test]
fn invariant_selected_update_changes_only_the_selected_package_and_summarizes_source_change() {
    let fixture = Fixture::new();
    fixture.addon("alpha", "first\n");
    fixture.addon("beta", "first\n");
    add(&fixture, "alpha");
    add(&fixture, "beta");
    let lock_before = fixture.parsed_lock();
    fixture.set_addon_content("alpha", "second\n");

    let output = command(fixture.root())
        .arg("alpha")
        .output()
        .expect("selected update should run");
    let lock_after = fixture.parsed_lock();

    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_ne!(
        lock_before.packages().get("alpha"),
        lock_after.packages().get("alpha")
    );
    assert_eq!(
        lock_before.packages().get("beta"),
        lock_after.packages().get("beta")
    );
    assert_eq!(fixture.installed_content("alpha"), "second\n");
    assert_eq!(fixture.installed_content("beta"), "first\n");
    assert!(String::from_utf8_lossy(&output.stdout).contains("updated alpha:"));
}

#[test]
fn invariant_update_all_updates_every_direct_package() {
    let fixture = Fixture::new();
    fixture.addon("alpha", "first\n");
    fixture.addon("beta", "first\n");
    add(&fixture, "alpha");
    add(&fixture, "beta");
    fixture.set_addon_content("alpha", "second\n");
    fixture.set_addon_content("beta", "second\n");

    let output = command(fixture.root())
        .output()
        .expect("all update should run");

    assert!(output.status.success());
    assert_eq!(fixture.installed_content("alpha"), "second\n");
    assert_eq!(fixture.installed_content("beta"), "second\n");
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("updated alpha:"));
    assert!(stdout.contains("updated beta:"));
}

#[test]
fn invariant_selected_update_rolls_back_the_lock_when_an_unselected_locked_source_changed() {
    let fixture = Fixture::new();
    fixture.addon("alpha", "first\n");
    fixture.addon("beta", "first\n");
    add(&fixture, "alpha");
    add(&fixture, "beta");
    let lock_before = fixture.lock();
    fixture.set_addon_content("alpha", "second\n");
    fixture.set_addon_content("beta", "second\n");

    let output = command(fixture.root())
        .arg("alpha")
        .output()
        .expect("selected update should run");

    assert!(!output.status.success());
    assert_eq!(fixture.lock(), lock_before);
    assert_eq!(fixture.installed_content("alpha"), "first\n");
    assert_eq!(fixture.installed_content("beta"), "first\n");
    assert!(String::from_utf8_lossy(&output.stderr).contains("locked package beta"));
}

#[test]
fn invariant_version_only_update_fails_before_lockfile_or_project_mutation() {
    let fixture = Fixture::new();
    fixture.addon("alpha", "first\n");
    add(&fixture, "alpha");
    let lock_before = fixture.lock();
    fs::write(
        fixture.root().join("wukong.toml"),
        "[project]\nname=\"fixture\"\ngodot=\"4\"\n\n[dependencies]\nalpha=\"^1\"\n",
    )
    .expect("manifest should change");

    let output = command(fixture.root())
        .arg("alpha")
        .output()
        .expect("version-only update should run");

    assert_eq!(output.status.code(), Some(2));
    assert_eq!(fixture.lock(), lock_before);
    assert_eq!(fixture.installed_content("alpha"), "first\n");
    assert!(String::from_utf8_lossy(&output.stderr).contains("require a package catalogue"));
}

fn add(fixture: &Fixture, alias: &str) {
    let output = Command::new(env!("CARGO_BIN_EXE_wukong"))
        .args(["add", alias, "--path", alias])
        .current_dir(fixture.root())
        .output()
        .expect("add should run");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn command(current_directory: &Path) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_wukong"));
    command.arg("update").current_dir(current_directory);
    command
}

struct Fixture {
    _directory: TempDir,
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
        Self {
            _directory: directory,
            root,
        }
    }

    fn root(&self) -> &Path {
        &self.root
    }

    fn addon(&self, name: &str, content: &str) {
        let path = self.root.join(name);
        fs::create_dir(&path).expect("addon should create");
        fs::write(path.join("plugin.gd"), content).expect("addon should write");
    }

    fn set_addon_content(&self, name: &str, content: &str) {
        fs::write(self.root.join(name).join("plugin.gd"), content)
            .expect("addon content should change");
    }

    fn installed_content(&self, name: &str) -> String {
        fs::read_to_string(self.root.join("addons").join(name).join("plugin.gd"))
            .expect("installed file should read")
    }

    fn lock(&self) -> String {
        fs::read_to_string(self.root.join("wukong.lock")).expect("lock should read")
    }

    fn parsed_lock(&self) -> Lockfile {
        let path = self.root.join("wukong.lock");
        Lockfile::parse(&path, &fs::read_to_string(&path).expect("lock should read"))
            .expect("lock should parse")
    }
}
