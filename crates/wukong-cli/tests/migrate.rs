use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::Command,
};
use tempfile::TempDir;
use wukong_core::{
    cache::CacheLayout,
    identity::PackageName,
    lockfile::{GodotCompatibility, LockedHttpSource, LockedPackage, Lockfile},
    semantic_version::{SemanticVersion, VersionRequirement},
    source::ImmutableSourceId,
    source_catalog::SourceCatalog,
};
use zip::{CompressionMethod, ZipWriter, write::SimpleFileOptions};

#[test]
fn invariant_migrate_writes_valid_catalog_and_schema_three_lock_without_backup_files() {
    let fixture = Fixture::new(true);
    fixture.lock_direct();

    let output = fixture
        .command("migrate")
        .output()
        .expect("migration should run");
    let manifest = fixture.manifest();
    let lock = fixture.lock();

    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(manifest.contains("alpha = \"=1.0.0\""));
    assert_eq!(lock.schema(), 3);
    SourceCatalog::load(&fixture.catalog_path())
        .and_then(|catalog| catalog.validate(&fixture.catalog_path()))
        .expect("migration catalog should validate");
    assert!(
        fixture
            .command("sync")
            .arg("--frozen")
            .output()
            .expect("frozen sync should run")
            .status
            .success()
    );
    assert!(!fixture.root().join("wukong.toml.bak").exists());
    assert!(!fixture.root().join("wukong.lock.bak").exists());
    assert!(!fixture.root().join("wukong.sources.toml.bak").exists());
}

#[test]
fn invariant_migrate_dry_run_leaves_project_and_cache_unchanged() {
    let fixture = Fixture::new(true);
    fixture.lock_direct();
    let manifest_before = fixture.manifest();
    let lock_before = fs::read(fixture.lock_path()).expect("lock should read");
    let packages_before = fixture.cached_package_count();

    let output = fixture
        .command("migrate")
        .arg("--dry-run")
        .output()
        .expect("migration preview should run");

    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(fixture.manifest(), manifest_before);
    assert_eq!(
        fs::read(fixture.lock_path()).expect("lock should read"),
        lock_before
    );
    assert!(!fixture.catalog_path().exists());
    assert_eq!(fixture.cached_package_count(), packages_before);
    assert!(String::from_utf8_lossy(&output.stdout).contains("migration dry-run: would write"));
}

#[test]
fn invariant_metadata_less_migration_leaves_every_project_file_unchanged() {
    let fixture = Fixture::new(false);
    fixture.write_legacy_direct_lock();
    let manifest_before = fixture.manifest();
    let lock_before = fs::read(fixture.lock_path()).expect("lock should read");

    let output = fixture
        .command("migrate")
        .output()
        .expect("migration should run");

    assert_eq!(output.status.code(), Some(4));
    assert!(String::from_utf8_lossy(&output.stderr).contains("no wukong-package.toml"));
    assert_eq!(fixture.manifest(), manifest_before);
    assert_eq!(
        fs::read(fixture.lock_path()).expect("lock should read"),
        lock_before
    );
    assert!(!fixture.catalog_path().exists());
}

#[test]
fn invariant_migrate_never_overwrites_a_project_owned_catalog() {
    let fixture = Fixture::new(true);
    fixture.lock_direct();
    fs::write(fixture.catalog_path(), "schema = 1\n").expect("catalog should write");
    let manifest_before = fixture.manifest();
    let lock_before = fs::read(fixture.lock_path()).expect("lock should read");
    let catalog_before = fs::read(fixture.catalog_path()).expect("catalog should read");

    let output = fixture
        .command("migrate")
        .output()
        .expect("migration should run");

    assert_eq!(output.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&output.stderr).contains("already exists"));
    assert_eq!(fixture.manifest(), manifest_before);
    assert_eq!(
        fs::read(fixture.lock_path()).expect("lock should read"),
        lock_before
    );
    assert_eq!(
        fs::read(fixture.catalog_path()).expect("catalog should read"),
        catalog_before
    );
}

struct Fixture {
    _directory: TempDir,
    root: PathBuf,
    cache: CacheLayout,
    sha256: String,
}

