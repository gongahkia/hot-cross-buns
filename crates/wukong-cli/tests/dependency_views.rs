use std::{collections::BTreeSet, fs, path::Path, process::Command};
use tempfile::TempDir;
use wukong_core::{
    identity::PackageName,
    lockfile::{
        CatalogGraphRoots, GodotCompatibility, LockedGitSource, LockedLocalSource, LockedPackage,
        Lockfile,
    },
    semantic_version::SemanticVersion,
    source::ImmutableSourceId,
};

#[test]
fn invariant_tree_compacts_repeated_subgraphs_and_marks_dependency_kinds() {
    let fixture = Fixture::new();

    let output = command("tree", fixture.root())
        .output()
        .expect("tree should run");
    let json = command("tree", fixture.root())
        .arg("--json")
        .output()
        .expect("JSON tree should run");
    let stdout = String::from_utf8_lossy(&output.stdout);

    assert!(output.status.success());
    assert!(stdout.contains("runtime dependencies:"));
    assert!(stdout.contains("alpha@1.0.0 [direct]"));
    assert!(stdout.contains("beta@1.0.0 [direct]"));
    assert!(stdout.contains("shared@1.0.0 [transitive]"));
    assert!(stdout.contains("shared@1.0.0 [transitive] [repeated]"));
    assert!(stdout.contains("development dependencies:"));
    assert!(stdout.contains("dev-tool@1.0.0 [direct, development]"));
    assert!(json.status.success());
    let events = json_events(&json.stdout);
    assert_eq!(
        event_types(&events),
        ["started", "progress", "progress", "result"]
    );
    assert_eq!(events[0]["command"], "tree");
    assert_eq!(
        events[3]["result"]["roots"]["runtime"],
        serde_json::json!(["alpha", "beta"])
    );
    assert_eq!(events[3]["result"]["packages"][3]["name"], "shared");
}

#[test]
fn invariant_why_reports_all_root_paths_and_json_is_deterministic() {
    let fixture = Fixture::new();

    let human = command("why", fixture.root())
        .arg("shared")
        .output()
        .expect("why should run");
    let first_json = command("why", fixture.root())
        .args(["shared", "--json"])
        .output()
        .expect("JSON why should run");
    let second_json = command("why", fixture.root())
        .args(["--json", "shared"])
        .output()
        .expect("repeated JSON why should run");

    assert!(human.status.success());
    assert_eq!(
        String::from_utf8_lossy(&human.stdout),
        "why shared:\nalpha -> shared\nbeta -> shared\n"
    );
    assert!(first_json.status.success());
    assert_eq!(first_json.stdout, second_json.stdout);
    let events = json_events(&first_json.stdout);
    assert_eq!(
        event_types(&events),
        ["started", "progress", "progress", "result"]
    );
    assert_eq!(events[0]["command"], "why");
    assert_eq!(
        events[3]["result"]["paths"],
        serde_json::json!([["alpha", "shared"], ["beta", "shared"]])
    );
}

#[test]
fn invariant_schema_three_tree_and_why_use_persisted_roots_without_a_manifest() {
    let fixture = Fixture::new();
    let lock = Lockfile::new_catalog_graph(
        [
            catalog_package("runtime", ["shared"], 1),
            catalog_package("dev-tool", ["shared"], 2),
            catalog_package("shared", [], 3),
        ],
        CatalogGraphRoots::new([name("runtime")], [name("dev-tool")]),
    )
    .expect("catalog graph should build");
    fs::write(fixture.root().join("wukong.lock"), lock.to_toml()).expect("lock should write");
    fs::remove_file(fixture.root().join("wukong.toml")).expect("manifest should remove");

    let tree = command("tree", fixture.root())
        .arg("--json")
        .output()
        .expect("tree should run");
    let why = command("why", fixture.root())
        .arg("shared")
        .output()
        .expect("why should run");

    assert!(tree.status.success());
    assert_eq!(
        String::from_utf8_lossy(&why.stdout),
        "why shared:\nruntime -> shared\ndev-tool -> shared\n"
    );
    let events = json_events(&tree.stdout);
    assert_eq!(
        events[3]["result"]["roots"],
        serde_json::json!({"runtime":["runtime"],"development":["dev-tool"]})
    );
    let shared = events[3]["result"]["packages"]
        .as_array()
        .expect("packages should be an array")
        .iter()
        .find(|package| package["name"] == "shared")
        .expect("shared should be reported");
    assert_eq!(shared["runtime"], true);
    assert_eq!(shared["development"], false);
}

