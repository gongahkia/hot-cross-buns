use std::{collections::BTreeSet, fs, path::Path, process::Command};
use tempfile::TempDir;
use wukong_core::{
    identity::PackageName,
    lockfile::{
        CatalogGraphRoots, GodotCompatibility, LockedGitSource, LockedHttpSource,
        LockedLocalSource, LockedPackage, LockedSource, Lockfile,
    },
    source::ImmutableSourceId,
};

const COMMIT: &str = "4ab90a80b815bc1ad4a8d7eea92c785e654bfd91";
const LOCAL_CHECKSUM: &str = "11c61f3a6ace3a2b9d1729f6d52af90e6c9b6671e1db798cd91dec1ad666e91b";
const ARCHIVE_CHECKSUM: &str = "77c61f3a6ace3a2b9d1729f6d52af90e6c9b6671e1db798cd91dec1ad666e91b";

#[test]
fn invariant_audit_displays_deterministic_immutable_provenance() {
    let fixture = Fixture::new();

    let human = command(fixture.root()).output().expect("audit should run");
    let first_json = command(fixture.root())
        .arg("--json")
        .output()
        .expect("JSON audit should run");
    let second_json = command(fixture.root())
        .arg("--json")
        .output()
        .expect("repeated JSON audit should run");

    assert!(human.status.success());
    let output = String::from_utf8(human.stdout).expect("audit output should be UTF-8");
    for expected in [
        "audit format: 1",
        "signature verification: not implemented",
        "archive-addon",
        "source kind: http",
        "canonical source: https://example.test/addon.zip",
        "git-addon",
        "source kind: git",
        "canonical source: https://example.test/Org/addon.git",
        &format!("immutable revision: {COMMIT}"),
        "local-addon",
        &format!("canonical source: local:sha256:{LOCAL_CHECKSUM}"),
        &format!("source checksum: {ARCHIVE_CHECKSUM}"),
    ] {
        assert!(
            output.contains(expected),
            "missing {expected:?} in {output:?}"
        );
    }
    assert!(first_json.status.success());
    assert_eq!(first_json.stdout, second_json.stdout);
    let json = String::from_utf8(first_json.stdout).expect("JSON audit output should be UTF-8");
    let events = json_events(&json);
    assert_eq!(
        event_types(&events),
        ["started", "progress", "progress", "result"]
    );
    assert_eq!(events[0]["command"], "audit");
    assert_eq!(events[3]["result"]["packages"][0]["name"], "archive-addon");
    assert_eq!(events[3]["result"]["packages"][1]["name"], "git-addon");
    assert_eq!(events[3]["result"]["packages"][2]["name"], "local-addon");
}

#[test]
fn invariant_audit_requires_a_lockfile() {
    let fixture = Fixture::without_lock();

    let output = command(fixture.root())
        .arg("--json")
        .output()
        .expect("audit should run");

    assert_eq!(output.status.code(), Some(2));
    let events = json_events(std::str::from_utf8(&output.stdout).expect("stdout should be UTF-8"));
    assert_eq!(event_types(&events), ["started", "progress"]);
    let diagnostic: serde_json::Value =
        serde_json::from_slice(&output.stderr).expect("JSON diagnostics should be parseable");
    assert_eq!(diagnostic["protocol"], 1);
    assert_eq!(diagnostic["type"], "diagnostic");
    assert_eq!(diagnostic["code"], "WUK001");
    assert!(
        diagnostic["message"]
            .as_str()
            .expect("message should be a string")
            .contains("wukong.lock is required")
    );
}

