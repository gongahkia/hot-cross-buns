use sha2::{Digest, Sha256};
use std::{collections::BTreeSet, fs, path::Path};
use tempfile::TempDir;
use wukong_core::{
    identity::PackageName,
    installed_state::{
        DependencyGroup, InstalledPackage, InstalledState, MaterializationStrategy, OwnedFile,
        STATE_DIRECTORY_NAME, STATE_FILE_NAME, create_state_directory, state_path,
        verify_installed_state,
    },
    source::ImmutableSourceId,
};

#[test]
fn invariant_installed_state_serializes_identity_ownership_hashes_and_groups_deterministically() {
    let first = state(["zeta", "alpha"]);
    let second = state(["alpha", "zeta"]);
    let output = first.to_toml();

    assert_eq!(output, second.to_toml());
    assert!(output.contains("groups = [\"dependencies\", \"dev-dependencies\"]"));
    assert!(output.find("name = \"alpha\"") < output.find("name = \"zeta\""));
    assert!(output.contains("path = \"addons/alpha/plugin.gd\""));
    assert!(output.contains("materialization = \"copy\""));
    assert_eq!(
        InstalledState::parse(Path::new("fixture/.wukong/state.toml"), &output)
            .expect("serialized state should parse"),
        first
    );
}

#[test]
fn invariant_state_rejects_unsafe_paths_unknown_owners_and_unknown_fields() {
    let package = package("alpha", 1);
    assert!(
        OwnedFile::new(
            "../outside.gd",
            BTreeSet::from([PackageName::parse("alpha").expect("name should parse")]),
            hash(1),
            MaterializationStrategy::Copy,
        )
        .is_err()
    );
    let file = OwnedFile::new(
        "addons/alpha/plugin.gd",
        BTreeSet::from([PackageName::parse("other").expect("name should parse")]),
        hash(1),
        MaterializationStrategy::Copy,
    )
    .expect("file should parse");
    assert!(InstalledState::new(BTreeSet::new(), [package], [file]).is_err());
    assert!(
        InstalledState::parse(
            Path::new("fixture/.wukong/state.toml"),
            "schema = 1\ngroups = []\nx-unknown = \"no\"\n"
        )
        .is_err()
    );
}

#[test]
fn invariant_state_retains_all_identical_file_owners() {
    let alpha = package("alpha", 0);
    let beta = package("beta", 1);
    let state = InstalledState::new(
        BTreeSet::new(),
        [alpha, beta],
        [OwnedFile::new(
            "addons/shared/plugin.gd",
            BTreeSet::from([
                PackageName::parse("alpha").expect("name should parse"),
                PackageName::parse("beta").expect("name should parse"),
            ]),
            hash(0),
            MaterializationStrategy::Copy,
        )
        .expect("file should parse")],
    )
    .expect("state should parse");

    let output = state.to_toml();
    assert!(output.contains("packages = [\"alpha\", \"beta\"]"));
    assert_eq!(
        InstalledState::parse(Path::new("fixture/.wukong/state.toml"), &output)
            .expect("state should parse"),
        state
    );
}

#[test]
fn invariant_state_directory_creation_never_overwrites_a_non_directory() {
    let fixture = TempDir::new().expect("fixture directory should exist");
    let state = create_state_directory(fixture.path()).expect("state directory should create");

    assert_eq!(state, fixture.path().join(STATE_DIRECTORY_NAME));
    assert_eq!(state_path(fixture.path()), state.join(STATE_FILE_NAME));
    assert!(state.is_dir());

    let conflict = TempDir::new().expect("conflict fixture should exist");
    fs::write(
        conflict.path().join(STATE_DIRECTORY_NAME),
        "not a directory\n",
    )
    .expect("conflict should write");
    assert!(create_state_directory(conflict.path()).is_err());
}

#[test]
fn invariant_state_verification_reports_matching_missing_and_modified_files() {
    let fixture = TempDir::new().expect("fixture directory should exist");
    let path = fixture.path().join("addons/alpha/plugin.gd");
    fs::create_dir_all(path.parent().expect("file should have a parent"))
        .expect("file parent should create");
    fs::write(&path, "first").expect("file should write");
    let state = InstalledState::new(
        BTreeSet::new(),
        [package("alpha", 0)],
        [OwnedFile::new(
            "addons/alpha/plugin.gd",
            BTreeSet::from([PackageName::parse("alpha").expect("name should parse")]),
            sha256("first"),
            MaterializationStrategy::Copy,
        )
        .expect("owned file should parse")],
    )
    .expect("state should parse");

    let matching = verify_installed_state(fixture.path(), &state).expect("state should verify");
    fs::write(&path, "modified").expect("file should modify");
    let modified = verify_installed_state(fixture.path(), &state).expect("state should verify");
    fs::remove_file(&path).expect("file should remove");
    let missing = verify_installed_state(fixture.path(), &state).expect("state should verify");

    assert_eq!(
        (
            matching.verified_files(),
            matching.missing_files(),
            matching.modified_files()
        ),
        (1, 0, 0)
    );
    assert_eq!(
        (
            modified.verified_files(),
            modified.missing_files(),
            modified.modified_files()
        ),
        (0, 0, 1)
    );
    assert_eq!(
        (
            missing.verified_files(),
            missing.missing_files(),
            missing.modified_files()
        ),
        (0, 1, 0)
    );
}

fn state(names: impl IntoIterator<Item = &'static str>) -> InstalledState {
    let packages = names
        .into_iter()
        .map(|name| package(name, usize::from(name != "alpha")));
    let files = [OwnedFile::new(
        "addons/alpha/plugin.gd",
        BTreeSet::from([PackageName::parse("alpha").expect("name should parse")]),
        hash(0),
        MaterializationStrategy::Copy,
    )
    .expect("file should parse")];
    InstalledState::new(
        [
            DependencyGroup::Dependencies,
            DependencyGroup::DevDependencies,
        ]
        .into_iter()
        .collect(),
        packages,
        files,
    )
    .expect("state should parse")
}

fn package(name: &str, index: usize) -> InstalledPackage {
    InstalledPackage::new(
        PackageName::parse(name).expect("name should parse"),
        ImmutableSourceId::new(format!("sha256:{}", hash(index))).expect("identity should parse"),
        hash(index),
    )
    .expect("package should parse")
}

fn hash(index: usize) -> String {
    format!("{index:064x}")
}

fn sha256(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}