fn json_events(output: &[u8]) -> Vec<serde_json::Value> {
    std::str::from_utf8(output)
        .expect("JSON output should be UTF-8")
        .lines()
        .map(|line| serde_json::from_str(line).expect("JSON event should parse"))
        .collect()
}

fn event_types(events: &[serde_json::Value]) -> Vec<&str> {
    events
        .iter()
        .map(|event| event["type"].as_str().expect("event should have a type"))
        .collect()
}

#[test]
fn invariant_why_rejects_a_package_absent_from_the_lockfile() {
    let fixture = Fixture::new();

    let output = command("why", fixture.root())
        .arg("missing")
        .output()
        .expect("why should run");

    assert_eq!(output.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&output.stderr).contains("not in wukong.lock"));
}

#[test]
fn invariant_tree_marks_hand_edited_cycles_without_unbounded_traversal() {
    let fixture = Fixture::new();
    let lock = Lockfile::new([
        package("alpha", ["beta"], false, 1),
        package("beta", ["alpha"], false, 2),
    ])
    .expect("cyclic lock should build");
    fs::write(fixture.root().join("wukong.lock"), lock.to_toml()).expect("lock should write");

    let output = command("tree", fixture.root())
        .output()
        .expect("tree should run");

    assert!(output.status.success());
    assert!(String::from_utf8_lossy(&output.stdout).contains("[cycle]"));
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
        fs::create_dir(&root).expect("project should exist");
        fs::write(
            root.join("project.godot"),
            "[application]\nconfig/name=\"fixture\"\n",
        )
        .expect("project marker should write");
        fs::write(
            root.join("wukong.toml"),
            "[project]\nname=\"fixture\"\ngodot=\"4\"\n\n[dependencies]\nalpha = \"^1\"\nbeta = \"^1\"\n\n[dev-dependencies]\ndev-tool = { path = \"dev-tool\" }\n",
        )
        .expect("manifest should write");
        let lock = Lockfile::new([
            package("alpha", ["shared"], false, 1),
            package("beta", ["shared"], false, 2),
            package("shared", [], false, 3),
            package("dev-tool", [], true, 4),
        ])
        .expect("lock should build");
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

fn package(
    package_name: &str,
    dependencies: impl IntoIterator<Item = &'static str>,
    development: bool,
    index: usize,
) -> LockedPackage {
    let checksum = format!("{index:064x}");
    let source = LockedLocalSource::new(
        ImmutableSourceId::new(format!("sha256:{checksum}")).expect("source ID should parse"),
        checksum.clone(),
    )
    .expect("source should build");
    LockedPackage::new(
        name(package_name),
        Some(SemanticVersion::parse("1.0.0").expect("version should parse")),
        source,
        checksum,
        format!("{:064x}", index + 100),
        dependencies.into_iter().map(name).collect::<BTreeSet<_>>(),
        ".".into(),
        format!("addons/{package_name}").into(),
        GodotCompatibility::Unknown,
        development,
    )
    .expect("package should build")
}

fn catalog_package(
    package_name: &str,
    dependencies: impl IntoIterator<Item = &'static str>,
    index: usize,
) -> LockedPackage {
    let commit = "4ab90a80b815bc1ad4a8d7eea92c785e654bfd91";
    let source = LockedGitSource::new(
        ImmutableSourceId::new(format!("git:{commit}")).expect("identity should parse"),
        "https://example.test/catalog.git",
        commit.to_owned(),
    )
    .expect("source should build");
    LockedPackage::new(
        name(package_name),
        Some(SemanticVersion::parse("1.0.0").expect("version should parse")),
        source,
        format!("{:064x}", index + 100),
        format!("{:064x}", index + 200),
        dependencies.into_iter().map(name).collect(),
        format!("addons/{package_name}").into(),
        format!("addons/{package_name}").into(),
        GodotCompatibility::Requirement("4".parse().expect("Godot requirement should parse")),
        false,
    )
    .expect("package should build")
    .with_catalog_sha256(format!("{index:064x}"))
    .expect("catalog fingerprint should build")
}

fn name(value: &str) -> PackageName {
    PackageName::parse(value).expect("name should parse")
}
