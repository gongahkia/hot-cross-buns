use sha2::{Digest, Sha256};
use std::{fs, path::Path};
use tempfile::TempDir;
use wukong_core::{
    layout::{LayoutOptions, detect_package_layout},
    package_tree::{inspect_package_tree, prepare_package_tree},
};

#[test]
fn invariant_identical_selected_content_has_a_deterministic_tree_hash() {
    let fixture = TempDir::new().expect("fixture directory should exist");
    let source = fixture.path().join("source");
    write(&source.join("plugin.cfg"), "[plugin]\nname=\"Example\"\n");
    write(&source.join("scripts/main.gd"), "extends Node\n");

    let first = prepare_package_tree(&source, &fixture.path().join("first"))
        .expect("first tree should prepare");
    let second = prepare_package_tree(&source, &fixture.path().join("second"))
        .expect("second tree should prepare");

    assert_eq!(first.sha256(), second.sha256());
    assert_eq!(
        paths(&first),
        [Path::new("plugin.cfg"), Path::new("scripts/main.gd")]
    );
}

#[test]
fn invariant_in_place_inspection_matches_copied_canonical_tree() {
    let fixture = TempDir::new().expect("fixture directory should exist");
    let source = fixture.path().join("source");
    write(&source.join("plugin.cfg"), "[plugin]\nname=\"Example\"\n");
    write(&source.join("scripts/main.gd"), "extends Node\n");

    let inspected = inspect_package_tree(&source).expect("source should inspect");
    let prepared = prepare_package_tree(&source, &fixture.path().join("stage"))
        .expect("source should prepare");

    assert_eq!(
        inspected.root(),
        source.canonicalize().expect("source should canonicalize")
    );
    assert_eq!(inspected.sha256(), prepared.sha256());
    assert_eq!(inspected.files(), prepared.files());
}

#[test]
fn invariant_prepared_file_checksum_matches_the_copied_content() {
    let fixture = TempDir::new().expect("fixture directory should exist");
    let source = fixture.path().join("source");
    write(&source.join("plugin.gd"), "extends Node\n");

    let tree =
        prepare_package_tree(&source, &fixture.path().join("stage")).expect("tree should prepare");
    let file = tree.files().first().expect("prepared file should exist");
    let contents = b"extends Node\n";
    let expected = format!("{:x}", Sha256::digest(contents));
    let mut tree_hasher = Sha256::new();
    tree_hasher.update(b"f");
    tree_hasher.update(9_u64.to_be_bytes());
    tree_hasher.update(b"plugin.gd");
    tree_hasher.update(b"\0");
    tree_hasher.update(
        u64::try_from(contents.len())
            .expect("fixture length should fit u64")
            .to_be_bytes(),
    );
    tree_hasher.update(contents);

    assert_eq!(file.sha256(), expected);
    assert_eq!(tree.sha256(), format!("{:x}", tree_hasher.finalize()));
}

#[test]
fn invariant_layout_wrappers_do_not_change_canonical_content() {
    let fixture = TempDir::new().expect("fixture directory should exist");
    let direct = fixture.path().join("direct");
    let wrapped = fixture.path().join("wrapped");
    write(&direct.join("plugin.cfg"), "[plugin]\nname=\"Example\"\n");
    write(
        &wrapped.join("release/addons/example/plugin.cfg"),
        "[plugin]\nname=\"Example\"\n",
    );
    write(&wrapped.join("release/README.md"), "repository readme\n");

    let selected = detect_package_layout(&wrapped, &LayoutOptions::default())
        .expect("wrapped layout should select the addon");
    let direct_tree = prepare_package_tree(&direct, &fixture.path().join("direct-stage"))
        .expect("direct tree should prepare");
    let wrapped_tree = prepare_package_tree(
        selected.source_root(),
        &fixture.path().join("wrapped-stage"),
    )
    .expect("wrapped tree should prepare");

    assert_eq!(direct_tree.sha256(), wrapped_tree.sha256());
    assert_eq!(paths(&wrapped_tree), [Path::new("plugin.cfg")]);
}

