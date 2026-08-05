use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};
use tempfile::TempDir;
use wukong_core::package_metadata::PackageMetadata;

#[test]
fn invariant_package_init_creates_immediately_valid_default_metadata() {
    let fixture = Fixture::new("example-addon");

    let output = command()
        .args(["package", "init"])
        .current_dir(fixture.root())
        .output()
        .expect("package init should run");

    assert!(output.status.success());
    assert!(String::from_utf8_lossy(&output.stdout).contains("created"));
    let metadata = PackageMetadata::load_required(fixture.root())
        .expect("generated package metadata should validate");
    assert_eq!(metadata.name().as_str(), "example-addon");
    assert_eq!(metadata.version().to_string(), "0.1.0");
}

#[test]
fn invariant_package_init_validates_and_writes_explicit_metadata_fields() {
    let fixture = Fixture::new("source");

    let output = command()
        .args([
            "package",
            "init",
            "--path",
            fixture.root().to_str().expect("path should be UTF-8"),
            "--name",
            "custom-addon",
            "--version",
            "1.2.3",
            "--godot",
            ">=4.3,<5",
            "--root",
            "addons/custom-addon",
            "--target",
            "addons/custom-addon",
        ])
        .output()
        .expect("package init should run");

    assert!(output.status.success());
    let metadata = PackageMetadata::load_required(fixture.root())
        .expect("generated package metadata should validate");
    assert_eq!(metadata.name().as_str(), "custom-addon");
    assert_eq!(metadata.version().to_string(), "1.2.3");
    assert_eq!(metadata.root(), Some(Path::new("addons/custom-addon")));
    assert_eq!(metadata.target(), Some(Path::new("addons/custom-addon")));
}

#[test]
fn invariant_package_init_refuses_invalid_fields_and_existing_metadata_without_overwrite() {
    let invalid = Fixture::new("invalid-addon");

    let invalid_output = command()
        .args(["package", "init", "--name", "Invalid"])
        .current_dir(invalid.root())
        .output()
        .expect("package init should run");

    assert_eq!(invalid_output.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&invalid_output.stderr).contains("package.name"));
    assert!(!invalid.root().join("wukong-package.toml").exists());

    let existing = Fixture::new("existing-addon");
    let metadata_path = existing.root().join("wukong-package.toml");
    fs::write(&metadata_path, "existing content\n").expect("metadata should write");

    let existing_output = command()
        .args(["package", "init"])
        .current_dir(existing.root())
        .output()
        .expect("package init should run");

    assert_eq!(existing_output.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&existing_output.stderr).contains("already exists"));
    assert_eq!(
        fs::read_to_string(metadata_path).expect("metadata should remain readable"),
        "existing content\n"
    );
}

fn command() -> Command {
    Command::new(env!("CARGO_BIN_EXE_wukong"))
}

struct Fixture {
    _directory: TempDir,
    root: PathBuf,
}

impl Fixture {
    fn new(name: &str) -> Self {
        let directory = TempDir::new().expect("fixture directory should exist");
        let root = directory.path().join(name);
        fs::create_dir(&root).expect("package root should create");
        Self {
            _directory: directory,
            root,
        }
    }

    fn root(&self) -> &Path {
        &self.root
    }
}
