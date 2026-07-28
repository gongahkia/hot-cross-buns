use std::{fs, path::Path, process::Command};
use tempfile::TempDir;

#[test]
fn invariant_init_creates_a_parseable_manifest_from_the_godot_project_name() {
    let fixture = Fixture::new("[application]\nconfig/name=\"CLI Game\"\n");

    let output = command(fixture.root())
        .current_dir(fixture.root())
        .output()
        .expect("init should run");

    assert!(output.status.success());
    assert!(String::from_utf8_lossy(&output.stdout).contains("created"));
    assert_eq!(
        fs::read_to_string(fixture.root().join("wukong.toml")).expect("manifest should exist"),
        "[project]\nname = \"CLI Game\"\ngodot = \">=4.0,<5\"\n"
    );
}

#[test]
fn invariant_repeated_cli_init_refuses_to_overwrite_the_manifest() {
    let fixture = Fixture::new("[application]\nconfig/name=\"CLI Game\"\n");
    let first = command(fixture.root())
        .current_dir(fixture.root())
        .output()
        .expect("first init should run");
    let manifest_path = fixture.root().join("wukong.toml");
    let content = fs::read_to_string(&manifest_path).expect("manifest should exist");
    let second = command(fixture.root())
        .current_dir(fixture.root())
        .output()
        .expect("second init should run");

    assert!(first.status.success());
    assert_eq!(second.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&second.stderr).contains("already exists"));
    assert_eq!(
        fs::read_to_string(manifest_path).expect("manifest should remain readable"),
        content
    );
}

#[test]
fn invariant_non_interactive_init_supports_an_explicit_project_path() {
    let fixture = Fixture::new("[application]\nconfig/name=\"CLI Game\"\n");
    let outside = fixture.directory.path().join("outside");
    fs::create_dir(&outside).expect("outside directory should be created");

    let output = command(&outside)
        .arg("--project")
        .arg(fixture.root())
        .arg("--non-interactive")
        .output()
        .expect("init should run");

    assert!(output.status.success());
    assert!(fixture.root().join("wukong.toml").is_file());
}

fn command(current_directory: &Path) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_wukong"));
    command.arg("init").current_dir(current_directory);
    command
}

struct Fixture {
    directory: TempDir,
    root: std::path::PathBuf,
}

impl Fixture {
    fn new(project_content: &str) -> Self {
        let directory = TempDir::new().expect("temporary directory should be created");
        let root = directory.path().join("fixture-game");
        fs::create_dir(&root).expect("project root should be created");
        fs::write(root.join("project.godot"), project_content)
            .expect("project marker should be written");
        Self { directory, root }
    }

    fn root(&self) -> &Path {
        &self.root
    }
}
