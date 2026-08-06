use sha2::{Digest, Sha256};
use std::{collections::BTreeSet, fs, path::Path};
use tempfile::TempDir;
use wukong_core::{
    identity::PackageName,
    installed_state::{DependencyGroup, InstalledPackage, InstalledState, state_path},
    operation_lock::AdvisoryLock,
    ownership::{PackageMaterialization, build_desired_file_map},
    package_tree::{PreparedPackageTree, prepare_package_tree},
    project_sync::sync_project,
    source::ImmutableSourceId,
};

#[test]
fn invariant_native_fixture_recovers_interrupted_transaction_and_preserves_unicode_content() {
    let fixture = Fixture::new();
    let transaction = fixture.project().join(".wukong/.transaction");
    let output = fixture.project().join("addons/alpha/plugin.gd");
    fs::create_dir_all(output.parent().expect("output parent should exist"))
        .expect("output parent should create");
    fs::write(&output, "interrupted output").expect("interrupted output should write");
    let rollback = transaction.join("rollback/addons/alpha/plugin.gd");
    fs::create_dir_all(rollback.parent().expect("rollback parent should exist"))
        .expect("rollback parent should create");
    fs::write(&rollback, "prior owned content").expect("rollback content should write");
    fs::write(
        transaction.join("journal"),
        format!(
            "v2\nmoved addons/alpha/plugin.gd\nwritten {} addons/alpha/plugin.gd\n",
            sha256("interrupted output")
        ),
    )
    .expect("journal should write");
    let unicode = fixture.project().join("notes-東京.txt");
    fs::write(&unicode, "user content").expect("unicode file should write");

    sync_project(
        fixture.project(),
        groups(),
        [],
        &wukong_core::ownership::DesiredFileMap::default(),
    )
    .expect("interrupted transaction should recover before native sync");

    assert!(!transaction.exists());
    assert_eq!(
        fs::read_to_string(unicode).expect("unicode file should remain"),
        "user content"
    );
    assert_eq!(
        fs::read_to_string(output).expect("prior file should restore"),
        "prior owned content"
    );
    assert!(
        InstalledState::parse(
            &state_path(fixture.project()),
            &fs::read_to_string(state_path(fixture.project())).expect("state should read"),
        )
        .is_ok()
    );
}

fn sha256(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}

#[test]
fn invariant_native_fixture_conflicts_and_safe_removal_preserve_final_project_integrity() {
    let fixture = Fixture::new();
    let package = fixture.package("alpha", "first");
    let target = fixture.project().join("addons/alpha/plugin.gd");
    fs::create_dir_all(target.parent().expect("target parent should exist"))
        .expect("target parent should create");
    fs::write(&target, "project-owned").expect("project file should write");

    assert!(
        sync_project(
            fixture.project(),
            groups(),
            [package.installed.clone()],
            &package.desired()
        )
        .is_err()
    );
    assert_eq!(
        fs::read_to_string(&target).expect("project file should remain"),
        "project-owned"
    );
    assert!(!state_path(fixture.project()).exists());

    fs::remove_file(&target).expect("conflicting file should remove for fixture setup");
    let desired = package.desired();
    sync_project(fixture.project(), groups(), [package.installed], &desired)
        .expect("native sync should work");
    fs::write(&target, "user edit").expect("installed file should change");
    sync_project(
        fixture.project(),
        groups(),
        [],
        &wukong_core::ownership::DesiredFileMap::default(),
    )
    .expect("safe removal should work");

    assert_eq!(
        fs::read_to_string(target).expect("user edit should remain"),
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
fn invariant_native_fixture_detects_portable_case_conflicts_and_mutation_lock_contention() {
    let fixture = Fixture::new();
    let alpha = fixture.package("alpha", "alpha");
    let beta = fixture.package("beta", "beta");
    let conflict = build_desired_file_map([
        PackageMaterialization::new(&alpha.name, &alpha.tree, Path::new("addons/Alpha")),
        PackageMaterialization::new(&beta.name, &beta.tree, Path::new("addons/alpha")),
    ]);
    assert!(conflict.is_err());
    assert!(!fixture.project().join("addons").exists());

    let lock = AdvisoryLock::try_acquire(
        &fixture.project().join(".wukong/mutation.lock"),
        "native fixture project",
    )
    .expect("fixture mutation lock should acquire");
    assert!(
        sync_project(
            fixture.project(),
            groups(),
            [alpha.installed.clone()],
            &alpha.desired()
        )
        .is_err()
    );
    assert!(!state_path(fixture.project()).exists());
    drop(lock);
    let desired = alpha.desired();
    sync_project(fixture.project(), groups(), [alpha.installed], &desired)
        .expect("sync should recover after lock release");
    assert_eq!(fixture.installed("alpha"), "alpha");
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
        let directory = TempDir::new().expect("fixture should create");
        let project = directory.path().join("project");
        fs::create_dir(&project).expect("project should create");
        Self { directory, project }
    }

    fn project(&self) -> &Path {
        &self.project
    }

    fn package(&self, name: &str, content: &str) -> PackageFixture {
        let source = self.directory.path().join(format!("source-{name}"));
        fs::create_dir(&source).expect("source should create");
        fs::write(source.join("plugin.gd"), content).expect("source should write");
        let tree = prepare_package_tree(
            &source,
            &self.directory.path().join(format!("prepared-{name}")),
        )
        .expect("source tree should prepare");
        let name = PackageName::parse(name).expect("package name should parse");
        let installed = InstalledPackage::new(
            name.clone(),
            ImmutableSourceId::new(format!("sha256:{}", tree.sha256()))
                .expect("identity should parse"),
            tree.sha256().to_owned(),
        )
        .expect("installed package should build");
        PackageFixture {
            name,
            tree,
            installed,
        }
    }

    fn installed(&self, name: &str) -> String {
        fs::read_to_string(self.project().join("addons").join(name).join("plugin.gd"))
            .expect("installed content should read")
    }
}

struct PackageFixture {
    name: PackageName,
    tree: PreparedPackageTree,
    installed: InstalledPackage,
}

impl PackageFixture {
    fn desired(&self) -> wukong_core::ownership::DesiredFileMap {
        build_desired_file_map([PackageMaterialization::new(
            &self.name,
            &self.tree,
            Path::new(&format!("addons/{}", self.name)),
        )])
        .expect("desired map should build")
    }
}
