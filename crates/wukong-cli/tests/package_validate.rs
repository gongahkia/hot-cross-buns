use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};
use tempfile::TempDir;

#[test]
fn invariant_package_validate_is_read_only_for_valid_metadata() {
    let fixture = Fixture::new();
    fixture.metadata(
        "[package]\nschema = 1\nname = \"example-addon\"\nversion = \"1.2.3\"\ngodot = \"4\"\n",
    );
    let before = fs::read(fixture.metadata_path()).expect("metadata should read");

    let output = command()
        .args(["package", "validate"])
        .current_dir(fixture.root())
        .output()
        .expect("package validate should run");

    assert!(output.status.success());
    assert!(String::from_utf8_lossy(&output.stdout).contains("validated"));
    assert_eq!(
        fs::read(fixture.metadata_path()).expect("metadata should remain readable"),
        before
    );
    assert!(!fixture.root().join("wukong.toml").exists());
    assert!(!fixture.root().join("wukong.lock").exists());
}

#[test]
fn invariant_package_validate_emits_a_versioned_json_diagnostic_for_invalid_semver() {
    let fixture = Fixture::new();
    fixture.metadata(
        "[package]\nschema = 1\nname = \"example-addon\"\nversion = \"1.2\"\ngodot = \"4\"\n",
    );

    let output = command()
        .args(["package", "validate", "--json"])
        .current_dir(fixture.root())
        .output()
        .expect("package validate should run");

    assert_eq!(output.status.code(), Some(2));
    let diagnostic: serde_json::Value =
        serde_json::from_slice(&output.stderr).expect("diagnostic should be JSON");
    assert_eq!(diagnostic["protocol"], 1);
    assert_eq!(diagnostic["type"], "diagnostic");
    assert_eq!(diagnostic["code"], "WUK001");
    assert_eq!(diagnostic["modified"], "none");
    assert_eq!(diagnostic["rollback"], "not required");
    assert!(
        diagnostic["message"]
            .as_str()
            .is_some_and(|message| message.contains("package.version"))
    );
}

#[test]
fn invariant_package_validate_rejects_unsafe_layout_paths_without_mutation() {
    let fixture = Fixture::new();
    fixture.metadata(
        "[package]\nschema = 1\nname = \"example-addon\"\nversion = \"1.2.3\"\ngodot = \"4\"\nroot = \"../escape\"\n",
    );
    let before = fs::read(fixture.metadata_path()).expect("metadata should read");

    let output = command()
        .args(["package", "validate", "--path"])
        .arg(fixture.root())
        .output()
        .expect("package validate should run");

    assert_eq!(output.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&output.stderr).contains("package.root"));
    assert_eq!(
        fs::read(fixture.metadata_path()).expect("metadata should remain readable"),
        before
    );
}

#[test]
fn invariant_package_validate_reports_a_stable_json_success_result() {
    let fixture = Fixture::new();
    fixture.metadata(
        "[package]\nschema = 1\nname = \"example-addon\"\nversion = \"1.2.3\"\ngodot = \">=4.3,<5\"\n",
    );

    let output = command()
        .args(["package", "validate", "--json"])
        .current_dir(fixture.root())
        .output()
        .expect("package validate should run");

    assert!(output.status.success());
    let result: serde_json::Value =
        serde_json::from_slice(&output.stdout).expect("result should be JSON");
    assert_eq!(result["protocol"], 1);
    assert_eq!(result["type"], "result");
    assert_eq!(result["result"]["name"], "example-addon");
    assert_eq!(result["result"]["version"], "1.2.3");
    assert_eq!(result["result"]["godot"], ">=4.3, <5");
}

fn command() -> Command {
    Command::new(env!("CARGO_BIN_EXE_wukong"))
}

struct Fixture {
    _directory: TempDir,
    root: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let directory = TempDir::new().expect("fixture directory should exist");
        let root = directory.path().join("example-addon");
        fs::create_dir(&root).expect("package root should create");
        Self {
            _directory: directory,
            root,
        }
    }

    fn root(&self) -> &Path {
        &self.root
    }

    fn metadata_path(&self) -> PathBuf {
        self.root.join("wukong-package.toml")
    }

    fn metadata(&self, content: &str) {
        fs::write(self.metadata_path(), content).expect("metadata should write");
    }
}
