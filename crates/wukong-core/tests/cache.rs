use std::path::PathBuf;
use wukong_core::cache::{CACHE_SCHEMA, CacheLayout};

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
