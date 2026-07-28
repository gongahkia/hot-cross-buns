use std::{
    fs,
    path::{Path, PathBuf},
};
use tempfile::TempDir;
use wukong_core::{
    direct_lock::lock_direct_local_dependencies, direct_sync::sync_direct_local_dependencies,
    manifest::Manifest,
};

#[test]
fn invariant_direct_sync_follows_the_lockfile_and_is_idempotent() {
    let fixture = Fixture::new();
    fixture.addon("addon", "first");
    let manifest = fixture.manifest("[dependencies]\naddon = { path = \"addon\" }\n");
    let lock = lock(&fixture, &manifest);

    let first = sync(&fixture, &manifest, &lock, false).expect("fresh sync should work");
    let second = sync(&fixture, &manifest, &lock, false).expect("repeat sync should work");

    assert_eq!(first.written, 1);
    assert_eq!(second.written, 0);
    assert_eq!(second.unchanged, 1);
    assert_eq!(
        fs::read_to_string(fixture.project().join("addons/addon/plugin.gd"))
            .expect("locked file should materialise"),
        "first"
    );
}

#[test]
fn invariant_direct_sync_rejects_changed_locked_content_before_project_mutation() {
    let fixture = Fixture::new();
    let addon = fixture.addon("addon", "first");
    let manifest = fixture.manifest("[dependencies]\naddon = { path = \"addon\" }\n");
    let lock = lock(&fixture, &manifest);
    fs::write(addon.join("plugin.gd"), "changed").expect("source should change");

    assert!(sync(&fixture, &manifest, &lock, false).is_err());
    assert!(!fixture.project().join("addons").exists());
    assert!(!fixture.project().join(".wukong/state.toml").exists());
}

#[test]
fn invariant_direct_sync_selects_development_dependencies_only_with_dev_enabled() {
    let fixture = Fixture::new();
    fixture.addon("runtime", "runtime");
    fixture.addon("development", "development");
    let manifest = fixture.manifest(
        "[dependencies]\nruntime = { path = \"runtime\" }\n\n[dev-dependencies]\ndevelopment = { path = \"development\" }\n",
    );
    let lock = lock(&fixture, &manifest);

    sync(&fixture, &manifest, &lock, false).expect("runtime sync should work");

    assert!(fixture.project().join("addons/runtime/plugin.gd").is_file());
    assert!(
        !fixture
            .project()
            .join("addons/development/plugin.gd")
            .exists()
    );
    sync(&fixture, &manifest, &lock, true).expect("development sync should work");
    assert!(
        fixture
            .project()
            .join("addons/development/plugin.gd")
            .is_file()
    );
}

fn lock(fixture: &Fixture, manifest: &Manifest) -> wukong_core::lockfile::Lockfile {
    lock_direct_local_dependencies(fixture.manifest_path(), manifest, None)
        .expect("local dependencies should lock")
}

fn sync(
    fixture: &Fixture,
    manifest: &Manifest,
    lock: &wukong_core::lockfile::Lockfile,
    include_dev: bool,
) -> Result<wukong_core::project_sync::SyncSummary, Box<wukong_core::diagnostic::Diagnostic>> {
    sync_direct_local_dependencies(
        fixture.project(),
        fixture.manifest_path(),
        manifest,
        lock,
        include_dev,
    )
}

struct Fixture {
    _directory: TempDir,
    project: PathBuf,
    manifest_path: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let directory = TempDir::new().expect("fixture directory should exist");
        let project = directory.path().join("project");
        fs::create_dir(&project).expect("project should create");
        let manifest_path = project.join("wukong.toml");
        Self {
            _directory: directory,
            project,
            manifest_path,
        }
    }
    fn project(&self) -> &Path {
        &self.project
    }
    fn manifest_path(&self) -> &Path {
        &self.manifest_path
    }
    fn manifest(&self, dependencies: &str) -> Manifest {
        Manifest::parse(
            &self.manifest_path,
            &format!("[project]\nname = \"fixture\"\ngodot = \"4\"\n\n{dependencies}"),
        )
        .expect("fixture manifest should parse")
    }
    fn addon(&self, name: &str, content: &str) -> PathBuf {
        let addon = self.project.join(name);
        fs::create_dir(&addon).expect("addon should create");
        fs::write(addon.join("plugin.gd"), content).expect("addon should write");
        addon
    }
}
