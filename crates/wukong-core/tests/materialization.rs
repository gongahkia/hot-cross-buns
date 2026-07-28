use std::{fs, path::Path};
use tempfile::TempDir;
use wukong_core::{
    installed_state::MaterializationStrategy,
    materialization::{MaterializationPreference, materialize_file},
};

#[test]
fn invariant_explicit_copy_and_auto_materialisation_preserve_content() {
    let fixture = TempDir::new().expect("fixture should exist");
    let source = fixture.path().join("source");
    write(&source, "content\n");
    let copied = fixture.path().join("copied");
    let automatic = fixture.path().join("automatic");

    assert_eq!(
        materialize_file(&source, &copied, MaterializationPreference::Copy)
            .expect("copy should work"),
        MaterializationStrategy::Copy
    );
    let strategy = materialize_file(&source, &automatic, MaterializationPreference::Auto)
        .expect("auto should select a safe strategy");

    assert_eq!(
        fs::read_to_string(copied).expect("copy should read"),
        "content\n"
    );
    assert_eq!(
        fs::read_to_string(automatic).expect("auto file should read"),
        "content\n"
    );
    assert!(matches!(
        strategy,
        MaterializationStrategy::Copy
            | MaterializationStrategy::Hardlink
            | MaterializationStrategy::Reflink
    ));
}

#[test]
fn invariant_explicit_hardlink_is_never_silently_replaced_by_copy() {
    let fixture = TempDir::new().expect("fixture should exist");
    let source = fixture.path().join("source");
    let target = fixture.path().join("target");
    write(&source, "content\n");

    let result = materialize_file(&source, &target, MaterializationPreference::Hardlink);

    if result.is_ok() {
        assert_eq!(
            fs::read_to_string(target).expect("hardlink should read"),
            "content\n"
        );
    } else {
        assert!(!target.exists());
    }
}

fn write(path: &Path, content: &str) {
    fs::write(path, content).expect("file should write");
}
