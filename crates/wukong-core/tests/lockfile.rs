use proptest::{collection, prelude::*};
use std::{collections::BTreeSet, path::Path};
use wukong_core::{
    identity::PackageName,
    lockfile::{
        CatalogGraphRoots, GodotCompatibility, LockedGitSource, LockedGodotArtifact,
        LockedGodotToolchain, LockedHttpSource, LockedLocalSource, LockedPackage, LockedSource,
        Lockfile,
    },
    managed_godot::{GodotFlavor, GodotPlatform},
    semantic_version::SemanticVersion,
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
    fn invariant_unknown_schema_versions_fail(schema in 5i64..1000) {
        let error = Lockfile::parse(Path::new(PATH), &format!("schema = {schema}\n")).expect_err("unknown schema should fail");
        prop_assert!(error.message().contains("schema"));
    }
}

#[test]
fn invariant_schema_four_round_trips_exact_managed_godot_artifacts() {
    let hash = "a".repeat(128);
    let editor = LockedGodotArtifact::new(
        "Godot_v4.4.1-stable_macos.universal.zip".to_owned(),
        "https://github.com/godotengine/godot-builds/releases/download/4.4.1-stable/Godot_v4.4.1-stable_macos.universal.zip".to_owned(),
        hash.clone(),
        42,
    ).expect("editor should lock");
    let templates = LockedGodotArtifact::new(
        "Godot_v4.4.1-stable_export_templates.tpz".to_owned(),
        "https://github.com/godotengine/godot-builds/releases/download/4.4.1-stable/Godot_v4.4.1-stable_export_templates.tpz".to_owned(),
        hash,
        24,
    ).expect("templates should lock");
    let toolchain = LockedGodotToolchain::new(
        SemanticVersion::parse("4.4.1").expect("version should parse"),
        GodotFlavor::Standard,
        "4.4.1-stable".to_owned(),
        [(GodotPlatform::MacosUniversal, editor)],
        templates,
    ).expect("toolchain should lock");
    let lock = lock(["example-addon"]).with_toolchain(toolchain);
    let output = lock.to_toml();
    let parsed = Lockfile::parse(Path::new(PATH), &output).expect("schema four should parse");
    assert_eq!(lock, parsed);
    assert_eq!(lock.schema(), 4);
    assert!(output.contains("[toolchain]"));
    assert!(output.contains("[[toolchain.editor]]"));
}

#[test]
fn invariant_schema_two_serializes_local_identity_layout_and_compatibility() {
    let lock = lock(["example-addon", "other-addon"]);
    let output = lock.to_toml();
    assert_eq!(lock.schema(), 2);
    assert!(output.starts_with("schema = 2\n"));
    assert!(output.contains("immutable_id = \"sha256:"));
    assert!(output.contains("source_subdirectory = \".\""));
    assert!(output.contains("godot = \"unknown\""));
    assert!(output.contains("[[package]]"));
}

#[test]
fn invariant_schema_two_round_trips_immutable_git_and_http_sources() {
    let git_commit = "4ab90a80b815bc1ad4a8d7eea92c785e654bfd91";
    let archive_checksum = "77c61f3a6ace3a2b9d1729f6d52af90e6c9b6671e1db798cd91dec1ad666e91b";
    let git = LockedGitSource::new(
        ImmutableSourceId::new(format!("git:{git_commit}")).expect("identity should parse"),
        "https://github.com/Goutte/godot-addon-animated-shape-2d.git",
        git_commit.to_owned(),
    )
    .expect("Git source should lock");
    let http = LockedHttpSource::new(
        ImmutableSourceId::new(format!("sha256:{archive_checksum}"))
            .expect("identity should parse"),
        "https://github.com/Goutte/godot-addon-animated-shape-2d/archive/4ab90a80b815bc1ad4a8d7eea92c785e654bfd91.zip",
        archive_checksum.to_owned(),
    )
    .expect("HTTP source should lock");
    let lock = Lockfile::new([
        remote_package("git-addon", git.into(), 1),
        remote_package("http-addon", http.into(), 2),
    ])
    .expect("lock should create");

    let output = lock.to_toml();
    let parsed = Lockfile::parse(Path::new(PATH), &output).expect("lock should parse");

    assert_eq!(parsed, lock);
    assert!(output.contains("kind = \"git\""));
    assert!(output.contains("kind = \"http\""));
    assert!(!output.contains("branch ="));
}

#[test]
fn invariant_schema_three_serializes_a_complete_catalog_graph_deterministically() {
    let lock = catalog_graph();
    let output = lock.to_toml();
    let parsed = Lockfile::parse(Path::new(PATH), &output).expect("catalog graph should parse");

    assert_eq!(lock.schema(), 3);
    assert_eq!(parsed, lock);
    assert!(output.starts_with("schema = 3\n"));
    assert!(output.contains("[roots]\nruntime = [\"alpha\"]\ndevelopment = []"));
    assert!(output.contains("catalog_sha256"));
    assert!(output.contains("dependencies = [\"beta\"]"));
    assert!(output.contains("source_subdirectory = \"addons/alpha\""));
    assert!(!output.contains("user:"));
}

