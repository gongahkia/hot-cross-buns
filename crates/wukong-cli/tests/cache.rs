use std::{fs, path::PathBuf, process::Command};
use tempfile::TempDir;
use wukong_core::{
    cache::{CacheLayout, publish_prepared_package},
    package_tree::prepare_package_tree,
};

#[test]
fn invariant_cache_verify_reports_a_clean_prepared_package_cache() {
    let fixture = Fixture::new();
    let object = fixture.publish("Example");

    let output = command(&fixture, ["verify"])
        .output()
        .expect("cache verify should run");

    assert!(output.status.success());
    assert!(String::from_utf8_lossy(&output.stdout).contains("1 verified, 0 corrupt removed"));
    assert!(object.exists());
}

#[test]
fn invariant_cache_verify_removes_corrupt_objects_and_returns_integrity_exit() {
    let fixture = Fixture::new();
    let object = fixture.publish("Example");
    fs::write(object.join("plugin.cfg"), "[plugin]\nname=\"Tampered\"\n")
        .expect("cache object should become corrupt");

    let output = command(&fixture, ["verify"])
        .output()
        .expect("cache verify should run");

    assert_eq!(output.status.code(), Some(4));
    assert!(String::from_utf8_lossy(&output.stdout).contains("0 verified, 1 corrupt removed"));
    assert!(String::from_utf8_lossy(&output.stderr).contains("removed 1 corrupt object"));
    assert!(!object.exists());
}

#[test]
fn invariant_cache_dir_and_status_report_the_active_schema_and_human_sizes() {
    let fixture = Fixture::new();
    fixture.publish("Example");

    let directory = command(&fixture, ["dir"])
        .output()
        .expect("cache dir should run");
    let status = command(&fixture, ["status"])
        .output()
        .expect("cache status should run");

    assert!(directory.status.success());
    assert_eq!(
        String::from_utf8(directory.stdout)
            .expect("directory output should be UTF-8")
            .trim(),
        CacheLayout::for_root(fixture.cache_root())
            .expect("cache layout should parse")
            .schema_root()
            .display()
            .to_string()
    );
    assert!(status.status.success());
    let status = String::from_utf8(status.stdout).expect("status output should be UTF-8");
    assert!(status.contains("prepared packages: 1 ("));
    assert!(status.contains("total: "));
}

#[test]
fn invariant_cache_clean_dry_run_and_removal_preserve_unrecognized_entries() {
    let fixture = Fixture::new();
    let object = fixture.publish("Example");
    let archive = fixture.archive("a", "archive");
    let foreign = fixture.cache_root().join("v1/packages/sha256/foreign");
    fs::create_dir_all(&foreign).expect("foreign directory should create");
    fs::write(foreign.join("data"), "preserve\n").expect("foreign file should write");

    let preview = command(&fixture, ["clean", "--dry-run"])
        .output()
        .expect("cache clean dry-run should run");

    assert!(preview.status.success());
    assert!(
        String::from_utf8(preview.stdout)
            .expect("preview output should be UTF-8")
            .contains("cache clean dry-run: 1 prepared package(s), 1 archive(s)")
    );
    assert!(object.exists());
    assert!(archive.exists());

    let cleaned = command(&fixture, ["clean"])
        .output()
        .expect("cache clean should run");

    assert!(cleaned.status.success());
    assert!(!object.exists());
    assert!(!archive.exists());
    assert!(foreign.exists());
}

fn command<const N: usize>(fixture: &Fixture, arguments: [&str; N]) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_wukong"));
    command
        .arg("cache")
        .args(arguments)
        .current_dir(fixture.directory.path())
        .env("WUKONG_CACHE_DIR", fixture.cache_root());
    command
}

struct Fixture {
    directory: TempDir,
}

impl Fixture {
    fn new() -> Self {
        Self {
            directory: TempDir::new().expect("fixture directory should exist"),
        }
    }

    fn cache_root(&self) -> PathBuf {
        self.directory.path().join("cache")
    }

    fn publish(&self, plugin_name: &str) -> std::path::PathBuf {
        let source = self.directory.path().join("source");
        fs::create_dir_all(&source).expect("source directory should exist");
        fs::write(
            source.join("plugin.cfg"),
            format!("[plugin]\nname=\"{plugin_name}\"\n"),
        )
        .expect("source should write");
        let prepared = prepare_package_tree(&source, &self.directory.path().join("prepared"))
            .expect("source should prepare");
        let layout = CacheLayout::for_root(self.cache_root()).expect("cache layout should parse");
        publish_prepared_package(&layout, &prepared)
            .expect("cache publication should work")
            .path()
            .to_path_buf()
    }

    fn archive(&self, character: &str, contents: &str) -> std::path::PathBuf {
        let archive = self
            .cache_root()
            .join("v1/downloads/sha256")
            .join(character.repeat(64));
        fs::create_dir_all(archive.parent().expect("archive should have a parent"))
            .expect("archive parent should create");
        fs::write(&archive, contents).expect("archive should write");
        archive
    }
}
