use std::{
    fs,
    path::{Path, PathBuf},
};
use tempfile::TempDir;
use wukong_core::{
    cache::{CacheLayout, verify_package_object},
    diagnostic::ErrorCode,
    direct_lock::{
        lock_direct_dependencies, lock_direct_dependencies_with_cancellation,
        update_direct_dependencies,
    },
    direct_sync::sync_direct_dependencies,
    lockfile::{GodotCompatibility, LockedSource},
    manifest::Manifest,
    source::CancellationToken,
};

#[test]
fn invariant_multiple_direct_local_dependencies_produce_a_deterministic_lock() {
    let fixture = Fixture::new();
    fixture.addon("alpha", "alpha");
    fixture.addon("zebra", "zebra");
    let manifest = fixture.manifest(
        "[dev-dependencies]\nzebra = { path = \"zebra\" }\nalpha = { path = \"alpha\" }\n",
    );

    let first = lock(&fixture, &manifest, None);
    let second = lock(&fixture, &manifest, None);

    assert_eq!(first.to_toml(), second.to_toml());
    assert_eq!(
        first
            .packages()
            .keys()
            .map(wukong_core::identity::PackageName::as_str)
            .collect::<Vec<_>>(),
        ["alpha", "zebra"]
    );
    assert!(first.packages().values().all(|package| {
        package
            .source()
            .immutable_id()
            .as_str()
            .starts_with("sha256:")
    }));
    assert!(first.packages().values().all(|package| {
        package.version().is_some() && matches!(package.godot(), GodotCompatibility::Requirement(_))
    }));
}

#[test]
fn invariant_lock_publishes_a_verified_prepared_package_cache_object() {
    let fixture = Fixture::new();
    fixture.addon("addon", "first");
    let manifest = fixture.manifest("[dev-dependencies]\naddon = { path = \"addon\" }\n");
    let cache =
        CacheLayout::for_root(fixture.directory.path().join("cache")).expect("cache should create");

    let lock = lock_direct_dependencies(fixture.manifest_path(), &manifest, None, &cache, true)
        .expect("local package should lock");
    let package = lock.packages().get("addon").expect("package should lock");
    let object = verify_package_object(&cache, package.package_sha256())
        .expect("lock should publish a verified cache object");

    assert_eq!(object.sha256(), package.package_sha256());
    assert_eq!(object.prepared().files().len(), 2);
}

#[test]
fn invariant_missing_metadata_fails_before_cache_or_lock_publication() {
    let fixture = Fixture::new();
    fixture.addon_without_metadata("addon", "first");
    let manifest = fixture.manifest("[dev-dependencies]\naddon = { path = \"addon\" }\n");
    let cache =
        CacheLayout::for_root(fixture.directory.path().join("cache")).expect("cache should create");

    let error = lock_direct_dependencies(fixture.manifest_path(), &manifest, None, &cache, true)
        .expect_err("missing metadata must fail");

    assert_eq!(error.code(), ErrorCode::UserInput);
    assert_eq!(error.package(), Some("addon"));
    assert!(error.message().contains("wukong-package.toml is required"));
    assert!(!cache.packages().exists());
}

#[test]
fn invariant_metadata_name_mismatch_fails_before_cache_or_lock_publication() {
    let fixture = Fixture::new();
    let addon = fixture.addon("addon", "first");
    Fixture::metadata(&addon, "other");
    let manifest = fixture.manifest("[dev-dependencies]\naddon = { path = \"addon\" }\n");
    let cache =
        CacheLayout::for_root(fixture.directory.path().join("cache")).expect("cache should create");

    let error = lock_direct_dependencies(fixture.manifest_path(), &manifest, None, &cache, true)
        .expect_err("metadata name mismatch must fail");

    assert_eq!(error.code(), ErrorCode::IntegrityFailure);
    assert_eq!(error.package(), Some("addon"));
    assert!(
        error
            .message()
            .contains("does not match declared package addon")
    );
    assert!(!cache.packages().exists());
}

#[test]
fn invariant_lock_entry_uses_the_verified_metadata_name_and_version() {
    let fixture = Fixture::new();
    let addon = fixture.addon("addon", "first");
    fs::write(
        addon.join("wukong-package.toml"),
        "[package]\nschema = 1\nname = \"addon\"\nversion = \"2.3.4\"\ngodot = \"4\"\n",
    )
    .expect("metadata should write");
    let manifest = fixture.manifest("[dev-dependencies]\naddon = { path = \"addon\" }\n");

    let lock = lock(&fixture, &manifest, None);
    let package = lock.packages().get("addon").expect("package should lock");

    assert_eq!(package.name().as_str(), "addon");
    assert_eq!(
        package
            .version()
            .expect("verified metadata version should lock")
            .to_string(),
        "2.3.4"
    );
}

