use std::path::Path;
use wukong_core::{
    manifest::{Dependency, Manifest},
    package_metadata::PackageMetadata,
    semantic_version::{SemanticVersion, VersionRequirement},
};

const MANIFEST_PATH: &str = "fixture/wukong.toml";
const METADATA_PATH: &str = "fixture/wukong-package.toml";

#[test]
fn invariant_requirements_cover_exact_ranges_caret_and_tilde() {
    let cases = [
        ("=1.2.3", "1.2.3", "1.2.4", "exact"),
        (">=1.2.0,<2.0.0", "1.5.0", "2.0.0", "range"),
        ("^1.2.3", "1.9.0", "2.0.0", "caret"),
        ("~1.2.3", "1.2.9", "1.3.0", "tilde"),
        ("1.2.3", "1.9.0", "2.0.0", "unprefixed caret"),
    ];
    for (requirement, accepted, rejected, label) in cases {
        let requirement = VersionRequirement::parse(requirement).expect("requirement should parse");
        assert!(
            requirement
                .matches(&SemanticVersion::parse(accepted).expect("accepted version should parse")),
            "{label} requirement should accept {accepted}"
        );
        assert!(
            !requirement
                .matches(&SemanticVersion::parse(rejected).expect("rejected version should parse")),
            "{label} requirement should reject {rejected}"
        );
    }
}

#[test]
fn invariant_prereleases_require_an_explicit_prerelease_requirement() {
    let stable = VersionRequirement::parse("^1.2.3").expect("stable requirement should parse");
    let prerelease = SemanticVersion::parse("1.3.0-alpha.1").expect("pre-release should parse");
    assert!(!stable.matches(&prerelease));

    let explicit = VersionRequirement::parse("=1.2.3-alpha.1")
        .expect("explicit pre-release requirement should parse");
    assert!(
        explicit.matches(&SemanticVersion::parse("1.2.3-alpha.1").expect("version should parse"))
    );
    assert!(
        !explicit.matches(&SemanticVersion::parse("1.2.3-alpha.2").expect("version should parse"))
    );
}

#[test]
fn invariant_manifest_and_metadata_reject_invalid_or_missing_versions() {
    assert!(VersionRequirement::parse("not-a-version").is_err());
    assert!(VersionRequirement::parse(">=1.0.0 || <2.0.0").is_err());
    assert!(SemanticVersion::parse("1.2").is_err());

    let manifest = Manifest::parse(
        Path::new(MANIFEST_PATH),
        "[project]\nname = \"example\"\ngodot = \"4\"\n[dependencies]\naddon = \"\"\n",
    )
    .expect_err("empty version requirement should fail");
    assert!(manifest.message().contains("dependencies.addon"));

    let metadata = PackageMetadata::parse(
        Path::new(METADATA_PATH),
        "[package]\nschema = 1\nname = \"example\"\ngodot = \"4\"\n",
    )
    .expect_err("missing package version should fail");
    assert!(metadata.message().contains("package.version is required"));
}

#[test]
fn invariant_source_pinned_dependencies_do_not_declare_version_catalogues() {
    let manifest = Manifest::parse(
        Path::new(MANIFEST_PATH),
        r#"
[project]
name = "example"
godot = "4"

[dependencies]
local = { path = "../local" }
git = { git = "https://example.test/addon.git", rev = "0123456789abcdef0123456789abcdef01234567" }
archive = { url = "https://example.test/addon.zip", sha256 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" }
"#,
    )
    .expect("source-pinned dependencies should parse");

    assert!(matches!(
        manifest.dependencies().get("local"),
        Some(Dependency::Path { .. })
    ));
    assert!(matches!(
        manifest.dependencies().get("git"),
        Some(Dependency::Git { .. })
    ));
    assert!(matches!(
        manifest.dependencies().get("archive"),
        Some(Dependency::Url { .. })
    ));
}

#[test]
fn invariant_stable_requirement_overlap_is_exact_for_godot_compatibility() {
    let project = VersionRequirement::parse(">=4.4,<5").expect("project requirement should parse");
    let compatible = VersionRequirement::parse("^4.5").expect("package requirement should parse");
    let incompatible = VersionRequirement::parse("<4").expect("package requirement should parse");
    let prerelease =
        VersionRequirement::parse(">=4.5.0-beta").expect("package requirement should parse");

    assert_eq!(project.stable_overlap(&compatible), Some(true));
    assert_eq!(project.stable_overlap(&incompatible), Some(false));
    assert_eq!(project.stable_overlap(&prerelease), None);
}
