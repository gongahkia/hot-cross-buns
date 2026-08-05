use std::path::{Path, PathBuf};
use wukong_core::{
    diagnostic::ErrorCode,
    manifest::{Dependency, DependencyLayout, GitReference, Manifest},
};

const MANIFEST_PATH: &str = "fixture/wukong.toml";
const SHA256_EMPTY_FILE: &str = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

#[test]
fn invariant_valid_minimal_manifest_produces_typed_project_metadata() {
    let manifest = parse(
        r#"
[project]
name = "my-game"
godot = ">=4.5,<5"
"#,
    );

    assert_eq!(manifest.project().name(), "my-game");
    assert_eq!(manifest.project().godot().to_string(), ">=4.5, <5");
    assert!(manifest.dependencies().is_empty());
    assert!(manifest.dev_dependencies().is_empty());
}

#[test]
fn invariant_representative_direct_source_manifest_parses_successfully() {
    let manifest = parse(&format!(
        r#"
[project]
name = "my-game"
godot = "4"

[dependencies]
dialogic = "^2.0"
terrain3d = {{ git = "https://example.test/terrain3d.git", tag = "v1.0.0" }}
custom-ui = {{ url = "https://example.test/custom-ui.zip", sha256 = "{SHA256_EMPTY_FILE}" }}

[dev-dependencies]
shared-tools = {{ path = "shared-tools" }}
test-tools = {{ path = "test-tools" }}
"#,
    ));

    assert_eq!(manifest.project().name(), "my-game");
    assert_eq!(manifest.dependencies().len(), 3);
    assert_eq!(manifest.dev_dependencies().len(), 2);
    assert!(matches!(
        manifest.dependencies().get("dialogic"),
        Some(Dependency::Version(_))
    ));
    assert!(matches!(
        manifest.dependencies().get("terrain3d"),
        Some(Dependency::Git {
            reference: Some(GitReference::Tag(tag)),
            ..
        }) if tag == "v1.0.0"
    ));
    assert!(matches!(
        manifest.dependencies().get("custom-ui"),
        Some(Dependency::Url { sha256, .. }) if sha256 == SHA256_EMPTY_FILE
    ));
    assert!(matches!(
        manifest.dev_dependencies().get("shared-tools"),
        Some(Dependency::Path { path, layout })
            if path == &PathBuf::from("fixture").join("shared-tools")
                && layout == &DependencyLayout::default()
    ));
}

#[test]
fn invariant_dependencies_are_stored_in_deterministic_alias_order() {
    let manifest = parse(
        r#"
[project]
name = "my-game"
godot = "4"

[dependencies]
zebra = "1"
alpha = "1"
middle = "1"
"#,
    );
    let aliases = manifest
        .dependencies()
        .keys()
        .map(wukong_core::manifest::DependencyAlias::as_str)
        .collect::<Vec<_>>();

    assert_eq!(aliases, ["alpha", "middle", "zebra"]);
}

#[test]
fn invariant_relative_paths_are_resolved_and_lexically_normalised() {
    let input = r#"
[project]
name = "my-game"
godot = "4"

[dev-dependencies]
example = { path = "./addons/../addons/example" }
"#;
    let manifest = Manifest::parse(Path::new("fixtures/project/wukong.toml"), input)
        .expect("manifest should parse");

    assert!(matches!(
        manifest.dev_dependencies().get("example"),
        Some(Dependency::Path { path, .. })
            if path == &PathBuf::from("fixtures").join("project/addons/example")
    ));
}

#[test]
fn invariant_direct_source_layout_overrides_are_safe_and_typed() {
    let manifest = parse(
        r#"
[project]
name = "my-game"
godot = "4"

[dev-dependencies]
alpha = { path = "../multi-addon", root = "3d/alpha", target = "addons/alpha" }
"#,
    );

    let Some(Dependency::Path { layout, .. }) = manifest.dev_dependencies().get("alpha") else {
        panic!("path dependency should retain layout overrides");
    };
    assert_eq!(layout.root(), Some(Path::new("3d/alpha")));
    assert_eq!(layout.target(), Some(Path::new("addons/alpha")));

    let error = parse_error(
        r#"
[project]
name = "my-game"
godot = "4"

[dev-dependencies]
alpha = { path = "../multi-addon", root = "C:\\escape" }
"#,
    );
    assert!(error.message().contains("dependencies.alpha.root"));
}

#[test]
fn invariant_archive_sources_require_a_valid_checksum() {
    let error = parse_error(
        r#"
[project]
name = "my-game"
godot = "4"

[dependencies]
example = { url = "https://example.test/addon.zip", sha256 = "invalid" }
"#,
    );

    assert_eq!(error.code(), ErrorCode::UserInput);
    assert!(error.message().contains("dependencies.example.sha256"));
    assert!(error.message().contains("64-character hexadecimal SHA-256"));
}

