mod support;

use std::{
    cell::RefCell,
    collections::BTreeSet,
    fs,
    path::{Path, PathBuf},
};
use tempfile::TempDir;
use wukong_core::{
    cache::CacheLayout,
    diagnostic::ErrorCode,
    direct_lock::{lock_direct_dependencies, lock_direct_local_dependencies},
    direct_sync::{
        SyncProgress, SyncProgressObserver, SyncProgressStage, sync_direct_dependencies,
        sync_direct_dependencies_with_cancellation,
        sync_direct_dependencies_with_progress_and_cancellation, sync_direct_local_dependencies,
    },
    identity::PackageName,
    lockfile::{GodotCompatibility, LockedGitSource, LockedHttpSource, LockedPackage, Lockfile},
    manifest::Manifest,
    operation_lock::AdvisoryLock,
    source::{CancellationToken, ImmutableSourceId},
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
fn invariant_direct_sync_reports_deterministic_package_progress() {
    let fixture = Fixture::new();
    fixture.addon("addon", "first");
    let manifest = fixture.manifest("[dependencies]\naddon = { path = \"addon\" }\n");
    let lock = lock(&fixture, &manifest);
    let cache = CacheLayout::for_root(fixture.project().join("cache"))
        .expect("cache layout should be valid");
    let events = ProgressRecorder::default();
    let cancellation = CancellationToken::new();

    sync_direct_dependencies_with_progress_and_cancellation(
        fixture.project(),
        fixture.manifest_path(),
        &manifest,
        &lock,
        false,
        &cache,
        true,
        &cancellation,
        &events,
    )
    .expect("sync should work");

    assert_eq!(
        events.events.into_inner(),
        vec![
            (
                "addon".to_owned(),
                0,
                1,
                SyncProgressStage::ValidatingSource
            ),
            (
                "addon".to_owned(),
                0,
                1,
                SyncProgressStage::PreparingPackage
            ),
            ("addon".to_owned(), 1, 1, SyncProgressStage::Prepared),
        ]
    );
}

#[test]
fn invariant_direct_sync_uses_a_verified_source_tree_when_cache_object_is_busy() {
    let fixture = Fixture::new();
    fixture.addon("addon", "first");
    let manifest = fixture.manifest("[dependencies]\naddon = { path = \"addon\" }\n");
    let cache = CacheLayout::for_root(fixture.project().join("cache"))
        .expect("cache layout should be valid");
    let lock = lock_direct_dependencies(fixture.manifest_path(), &manifest, None, &cache, true)
        .expect("local package should lock");
    let package = lock.packages().get("addon").expect("package should lock");
    let held = AdvisoryLock::try_acquire(
        &cache
            .object_lock(package.package_sha256())
            .expect("cache object lock should derive"),
        "fixture cache object",
    )
    .expect("fixture lock should acquire");

    let summary = sync_direct_dependencies(
        fixture.project(),
        fixture.manifest_path(),
        &manifest,
        &lock,
        false,
        &cache,
        true,
    )
    .expect("busy cache object should not block a verified source sync");

    assert_eq!(summary.written, 1);
    assert!(fixture.project().join("addons/addon/plugin.gd").is_file());
    drop(held);
}

#[test]
fn invariant_multi_addon_source_layout_overrides_lock_and_sync_each_selected_tree() {
    let fixture = Fixture::new();
    let source = fixture.project().join("multi-addon-source/addons");
    fs::create_dir_all(source.join("alpha")).expect("alpha source should create");
    fs::create_dir_all(source.join("beta")).expect("beta source should create");
    fs::write(source.join("alpha/plugin.gd"), "alpha").expect("alpha source should write");
    fs::write(source.join("beta/plugin.gd"), "beta").expect("beta source should write");
    let manifest = fixture.manifest(
        "[dependencies]\nalpha = { path = \"multi-addon-source\", root = \"addons/alpha\", target = \"addons/alpha\" }\nbeta = { path = \"multi-addon-source\", root = \"addons/beta\", target = \"addons/beta\" }\n",
    );
    let lock = lock(&fixture, &manifest);

    assert_eq!(
        lock.packages()
            .get("alpha")
            .expect("alpha should lock")
            .source_subdirectory(),
        Path::new("addons/alpha")
    );
    assert_eq!(
        lock.packages()
            .get("beta")
            .expect("beta should lock")
            .source_subdirectory(),
        Path::new("addons/beta")
    );
    sync(&fixture, &manifest, &lock, false).expect("selected trees should sync");
    let noop = sync(&fixture, &manifest, &lock, false).expect("repeat sync should work");

    assert_eq!(noop.written, 0);
    assert_eq!(
        fs::read_to_string(fixture.project().join("addons/alpha/plugin.gd"))
            .expect("alpha should materialise"),
        "alpha"
    );
    assert_eq!(
        fs::read_to_string(fixture.project().join("addons/beta/plugin.gd"))
            .expect("beta should materialise"),
        "beta"
    );
}

#[test]
fn invariant_native_extension_files_materialise_as_opaque_package_content() {
    let fixture = Fixture::new();
    let native = fixture.addon("native", "extends Node\n");
    fs::create_dir_all(native.join("bin")).expect("native binary directory should create");
    fs::write(
        native.join("native.gdextension"),
        "[configuration]\nentry_symbol = \"native_library_init\"\n",
    )
    .expect("native extension descriptor should write");
    fs::write(native.join("bin/native.macos.debug"), [0_u8, 1, 2, 3])
        .expect("native binary fixture should write");
    let manifest = fixture.manifest("[dependencies]\nnative = { path = \"native\" }\n");
    let lock = lock(&fixture, &manifest);

    sync(&fixture, &manifest, &lock, false).expect("native package should sync");

    assert!(
        fixture
            .project()
            .join("addons/native/native.gdextension")
            .is_file()
    );
    assert_eq!(
        fs::read(
            fixture
                .project()
                .join("addons/native/bin/native.macos.debug")
        )
        .expect("native binary should materialise"),
        [0_u8, 1, 2, 3]
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
fn invariant_cancelled_sync_leaves_project_unmodified() {
    let fixture = Fixture::new();
    fixture.addon("addon", "first");
    let manifest = fixture.manifest("[dependencies]\naddon = { path = \"addon\" }\n");
    let lock = lock(&fixture, &manifest);
    let cache = CacheLayout::for_root(fixture.project().join("cache"))
        .expect("cache layout should be valid");
    let cancellation = CancellationToken::new();
    cancellation.cancel();

    let error = sync_direct_dependencies_with_cancellation(
        fixture.project(),
        fixture.manifest_path(),
        &manifest,
        &lock,
        false,
        &cache,
        true,
        &cancellation,
    )
    .expect_err("cancelled sync should fail");

    assert_eq!(error.code(), ErrorCode::SourceAccess);
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

#[test]
fn invariant_offline_sync_reports_every_missing_remote_cache_object_before_mutation() {
    let fixture = Fixture::new();
    let git_commit = "1".repeat(40);
    let archive_sha256 = "2".repeat(64);
    let manifest = fixture.manifest(&format!(
        "[dependencies]\ngit-addon = {{ git = \"https://fixture.test/git-addon.git\", rev = \"{git_commit}\" }}\nhttp-addon = {{ url = \"https://fixture.test/http-addon.zip\", sha256 = \"{archive_sha256}\" }}\n"
    ));
    let lock = Lockfile::new([
        locked_package(
            "git-addon",
            LockedGitSource::new(
                ImmutableSourceId::new(format!("git:{git_commit}"))
                    .expect("Git identity should be valid"),
                "https://fixture.test/git-addon.git",
                git_commit.clone(),
            )
            .expect("Git source should be valid")
            .into(),
        ),
        locked_package(
            "http-addon",
            LockedHttpSource::new(
                ImmutableSourceId::new(format!("sha256:{archive_sha256}"))
                    .expect("HTTP identity should be valid"),
                "https://fixture.test/http-addon.zip",
                archive_sha256.clone(),
            )
            .expect("HTTP source should be valid")
            .into(),
        ),
    ])
    .expect("lock should be valid");
    let cache = CacheLayout::for_root(fixture.project().join("cache"))
        .expect("cache layout should be valid");

    let error = sync_direct_dependencies(
        fixture.project(),
        fixture.manifest_path(),
        &manifest,
        &lock,
        false,
        &cache,
        true,
    )
    .expect_err("offline sync should report unavailable artifacts");

    assert_eq!(error.code(), ErrorCode::SourceAccess);
    assert!(
        error
            .message()
            .contains(&format!("git-addon (Git checkout {git_commit})"))
    );
    assert!(error.message().contains(&format!(
        "http-addon (HTTPS archive sha256:{archive_sha256})"
    )));
    assert!(!fixture.project().join("addons").exists());
    assert!(!fixture.project().join(".wukong/state.toml").exists());
}

#[test]
fn invariant_direct_http_source_satisfies_the_shared_checksum_artifact_contract() {
    let checksum = "2".repeat(64);
    let source = LockedHttpSource::new(
        ImmutableSourceId::new(format!("sha256:{checksum}")).expect("identity should be valid"),
        "https://fixture.test/http-addon.zip",
        checksum,
    )
    .expect("HTTP source should be valid");

    support::http_artifact_contract::assert_checksum_locked_http_contract(&source);
}

fn locked_package(name: &str, source: wukong_core::lockfile::LockedSource) -> LockedPackage {
    LockedPackage::new(
        PackageName::parse(name).expect("package name should be valid"),
        None,
        source,
        "3".repeat(64),
        "4".repeat(64),
        BTreeSet::new(),
        PathBuf::from("."),
        PathBuf::from(format!("addons/{name}")),
        GodotCompatibility::Unknown,
        false,
    )
    .expect("locked package should be valid")
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

#[derive(Default)]
struct ProgressRecorder {
    events: RefCell<Vec<(String, usize, usize, SyncProgressStage)>>,
}
impl SyncProgressObserver for ProgressRecorder {
    fn report(&self, progress: &SyncProgress) {
        self.events.borrow_mut().push((
            progress.package().as_str().to_owned(),
            progress.completed(),
            progress.total(),
            progress.stage(),
        ));
    }
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
