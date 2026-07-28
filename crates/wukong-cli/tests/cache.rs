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

    let output = command(&fixture).output().expect("cache verify should run");

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

    let output = command(&fixture).output().expect("cache verify should run");

    assert_eq!(output.status.code(), Some(4));
    assert!(String::from_utf8_lossy(&output.stdout).contains("0 verified, 1 corrupt removed"));
    assert!(String::from_utf8_lossy(&output.stderr).contains("removed 1 corrupt object"));
    assert!(!object.exists());
}

fn command(fixture: &Fixture) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_wukong"));
    command
        .args(["cache", "verify"])
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
}
