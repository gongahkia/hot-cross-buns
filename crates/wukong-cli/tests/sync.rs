use std::{
    collections::BTreeSet,
    fs,
    path::{Path, PathBuf},
    process::Command,
};
use tempfile::TempDir;
use wukong_core::{
    identity::PackageName,
    lockfile::{GodotCompatibility, LockedGitSource, LockedHttpSource, LockedPackage, Lockfile},
    source::ImmutableSourceId,
};

#[test]
fn invariant_install_materialises_locked_local_dependencies_and_sync_is_a_noop() {
    let fixture = Fixture::new();
    fixture.addon("addon", "first");
    fixture.manifest("[dependencies]\naddon = { path = \"addon\" }\n");
    assert!(
        command("lock", fixture.root())
            .output()
            .expect("lock should run")
            .status
            .success()
    );

    let install = command("install", fixture.root())
        .arg("--offline")
        .output()
        .expect("install should run");
    let sync = command("sync", fixture.root())
        .output()
        .expect("sync should run");

    assert!(install.status.success());
    assert!(sync.status.success());
    assert_eq!(
        fs::read_to_string(fixture.root().join("addons/addon/plugin.gd"))
            .expect("addon should materialise"),
        "first"
    );
    assert!(String::from_utf8_lossy(&sync.stdout).contains("0 written, 1 unchanged, 0 removed"));
}

#[test]
fn invariant_locked_and_frozen_sync_refuse_a_changed_manifest_without_project_mutation() {
    let fixture = Fixture::new();
    fixture.addon("first", "first");
    fixture.addon("second", "second");
    fixture.manifest("[dependencies]\naddon = { path = \"first\" }\n");
    assert!(
        command("lock", fixture.root())
            .output()
            .expect("lock should run")
            .status
            .success()
    );
    fixture.manifest("[dependencies]\naddon = { path = \"second\" }\n");

    for option in ["--locked", "--frozen"] {
        let output = command("sync", fixture.root())
            .arg(option)
            .output()
            .expect("locked sync should run");

        assert_eq!(output.status.code(), Some(2));
        assert!(String::from_utf8_lossy(&output.stderr).contains("manifest and lockfile differ"));
    }
    assert!(!fixture.root().join("addons").exists());
}

#[test]
fn invariant_sync_removes_an_unmodified_package_absent_from_the_new_lockfile() {
    let fixture = Fixture::new();
    fixture.addon("addon", "first");
    fixture.manifest("[dependencies]\naddon = { path = \"addon\" }\n");
    assert!(
        command("lock", fixture.root())
            .output()
            .expect("lock should run")
            .status
            .success()
    );
    assert!(
        command("sync", fixture.root())
            .output()
            .expect("sync should run")
            .status
            .success()
    );
    fixture.manifest("");
    assert!(
        command("lock", fixture.root())
            .output()
            .expect("lock should run")
            .status
            .success()
    );

    let output = command("sync", fixture.root())
        .output()
        .expect("sync should run");

    assert!(output.status.success());
    assert!(!fixture.root().join("addons/addon/plugin.gd").exists());
    assert!(String::from_utf8_lossy(&output.stdout).contains("0 written, 0 unchanged, 1 removed"));
}

#[test]
fn invariant_explicit_godot_version_is_validated_before_lockfile_or_project_mutation() {
    let fixture = Fixture::new();
    fixture.addon("addon", "first");
    fixture.manifest("[dependencies]\naddon = { path = \"addon\" }\n");

    let incompatible_lock = command("lock", fixture.root())
        .args(["--godot", "3.5.0"])
        .output()
        .expect("lock should run");
    assert_eq!(incompatible_lock.status.code(), Some(2));
    assert!(!fixture.root().join("wukong.lock").exists());

    assert!(
        command("lock", fixture.root())
            .args(["--godot", "4.4.0"])
            .output()
            .expect("compatible lock should run")
            .status
            .success()
    );
    let incompatible_sync = command("sync", fixture.root())
        .args(["--godot", "3.5.0"])
        .output()
        .expect("sync should run");

    assert_eq!(incompatible_sync.status.code(), Some(2));
    assert!(!fixture.root().join("addons").exists());
    assert!(String::from_utf8_lossy(&incompatible_sync.stderr).contains("does not satisfy"));
}

