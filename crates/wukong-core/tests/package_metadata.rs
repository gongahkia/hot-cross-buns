use std::path::Path;
use tempfile::TempDir;
use wukong_core::{
    diagnostic::{ErrorCode, RedactedSource},
    package_metadata::PackageMetadata,
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

fn parse(input: &str) -> PackageMetadata {
    PackageMetadata::parse(Path::new(PATH), input).expect("metadata should parse")
}
fn parse_error(input: &str) -> Box<wukong_core::diagnostic::Diagnostic> {
    PackageMetadata::parse(Path::new(PATH), input).expect_err("metadata should fail")
}
