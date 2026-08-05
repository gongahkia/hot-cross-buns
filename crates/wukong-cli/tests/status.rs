use std::{collections::BTreeSet, fs, path::Path, process::Command};
use tempfile::TempDir;
use wukong_core::{
    identity::PackageName,
    installed_state::{InstalledPackage, InstalledState, state_path},
    lockfile::{CatalogGraphRoots, GodotCompatibility, LockedGitSource, LockedPackage, Lockfile},
    semantic_version::SemanticVersion,
    source::ImmutableSourceId,
};

#[test]
fn invariant_status_json_reports_only_installed_package_identities() {
    let fixture = Fixture::new();
    fixture.addon("addon", "first");
    fixture.manifest("[dev-dependencies]\naddon = { path = \"addon\" }\n");
    assert!(
        command("lock", fixture.root())
            .output()
            .expect("lock should run")
            .status
            .success()
    );
    assert!(
        command("sync", fixture.root())
            .arg("--dev")
            .output()
            .expect("sync should run")
            .status
            .success()
    );

    let output = command("status", fixture.root())
        .arg("--json")
        .output()
        .expect("status should run");

    assert!(output.status.success());
    let events = String::from_utf8(output.stdout)
        .expect("JSON output should be UTF-8")
        .lines()
        .map(|line| serde_json::from_str::<serde_json::Value>(line).expect("event should parse"))
        .collect::<Vec<_>>();
    assert_eq!(
        events
            .iter()
            .map(|event| event["type"].as_str().expect("event should have a type"))
            .collect::<Vec<_>>(),
        ["started", "progress", "result"]
    );
    assert_eq!(events[0]["command"], "status");
    assert_eq!(events[2]["result"]["packages"][0]["name"], "addon");
    assert!(
        events[2]["result"]["packages"][0]["immutable_id"]
            .as_str()
            .expect("immutable ID should be a string")
            .starts_with("sha256:")
    );
}

#[test]
fn invariant_schema_three_status_uses_persisted_graph_groups() {
    let fixture = Fixture::new();
    let commit = "4ab90a80b815bc1ad4a8d7eea92c785e654bfd91";
    let checksum = format!("{:064x}", 101);
    let source = LockedGitSource::new(
        ImmutableSourceId::new(format!("git:{commit}")).expect("identity should parse"),
        "https://example.test/catalog.git",
        commit.to_owned(),
    )
    .expect("source should build");
    let package = LockedPackage::new(
        PackageName::parse("runtime").expect("name should parse"),
        Some(SemanticVersion::parse("1.0.0").expect("version should parse")),
        source,
        checksum.clone(),
        format!("{:064x}", 201),
        BTreeSet::new(),
        "addons/runtime".into(),
        "addons/runtime".into(),
        GodotCompatibility::Requirement("4".parse().expect("Godot requirement should parse")),
        false,
    )
    .expect("package should build")
    .with_catalog_sha256(format!("{:064x}", 1))
    .expect("catalog fingerprint should build");
    let lock = Lockfile::new_catalog_graph(
        [package],
        CatalogGraphRoots::new(
            [PackageName::parse("runtime").expect("name should parse")],
            [],
        ),
    )
    .expect("catalog lock should build");
    fs::write(fixture.root().join("wukong.lock"), lock.to_toml()).expect("lock should write");
    let state = InstalledState::new(
        BTreeSet::new(),
        [InstalledPackage::new(
            PackageName::parse("runtime").expect("name should parse"),
            ImmutableSourceId::new(format!("git:{commit}")).expect("identity should parse"),
            checksum,
        )
        .expect("installed package should build")],
        [],
    )
    .expect("installed state should build");
    fs::create_dir(fixture.root().join(".wukong")).expect("state directory should create");
    fs::write(state_path(fixture.root()), state.to_toml()).expect("state should write");

    let output = command("status", fixture.root())
        .arg("--json")
        .output()
        .expect("status should run");

    assert!(output.status.success());
    let events = String::from_utf8(output.stdout)
        .expect("JSON output should be UTF-8")
        .lines()
        .map(|line| serde_json::from_str::<serde_json::Value>(line).expect("event should parse"))
        .collect::<Vec<_>>();
    let package = &events[2]["result"]["packages"][0];
    assert_eq!(package["direct_runtime"], true);
    assert_eq!(package["runtime"], true);
    assert_eq!(package["development"], false);
}

fn command(subcommand: &str, current_directory: &Path) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_wukong"));
    command.arg(subcommand).current_dir(current_directory);
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
        Self::metadata(&addon, name);
    }

    fn metadata(root: &Path, name: &str) {
        fs::write(
            root.join("wukong-package.toml"),
            format!(
                "[package]\nschema = 1\nname = \"{name}\"\nversion = \"1.0.0\"\ngodot = \"4\"\n"
            ),
        )
        .expect("package metadata should write");
    }
}
