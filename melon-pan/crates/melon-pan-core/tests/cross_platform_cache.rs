//! Cache layout contract test.
//!
//! This test loads a hand-authored fixture tree from
//! `tests/cross-platform-cache/melon-pan/` and asserts that
//! `LocalCacheStore` reads each surface: current.md, current.docs.json,
//! meta.json with persisted fidelity warnings, drive-tree.json, and the
//! audit triangle.

use melon_pan_core::{LocalCacheStore, WarningKind};
use std::path::PathBuf;

fn fixture_root() -> PathBuf {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir
        .parent()
        .and_then(|crates| crates.parent())
        .map(|root| {
            root.join("tests")
                .join("cross-platform-cache")
                .join("melon-pan")
        })
        .expect("repo layout has crates/<crate>/, walk up two parents")
}

#[test]
fn cross_platform_fixture_is_readable() {
    let root = fixture_root();
    assert!(root.exists(), "fixture missing at {}", root.display());
    let store = LocalCacheStore::new(&root);

    let markdown = store
        .read_current_markdown("doc-fixture-1")
        .expect("current.md should be readable");
    assert!(markdown.starts_with("# Cache fixture"));
    assert!(markdown.contains("| col1 | col2 |"));

    let docs_json = store
        .read_current_docs_json("doc-fixture-1")
        .expect("current.docs.json should be readable");
    assert!(docs_json.contains("\"documentId\": \"doc-fixture-1\""));
}

#[test]
fn cross_platform_meta_round_trips_with_fidelity_warning() {
    let root = fixture_root();
    let store = LocalCacheStore::new(&root);
    let metadata = store
        .read_metadata("doc-fixture-1")
        .expect("meta.json should parse");
    assert_eq!(metadata.document_id, "doc-fixture-1");
    assert_eq!(metadata.revision_id, "rev-fixture-1");
    assert_eq!(metadata.last_fidelity_report.warnings.len(), 1);
    assert_eq!(
        metadata.last_fidelity_report.warnings[0].kind,
        WarningKind::LosslessApproximation
    );
    assert_eq!(metadata.last_pushed_at, None);
}

#[test]
fn cross_platform_drive_tree_lists_fixture_doc() {
    let root = fixture_root();
    let drive_tree = std::fs::read_to_string(root.join("drive-tree.json"))
        .expect("drive-tree.json should exist");
    let parsed =
        melon_pan_core::parse_drive_list_json(&drive_tree).expect("drive-tree.json should parse");
    let names: Vec<&str> = parsed.files.iter().map(|item| item.name.as_str()).collect();
    assert!(
        names.contains(&"Cross-platform fixture"),
        "drive-tree.json missing fixture doc; got {names:?}"
    );
}

#[test]
fn cross_platform_snapshot_pair_exists_for_fixture() {
    let root = fixture_root();
    let snapshot_dir = root.join("snapshots").join("doc-fixture-1");
    let md = snapshot_dir.join("rev-fixture-1.md");
    let docs_json = snapshot_dir.join("rev-fixture-1.docs.json");
    assert!(md.exists(), "snapshot md missing at {}", md.display());
    assert!(
        docs_json.exists(),
        "snapshot docs.json missing at {}",
        docs_json.display()
    );
}

#[test]
fn list_cached_document_ids_round_trips_fixture() {
    let root = fixture_root();
    let store = LocalCacheStore::new(&root);
    let ids = store
        .list_cached_document_ids()
        .expect("listing cache ids should succeed");
    assert!(
        ids.contains(&"doc-fixture-1".to_string()),
        "list_cached_document_ids missed the fixture doc; got {ids:?}"
    );
}
