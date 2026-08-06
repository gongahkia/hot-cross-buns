use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::Command,
};
use tempfile::TempDir;
use wukong_core::{cache::CacheLayout, lockfile::Lockfile};
use zip::{CompressionMethod, ZipWriter, write::SimpleFileOptions};

#[test]
fn invariant_catalog_lock_syncs_the_complete_graph_without_a_catalog_during_frozen_reuse() {
    let fixture = Fixture::new();

    let lock = fixture
        .command("lock")
        .arg("--offline")
        .output()
        .expect("catalog lock should run");
    assert!(
        lock.status.success(),
        "{}",
        String::from_utf8_lossy(&lock.stderr)
    );
    let lock = Lockfile::parse(
        &fixture.root().join("wukong.lock"),
        &fs::read_to_string(fixture.root().join("wukong.lock")).expect("lock should read"),
    )
    .expect("catalog lock should parse");
    assert_eq!(lock.schema(), 3);
    assert_eq!(lock.packages().len(), 3);
    assert_eq!(
        lock.packages()
            .get("root")
            .expect("root should lock")
            .dependencies()
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>(),
        ["helper"]
    );

    let tree = fixture.command("tree").output().expect("tree should run");
    assert!(tree.status.success());
    assert!(String::from_utf8_lossy(&tree.stdout).contains("helper@1.0.0 [transitive]"));

    fs::remove_file(fixture.root().join("wukong.sources.toml"))
        .expect("catalog should remove after lock");
    let first = fixture
        .command("sync")
        .args(["--frozen", "--dev"])
        .output()
        .expect("frozen catalog sync should run");
    let repeat = fixture
        .command("sync")
        .args(["--frozen", "--dev"])
        .output()
        .expect("repeated frozen catalog sync should run");
    let runtime_only = fixture
        .command("sync")
        .arg("--frozen")
        .output()
        .expect("runtime-only frozen catalog sync should run");

    assert!(
        first.status.success(),
        "{}",
        String::from_utf8_lossy(&first.stderr)
    );
    assert!(
        repeat.status.success(),
        "{}",
        String::from_utf8_lossy(&repeat.stderr)
    );
    assert!(
        runtime_only.status.success(),
        "{}",
        String::from_utf8_lossy(&runtime_only.stderr)
    );
    assert!(fixture.root().join("addons/root/plugin.gd").is_file());
    assert!(fixture.root().join("addons/helper/plugin.gd").is_file());
    assert!(!fixture.root().join("addons/dev-tool/plugin.gd").exists());
    assert!(String::from_utf8_lossy(&repeat.stdout).contains("0 written, 6 unchanged, 0 removed"));
    assert!(
        String::from_utf8_lossy(&runtime_only.stdout).contains("0 written, 4 unchanged, 2 removed")
    );
}

#[test]
fn invariant_frozen_catalog_sync_rejects_changed_roots_before_project_mutation() {
    let fixture = Fixture::new();
    let lock = fixture
        .command("lock")
        .arg("--offline")
        .output()
        .expect("catalog lock should run");
    assert!(
        lock.status.success(),
        "{}",
        String::from_utf8_lossy(&lock.stderr)
    );
    fs::write(
        fixture.root().join("wukong.toml"),
        "[project]\nname = \"fixture\"\ngodot = \"4\"\n\n[dependencies]\nroot = \"^2\"\n\n[dev-dependencies]\ndev-tool = \"^1\"\n",
    )
    .expect("changed manifest should write");
    fs::remove_file(fixture.root().join("wukong.sources.toml"))
        .expect("catalog should remove after lock");

    let output = fixture
        .command("sync")
        .arg("--frozen")
        .output()
        .expect("frozen catalog sync should run");

    assert_eq!(output.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&output.stderr).contains("does not satisfy"));
    assert!(!fixture.root().join("addons").exists());
    assert!(!fixture.root().join(".wukong/state.toml").exists());
}

struct Fixture {
    _directory: TempDir,
    project: PathBuf,
    cache: CacheLayout,
}

