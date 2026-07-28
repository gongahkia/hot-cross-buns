use wukong_core::{
    godot_compatibility::resolve_project_godot_compatibility, manifest::Manifest,
    semantic_version::SemanticVersion,
};

#[test]
fn invariant_manifest_requirement_is_authoritative_without_an_engine_version_inference() {
    let manifest = manifest(">=4.4,<5");

    let compatibility = resolve_project_godot_compatibility(&manifest, None)
        .expect("manifest compatibility should resolve");

    assert_eq!(compatibility.requirement().to_string(), ">=4.4, <5");
    assert_eq!(compatibility.active_version(), None);
}

#[test]
fn invariant_explicit_godot_version_must_be_complete_and_satisfy_the_manifest() {
    let manifest = manifest(">=4.4,<5");

    let compatibility = resolve_project_godot_compatibility(&manifest, Some("4.4.2"))
        .expect("compatible explicit version should resolve");
    let incompatible = resolve_project_godot_compatibility(&manifest, Some("4.3.0"))
        .expect_err("incompatible version should fail");
    let incomplete = resolve_project_godot_compatibility(&manifest, Some("4.4"))
        .expect_err("incomplete version should fail");

    assert_eq!(
        compatibility.active_version(),
        Some(&SemanticVersion::parse("4.4.2").expect("fixture version should parse"))
    );
    assert!(incompatible.message().contains("does not satisfy"));
    assert!(incomplete.message().contains("complete semantic version"));
}

fn manifest(requirement: &str) -> Manifest {
    Manifest::parse(
        std::path::Path::new("wukong.toml"),
        &format!("[project]\nname=\"fixture\"\ngodot=\"{requirement}\"\n"),
    )
    .expect("fixture manifest should parse")
}
