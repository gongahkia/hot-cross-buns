use std::{collections::BTreeSet, fs, path::Path, process::Command};
use tempfile::TempDir;
use wukong_core::{
    identity::PackageName,
    lockfile::{GodotCompatibility, LockedLocalSource, LockedPackage, Lockfile},
    semantic_version::SemanticVersion,
    source::ImmutableSourceId,
};

#[test]
fn invariant_outdated_reports_non_catalogue_sources_without_network_access() {
    let fixture = Fixture::new();

    let output = command(fixture.root())
        .output()
        .expect("outdated should run");

    assert!(output.status.success());
    assert_eq!(
        String::from_utf8(output.stdout).expect("output should be UTF-8"),
        "alpha: unavailable (local source has no version catalogue)\n"
    );
}

#[test]
fn invariant_outdated_json_is_deterministic_and_versioned() {
    let fixture = Fixture::new();

    let first = command(fixture.root())
        .arg("--json")
        .output()
        .expect("JSON outdated should run");
    let second = command(fixture.root())
        .arg("--json")
        .output()
        .expect("repeated JSON outdated should run");

    assert!(first.status.success());
    assert_eq!(first.stdout, second.stdout);
    assert_eq!(
        String::from_utf8(first.stdout).expect("output should be UTF-8"),
        "{\"schema\":1,\"packages\":[{\"name\":\"alpha\",\"status\":\"unavailable\",\"current\":null,\"compatible\":null,\"breaking\":null,\"reason\":\"local source has no version catalogue\"}]}\n"
    );
}

fn command(current_directory: &Path) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_wukong"));
    command.arg("outdated").current_dir(current_directory);
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
        let lock = Lockfile::new([package("alpha", 1)]).expect("lock should build");
        fs::write(root.join("wukong.lock"), lock.to_toml()).expect("lock should write");
        Self {
            _directory: directory,
            root,
        }
    }

    fn root(&self) -> &Path {
        &self.root
    }
}

fn package(name: &str, index: usize) -> LockedPackage {
    let checksum = format!("{index:064x}");
    let source = LockedLocalSource::new(
        ImmutableSourceId::new(format!("sha256:{checksum}")).expect("source ID should parse"),
        checksum.clone(),
    )
    .expect("source should build");
    LockedPackage::new(
        PackageName::parse(name).expect("package name should parse"),
        Some(SemanticVersion::parse("1.0.0").expect("version should parse")),
        source,
        checksum,
        format!("{:064x}", index + 100),
        BTreeSet::new(),
        ".".into(),
        format!("addons/{name}").into(),
        GodotCompatibility::Unknown,
        false,
    )
    .expect("package should build")
}