impl Fixture {
    fn new() -> Self {
        let directory = TempDir::new().expect("fixture directory should create");
        let root = directory.path().join("project");
        fs::create_dir(&root).expect("project should create");
        fs::write(
            root.join("project.godot"),
            "[application]\nconfig/name=\"fixture\"\n",
        )
        .expect("project marker should write");
        fs::write(
            root.join("wukong.toml"),
            "[project]\nname = \"fixture\"\ngodot = \"4\"\n\n[dependencies]\nroot = \"^1\"\n\n[dev-dependencies]\ndev-tool = \"^1\"\n",
        )
        .expect("manifest should write");
        let cache = CacheLayout::for_root(directory.path().join("cache"))
            .expect("cache layout should create");
        let root_sha256 = cache_archive(&cache, &archive("root", [("helper", "^1")]));
        let helper_sha256 = cache_archive(&cache, &archive("helper", []));
        let dev_tool_sha256 = cache_archive(&cache, &archive("dev-tool", []));
        fs::write(
            root.join("wukong.sources.toml"),
            format!(
                "schema = 1\n\n[[package]]\nname = \"root\"\n[package.http]\nversion = \"1.0.0\"\nurl = \"https://fixture.test/root.zip\"\nsha256 = \"{root_sha256}\"\nroot = \"addons/root\"\n\n[[package]]\nname = \"helper\"\n[package.http]\nversion = \"1.0.0\"\nurl = \"https://fixture.test/helper.zip\"\nsha256 = \"{helper_sha256}\"\nroot = \"addons/helper\"\n\n[[package]]\nname = \"dev-tool\"\n[package.http]\nversion = \"1.0.0\"\nurl = \"https://fixture.test/dev-tool.zip\"\nsha256 = \"{dev_tool_sha256}\"\nroot = \"addons/dev-tool\"\n"
            ),
        )
        .expect("catalog should write");
        Self {
            _directory: directory,
            project: root,
            cache,
        }
    }

    fn root(&self) -> &Path {
        &self.project
    }

    fn command(&self, subcommand: &str) -> Command {
        let mut command = Command::new(env!("CARGO_BIN_EXE_wukong"));
        command
            .arg(subcommand)
            .current_dir(self.root())
            .env("WUKONG_CACHE_DIR", self.cache.root());
        command
    }
}

fn archive(
    name: &str,
    dependencies: impl IntoIterator<Item = (&'static str, &'static str)>,
) -> Vec<u8> {
    let mut output = Vec::new();
    let mut archive = ZipWriter::new(std::io::Cursor::new(&mut output));
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    let dependencies = dependencies
        .into_iter()
        .map(|(name, requirement)| format!("{name} = {requirement:?}"))
        .collect::<Vec<_>>()
        .join("\n");
    let dependencies = if dependencies.is_empty() {
        String::new()
    } else {
        format!("\n[dependencies]\n{dependencies}\n")
    };
    let metadata = format!(
        "[package]\nschema = 1\nname = {name:?}\nversion = \"1.0.0\"\ngodot = \"4\"{dependencies}"
    );
    archive
        .start_file(format!("addons/{name}/wukong-package.toml"), options)
        .expect("metadata entry should start");
    archive
        .write_all(metadata.as_bytes())
        .expect("metadata should write");
    archive
        .start_file(format!("addons/{name}/plugin.gd"), options)
        .expect("plugin entry should start");
    archive
        .write_all(name.as_bytes())
        .expect("plugin should write");
    archive.finish().expect("archive should finish");
    output
}

fn cache_archive(cache: &CacheLayout, archive: &[u8]) -> String {
    let sha256 = format!("{:x}", Sha256::digest(archive));
    let path = cache.downloads().join("sha256").join(&sha256);
    fs::create_dir_all(path.parent().expect("archive cache parent should exist"))
        .expect("archive cache parent should create");
    fs::write(path, archive).expect("archive cache should write");
    sha256
}