#[test]
fn invariant_incompatible_package_godot_metadata_blocks_lock_publication_and_installation() {
    let fixture = Fixture::new();
    fixture.addon("addon", "first");
    fixture.addon_metadata("addon", "<4");
    fixture.manifest("[dependencies]\naddon = { path = \"addon\" }\n");

    let output = command("lock", fixture.root())
        .output()
        .expect("lock should run");

    assert_eq!(output.status.code(), Some(2));
    assert!(!fixture.root().join("wukong.lock").exists());
    assert!(!fixture.root().join("addons").exists());
    assert!(String::from_utf8_lossy(&output.stderr).contains("incompatible with project"));
}

#[test]
fn invariant_offline_cli_sync_lists_missing_remote_cache_objects_before_project_mutation() {
    let fixture = Fixture::new();
    let git_commit = "1".repeat(40);
    let archive_sha256 = "2".repeat(64);
    fixture.manifest(&format!(
        "[dependencies]\ngit-addon = {{ git = \"https://fixture.test/git-addon.git\", rev = \"{git_commit}\" }}\nhttp-addon = {{ url = \"https://fixture.test/http-addon.zip\", sha256 = \"{archive_sha256}\" }}\n"
    ));
    let lock = Lockfile::new([
        remote_locked_package(
            "git-addon",
            LockedGitSource::new(
                ImmutableSourceId::new(format!("git:{git_commit}"))
                    .expect("Git identity should be valid"),
                "https://fixture.test/git-addon.git",
                git_commit.clone(),
            )
            .expect("Git source should be valid")
            .into(),
        ),
        remote_locked_package(
            "http-addon",
            LockedHttpSource::new(
                ImmutableSourceId::new(format!("sha256:{archive_sha256}"))
                    .expect("HTTP identity should be valid"),
                "https://fixture.test/http-addon.zip",
                archive_sha256.clone(),
            )
            .expect("HTTP source should be valid")
            .into(),
        ),
    ])
    .expect("lockfile should be valid");
    fs::write(fixture.root().join("wukong.lock"), lock.to_toml()).expect("lockfile should write");

    let output = command("sync", fixture.root())
        .arg("--offline")
        .env("WUKONG_CACHE_DIR", fixture.root().join("cache"))
        .output()
        .expect("offline sync should run");

    assert_eq!(output.status.code(), Some(3));
    let stderr = String::from_utf8(output.stderr).expect("diagnostic should be UTF-8");
    assert!(stderr.contains(&format!("git-addon (Git checkout {git_commit})")));
    assert!(stderr.contains(&format!(
        "http-addon (HTTPS archive sha256:{archive_sha256})"
    )));
    assert!(!fixture.root().join("addons").exists());
    assert!(!fixture.root().join(".wukong/state.toml").exists());
}

#[test]
fn invariant_unknown_package_godot_metadata_is_reported_without_blocking_lock() {
    let fixture = Fixture::new();
    fixture.addon("addon", "first");
    fixture.manifest("[dependencies]\naddon = { path = \"addon\" }\n");

    let output = command("lock", fixture.root())
        .output()
        .expect("lock should run");

    assert!(output.status.success());
    assert!(String::from_utf8_lossy(&output.stdout).contains("unknown for addon"));
}

fn command(subcommand: &str, current_directory: &Path) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_wukong"));
    command.arg(subcommand).current_dir(current_directory);
    command
}

fn remote_locked_package(name: &str, source: wukong_core::lockfile::LockedSource) -> LockedPackage {
    LockedPackage::new(
        PackageName::parse(name).expect("package name should be valid"),
        None,
        source,
        "3".repeat(64),
        "4".repeat(64),
        BTreeSet::new(),
        PathBuf::from("."),
        PathBuf::from(format!("addons/{name}")),
        GodotCompatibility::Unknown,
        false,
    )
    .expect("locked package should be valid")
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
    fn addon(&self, name: &str, contents: &str) {
        let addon = self.root.join(name);
        fs::create_dir(&addon).expect("addon should create");
        fs::write(addon.join("plugin.gd"), contents).expect("addon should write");
    }

    fn addon_metadata(&self, name: &str, godot: &str) {
        fs::write(
            self.root.join(name).join("wukong-package.toml"),
            format!("[package]\nschema=1\nname=\"{name}\"\nversion=\"1.0.0\"\ngodot=\"{godot}\"\n"),
        )
        .expect("addon metadata should write");
    }
}
