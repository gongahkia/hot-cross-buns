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

#[test]
fn invariant_selected_catalog_update_refreshes_only_its_reachable_closure() {
    let fixture = Fixture::new();
    fixture.lock_and_sync();
    let before = fixture.parsed_lock();
    fixture.add_update_candidates();

    let output = fixture
        .command("update")
        .args(["root", "--offline"])
        .output()
        .expect("selected catalog update should run");
    let after = fixture.parsed_lock();

    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(
        after.packages()["root"]
            .version()
            .expect("root version")
            .to_string(),
        "1.1.0"
    );
    assert_eq!(
        after.packages()["helper"]
            .version()
            .expect("helper version")
            .to_string(),
        "1.1.0"
    );
    assert_eq!(
        before.packages().get("dev-tool"),
        after.packages().get("dev-tool")
    );
    assert_eq!(fixture.installed_content("root"), "root-1.1.0");
    assert_eq!(fixture.installed_content("helper"), "helper-1.1.0");
    assert_eq!(fixture.installed_content("dev-tool"), "dev-tool-1.0.0");
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("updated root: 1.0.0 -> 1.1.0"));
    assert!(stdout.contains("updated helper: 1.0.0 -> 1.1.0"));
    assert!(stdout.contains(before.packages()["root"].source().immutable_id().as_str()));
    assert!(stdout.contains(after.packages()["root"].source().immutable_id().as_str()));
}

#[test]
fn invariant_catalog_update_without_a_target_refreshes_all_roots() {
    let fixture = Fixture::new();
    fixture.lock_and_sync();
    fixture.add_update_candidates();

    let output = fixture
        .command("update")
        .arg("--offline")
        .output()
        .expect("catalog update should run");
    let lock = fixture.parsed_lock();

    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(
        lock.packages()["root"]
            .version()
            .expect("root version")
            .to_string(),
        "1.1.0"
    );
    assert_eq!(
        lock.packages()["helper"]
            .version()
            .expect("helper version")
            .to_string(),
        "1.1.0"
    );
    assert_eq!(
        lock.packages()["dev-tool"]
            .version()
            .expect("development root version")
            .to_string(),
        "1.0.0"
    );
}

#[test]
fn invariant_catalog_update_dry_run_does_not_publish_cache_or_change_project_state() {
    let fixture = Fixture::new();
    fixture.lock_and_sync();
    let lock_before = fs::read(fixture.root().join("wukong.lock")).expect("lock should read");
    let package_count_before = fixture.cached_package_count();
    fixture.add_update_candidates();

    let output = fixture
        .command("update")
        .args(["root", "--dry-run"])
        .output()
        .expect("catalog dry-run should run");

    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(
        fs::read(fixture.root().join("wukong.lock")).expect("lock should read"),
        lock_before
    );
    assert_eq!(fixture.cached_package_count(), package_count_before);
    assert_eq!(fixture.installed_content("root"), "root-1.0.0");
    assert_eq!(fixture.installed_content("helper"), "helper-1.0.0");
    assert_eq!(fixture.installed_content("dev-tool"), "dev-tool-1.0.0");
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("would update root: 1.0.0 -> 1.1.0"));
    assert!(stdout.contains("would update helper: 1.0.0 -> 1.1.0"));
}

struct Fixture {
    _directory: TempDir,
    project: PathBuf,
    cache: CacheLayout,
    root_update_sha256: String,
    helper_update_sha256: String,
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
        let root_sha256 = cache_archive(&cache, &archive("root", "1.0.0", [("helper", "^1")]));
        let helper_sha256 = cache_archive(&cache, &archive("helper", "1.0.0", []));
        let dev_tool_sha256 = cache_archive(&cache, &archive("dev-tool", "1.0.0", []));
        let root_update_sha256 =
            cache_archive(&cache, &archive("root", "1.1.0", [("helper", "^1.1")]));
        let helper_update_sha256 = cache_archive(&cache, &archive("helper", "1.1.0", []));
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
            root_update_sha256,
            helper_update_sha256,
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

    fn lock_and_sync(&self) {
        let lock = self
            .command("lock")
            .arg("--offline")
            .output()
            .expect("catalog lock should run");
        assert!(
            lock.status.success(),
            "{}",
            String::from_utf8_lossy(&lock.stderr)
        );
        let sync = self
            .command("sync")
            .args(["--frozen", "--dev"])
            .output()
            .expect("catalog sync should run");
        assert!(
            sync.status.success(),
            "{}",
            String::from_utf8_lossy(&sync.stderr)
        );
    }

    fn add_update_candidates(&self) {
        let mut catalog = fs::read_to_string(self.root().join("wukong.sources.toml"))
            .expect("catalog should read");
        catalog.push_str(&format!(
            "\n[[package]]\nname = \"root\"\n[package.http]\nversion = \"1.1.0\"\nurl = \"https://fixture.test/root-1.1.zip\"\nsha256 = \"{}\"\nroot = \"addons/root\"\n\n[[package]]\nname = \"helper\"\n[package.http]\nversion = \"1.1.0\"\nurl = \"https://fixture.test/helper-1.1.zip\"\nsha256 = \"{}\"\nroot = \"addons/helper\"\n",
            self.root_update_sha256, self.helper_update_sha256
        ));
        fs::write(self.root().join("wukong.sources.toml"), catalog)
            .expect("updated catalog should write");
    }

    fn parsed_lock(&self) -> Lockfile {
        let path = self.root().join("wukong.lock");
        Lockfile::parse(&path, &fs::read_to_string(&path).expect("lock should read"))
            .expect("lock should parse")
    }

    fn installed_content(&self, package: &str) -> String {
        fs::read_to_string(self.root().join("addons").join(package).join("plugin.gd"))
            .expect("installed package file should read")
    }

    fn cached_package_count(&self) -> usize {
        fs::read_dir(self.cache.packages())
            .expect("prepared package cache should exist")
            .filter_map(Result::ok)
            .count()
    }
}

fn archive(
    name: &str,
    version: &str,
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
        "[package]\nschema = 1\nname = {name:?}\nversion = {version:?}\ngodot = \"4\"{dependencies}"
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
        .write_all(format!("{name}-{version}").as_bytes())
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
