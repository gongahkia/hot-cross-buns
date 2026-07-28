mod support;

use std::{
    collections::BTreeSet,
    fs,
    path::{Path, PathBuf},
};
use tempfile::TempDir;
use wukong_core::{
    cache::CacheLayout,
    diagnostic::ErrorCode,
    direct_lock::lock_direct_local_dependencies,
    direct_sync::{sync_direct_dependencies, sync_direct_local_dependencies},
    identity::PackageName,
    lockfile::{GodotCompatibility, LockedGitSource, LockedHttpSource, LockedPackage, Lockfile},
    manifest::Manifest,
    source::ImmutableSourceId,
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