#[test]
fn invariant_same_direct_source_cannot_lock_under_incompatible_aliases() {
    let fixture = Fixture::new();
    fixture.addon("shared", "first");
    let manifest = fixture.manifest(
        "[dev-dependencies]\nalpha = { path = \"shared\" }\nbeta = { path = \"shared\" }\n",
    );
    let cache =
        CacheLayout::for_root(fixture.directory.path().join("cache")).expect("cache should create");

    let error = lock_direct_dependencies(fixture.manifest_path(), &manifest, None, &cache, true)
        .expect_err("incompatible alias must fail");

    assert_eq!(error.code(), ErrorCode::IntegrityFailure);
    assert_eq!(error.package(), Some("alpha"));
    assert!(error.message().contains("declared package alpha"));
}

#[test]
fn invariant_multi_addon_repository_locks_each_selected_metadata_identity() {
    let fixture = Fixture::new();
    let source = fixture.directory.path().join("suite/addons");
    fs::create_dir_all(source.join("alpha")).expect("alpha source should create");
    fs::create_dir_all(source.join("beta")).expect("beta source should create");
    fs::write(source.join("alpha/plugin.gd"), "alpha").expect("alpha source should write");
    fs::write(source.join("beta/plugin.gd"), "beta").expect("beta source should write");
    Fixture::metadata(&source.join("alpha"), "alpha");
    Fixture::metadata(&source.join("beta"), "beta");
    let manifest = fixture.manifest(
        "[dev-dependencies]\nalpha = { path = \"suite\", root = \"addons/alpha\", target = \"addons/alpha\" }\nbeta = { path = \"suite\", root = \"addons/beta\", target = \"addons/beta\" }\n",
    );

    let lock = lock(&fixture, &manifest, None);

    assert_eq!(
        lock.packages()
            .keys()
            .map(wukong_core::identity::PackageName::as_str)
            .collect::<Vec<_>>(),
        ["alpha", "beta"]
    );
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
}

#[test]
fn invariant_runtime_local_paths_fail_before_cache_or_lock_publication() {
    let fixture = Fixture::new();
    fixture.addon("addon", "first");
    let cache =
        CacheLayout::for_root(fixture.directory.path().join("cache")).expect("cache should create");

    let error = Manifest::parse(
        fixture.manifest_path(),
        "[project]\nname=\"fixture\"\ngodot=\"4\"\n\n[dependencies]\naddon = { path = \"addon\" }\n",
    )
    .expect_err("runtime local path must be rejected");

    assert_eq!(error.code(), ErrorCode::UserInput);
    assert!(error.message().contains("dependencies.addon"));
    assert!(error.message().contains("only in [dev-dependencies]"));
    assert!(!cache.packages().exists());
}

#[test]
#[ignore = "requires network access to pinned public Git and HTTPS archive sources"]
fn invariant_direct_remote_dependencies_lock_to_immutable_sources_and_reuse_offline() {
    let fixture = Fixture::new();
    let manifest = fixture.manifest(
        "[dependencies]\ngit-addon = { git = \"https://github.com/Goutte/godot-addon-animated-shape-2d.git\", rev = \"4ab90a80b815bc1ad4a8d7eea92c785e654bfd91\" }\nhttp-addon = { url = \"https://github.com/Goutte/godot-addon-animated-shape-2d/archive/4ab90a80b815bc1ad4a8d7eea92c785e654bfd91.zip\", sha256 = \"77c61f3a6ace3a2b9d1729f6d52af90e6c9b6671e1db798cd91dec1ad666e91b\" }\n",
    );
    let cache =
        CacheLayout::for_root(fixture.directory.path().join("cache")).expect("cache should create");

    let first = lock_direct_dependencies(fixture.manifest_path(), &manifest, None, &cache, false)
        .expect("remote dependencies should lock");
    let second = lock_direct_dependencies(
        fixture.manifest_path(),
        &manifest,
        Some(&first),
        &cache,
        true,
    )
    .expect("unchanged lock should reuse without source access");

    assert_eq!(first, second);
    assert!(matches!(
        first
            .packages()
            .get("git-addon")
            .expect("Git package should lock")
            .source(),
        LockedSource::Git(_)
    ));
    assert!(matches!(
        first
            .packages()
            .get("http-addon")
            .expect("HTTP package should lock")
            .source(),
        LockedSource::Http(_)
    ));
    let summary = sync_direct_dependencies(
        fixture.directory.path(),
        fixture.manifest_path(),
        &manifest,
        &first,
        false,
        &cache,
        true,
    )
    .expect("cached remote dependencies should synchronise offline");

    assert!(summary.written > 0);
    assert!(
        fixture
            .directory
            .path()
            .join(".wukong/state.toml")
            .is_file()
    );
}

