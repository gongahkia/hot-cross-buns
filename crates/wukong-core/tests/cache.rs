use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread,
};
use tempfile::TempDir;
use wukong_core::{
    cache::{
        CACHE_SCHEMA, CacheLayout, publish_prepared_package, verify_cached_packages,
        verify_package_object,
    },
    diagnostic::ErrorCode,
    operation_lock::AdvisoryLock,
    package_tree::{PreparedPackageTree, prepare_package_tree},
};

#[test]
fn invariant_cache_objects_and_locks_are_content_addressed_and_separated() {
    let layout =
        CacheLayout::for_root(PathBuf::from("/cache/wukong")).expect("layout should parse");
    let hash = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    assert_eq!(
        layout.schema_root(),
        PathBuf::from("/cache/wukong").join(CACHE_SCHEMA)
    );
    assert_ne!(layout.downloads(), layout.packages());
    assert_eq!(
        layout.package_object(hash).expect("hash should parse"),
        layout.packages().join("sha256").join(hash)
    );
    assert_eq!(
        layout.object_lock(hash).expect("hash should parse"),
        layout
            .locks()
            .join("sha256")
            .join(hash)
            .with_extension("lock")
    );
}

#[test]
fn invariant_invalid_cache_object_names_are_rejected() {
    let layout = CacheLayout::for_root(PathBuf::from("cache")).expect("layout should parse");
    assert!(layout.package_object("not-a-hash").is_err());
}

#[test]
fn invariant_publication_is_verified_and_readers_only_observe_complete_content() {
    let fixture = TempDir::new().expect("fixture directory should exist");
    let prepared = prepared_fixture_with_large_file(&fixture);
    let layout = cache_layout(&fixture);
    let final_path = layout
        .package_object(prepared.sha256())
        .expect("hash should be valid");
    let publication_layout = layout.clone();
    let publication_tree = prepared.clone();
    let completed = Arc::new(AtomicBool::new(false));
    let publication_completed = Arc::clone(&completed);

    let publisher = thread::spawn(move || {
        let result = publish_prepared_package(&publication_layout, &publication_tree);
        publication_completed.store(true, Ordering::Release);
        result
    });
    let mut observed = false;
    while !completed.load(Ordering::Acquire) {
        if final_path.exists() {
            observed = true;
            assert_eq!(
                fs::read_to_string(final_path.join("plugin.cfg"))
                    .expect("visible object should contain complete plugin file"),
                "[plugin]\nname=\"Example\"\n"
            );
        }
        thread::yield_now();
    }
    let object = publisher
        .join()
        .expect("publisher should not panic")
        .expect("publication should succeed");

    assert_eq!(object.path(), final_path.as_path());
    assert_eq!(object.sha256(), prepared.sha256());
    assert!(
        observed,
        "reader should observe the completed published object"
    );
    let verification = prepare_package_tree(object.path(), &fixture.path().join("reader-stage"))
        .expect("published object should be readable as a complete tree");
    assert_eq!(verification.sha256(), prepared.sha256());
    assert_no_temporary_candidates(&layout);
}

#[test]
fn invariant_concurrent_publishers_converge_on_one_verified_object() {
    let fixture = TempDir::new().expect("fixture directory should exist");
    let prepared = Arc::new(prepared_fixture(&fixture));
    let layout = Arc::new(cache_layout(&fixture));
    let publishers = (0..2)
        .map(|_| {
            let prepared = Arc::clone(&prepared);
            let layout = Arc::clone(&layout);
            thread::spawn(move || publish_prepared_package(&layout, &prepared))
        })
        .collect::<Vec<_>>();
    let mut objects = Vec::new();
    for publisher in publishers {
        match publisher.join().expect("publisher should not panic") {
            Ok(object) => objects.push(object),
            Err(error) => assert_eq!(error.code(), ErrorCode::SourceAccess),
        }
    }

    assert!(!objects.is_empty());
    assert!(
        objects
            .iter()
            .all(|object| object.sha256() == prepared.sha256())
    );
    verify_package_object(&layout, prepared.sha256())
        .expect("one publisher should leave a verified cache object");
    assert_no_temporary_candidates(&layout);
}