#[test]
fn invariant_schema_three_audit_uses_persisted_graph_groups() {
    let fixture = Fixture::without_lock();
    let lock = Lockfile::new_catalog_graph(
        [
            catalog_package("runtime", ["shared"], 1),
            catalog_package("dev-tool", ["shared"], 2),
            catalog_package("shared", [], 3),
        ],
        CatalogGraphRoots::new([name("runtime")], [name("dev-tool")]),
    )
    .expect("catalog lock should build");
    fs::write(fixture.root().join("wukong.lock"), lock.to_toml()).expect("lock should write");

    let output = command(fixture.root())
        .arg("--json")
        .output()
        .expect("audit should run");

    assert!(output.status.success());
    let events = json_events(std::str::from_utf8(&output.stdout).expect("output should be UTF-8"));
    let packages = events[3]["result"]["packages"]
        .as_array()
        .expect("packages should be an array");
    let shared = packages
        .iter()
        .find(|package| package["name"] == "shared")
        .expect("shared should be reported");
    let development = packages
        .iter()
        .find(|package| package["name"] == "dev-tool")
        .expect("development root should be reported");
    assert_eq!(shared["runtime"], true);
    assert_eq!(shared["development"], false);
    assert_eq!(development["direct_development"], true);
    assert_eq!(development["development"], true);
}

fn json_events(output: &str) -> Vec<serde_json::Value> {
    output
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

fn command(current_directory: &Path) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_wukong"));
    command.arg("audit").current_dir(current_directory);
    command
}

struct Fixture {
    _directory: TempDir,
    root: std::path::PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let fixture = Self::without_lock();
        let lock = Lockfile::new([
            package(
                "local-addon",
                LockedLocalSource::new(
                    ImmutableSourceId::new(format!("sha256:{LOCAL_CHECKSUM}"))
                        .expect("local identity should parse"),
                    LOCAL_CHECKSUM.to_owned(),
                )
                .expect("local source should lock")
                .into(),
                1,
            ),
            package(
                "git-addon",
                LockedGitSource::new(
                    ImmutableSourceId::new(format!("git:{COMMIT}"))
                        .expect("Git identity should parse"),
                    "HTTPS://EXAMPLE.test:443/Org/addon.git",
                    COMMIT.to_owned(),
                )
                .expect("Git source should lock")
                .into(),
                2,
            ),
            package(
                "archive-addon",
                LockedHttpSource::new(
                    ImmutableSourceId::new(format!("sha256:{ARCHIVE_CHECKSUM}"))
                        .expect("archive identity should parse"),
                    "https://example.test/addon.zip",
                    ARCHIVE_CHECKSUM.to_owned(),
                )
                .expect("archive source should lock")
                .into(),
                3,
            ),
        ])
        .expect("lock should create");
        fs::write(fixture.root.join("wukong.lock"), lock.to_toml()).expect("lock should write");
        fixture
    }

    fn without_lock() -> Self {
        let directory = TempDir::new().expect("fixture directory should exist");
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
}

fn package(name: &str, source: LockedSource, index: usize) -> LockedPackage {
    LockedPackage::new(
        PackageName::parse(name).expect("package name should parse"),
        None,
        source,
        format!("{index:064x}"),
        format!("{:064x}", index + 10),
        BTreeSet::new(),
        ".".into(),
        format!("addons/{name}").into(),
        GodotCompatibility::Unknown,
        false,
    )
    .expect("package should lock")
}

fn catalog_package(
    package_name: &str,
    dependencies: impl IntoIterator<Item = &'static str>,
    index: usize,
) -> LockedPackage {
    let source = LockedGitSource::new(
        ImmutableSourceId::new(format!("git:{COMMIT}")).expect("Git identity should parse"),
        "https://example.test/catalog.git",
        COMMIT.to_owned(),
    )
    .expect("Git source should lock");
    LockedPackage::new(
        name(package_name),
        Some("1.0.0".parse().expect("version should parse")),
        source,
        format!("{:064x}", index + 100),
        format!("{:064x}", index + 200),
        dependencies.into_iter().map(name).collect(),
        format!("addons/{package_name}").into(),
        format!("addons/{package_name}").into(),
        GodotCompatibility::Requirement("4".parse().expect("Godot requirement should parse")),
        false,
    )
    .expect("package should lock")
    .with_catalog_sha256(format!("{index:064x}"))
    .expect("catalog fingerprint should lock")
}

fn name(value: &str) -> PackageName {
    PackageName::parse(value).expect("package name should parse")
}