#[test]
fn invariant_schema_three_rejects_malformed_catalog_graph_state() {
    let output = catalog_graph().to_toml();
    let missing_version = output.replace("version = \"1.0.0\"\n", "");
    let invalid_fingerprint = output.replace(
        "catalog_sha256 = \"0000000000000000000000000000000000000000000000000000000000000001\"",
        "catalog_sha256 = \"invalid\"",
    );
    let dangling_edge = output.replace("dependencies = [\"beta\"]", "dependencies = [\"missing\"]");
    let local_source = output.replace("kind = \"git\"", "kind = \"local\"");
    let missing_roots = output.replace("[roots]\nruntime = [\"alpha\"]\ndevelopment = []\n\n", "");
    let missing_root = output.replace("runtime = [\"alpha\"]", "runtime = [\"missing\"]");
    let stale_development = output.replace("development = false", "development = true");

    for input in [
        missing_version,
        invalid_fingerprint,
        dangling_edge,
        local_source,
        missing_roots,
        missing_root,
        stale_development,
    ] {
        let error = Lockfile::parse(Path::new(PATH), &input)
            .expect_err("malformed schema-three state must fail");

        assert_eq!(error.code(), wukong_core::diagnostic::ErrorCode::UserInput);
    }
}

#[test]
fn invariant_schema_one_and_two_remain_readable_without_automatic_migration() {
    let schema_one = "schema = 1\n";
    let schema_two = lock(["example-addon"]).to_toml();

    let first = Lockfile::parse(Path::new(PATH), schema_one).expect("schema one should parse");
    let second = Lockfile::parse(Path::new(PATH), &schema_two).expect("schema two should parse");

    assert_eq!(first.schema(), 1);
    assert_eq!(first.to_toml(), schema_one);
    assert_eq!(second.schema(), 2);
    assert_eq!(second.to_toml(), schema_two);
}

#[test]
fn invariant_lockfile_rejects_remote_credentials_without_retaining_them() {
    let secret = "do-not-persist";
    let checksum = "77c61f3a6ace3a2b9d1729f6d52af90e6c9b6671e1db798cd91dec1ad666e91b";
    let source = LockedHttpSource::new(
        ImmutableSourceId::new(format!("sha256:{checksum}")).expect("identity should parse"),
        "https://example.test/addon.zip",
        checksum.to_owned(),
    )
    .expect("safe source should lock");
    let lock =
        Lockfile::new([remote_package("example", source.into(), 1)]).expect("lock should create");
    let input = lock.to_toml().replace(
        "https://example.test/addon.zip",
        &format!("https://example.test/addon.zip?signature={secret}"),
    );

    let error = Lockfile::parse(Path::new(PATH), &input)
        .expect_err("credential-bearing archive URL should not parse");

    assert_eq!(error.code(), wukong_core::diagnostic::ErrorCode::UserInput);
    assert!(!error.message().contains(secret));
    assert!(
        error
            .source_description()
            .is_none_or(|source| !source.as_str().contains(secret))
    );
    assert!(
        error
            .recovery()
            .is_none_or(|recovery| !recovery.contains(secret))
    );
    assert!(error.cause().is_none_or(|cause| !cause.contains(secret)));
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

fn remote_package(name: &str, source: LockedSource, index: usize) -> LockedPackage {
    LockedPackage::new(
        PackageName::parse(name).expect("name should parse"),
        None,
        source,
        format!("{index:064x}"),
        format!("{:064x}", index + 10),
        BTreeSet::new(),
        ".".into(),
        format!("addons/{name}").into(),
        GodotCompatibility::Unknown,
        false,
    )
    .expect("package should lock")
}

fn catalog_graph() -> Lockfile {
    let git_commit = "4ab90a80b815bc1ad4a8d7eea92c785e654bfd91";
    let archive_checksum = "77c61f3a6ace3a2b9d1729f6d52af90e6c9b6671e1db798cd91dec1ad666e91b";
    let alpha = LockedGitSource::new(
        ImmutableSourceId::new(format!("git:{git_commit}")).expect("identity should parse"),
        "https://example.test/alpha.git",
        git_commit.to_owned(),
    )
    .expect("Git source should lock");
    let beta = LockedHttpSource::new(
        ImmutableSourceId::new(format!("sha256:{archive_checksum}"))
            .expect("identity should parse"),
        "https://example.test/beta.zip",
        archive_checksum.to_owned(),
    )
    .expect("HTTP source should lock");
    Lockfile::new_catalog_graph(
        [
            catalog_package("alpha", alpha.into(), ["beta"], 1),
            catalog_package("beta", beta.into(), [], 2),
        ],
        CatalogGraphRoots::new([name("alpha")], []),
    )
    .expect("catalog graph should lock")
}

fn name(value: &str) -> PackageName {
    PackageName::parse(value).expect("name should parse")
}

fn catalog_package(
    name: &str,
    source: LockedSource,
    dependencies: impl IntoIterator<Item = &'static str>,
    index: usize,
) -> LockedPackage {
    LockedPackage::new(
        PackageName::parse(name).expect("name should parse"),
        Some(
            format!("{index}.0.0")
                .parse()
                .expect("version should parse"),
        ),
        source,
        format!("{:064x}", index + 100),
        format!("{:064x}", index + 200),
        dependencies
            .into_iter()
            .map(|dependency| PackageName::parse(dependency).expect("dependency should parse"))
            .collect(),
        format!("addons/{name}").into(),
        format!("addons/{name}").into(),
        GodotCompatibility::Requirement("4".parse().expect("Godot requirement should parse")),
        false,
    )
    .expect("package should lock")
    .with_catalog_sha256(format!("{index:064x}"))
    .expect("catalog fingerprint should validate")
}
