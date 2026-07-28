use std::fs;
use tempfile::TempDir;
use wukong_core::transactional_file::{FileSnapshot, write_atomic};

#[test]
fn invariant_atomic_replacement_and_verified_restore_recover_exact_prior_bytes() {
    let fixture = TempDir::new().expect("fixture directory should exist");
    let path = fixture.path().join("wukong.toml");
    fs::write(&path, "before").expect("fixture should write");
    let snapshot = FileSnapshot::capture(&path).expect("snapshot should capture");

    write_atomic(&path, b"after").expect("replacement should write");
    snapshot
        .restore_if_current(Some(b"after"))
        .expect("matching file should restore");

    assert_eq!(fs::read(&path).expect("file should read"), b"before");
}

#[test]
fn invariant_restore_never_overwrites_an_unexpected_concurrent_edit() {
    let fixture = TempDir::new().expect("fixture directory should exist");
    let path = fixture.path().join("wukong.lock");
    fs::write(&path, "before").expect("fixture should write");
    let snapshot = FileSnapshot::capture(&path).expect("snapshot should capture");
    fs::write(&path, "concurrent").expect("concurrent edit should write");

    let error = snapshot
        .restore_if_current(Some(b"after"))
        .expect_err("unexpected content should not restore");

    assert!(error.message().contains("refusing to restore"));
    assert_eq!(fs::read(&path).expect("file should read"), b"concurrent");
}

#[test]
fn invariant_absent_file_snapshot_removes_only_the_expected_new_file() {
    let fixture = TempDir::new().expect("fixture directory should exist");
    let path = fixture.path().join("wukong.lock");
    let snapshot = FileSnapshot::capture(&path).expect("missing snapshot should capture");
    write_atomic(&path, b"new").expect("replacement should write");

    snapshot
        .restore_if_current(Some(b"new"))
        .expect("new file should remove");

    assert!(!path.exists());
}
