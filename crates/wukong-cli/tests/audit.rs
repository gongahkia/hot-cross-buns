use std::{collections::BTreeSet, fs, path::Path, process::Command};
use tempfile::TempDir;
use wukong_core::{
    identity::PackageName,
    lockfile::{
        GodotCompatibility, LockedGitSource, LockedHttpSource, LockedLocalSource, LockedPackage,
        LockedSource, Lockfile,
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
    let archive_package_checksum = format!("{:064x}", 3);
    let git_package_checksum = format!("{:064x}", 2);
    let local_package_checksum = format!("{:064x}", 1);
    assert_eq!(
        json,
        format!(
            "{{\"schema\":1,\"signature_verification\":\"not_implemented\",\"packages\":[{{\"name\":\"archive-addon\",\"source_kind\":\"http\",\"canonical_source\":\"https://example.test/addon.zip\",\"immutable_id\":\"sha256:{ARCHIVE_CHECKSUM}\",\"immutable_revision\":null,\"source_checksum\":\"{ARCHIVE_CHECKSUM}\",\"package_checksum\":\"{archive_package_checksum}\"}},{{\"name\":\"git-addon\",\"source_kind\":\"git\",\"canonical_source\":\"https://example.test/Org/addon.git\",\"immutable_id\":\"git:{COMMIT}\",\"immutable_revision\":\"{COMMIT}\",\"source_checksum\":null,\"package_checksum\":\"{git_package_checksum}\"}},{{\"name\":\"local-addon\",\"source_kind\":\"local\",\"canonical_source\":\"local:sha256:{LOCAL_CHECKSUM}\",\"immutable_id\":\"sha256:{LOCAL_CHECKSUM}\",\"immutable_revision\":null,\"source_checksum\":\"{LOCAL_CHECKSUM}\",\"package_checksum\":\"{local_package_checksum}\"}}]}}\n"
        )
    );
}

#[test]
fn invariant_audit_requires_a_lockfile() {
    let fixture = Fixture::without_lock();

    let output = command(fixture.root()).output().expect("audit should run");

    assert_eq!(output.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&output.stderr).contains("wukong.lock is required"));
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