impl Fixture {
    fn new(with_metadata: bool) -> Self {
        let directory = TempDir::new().expect("fixture directory should exist");
        let root = directory.path().join("game");
        fs::create_dir(&root).expect("project should create");
        fs::write(
            root.join("project.godot"),
            "[application]\nconfig/name=\"fixture\"\n",
        )
        .expect("project marker should write");
        let cache =
            CacheLayout::for_root(directory.path().join("cache")).expect("cache should create");
        let archive = archive(with_metadata);
        let sha256 = checksum(&archive);
        let archive_path = cache.downloads().join("sha256").join(&sha256);
        fs::create_dir_all(archive_path.parent().expect("archive parent should exist"))
            .expect("archive parent should create");
        fs::write(archive_path, archive).expect("archive should cache");
        fs::write(
            root.join("wukong.toml"),
            format!(
                "[project]\nname = \"fixture\"\ngodot = \"4\"\n\n[dependencies]\nalpha = {{ url = \"https://fixture.test/alpha.zip\", sha256 = \"{sha256}\", root = \"addons/alpha\" }}\n"
            ),
        )
        .expect("manifest should write");
        Self {
            _directory: directory,
            root,
            cache,
            sha256,
        }
    }

    fn root(&self) -> &Path {
        &self.root
    }

    fn command(&self, command: &str) -> Command {
        let mut process = Command::new(env!("CARGO_BIN_EXE_wukong"));
        process
            .arg(command)
            .current_dir(self.root())
            .env("WUKONG_CACHE_DIR", self.cache.root());
        process
    }

    fn lock_direct(&self) {
        let output = self
            .command("lock")
            .arg("--offline")
            .output()
            .expect("direct lock should run");
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn write_legacy_direct_lock(&self) {
        let source = LockedHttpSource::new(
            ImmutableSourceId::new(format!("sha256:{}", self.sha256))
                .expect("immutable ID should parse"),
            "https://fixture.test/alpha.zip",
            self.sha256.clone(),
        )
        .expect("source should construct");
        let package = LockedPackage::new(
            PackageName::parse("alpha").expect("package should parse"),
            Some(SemanticVersion::parse("1.0.0").expect("version should parse")),
            source,
            "a".repeat(64),
            "b".repeat(64),
            BTreeSet::new(),
            PathBuf::from("addons/alpha"),
            PathBuf::from("addons/alpha"),
            GodotCompatibility::Requirement(
                VersionRequirement::parse("4").expect("Godot requirement should parse"),
            ),
            false,
        )
        .expect("package should construct");
        fs::write(
            self.lock_path(),
            Lockfile::new([package])
                .expect("lock should construct")
                .to_toml(),
        )
        .expect("legacy lock should write");
    }

    fn manifest(&self) -> String {
        fs::read_to_string(self.root().join("wukong.toml")).expect("manifest should read")
    }

    fn lock_path(&self) -> PathBuf {
        self.root().join("wukong.lock")
    }

    fn catalog_path(&self) -> PathBuf {
        self.root().join("wukong.sources.toml")
    }

    fn lock(&self) -> Lockfile {
        let path = self.lock_path();
        Lockfile::parse(&path, &fs::read_to_string(&path).expect("lock should read"))
            .expect("lock should parse")
    }

    fn cached_package_count(&self) -> usize {
        fs::read_dir(self.cache.packages())
            .expect("prepared package cache should exist")
            .filter_map(Result::ok)
            .count()
    }
}

fn archive(with_metadata: bool) -> Vec<u8> {
    let mut output = Vec::new();
    let mut archive = ZipWriter::new(std::io::Cursor::new(&mut output));
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    if with_metadata {
        archive
            .start_file("addons/alpha/wukong-package.toml", options)
            .expect("metadata should start");
        archive
            .write_all(
                b"[package]\nschema = 1\nname = \"alpha\"\nversion = \"1.0.0\"\ngodot = \"4\"\n",
            )
            .expect("metadata should write");
    }
    archive
        .start_file("addons/alpha/plugin.gd", options)
        .expect("plugin should start");
    archive.write_all(b"plugin").expect("plugin should write");
    archive.finish().expect("archive should finish");
    output
}

fn checksum(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