#[test]
fn invariant_offline_lock_reports_every_missing_remote_cache_object() {
    let fixture = Fixture::new();
    let git_commit = "1".repeat(40);
    let archive_sha256 = "2".repeat(64);
    let manifest = fixture.manifest(&format!(
        "[dev-dependencies]\ngit-addon = {{ git = \"https://fixture.test/git-addon.git\", rev = \"{git_commit}\" }}\nhttp-addon = {{ url = \"https://fixture.test/http-addon.zip\", sha256 = \"{archive_sha256}\" }}\n"
    ));
    let cache =
        CacheLayout::for_root(fixture.directory.path().join("cache")).expect("cache should work");

    let error = lock_direct_dependencies(fixture.manifest_path(), &manifest, None, &cache, true)
        .expect_err("offline lock should report unavailable artifacts");

    assert_eq!(error.code(), ErrorCode::SourceAccess);
    assert!(
        error
            .message()
            .contains(&format!("git-addon (Git checkout {git_commit})"))
    );
    assert!(error.message().contains(&format!(
        "http-addon (HTTPS archive sha256:{archive_sha256})"
    )));
}

#[test]
fn invariant_changed_local_content_changes_the_direct_lock() {
    let fixture = Fixture::new();
    let addon = fixture.addon("addon", "first");
    let manifest = fixture.manifest("[dev-dependencies]\naddon = { path = \"addon\" }\n");
    let first = lock(&fixture, &manifest, None);
    fs::write(addon.join("plugin.gd"), "second").expect("fixture addon should change");

    let second = lock(&fixture, &manifest, None);

    assert_ne!(first.to_toml(), second.to_toml());
}

#[test]
fn invariant_changed_layout_override_relocks_the_same_source() {
    let fixture = Fixture::new();
    let source = fixture.directory.path().join("suite/addons");
    fs::create_dir_all(source.join("alpha")).expect("alpha source should create");
    fs::create_dir_all(source.join("beta")).expect("beta source should create");
    fs::write(source.join("alpha/plugin.gd"), "alpha").expect("alpha source should write");
    fs::write(source.join("beta/plugin.gd"), "beta").expect("beta source should write");
    Fixture::metadata(&source.join("alpha"), "addon");
    Fixture::metadata(&source.join("beta"), "addon");
    let alpha = fixture.manifest(
        "[dev-dependencies]\naddon = { path = \"suite\", root = \"addons/alpha\", target = \"addons/alpha\" }\n",
    );
    let first = lock(&fixture, &alpha, None);
    let beta = fixture.manifest(
        "[dev-dependencies]\naddon = { path = \"suite\", root = \"addons/beta\", target = \"addons/beta\" }\n",
    );

    let second = lock(&fixture, &beta, Some(&first));

    assert_ne!(first.to_toml(), second.to_toml());
    assert_eq!(
        second
            .packages()
            .get("addon")
            .expect("layout override should lock")
            .source_subdirectory(),
        Path::new("addons/beta")
    );
}

#[test]
fn invariant_parallel_lock_failures_are_reported_in_package_order() {
    let fixture = Fixture::new();
    let manifest = fixture.manifest(
        "[dev-dependencies]\nzebra = { path = \"missing-zebra\" }\nalpha = { path = \"missing-alpha\" }\n",
    );
    let cache =
        CacheLayout::for_root(fixture.directory.path().join("cache")).expect("cache should create");

    let error = lock_direct_dependencies(fixture.manifest_path(), &manifest, None, &cache, true)
        .expect_err("missing local dependencies should fail");

    assert!(error.message().contains("missing-alpha"));
}