#[test]
fn invariant_duplicate_toml_keys_return_a_recoverable_user_error() {
    let error = parse_error(
        r#"
[project]
name = "my-game"
name = "other-game"
godot = "4"
"#,
    );

    assert_eq!(error.code(), ErrorCode::UserInput);
    assert!(error.message().contains("invalid wukong.toml syntax"));
    assert_eq!(error.recovery(), Some("fix the TOML syntax and retry"));
}

#[test]
fn invariant_invalid_version_constraints_identify_the_invalid_field() {
    let error = parse_error(
        r#"
[project]
name = "my-game"
godot = "not-a-version"
"#,
    );

    assert_eq!(error.code(), ErrorCode::UserInput);
    assert!(
        error.message().contains("project.godot at line 4"),
        "{}",
        error.message()
    );
    assert!(error.message().contains("invalid version requirement"));
}

#[test]
fn invariant_multiple_source_types_are_rejected_before_resolution() {
    let error = parse_error(
        r#"
[project]
name = "my-game"
godot = "4"

[dependencies]
example = { path = "../example", git = "https://example.test/repository" }
"#,
    );

    assert_eq!(error.code(), ErrorCode::UserInput);
    assert!(error.message().contains("dependencies.example"));
    assert!(error.message().contains("exactly one supported source"));
}

#[test]
fn invariant_missing_project_metadata_is_rejected() {
    let error = parse_error(
        r#"
[dependencies]
example = "1"
"#,
    );

    assert_eq!(error.code(), ErrorCode::UserInput);
    assert!(error.message().contains("root.project is required"));
}

#[test]
fn invariant_invalid_relative_paths_are_rejected() {
    let error = parse_error(
        r#"
[project]
name = "my-game"
godot = "4"

[dev-dependencies]
example = { path = "\u0000" }
"#,
    );

    assert_eq!(error.code(), ErrorCode::UserInput);
    assert!(error.message().contains("dependencies.example.path"));
    assert!(error.message().contains("null character"));
}

#[test]
fn invariant_unicode_package_aliases_are_rejected() {
    let error = parse_error(
        r#"
[project]
name = "my-game"
godot = "4"

[dependencies]
"café" = "1"
"#,
    );

    assert_eq!(error.code(), ErrorCode::UserInput);
    assert!(error.message().contains("café"));
    assert!(error.message().contains("lowercase ASCII"));
}

#[test]
fn invariant_credentials_are_rejected_without_appearing_in_diagnostics() {
    for source in [
        r#"{ git = "https://secret-token@example.test/repository" }"#,
        r#"{ url = "https://example.test/addon.zip?access%5Ftoken=secret-token", sha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" }"#,
        r#"{ url = "https://example.test/addon.zip?signature=secret-token", sha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" }"#,
    ] {
        let error = parse_error(&format!(
            r#"
[project]
name = "my-game"
godot = "4"

[dependencies]
example = {source}
"#,
        ));

        assert_eq!(error.code(), ErrorCode::UserInput);
        assert!(error.message().contains("must not contain credentials"));
        assert!(!error.message().contains("secret-token"));
        assert!(
            error
                .source_description()
                .is_none_or(|source| !source.as_str().contains("secret-token"))
        );
    }
}

#[test]
fn invariant_git_ssh_users_and_safe_selectors_parse_but_invalid_revisions_fail() {
    let manifest = parse(
        r#"
[project]
name = "my-game"
godot = "4"

[dependencies]
example = { git = "ssh://git@work-alias/team/addon.git", branch = "release/1.2" }
"#,
    );
    let error = parse_error(
        r#"
[project]
name = "my-game"
godot = "4"

[dependencies]
example = { git = "https://example.test/addon.git", rev = "deadbeef" }
"#,
    );

    assert!(matches!(
        manifest.dependencies().get("example"),
        Some(Dependency::Git { reference: Some(GitReference::Branch(branch)), .. }) if branch == "release/1.2"
    ));
    assert_eq!(error.code(), ErrorCode::UserInput);
    assert!(error.message().contains("dependencies.example.rev"));
}

#[cfg(feature = "asset-library")]
#[test]
fn invariant_feature_gated_asset_source_requires_a_positive_stable_id() {
    let manifest = parse(
        r#"
[project]
name = "my-game"
godot = "4"

[dependencies]
example = { asset = "42" }
"#,
    );
    let error = parse_error(
        r#"
[project]
name = "my-game"
godot = "4"

[dependencies]
example = { asset = "0" }
"#,
    );

    assert!(
        matches!(manifest.dependencies().get("example"), Some(Dependency::Asset { id, .. }) if id.as_str() == "42")
    );
    assert!(
        error
            .message()
            .contains("positive decimal AssetLib asset ID")
    );
}

fn parse(input: &str) -> Manifest {
    Manifest::parse(Path::new(MANIFEST_PATH), input).expect("manifest should parse")
}

fn parse_error(input: &str) -> Box<wukong_core::diagnostic::Diagnostic> {
    Manifest::parse(Path::new(MANIFEST_PATH), input).expect_err("manifest should fail")
}
