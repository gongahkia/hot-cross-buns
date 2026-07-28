use proptest::{collection, prelude::*};
use std::{collections::BTreeSet, path::Path};
use wukong_core::{
    identity::PackageName,
    lockfile::{GodotCompatibility, LockedLocalSource, LockedPackage, Lockfile},
    source::ImmutableSourceId,
};

const PATH: &str = "fixture/wukong.lock";

proptest! {
    #[test]
    fn invariant_parse_serialize_round_trips_generated_locks(names in collection::btree_set("[a-z][a-z0-9]{0,5}", 1..8)) {
        let lock = lock(names.iter().map(String::as_str));
        let parsed = Lockfile::parse(Path::new(PATH), &lock.to_toml()).expect("serialized lock should parse");
        prop_assert_eq!(parsed, lock);
    }

    #[test]
    fn invariant_repeated_writes_are_byte_identical(names in collection::btree_set("[a-z][a-z0-9]{0,5}", 1..8)) {
        let lock = lock(names.iter().map(String::as_str));
        prop_assert_eq!(lock.to_toml(), lock.to_toml());
    }

    #[test]
    fn invariant_entry_order_does_not_change_serialization(names in collection::btree_set("[a-z][a-z0-9]{0,5}", 1..8)) {
        let mut entries = names.iter().enumerate().map(|(index, name)| package(name, index)).collect::<Vec<_>>();
        let first = Lockfile::new(entries.clone()).expect("entries should lock");
        entries.reverse();
        let second = Lockfile::new(entries).expect("entries should lock");
        prop_assert_eq!(first.to_toml(), second.to_toml());
    }

    #[test]
    fn invariant_x_extensions_are_preserved(value in "[a-z0-9 -]{0,24}") {
        let input = format!("schema = 1\nx-note = {value:?}\n");
        let lock = Lockfile::parse(Path::new(PATH), &input).expect("x extension should parse");
        prop_assert_eq!(lock.to_toml(), input);
    }

    #[test]
    fn invariant_unknown_schema_versions_fail(schema in 2i64..1000) {
        let error = Lockfile::parse(Path::new(PATH), &format!("schema = {schema}\n")).expect_err("unknown schema should fail");
        prop_assert!(error.message().contains("schema"));
    }
}

#[test]
fn invariant_schema_one_serializes_local_identity_layout_and_compatibility() {
    let lock = lock(["example-addon", "other-addon"]);
    let output = lock.to_toml();
    assert!(output.contains("immutable_id = \"sha256:"));
    assert!(output.contains("source_subdirectory = \".\""));
    assert!(output.contains("godot = \"unknown\""));
    assert!(output.contains("[[package]]"));
}

fn lock<'a>(names: impl IntoIterator<Item = &'a str>) -> Lockfile {
    Lockfile::new(
        names
            .into_iter()
            .enumerate()
            .map(|(index, name)| package(name, index)),
    )
    .expect("packages should lock")
}

fn package(name: &str, index: usize) -> LockedPackage {
    let checksum = format!("{index:064x}");
    let source = LockedLocalSource::new(
        ImmutableSourceId::new(format!("sha256:{checksum}")).expect("identity should parse"),
        checksum.clone(),
    )
    .expect("source should lock");
    LockedPackage::new(
        PackageName::parse(name).expect("name should parse"),
        None,
        source,
        checksum,
        format!("{index:064x}"),
        BTreeSet::new(),
        ".".into(),
        format!("addons/{name}").into(),
        GodotCompatibility::Unknown,
        false,
    )
    .expect("package should lock")
}