#[test]
fn invariant_cache_object_lock_reports_contention_and_recovers_after_release() {
    let fixture = TempDir::new().expect("fixture directory should exist");
    let prepared = prepared_fixture(&fixture);
    let layout = cache_layout(&fixture);
    let lock = AdvisoryLock::try_acquire(
        &layout
            .object_lock(prepared.sha256())
            .expect("object lock should derive"),
        "fixture cache object",
    )
    .expect("fixture lock should acquire");

    let error = publish_prepared_package(&layout, &prepared)
        .expect_err("publication should report an active object lock");
    assert_eq!(error.code(), ErrorCode::SourceAccess);
    assert!(
        error
            .message()
            .contains("another wukong operation is active")
    );
    drop(lock);

    publish_prepared_package(&layout, &prepared)
        .expect("publication should recover after object lock release");
}

#[test]
fn invariant_abandoned_package_staging_is_reclaimed_only_for_its_locked_object() {
    let fixture = TempDir::new().expect("fixture directory should exist");
    let prepared = prepared_fixture(&fixture);
    let layout = cache_layout(&fixture);
    let parent = layout.packages().join("sha256");
    let abandoned = parent.join(format!(".wukong-package-{}-abandoned", prepared.sha256()));
    write(&abandoned.join("partial"), "abandoned\n");

    publish_prepared_package(&layout, &prepared).expect("publication should reclaim its staging");

    assert!(!abandoned.exists());
    assert!(
        layout
            .package_object(prepared.sha256())
            .expect("object path should derive")
            .is_dir()
    );
}

#[test]
fn invariant_failed_publication_leaves_no_visible_or_partial_object() {
    let fixture = TempDir::new().expect("fixture directory should exist");
    let prepared = prepared_fixture(&fixture);
    let layout = cache_layout(&fixture);
    let final_path = layout
        .package_object(prepared.sha256())
        .expect("hash should be valid");
    fs::remove_file(prepared.root().join("plugin.cfg"))
        .expect("fixture should allow a simulated interrupted source");

    assert!(publish_prepared_package(&layout, &prepared).is_err());
    assert!(!final_path.exists());
    assert_no_temporary_candidates(&layout);
}

#[test]
fn invariant_corrupted_existing_object_is_rejected() {
    let fixture = TempDir::new().expect("fixture directory should exist");
    let prepared = prepared_fixture(&fixture);
    let layout = cache_layout(&fixture);
    let final_path = layout
        .package_object(prepared.sha256())
        .expect("hash should be valid");
    write(
        &final_path.join("plugin.cfg"),
        "[plugin]\nname=\"Tampered\"\n",
    );

    let error = publish_prepared_package(&layout, &prepared)
        .expect_err("publication should reject a corrupt existing object");

    assert_eq!(error.code(), ErrorCode::IntegrityFailure);
    assert!(!final_path.exists());
}

#[test]
fn invariant_cache_reads_verify_hashes_and_remove_corrupt_objects() {
    let fixture = TempDir::new().expect("fixture directory should exist");
    let prepared = prepared_fixture(&fixture);
    let layout = cache_layout(&fixture);
    let object = publish_prepared_package(&layout, &prepared).expect("publication should work");

    assert_eq!(
        verify_package_object(&layout, prepared.sha256())
            .expect("verified cache read should succeed"),
        object
    );
    write(
        &object.path().join("plugin.cfg"),
        "[plugin]\nname=\"Tampered\"\n",
    );

    let error = verify_package_object(&layout, prepared.sha256())
        .expect_err("corrupted cache read should fail");

    assert_eq!(error.code(), ErrorCode::IntegrityFailure);
    assert!(!object.path().exists());
}

