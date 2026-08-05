use std::{fs, path::Path, process::Command};
use tempfile::TempDir;

#[test]
fn invariant_status_json_reports_only_installed_package_identities() {
    let fixture = Fixture::new();
    fixture.addon("addon", "first");
    fixture.manifest("[dev-dependencies]\naddon = { path = \"addon\" }\n");
    assert!(
        command("lock", fixture.root())
            .output()
            .expect("lock should run")
            .status
            .success()
    );
    assert!(
        command("sync", fixture.root())
            .arg("--dev")
            .output()
            .expect("sync should run")
            .status
            .success()
    );

    let output = command("status", fixture.root())
        .arg("--json")
        .output()
        .expect("status should run");

    assert!(output.status.success());
    let events = String::from_utf8(output.stdout)
        .expect("JSON output should be UTF-8")
        .lines()
        .map(|line| serde_json::from_str::<serde_json::Value>(line).expect("event should parse"))
        .collect::<Vec<_>>();
    assert_eq!(
        events
            .iter()
            .map(|event| event["type"].as_str().expect("event should have a type"))
            .collect::<Vec<_>>(),
        ["started", "progress", "result"]
    );
    assert_eq!(events[0]["command"], "status");
    assert_eq!(events[2]["result"]["packages"][0]["name"], "addon");
    assert!(
        events[2]["result"]["packages"][0]["immutable_id"]
            .as_str()
            .expect("immutable ID should be a string")
            .starts_with("sha256:")
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
        Self {
            _directory: directory,
            root,
        }
    }

    fn root(&self) -> &Path {
        &self.root
    }

    fn manifest(&self, dependencies: &str) {
        fs::write(
            self.root.join("wukong.toml"),
            format!("[project]\nname=\"fixture\"\ngodot=\"4\"\n\n{dependencies}"),
        )
        .expect("manifest should write");
    }

    fn addon(&self, name: &str, contents: &str) {
        let addon = self.root.join(name);
        fs::create_dir(&addon).expect("addon should create");
        fs::write(addon.join("plugin.gd"), contents).expect("addon should write");
    }
}
