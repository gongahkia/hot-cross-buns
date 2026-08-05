use std::{fs, path::Path};
use tempfile::TempDir;
use wukong_core::{
    diagnostic::{ErrorCode, RedactedSource},
    package_metadata::{PackageMetadata, PackageMetadataInitializationOptions},
};

const PATH: &str = "fixture/wukong-package.toml";

#[test]
fn invariant_valid_required_metadata_parses_all_declared_fields() {
    let metadata = parse(
        r#"
[package]
schema = 1
name = "example-addon"
version = "1.2.3"
godot = ">=4.4,<5"
root = "addons/example"
target = "addons/example"

[dependencies]
other-addon = "^2"
"#,
    );

    assert_eq!(metadata.name().as_str(), "example-addon");
    assert_eq!(metadata.version().to_string(), "1.2.3");
    assert_eq!(metadata.root(), Some(Path::new("addons/example")));
    assert!(metadata.dependencies().contains_key("other-addon"));
}

#[test]
fn invariant_unknown_schema_and_unsafe_layout_paths_are_rejected() {
    let schema = parse_error(
        "[package]\nschema = 2\nname = \"example\"\nversion = \"1.0.0\"\ngodot = \"4\"\n",
    );
    let path = parse_error(
        "[package]\nschema = 1\nname = \"example\"\nversion = \"1.0.0\"\ngodot = \"4\"\nroot = \"../escape\"\n",
    );

    assert_eq!(schema.code(), ErrorCode::UserInput);
    assert!(schema.message().contains("schema"));
    assert_eq!(path.code(), ErrorCode::UserInput);
    assert!(path.message().contains("package.root"));
}

#[test]
fn invariant_metadata_rejects_scripts_and_source_specific_dependency_fields() {
    let script = parse_error(
        "[package]\nschema = 1\nname = \"example\"\nversion = \"1.0.0\"\ngodot = \"4\"\nscript = \"install.sh\"\n",
    );
    let source = parse_error(
        "[package]\nschema = 1\nname = \"example\"\nversion = \"1.0.0\"\ngodot = \"4\"\n\n[dependencies]\nhelper = { path = \"../helper\" }\n",
    );

    assert_eq!(script.code(), ErrorCode::UserInput);
    assert!(script.message().contains("package.script is not supported"));
    assert_eq!(source.code(), ErrorCode::UserInput);
    assert!(
        source
            .message()
            .contains("dependency requirement must be a string")
    );
}

#[test]
fn invariant_absent_required_metadata_fails_with_context() {
    let fixture = TempDir::new().expect("fixture directory should exist");

    let error = PackageMetadata::load_required(fixture.path())
        .expect_err("absent required metadata must fail");

    assert_eq!(error.code(), ErrorCode::UserInput);
    assert!(error.message().contains("wukong-package.toml is required"));
    assert_eq!(
        error.source_description().map(RedactedSource::as_str),
        Some(
            fixture
                .path()
                .join("wukong-package.toml")
                .to_string_lossy()
                .as_ref()
        )
    );
}

#[test]
fn invariant_package_metadata_initialization_generates_immediately_valid_defaults() {
    let fixture = TempDir::new().expect("fixture directory should exist");
    let root = fixture.path().join("example-addon");
    fs::create_dir(&root).expect("package root should create");

    let initialized =
        PackageMetadata::initialize(&root, &PackageMetadataInitializationOptions::default())
            .expect("metadata initialization should succeed");
    let metadata = PackageMetadata::load_required(&root).expect("generated metadata should parse");

    assert_eq!(
        initialized.path(),
        fs::canonicalize(&root)
            .expect("package root should canonicalize")
            .join("wukong-package.toml")
    );
    assert_eq!(initialized.metadata(), &metadata);
    assert_eq!(metadata.name().as_str(), "example-addon");
    assert_eq!(metadata.version().to_string(), "0.1.0");
    assert_eq!(metadata.root(), None);
    assert_eq!(metadata.target(), None);
}

#[test]
fn invariant_package_metadata_initialization_validates_explicit_fields() {
    let fixture = TempDir::new().expect("fixture directory should exist");
    let root = fixture.path().join("example-addon");
    fs::create_dir(&root).expect("package root should create");
    let options = PackageMetadataInitializationOptions::default()
        .with_name("custom-addon".to_owned())
        .with_version("1.2.3".to_owned())
        .with_godot(">=4.3,<5".to_owned())
        .with_root("addons/custom-addon".to_owned())
        .with_target("addons/custom-addon".to_owned());

    PackageMetadata::initialize(&root, &options).expect("explicit metadata should initialize");
    let metadata = PackageMetadata::load_required(&root).expect("metadata should parse");

    assert_eq!(metadata.name().as_str(), "custom-addon");
    assert_eq!(metadata.version().to_string(), "1.2.3");
    assert_eq!(metadata.root(), Some(Path::new("addons/custom-addon")));
    assert_eq!(metadata.target(), Some(Path::new("addons/custom-addon")));
}

#[test]
fn invariant_package_metadata_initialization_rejects_invalid_fields_and_existing_files() {
    let fixture = TempDir::new().expect("fixture directory should exist");
    let invalid_root = fixture.path().join("invalid-root");
    fs::create_dir(&invalid_root).expect("package root should create");
    for (options, field) in [
        (
            PackageMetadataInitializationOptions::default().with_name("Invalid".to_owned()),
            "package.name",
        ),
        (
            PackageMetadataInitializationOptions::default().with_version("1.0".to_owned()),
            "package.version",
        ),
        (
            PackageMetadataInitializationOptions::default().with_godot("Godot 4".to_owned()),
            "package.godot",
        ),
        (
            PackageMetadataInitializationOptions::default().with_root("../escape".to_owned()),
            "package.root",
        ),
        (
            PackageMetadataInitializationOptions::default().with_target("../escape".to_owned()),
            "package.target",
        ),
    ] {
        let invalid_error = PackageMetadata::initialize(&invalid_root, &options)
            .expect_err("invalid explicit metadata must fail");

        assert_eq!(invalid_error.code(), ErrorCode::UserInput);
        assert!(invalid_error.message().contains(field));
    }
    assert!(!invalid_root.join("wukong-package.toml").exists());

    let existing_root = fixture.path().join("existing-addon");
    fs::create_dir(&existing_root).expect("package root should create");
    let metadata_path = existing_root.join("wukong-package.toml");
    fs::write(&metadata_path, "existing content\n").expect("metadata should write");

    let existing_error = PackageMetadata::initialize(
        &existing_root,
        &PackageMetadataInitializationOptions::default(),
    )
    .expect_err("existing metadata must not be overwritten");

    assert_eq!(existing_error.code(), ErrorCode::UserInput);
    assert!(existing_error.message().contains("already exists"));
    assert_eq!(
        fs::read_to_string(metadata_path).expect("metadata should remain readable"),
        "existing content\n"
    );
}

fn parse(input: &str) -> PackageMetadata {
    PackageMetadata::parse(Path::new(PATH), input).expect("metadata should parse")
}
fn parse_error(input: &str) -> Box<wukong_core::diagnostic::Diagnostic> {
    PackageMetadata::parse(Path::new(PATH), input).expect_err("metadata should fail")
}