#[test]
fn invariant_source_control_metadata_is_excluded_from_the_prepared_tree() {
    let fixture = TempDir::new().expect("fixture directory should exist");
    let source = fixture.path().join("source");
    write(&source.join("plugin.cfg"), "[plugin]\nname=\"Example\"\n");
    write(
        &source.join(".git/config"),
        "[core]\nrepositoryformatversion = 0\n",
    );
    write(&source.join("nested/.hg/store"), "metadata\n");

    let tree = prepare_package_tree(&source, &fixture.path().join("stage"))
        .expect("tree should prepare without source-control metadata");

    assert_eq!(paths(&tree), [Path::new("plugin.cfg")]);
    assert!(!tree.root().join(".git").exists());
    assert!(!tree.root().join("nested/.hg").exists());
}

#[cfg(unix)]
#[test]
fn invariant_executable_bits_are_canonicalised_on_unix() {
    use std::os::unix::fs::PermissionsExt;

    let fixture = TempDir::new().expect("fixture directory should exist");
    let source = fixture.path().join("source");
    let executable = source.join("tools/run.sh");
    let regular = source.join("plugin.cfg");
    write(&executable, "#!/bin/sh\n");
    write(&regular, "[plugin]\n");
    fs::set_permissions(&executable, fs::Permissions::from_mode(0o710))
        .expect("executable fixture permissions should change");
    fs::set_permissions(&regular, fs::Permissions::from_mode(0o600))
        .expect("regular fixture permissions should change");

    let tree =
        prepare_package_tree(&source, &fixture.path().join("stage")).expect("tree should prepare");

    assert!(
        tree.files()
            .iter()
            .any(|file| file.path() == Path::new("tools/run.sh") && file.executable())
    );
    assert_eq!(
        fs::metadata(tree.root().join("tools/run.sh"))
            .expect("output metadata")
            .permissions()
            .mode()
            & 0o777,
        0o755
    );
    assert_eq!(
        fs::metadata(tree.root().join("plugin.cfg"))
            .expect("output metadata")
            .permissions()
            .mode()
            & 0o777,
        0o644
    );
}

#[cfg(unix)]
#[test]
fn invariant_unsafe_source_entries_fail_before_staging_is_created() {
    use std::os::unix::fs::symlink;

    let fixture = TempDir::new().expect("fixture directory should exist");
    let source = fixture.path().join("source");
    let staging = fixture.path().join("stage");
    write(&source.join("plugin.cfg"), "[plugin]\n");
    symlink("plugin.cfg", source.join("linked.cfg")).expect("fixture symlink should exist");

    let error = prepare_package_tree(&source, &staging).expect_err("symlink should fail");

    assert_eq!(
        error.code(),
        wukong_core::diagnostic::ErrorCode::SourceAccess
    );
    assert!(!staging.exists());
}

#[cfg(not(unix))]
#[test]
fn invariant_non_unix_output_records_no_executable_bit() {
    let fixture = TempDir::new().expect("fixture directory should exist");
    let source = fixture.path().join("source");
    write(&source.join("tool"), "tool\n");

    let tree =
        prepare_package_tree(&source, &fixture.path().join("stage")).expect("tree should prepare");

    assert!(tree.files().iter().all(|file| !file.executable()));
}

fn write(path: &Path, contents: &str) {
    fs::create_dir_all(path.parent().expect("fixture file should have a parent"))
        .expect("fixture directory should exist");
    fs::write(path, contents).expect("fixture file should write");
}

fn paths(tree: &wukong_core::package_tree::PreparedPackageTree) -> Vec<&Path> {
    tree.files()
        .iter()
        .map(wukong_core::package_tree::PreparedPackageFile::path)
        .collect()
}