#[test]
fn invariant_full_cache_verification_counts_valid_and_removed_objects() {
    let fixture = TempDir::new().expect("fixture directory should exist");
    let first = prepared_fixture(&fixture);
    let second = prepared_fixture_named(&fixture, "second", "second-prepared", "Second");
    let layout = cache_layout(&fixture);
    let valid = publish_prepared_package(&layout, &first).expect("first publication should work");
    let corrupt =
        publish_prepared_package(&layout, &second).expect("second publication should work");
    write(
        &corrupt.path().join("plugin.cfg"),
        "[plugin]\nname=\"Tampered\"\n",
    );

    let report = verify_cached_packages(&layout).expect("cache verification should complete");

    assert_eq!(report.verified_packages(), 1);
    assert_eq!(report.removed_corrupt_packages(), 1);
    assert!(valid.path().exists());
    assert!(!corrupt.path().exists());
}

#[test]
fn invariant_full_cache_verification_never_deletes_unrecognized_entries() {
    let fixture = TempDir::new().expect("fixture directory should exist");
    let layout = cache_layout(&fixture);
    let foreign = layout.packages().join("sha256").join("foreign");
    write(&foreign.join("data"), "do not delete\n");

    let error = verify_cached_packages(&layout)
        .expect_err("unrecognized entries should be diagnosed without deletion");

    assert_eq!(error.code(), ErrorCode::IntegrityFailure);
    assert!(foreign.exists());
}

#[cfg(windows)]
#[test]
fn invariant_windows_existing_object_is_verified_and_reused() {
    let fixture = TempDir::new().expect("fixture directory should exist");
    let prepared = prepared_fixture(&fixture);
    let layout = cache_layout(&fixture);

    let first =
        publish_prepared_package(&layout, &prepared).expect("first publication should work");
    let second =
        publish_prepared_package(&layout, &prepared).expect("existing object should reuse");

    assert_eq!(first, second);
}

fn cache_layout(fixture: &TempDir) -> CacheLayout {
    CacheLayout::for_root(fixture.path().join("cache")).expect("layout should parse")
}

fn prepared_fixture(fixture: &TempDir) -> PreparedPackageTree {
    prepared_fixture_named(fixture, "source", "prepared", "Example")
}

fn prepared_fixture_named(
    fixture: &TempDir,
    source_name: &str,
    staging_name: &str,
    plugin_name: &str,
) -> PreparedPackageTree {
    let source = fixture.path().join(source_name);
    write(
        &source.join("plugin.cfg"),
        &format!("[plugin]\nname=\"{plugin_name}\"\n"),
    );
    write(&source.join("scripts/main.gd"), "extends Node\n");
    prepare_package_tree(&source, &fixture.path().join(staging_name))
        .expect("fixture tree should prepare")
}

fn prepared_fixture_with_large_file(fixture: &TempDir) -> PreparedPackageTree {
    let source = fixture.path().join("source");
    write(&source.join("plugin.cfg"), "[plugin]\nname=\"Example\"\n");
    fs::create_dir_all(source.join("scripts")).expect("fixture directory should exist");
    fs::write(
        source.join("scripts/payload.bin"),
        vec![0_u8; 16 * 1024 * 1024],
    )
    .expect("fixture payload should write");
    prepare_package_tree(&source, &fixture.path().join("prepared"))
        .expect("fixture tree should prepare")
}

fn assert_no_temporary_candidates(layout: &CacheLayout) {
    let packages = layout.packages().join("sha256");
    if !packages.exists() {
        return;
    }
    let entries = fs::read_dir(packages).expect("cache package directory should be readable");
    for entry in entries {
        let entry = entry.expect("cache entry should be readable");
        assert!(
            !entry
                .file_name()
                .to_string_lossy()
                .starts_with(".wukong-package-"),
            "temporary staging candidate should be removed"
        );
    }
}

fn write(path: &Path, contents: &str) {
    fs::create_dir_all(path.parent().expect("fixture file should have a parent"))
        .expect("fixture directory should exist");
    fs::write(path, contents).expect("fixture file should write");
}
