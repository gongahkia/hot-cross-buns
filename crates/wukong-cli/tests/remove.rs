use std::{fs, path::Path, process::Command};
use tempfile::TempDir;
use wukong_core::lockfile::Lockfile;

#[test]
fn invariant_remove_prunes_the_direct_package_and_preserves_required_and_unrelated_files() {
    let fixture = Fixture::new();
    fixture.addon("alpha", "alpha\n");
    fixture.addon("beta", "beta\n");
    add(&fixture, "alpha");
    add(&fixture, "beta");
    fs::write(fixture.root().join("notes.txt"), "unrelated\n")
        .expect("unrelated file should write");

    let output = command("remove", fixture.root())
        .arg("alpha")
        .output()
        .expect("remove should run");
    let lock = Lockfile::parse(
        &fixture.root().join("wukong.lock"),
        &fs::read_to_string(fixture.root().join("wukong.lock")).expect("lock should read"),
    )
    .expect("lock should parse");

    assert!(output.status.success());
    assert!(!fixture.manifest().contains("alpha ="));
    assert!(fixture.manifest().contains("beta ="));
    assert!(!lock.packages().contains_key("alpha"));
    assert!(lock.packages().contains_key("beta"));
    assert!(!fixture.root().join("addons/alpha/plugin.gd").exists());
    assert_eq!(
        fs::read_to_string(fixture.root().join("addons/beta/plugin.gd"))
            .expect("required package should remain"),
        "beta\n"
    );
    assert_eq!(
        fs::read_to_string(fixture.root().join("notes.txt")).expect("unrelated file should remain"),
        "unrelated\n"
    );
    assert!(String::from_utf8_lossy(&output.stdout).contains("removed alpha; sync:"));
}

#[test]
fn invariant_remove_preserves_modified_formerly_owned_package_files() {
    let fixture = Fixture::new();
    fixture.addon("alpha", "source\n");
    add(&fixture, "alpha");
    fs::write(fixture.root().join("addons/alpha/plugin.gd"), "user edit\n")
        .expect("installed file should change");

    let output = command("remove", fixture.root())
        .arg("alpha")
        .output()
        .expect("remove should run");

    assert!(output.status.success());
    assert!(!fixture.manifest().contains("alpha ="));
    assert!(
        !Lockfile::parse(
            &fixture.root().join("wukong.lock"),
            &fs::read_to_string(fixture.root().join("wukong.lock")).expect("lock should read"),
        )
        .expect("lock should parse")
        .packages()
        .contains_key("alpha")
    );
    assert_eq!(
        fs::read_to_string(fixture.root().join("addons/alpha/plugin.gd"))
            .expect("modified package file should remain"),
        "user edit\n"
    );
}

fn add(fixture: &Fixture, alias: &str) {
    let output = command("add", fixture.root())
        .args([alias, "--path", alias])
        .output()
        .expect("add should run");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn command(subcommand: &str, current_directory: &Path) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_wukong"));
    command.arg(subcommand).current_dir(current_directory);
    command
}

struct Fixture {
    _directory: TempDir,
    root: std::path::PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let directory = TempDir::new().expect("fixture directory should exist");
        let root = directory.path().join("game");
        fs::create_dir(&root).expect("project should create");
        fs::write(
            root.join("project.godot"),
            "[application]\nconfig/name=\"fixture\"\n",
        )
        .expect("project marker should write");
        fs::write(
            root.join("wukong.toml"),
            "[project]\nname=\"fixture\"\ngodot=\"4\"\n",
        )
        .expect("manifest should write");
        Self {
            _directory: directory,
            root,
        }
    }

    fn root(&self) -> &Path {
        &self.root
    }

    fn addon(&self, name: &str, content: &str) {
        let path = self.root.join(name);
        fs::create_dir(&path).expect("addon should create");
        fs::write(path.join("plugin.gd"), content).expect("addon should write");
    }

    fn manifest(&self) -> String {
        fs::read_to_string(self.root.join("wukong.toml")).expect("manifest should read")
    }
}
