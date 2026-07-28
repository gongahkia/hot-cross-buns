use std::collections::BTreeSet;
use wukong_core::{
    godot_compatibility::{
        resolve_project_godot_compatibility, validate_locked_package_godot_compatibility,
    },
    identity::PackageName,
    lockfile::{GodotCompatibility, LockedLocalSource, LockedPackage, Lockfile},
    manifest::Manifest,
    semantic_version::VersionRequirement,
    source::ImmutableSourceId,
};

#[test]
fn invariant_incompatible_package_godot_requirement_fails_before_installation() {
    let project = project(">=4.4,<5", None);
    let lock = lock(GodotCompatibility::Requirement(requirement("<4")));

    let error = validate_locked_package_godot_compatibility(&lock, &project)
        .expect_err("incompatible package requirement should fail");

    assert!(error.message().contains("package addon requires Godot <4"));
}

#[test]
fn invariant_active_godot_version_is_checked_against_package_metadata() {
    let project = project(">=4.4,<5", Some("4.4.2"));
    let lock = lock(GodotCompatibility::Requirement(requirement(">=4.5,<5")));

    let error = validate_locked_package_godot_compatibility(&lock, &project)
        .expect_err("active engine incompatibility should fail");

    assert!(error.message().contains("active Godot is 4.4.2"));
}

#[test]
fn invariant_unknown_and_prerelease_package_compatibility_are_explicit_nonfatal_states() {
    let project = project(">=4.4,<5", None);
    let unknown = lock(GodotCompatibility::Unknown);
    let prerelease = lock(GodotCompatibility::Requirement(requirement(">=4.5.0-beta")));

    let unknown_report = validate_locked_package_godot_compatibility(&unknown, &project)
        .expect("unknown compatibility should not block");
    let prerelease_report = validate_locked_package_godot_compatibility(&prerelease, &project)
        .expect("indeterminate prerelease compatibility should not block");

    assert_eq!(
        unknown_report
            .unknown()
            .iter()
            .map(PackageName::as_str)
            .collect::<Vec<_>>(),
        ["addon"]
    );
    assert_eq!(
        prerelease_report
            .indeterminate()
            .iter()
            .map(PackageName::as_str)
            .collect::<Vec<_>>(),
        ["addon"]
    );
}

fn project(
    requirement: &str,
    active_version: Option<&str>,
) -> wukong_core::godot_compatibility::ProjectGodotCompatibility {
    let manifest = Manifest::parse(
        std::path::Path::new("wukong.toml"),
        &format!("[project]\nname=\"fixture\"\ngodot=\"{requirement}\"\n"),
    )
    .expect("fixture manifest should parse");
    resolve_project_godot_compatibility(&manifest, active_version)
        .expect("project compatibility should resolve")
}

fn lock(godot: GodotCompatibility) -> Lockfile {
    let checksum = "0".repeat(64);
    let source = LockedLocalSource::new(
        ImmutableSourceId::new(format!("sha256:{checksum}")).expect("source ID should parse"),
        checksum.clone(),
    )
    .expect("source should build");
    Lockfile::new([LockedPackage::new(
        PackageName::parse("addon").expect("package name should parse"),
        None,
        source,
        checksum,
        "1".repeat(64),
        BTreeSet::new(),
        ".".into(),
        "addons/addon".into(),
        godot,
        false,
    )
    .expect("package should build")])
    .expect("lock should build")
}

fn requirement(value: &str) -> VersionRequirement {
    VersionRequirement::parse(value).expect("fixture requirement should parse")
}
