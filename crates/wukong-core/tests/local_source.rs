use std::{ffi::OsString, fs, path::Path};
use tempfile::TempDir;
use wukong_core::{
    diagnostic::ErrorCode,
    local_source::{LocalPathAdapter, LocalPathRequest},
    source::{ResolvedSource, SourceAdapter, VersionAvailability},
};

#[test]
fn invariant_local_addon_root_resolves_to_a_content_snapshot() {
    let fixture = Fixture::new();
    let addon = fixture.root().join("addons/example");
    fs::create_dir_all(&addon).expect("addon directory should be created");
    fs::write(addon.join("plugin.gd"), "extends Node\n").expect("addon file should be written");

    let resolution = resolve(fixture.manifest_path(), Path::new("addons/example"));

    assert!(resolution.root().path().is_absolute());
    assert_eq!(resolution.snapshot().sha256().len(), 64);
    assert!(resolution.immutable_id().as_str().starts_with("sha256:"));
}

#[test]
fn invariant_repository_containing_addons_is_snapshotted_without_layout_selection() {
    let fixture = Fixture::new();
    let repository = fixture.root().join("repository/addons/example");
    fs::create_dir_all(&repository).expect("repository addon should be created");
    fs::write(repository.join("plugin.gd"), "extends Node\n")
        .expect("addon file should be written");

    let resolution = resolve(fixture.manifest_path(), Path::new("repository"));

    assert_eq!(
        LocalPathAdapter
            .available_versions(&LocalPathRequest::new(
                fixture.manifest_path().to_path_buf(),
                Path::new("repository").to_path_buf(),
            ))
            .expect("availability should resolve"),
        VersionAvailability::Unsupported
    );
    assert_eq!(
        resolution.root().path(),
        fs::canonicalize(fixture.root().join("repository")).expect("path should canonicalize")
    );
}

#[test]
fn invariant_missing_local_path_is_a_recoverable_source_error() {
    let fixture = Fixture::new();
    let request = LocalPathRequest::new(fixture.manifest_path().to_path_buf(), "missing".into());

    let error = LocalPathAdapter
        .resolve(&request)
        .expect_err("missing path should fail");

    assert_eq!(error.code(), ErrorCode::SourceAccess);
    assert!(error.message().contains("does not exist"));
}

#[test]
fn invariant_changed_local_contents_change_the_immutable_snapshot() {
    let fixture = Fixture::new();
    let addon = fixture.root().join("addon");
    fs::create_dir(&addon).expect("addon directory should be created");
    let file = addon.join("plugin.gd");
    fs::write(&file, "one\n").expect("first content should write");
    let first = resolve(fixture.manifest_path(), Path::new("addon"));
    fs::write(file, "two\n").expect("second content should write");
    let second = resolve(fixture.manifest_path(), Path::new("addon"));

    assert_ne!(first.snapshot(), second.snapshot());
    assert_ne!(first.immutable_id(), second.immutable_id());
}

#[test]
fn invariant_git_and_configured_names_are_ignored_during_hashing() {
    let fixture = Fixture::new();
    let addon = fixture.root().join("addon");
    fs::create_dir(&addon).expect("addon directory should be created");
    fs::write(addon.join("plugin.gd"), "stable\n").expect("addon file should write");
    fs::create_dir(addon.join(".git")).expect("git directory should be created");
    fs::write(addon.join(".git/index"), "first").expect("git file should write");
    fs::write(addon.join("generated"), "first").expect("generated file should write");
    let request = LocalPathRequest::new(fixture.manifest_path().to_path_buf(), "addon".into())
        .with_ignored_names([OsString::from("generated")]);
    let first = LocalPathAdapter
        .resolve(&request)
        .expect("first snapshot should resolve");
    fs::write(addon.join(".git/index"), "second").expect("git file should change");
    fs::write(addon.join("generated"), "second").expect("generated file should change");
    let second = LocalPathAdapter
        .resolve(&request)
        .expect("second snapshot should resolve");

    assert_eq!(first.snapshot(), second.snapshot());
}

#[cfg(unix)]
#[test]
fn invariant_symlinks_are_snapshotted_without_following_them() {
    use std::os::unix::fs::symlink;

    let fixture = Fixture::new();
    let addon = fixture.root().join("addon");
    let outside = fixture.directory.path().join("outside");
    fs::create_dir(&addon).expect("addon directory should be created");
    fs::write(&outside, "outside\n").expect("outside file should write");
    symlink(&outside, addon.join("linked.gd")).expect("symlink should be created");

    let resolution = resolve(fixture.manifest_path(), Path::new("addon"));

    assert_eq!(resolution.snapshot().sha256().len(), 64);
}

#[test]
fn invariant_paths_outside_the_project_are_supported() {
    let fixture = Fixture::new();
    let outside = fixture.directory.path().join("outside-addon");
    fs::create_dir(&outside).expect("outside addon should be created");
    fs::write(outside.join("plugin.gd"), "extends Node\n").expect("outside addon should write");

    let resolution = resolve(fixture.manifest_path(), &outside);

    assert_eq!(
        resolution.root().path(),
        fs::canonicalize(outside).expect("path should canonicalize")
    );
}

fn resolve(
    manifest_path: &Path,
    declared_path: &Path,
) -> wukong_core::local_source::LocalPathResolution {
    LocalPathAdapter
        .resolve(&LocalPathRequest::new(
            manifest_path.to_path_buf(),
            declared_path.to_path_buf(),
        ))
        .expect("local path should resolve")
}

struct Fixture {
    directory: TempDir,
    root: std::path::PathBuf,
    manifest_path: std::path::PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let directory = TempDir::new().expect("temporary directory should be created");
        let root = directory.path().join("project");
        fs::create_dir(&root).expect("project directory should be created");
        let manifest_path = root.join("wukong.toml");
        fs::write(&manifest_path, "[project]\nname=\"fixture\"\ngodot=\"4\"\n")
            .expect("manifest should be written");
        Self {
            directory,
            root,
            manifest_path,
        }
    }

    fn root(&self) -> &Path {
        &self.root
    }

    fn manifest_path(&self) -> &Path {
        &self.manifest_path
    }
}
