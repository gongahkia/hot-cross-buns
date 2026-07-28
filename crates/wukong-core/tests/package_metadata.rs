use std::path::Path;
use tempfile::TempDir;
use wukong_core::{diagnostic::ErrorCode, package_metadata::PackageMetadata};

const PATH: &str = "fixture/wukong-package.toml";

#[test]
fn invariant_valid_optional_metadata_parses_all_declared_fields() {
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
fn invariant_absent_metadata_does_not_block_direct_package_installation() {
    let fixture = TempDir::new().expect("fixture directory should exist");

    let metadata = PackageMetadata::load_optional(fixture.path())
        .expect("an absent optional metadata file should not fail");

    assert!(metadata.is_none());
}

fn parse(input: &str) -> PackageMetadata {
    PackageMetadata::parse(Path::new(PATH), input).expect("metadata should parse")
}
fn parse_error(input: &str) -> Box<wukong_core::diagnostic::Diagnostic> {
    PackageMetadata::parse(Path::new(PATH), input).expect_err("metadata should fail")
}
