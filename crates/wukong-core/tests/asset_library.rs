#![cfg(feature = "asset-library")]

use sha2::Digest;
use std::{collections::BTreeSet, fs, io::Write, path::PathBuf};
use tempfile::TempDir;
use wukong_core::{
    cache::CacheLayout,
    direct_sync::sync_direct_dependencies,
    identity::PackageName,
    lockfile::{GodotCompatibility, LockedHttpSource, LockedPackage, Lockfile},
    manifest::Manifest,
    package_tree::prepare_package_tree,
    source::ImmutableSourceId,
};
use zip::{CompressionMethod, ZipWriter, write::SimpleFileOptions};

#[test]
fn invariant_locked_asset_library_dependency_syncs_offline_without_metadata_access() {
    let directory = TempDir::new().expect("fixture directory should create");
    let project = directory.path().join("project");
    let source = directory.path().join("source");
    fs::create_dir_all(&project).expect("project should create");
    fs::create_dir(&source).expect("source should create");
    fs::write(source.join("plugin.gd"), "extends Node\n").expect("source file should write");
    let manifest_path = project.join("wukong.toml");
    fs::write(&manifest_path, "[project]\nname = \"fixture\"\ngodot = \"4\"\n\n[dependencies]\nexample = { asset = \"42\" }\n").expect("manifest should write");
    let manifest = Manifest::parse(
        &manifest_path,
        &fs::read_to_string(&manifest_path).expect("manifest should read"),
    )
    .expect("asset manifest should parse");
    let prepared = prepare_package_tree(&source, &directory.path().join("prepared"))
        .expect("source should prepare");
    let archive = archive_bytes();
    let archive_sha256 = format!("{:x}", sha2::Sha256::digest(&archive));
    let cache = CacheLayout::for_root(directory.path().join("cache")).expect("cache should create");
    let cache_path = cache.downloads().join("sha256").join(&archive_sha256);
    fs::create_dir_all(cache_path.parent().expect("cache path should have parent"))
        .expect("cache parent should create");
    fs::write(&cache_path, archive).expect("archive cache entry should write");
    let source = LockedHttpSource::new(
        ImmutableSourceId::new(format!("sha256:{archive_sha256}")).expect("identity should parse"),
        "https://asset-library.example.test/download.zip",
        archive_sha256,
    )
    .expect("source should lock");
    let lock = Lockfile::new([LockedPackage::new(
        PackageName::parse("example").expect("package name should parse"),
        None,
        source,
        prepared.sha256().to_owned(),
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855".to_owned(),
        BTreeSet::new(),
        PathBuf::from("."),
        PathBuf::from("addons/example"),
        GodotCompatibility::Unknown,
        false,
    )
    .expect("package should lock")])
    .expect("lockfile should create");

    sync_direct_dependencies(
        &project,
        &manifest_path,
        &manifest,
        &lock,
        false,
        &cache,
        true,
    )
    .expect("offline locked asset should sync");

    assert_eq!(
        fs::read_to_string(project.join("addons/example/plugin.gd"))
            .expect("installed file should read"),
        "extends Node\n"
    );
}

fn archive_bytes() -> Vec<u8> {
    let mut output = std::io::Cursor::new(Vec::new());
    let mut archive = ZipWriter::new(&mut output);
    archive
        .start_file(
            "plugin.gd",
            SimpleFileOptions::default().compression_method(CompressionMethod::Stored),
        )
        .expect("archive entry should start");
    archive
        .write_all(b"extends Node\n")
        .expect("archive should write");
    archive.finish().expect("archive should finish");
    output.into_inner()
}
