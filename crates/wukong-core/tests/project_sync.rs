use std::{collections::BTreeSet, fs, path::Path};
use tempfile::TempDir;
use wukong_core::{
    identity::PackageName,
    installed_state::{
        DependencyGroup, InstalledPackage, InstalledState, STATE_DIRECTORY_NAME, state_path,
    },
    materialization::MaterializationPreference,
    ownership::{PackageMaterialization, build_desired_file_map},
    package_tree::prepare_package_tree,
    project_sync::{sync_project, sync_project_with_preference},
    source::ImmutableSourceId,
};

#[test]
fn invariant_fresh_sync_is_idempotent_and_writes_state_last() {
    let fixture = Fixture::new();
    let input = fixture.package("first");
    let desired = input.desired();

    let first = sync_project(
        fixture.project(),
        groups(),
        [input.package.clone()],
        &desired,
    )
    .expect("fresh sync should work");
    let state = fs::read(state_path(fixture.project())).expect("state should be written");
    let second = sync_project(fixture.project(), groups(), [input.package], &desired)
        .expect("repeat sync should work");

    assert_eq!(first.written, 1);
    assert_eq!(second.written, 0);
    assert_eq!(second.unchanged, 1);
    assert_eq!(
        fs::read(state_path(fixture.project())).expect("state should remain"),
        state
    );
    assert_eq!(
        fs::read_to_string(fixture.project().join("addons/alpha/plugin.gd"))
            .expect("file should exist"),
        "first"
    );
}

#[test]
fn invariant_removal_never_deletes_a_user_modified_prior_owned_file() {
    let fixture = Fixture::new();
    let input = fixture.package("first");
    let desired = input.desired();
    sync_project(fixture.project(), groups(), [input.package], &desired).expect("sync should work");
    let path = fixture.project().join("addons/alpha/plugin.gd");
    fs::write(&path, "user edit").expect("user edit should write");

    let result = sync_project(
        fixture.project(),
        groups(),
        [],
        &wukong_core::ownership::DesiredFileMap::default(),
    )
    .expect("removal sync should work");

    assert_eq!(result.removed, 0);
    assert_eq!(
        fs::read_to_string(path).expect("user file should remain"),
        "user edit"
    );
    let state = InstalledState::parse(
        &state_path(fixture.project()),
        &fs::read_to_string(state_path(fixture.project())).expect("state should read"),
    )
    .expect("state should parse");
    assert!(state.files().is_empty());
}

#[test]
fn invariant_sync_refuses_to_overwrite_a_user_modified_prior_owned_file() {
    let fixture = Fixture::new();
    let input = fixture.package("first");
    let desired = input.desired();
    sync_project(
        fixture.project(),
        groups(),
        [input.package.clone()],
        &desired,
    )
    .expect("initial sync should work");
    let path = fixture.project().join("addons/alpha/plugin.gd");
    fs::write(&path, "user edit").expect("user edit should write");

    assert!(sync_project(fixture.project(), groups(), [input.package], &desired).is_err());
    assert_eq!(
        fs::read_to_string(path).expect("user file should remain"),
        "user edit"
    );
}

#[test]
fn invariant_sync_removes_an_unmodified_prior_owned_file() {
    let fixture = Fixture::new();
    let input = fixture.package("first");
    let desired = input.desired();
    sync_project(fixture.project(), groups(), [input.package], &desired)
        .expect("initial sync should work");

    let result = sync_project(
        fixture.project(),
        groups(),
        [],
        &wukong_core::ownership::DesiredFileMap::default(),
    )
    .expect("removal sync should work");

    assert_eq!(result.removed, 1);
    assert!(!fixture.project().join("addons/alpha/plugin.gd").exists());
}

#[test]
fn invariant_commit_failure_rolls_back_staged_project_files() {
    let fixture = Fixture::new();
    let input = fixture.package("first");
    let desired = input.desired();
    fs::write(fixture.project().join(STATE_DIRECTORY_NAME), "conflict")
        .expect("conflict should write");

    assert!(sync_project(fixture.project(), groups(), [input.package], &desired).is_err());
    assert!(!fixture.project().join("addons/alpha/plugin.gd").exists());
    assert_eq!(
        fs::read_to_string(fixture.project().join(STATE_DIRECTORY_NAME))
            .expect("conflict should remain"),
        "conflict"
    );
}

#[test]
fn invariant_sync_records_an_explicit_materialisation_override() {
    let fixture = Fixture::new();
    let input = fixture.package("first");
    let desired = input.desired();

    sync_project_with_preference(
        fixture.project(),
        groups(),
        [input.package],
        &desired,
        MaterializationPreference::Copy,
    )
    .expect("copy override should sync");
    let state = InstalledState::parse(
        &state_path(fixture.project()),
        &fs::read_to_string(state_path(fixture.project())).expect("state should read"),
    )
    .expect("state should parse");

    assert!(state.files().values().all(|file| {
        file.materialization() == wukong_core::installed_state::MaterializationStrategy::Copy
    }));
}

fn groups() -> BTreeSet<DependencyGroup> {
    BTreeSet::from([DependencyGroup::Dependencies])
}

struct Fixture {
    directory: TempDir,
    project: std::path::PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let directory = TempDir::new().expect("fixture should exist");
        let project = directory.path().join("project");
        fs::create_dir(&project).expect("project should create");
        Self { directory, project }
    }
    fn project(&self) -> &Path {
        &self.project
    }
    fn package(&self, content: &str) -> PackageFixture {
        let source = self.directory.path().join("source");
        fs::create_dir_all(&source).expect("source should create");
        fs::write(source.join("plugin.gd"), content).expect("source should write");
        let tree = prepare_package_tree(&source, &self.directory.path().join("prepared"))
            .expect("tree should prepare");
        let name = PackageName::parse("alpha").expect("name should parse");
        let package = InstalledPackage::new(
            name.clone(),
            ImmutableSourceId::new(format!("sha256:{}", tree.sha256()))
                .expect("source should parse"),
            tree.sha256().to_owned(),
        )
        .expect("package should parse");
        PackageFixture {
            name,
            tree,
            package,
        }
    }
}

struct PackageFixture {
    name: PackageName,
    tree: wukong_core::package_tree::PreparedPackageTree,
    package: InstalledPackage,
}
impl PackageFixture {
    fn desired(&self) -> wukong_core::ownership::DesiredFileMap {
        build_desired_file_map([PackageMaterialization::new(
            &self.name,
            &self.tree,
            Path::new("addons/alpha"),
        )])
        .expect("desired map should build")
    }
}
