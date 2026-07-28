use std::{
    fs,
    path::{Path, PathBuf},
};
use tempfile::TempDir;
use wukong_core::{
    cache::CacheLayout, direct_lock::lock_direct_dependencies, lockfile::LockedSource,
    manifest::Manifest,
};

#[test]
fn invariant_multiple_direct_local_dependencies_produce_a_deterministic_lock() {
    let fixture = Fixture::new();
    fixture.addon("alpha", "alpha");
    fixture.addon("zebra", "zebra");
    let manifest = fixture
        .manifest("[dependencies]\nzebra = { path = \"zebra\" }\nalpha = { path = \"alpha\" }\n");

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
}

#[test]
fn invariant_changed_local_content_changes_the_direct_lock() {
    let fixture = Fixture::new();
    let addon = fixture.addon("addon", "first");
    let manifest = fixture.manifest("[dependencies]\naddon = { path = \"addon\" }\n");
    let first = lock(&fixture, &manifest, None);
    fs::write(addon.join("plugin.gd"), "second").expect("fixture addon should change");

    let second = lock(&fixture, &manifest, None);

    assert_ne!(first.to_toml(), second.to_toml());
}

#[test]
fn invariant_existing_matching_lock_reuses_without_source_access() {
    let fixture = Fixture::new();
    let addon = fixture.addon("addon", "first");
    let manifest = fixture.manifest("[dependencies]\naddon = { path = \"addon\" }\n");
    let existing = lock(&fixture, &manifest, None);
    fs::remove_dir_all(addon).expect("fixture source should be removable");

    let reused = lock(&fixture, &manifest, Some(&existing));

    assert_eq!(reused, existing);
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
        addon
    }
    fn manifest_path(&self) -> &Path {
        &self.manifest_path
    }
}
