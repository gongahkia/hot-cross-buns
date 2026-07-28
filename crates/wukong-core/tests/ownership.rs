use std::{collections::BTreeSet, fs, path::Path};
use tempfile::TempDir;
use wukong_core::{
    identity::PackageName,
    ownership::{PackageMaterialization, build_desired_file_map, validate_project_file_conflicts},
    package_tree::prepare_package_tree,
};

#[test]
fn invariant_identical_package_claims_share_one_deterministic_owner_entry() {
    let fixture = TempDir::new().expect("fixture should exist");
    let first = tree(&fixture, "first", "same");
    let second = tree(&fixture, "second", "same");
    let alpha = name("alpha");
    let beta = name("beta");

    let map = build_desired_file_map([
        PackageMaterialization::new(&beta, &second, Path::new("addons/shared")),
        PackageMaterialization::new(&alpha, &first, Path::new("addons/shared")),
    ])
    .expect("identical files should share ownership");

    let file = map
        .files()
        .get(Path::new("addons/shared/plugin.gd"))
        .expect("shared file should exist");
    assert_eq!(file.owners(), &BTreeSet::from([alpha, beta]));
    assert_eq!(file.sha256(), first.files()[0].sha256());
}

#[test]
fn invariant_incompatible_and_case_folded_package_paths_fail_before_mutation() {
    let fixture = TempDir::new().expect("fixture should exist");
    let first = tree(&fixture, "first", "one");
    let second = tree(&fixture, "second", "two");
    let alpha = name("alpha");
    let beta = name("beta");
    let error = build_desired_file_map([
        PackageMaterialization::new(&alpha, &first, Path::new("addons/shared")),
        PackageMaterialization::new(&beta, &second, Path::new("addons/shared")),
    ])
    .expect_err("different content must conflict");
    assert!(error.message().contains("incompatible content"));

    let case_error = build_desired_file_map([
        PackageMaterialization::new(&alpha, &first, Path::new("addons/Shared")),
        PackageMaterialization::new(&beta, &first, Path::new("addons/shared")),
    ])
    .expect_err("case-folded paths must conflict");
    assert!(case_error.message().contains("case-insensitive"));
}

#[test]
fn invariant_unowned_project_files_block_materialisation_but_prior_owned_files_do_not() {
    let fixture = TempDir::new().expect("fixture should exist");
    let source = tree(&fixture, "source", "same");
    let alpha = name("alpha");
    let map = build_desired_file_map([PackageMaterialization::new(
        &alpha,
        &source,
        Path::new("addons/alpha"),
    )])
    .expect("map should build");
    let project = fixture.path().join("project");
    write(&project.join("addons/alpha/plugin.gd"), "user-owned\n");

    assert!(validate_project_file_conflicts(&project, &map, &BTreeSet::new()).is_err());
    assert!(
        validate_project_file_conflicts(
            &project,
            &map,
            &BTreeSet::from(["addons/alpha/plugin.gd".into()]),
        )
        .is_ok()
    );
}

fn tree(
    fixture: &TempDir,
    name: &str,
    contents: &str,
) -> wukong_core::package_tree::PreparedPackageTree {
    let source = fixture.path().join(name);
    write(&source.join("plugin.gd"), contents);
    prepare_package_tree(&source, &fixture.path().join(format!("{name}-prepared")))
        .expect("tree should prepare")
}

fn name(value: &str) -> PackageName {
    PackageName::parse(value).expect("name should parse")
}

fn write(path: &Path, contents: &str) {
    fs::create_dir_all(path.parent().expect("parent should exist")).expect("parent should create");
    fs::write(path, contents).expect("file should write");
}