#[test]
fn invariant_cancelled_lock_reads_no_source_content() {
    let fixture = Fixture::new();
    let addon = fixture.addon("addon", "first");
    let manifest = fixture.manifest("[dev-dependencies]\naddon = { path = \"addon\" }\n");
    let cache =
        CacheLayout::for_root(fixture.directory.path().join("cache")).expect("cache should create");
    let cancellation = CancellationToken::new();
    cancellation.cancel();
    fs::remove_dir_all(addon).expect("fixture source should be removable");

    let error = lock_direct_dependencies_with_cancellation(
        fixture.manifest_path(),
        &manifest,
        None,
        &cache,
        true,
        &cancellation,
    )
    .expect_err("cancelled lock should not access the source");

    assert_eq!(error.code(), ErrorCode::SourceAccess);
    assert!(error.message().contains("cancelled"));
}

#[test]
fn invariant_existing_matching_lock_reuses_without_source_access() {
    let fixture = Fixture::new();
    let addon = fixture.addon("addon", "first");
    let manifest = fixture.manifest("[dev-dependencies]\naddon = { path = \"addon\" }\n");
    let existing = lock(&fixture, &manifest, None);
    fs::remove_dir_all(addon).expect("fixture source should be removable");

    let reused = lock(&fixture, &manifest, Some(&existing));

    assert_eq!(reused, existing);
}

#[test]
fn invariant_selected_update_changes_only_the_selected_direct_lock_entry() {
    let fixture = Fixture::new();
    let alpha = fixture.addon("alpha", "first");
    let beta = fixture.addon("beta", "first");
    let manifest = fixture
        .manifest("[dev-dependencies]\nalpha = { path = \"alpha\" }\nbeta = { path = \"beta\" }\n");
    let existing = lock(&fixture, &manifest, None);
    fs::write(alpha.join("plugin.gd"), "second").expect("selected source should change");
    fs::write(beta.join("plugin.gd"), "second").expect("unselected source should change");
    let cache =
        CacheLayout::for_root(fixture.directory.path().join("cache")).expect("cache should create");
    let selected = wukong_core::identity::PackageName::parse("alpha")
        .expect("fixture package name should parse");

    let updated = update_direct_dependencies(
        fixture.manifest_path(),
        &manifest,
        &existing,
        Some(&selected),
        &cache,
        true,
    )
    .expect("selected update should lock");

    assert_ne!(
        existing.packages().get("alpha"),
        updated.packages().get("alpha")
    );
    assert_eq!(
        existing.packages().get("beta"),
        updated.packages().get("beta")
    );
}

fn lock(
    fixture: &Fixture,
    manifest: &Manifest,
    existing: Option<&wukong_core::lockfile::Lockfile>,
) -> wukong_core::lockfile::Lockfile {
    let cache =
        CacheLayout::for_root(fixture.directory.path().join("cache")).expect("cache should create");
    lock_direct_dependencies(fixture.manifest_path(), manifest, existing, &cache, true)
        .expect("local dependencies should lock")
}

struct Fixture {
    directory: TempDir,
    manifest_path: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let directory = TempDir::new().expect("fixture directory should exist");
        let manifest_path = directory.path().join("wukong.toml");
        Self {
            directory,
            manifest_path,
        }
    }
    fn manifest(&self, dependencies: &str) -> Manifest {
        Manifest::parse(
            &self.manifest_path,
            &format!("[project]\nname = \"fixture\"\ngodot = \"4\"\n\n{dependencies}"),
        )
        .expect("fixture manifest should parse")
    }
    fn addon(&self, name: &str, contents: &str) -> PathBuf {
        let addon = self.directory.path().join(name);
        fs::create_dir_all(&addon).expect("addon should create");
        fs::write(addon.join("plugin.gd"), contents).expect("addon should write");
        Self::metadata(&addon, name);
        addon
    }

    fn addon_without_metadata(&self, name: &str, contents: &str) -> PathBuf {
        let addon = self.directory.path().join(name);
        fs::create_dir_all(&addon).expect("addon should create");
        fs::write(addon.join("plugin.gd"), contents).expect("addon should write");
        addon
    }

    fn metadata(root: &Path, name: &str) {
        fs::write(
            root.join("wukong-package.toml"),
            format!(
                "[package]\nschema = 1\nname = \"{name}\"\nversion = \"1.0.0\"\ngodot = \"4\"\n"
            ),
        )
        .expect("package metadata should write");
    }
    fn manifest_path(&self) -> &Path {
        &self.manifest_path
    }
}
