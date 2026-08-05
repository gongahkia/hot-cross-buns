use std::{fs, path::Path, process::Command};
use tempfile::TempDir;

const VALID_CATALOG: &str = r#"schema = 1
[[package]]
name = "alpha"
[package.http]
version = "1.2.3"
url = "https://127.0.0.1:9/alpha.zip"
sha256 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
root = "addons/alpha"
"#;

#[test]
fn invariant_source_validate_is_read_only_and_never_acquires_a_declared_source() {
    let fixture = Fixture::new(VALID_CATALOG);
    let before = fixture.catalog();

    let output = command(fixture.root())
        .args(["source", "validate"])
        .output()
        .expect("source validation should run");

    assert!(output.status.success());
    assert_eq!(
        String::from_utf8(output.stdout).expect("output should be UTF-8"),
        "source catalog: valid\n"
    );
    assert_eq!(fixture.catalog(), before);
}

#[test]
fn invariant_source_validate_json_reports_every_deterministic_redacted_failure() {
    let secret = "never-display-this";
    let fixture = Fixture::new(&format!(
        r#"schema = 1
[[package]]
name = "Bad_Name"
[package.git]
url = "https://user:{secret}@example.test/alpha.git"
root = "../addons/alpha"
tag-prefix = ""

[[package]]
name = "alpha"
[package.http]
version = "not-a-version"
url = "https://example.test/alpha.zip?access_token={secret}"
sha256 = "ABC"
root = "/addons/alpha"
"#,
    ));
    let before = fixture.catalog();

    let output = command(fixture.root())
        .args(["source", "validate", "--json"])
        .output()
        .expect("source validation should run");

    assert_eq!(output.status.code(), Some(2));
    let stdout = String::from_utf8(output.stdout).expect("stdout should be UTF-8");
    let events = stdout
        .lines()
        .map(|line| serde_json::from_str::<serde_json::Value>(line).expect("event should parse"))
        .collect::<Vec<_>>();
    assert_eq!(
        events
            .iter()
            .map(|event| event["type"].as_str().expect("event should have a type"))
            .collect::<Vec<_>>(),
        ["started", "progress"]
    );
    assert_eq!(events[0]["command"], "source-validate");
    let diagnostics = String::from_utf8(output.stderr)
        .expect("diagnostics should be UTF-8")
        .lines()
        .map(|line| {
            serde_json::from_str::<serde_json::Value>(line).expect("diagnostic should parse")
        })
        .collect::<Vec<_>>();
    assert_eq!(diagnostics.len(), 8);
    assert!(
        diagnostics
            .iter()
            .all(|diagnostic| diagnostic["protocol"] == 1)
    );
    assert!(
        diagnostics
            .iter()
            .all(|diagnostic| diagnostic["type"] == "diagnostic")
    );
    assert_eq!(
        diagnostics
            .iter()
            .map(|diagnostic| diagnostic["message"]
                .as_str()
                .expect("message should be a string"))
            .collect::<Vec<_>>(),
        [
            "package.Bad_Name.name is invalid",
            "package.Bad_Name.git.url is invalid",
            "package.Bad_Name.git.root is invalid",
            "package.Bad_Name.git.tag-prefix is invalid",
            "package.alpha.http.version is invalid",
            "package.alpha.http.url is invalid",
            "package.alpha.http.sha256 is invalid",
            "package.alpha.http.root is invalid",
        ]
    );
    assert!(!stdout.contains(secret));
    assert!(
        !diagnostics
            .iter()
            .any(|diagnostic| diagnostic.to_string().contains(secret))
    );
    assert_eq!(fixture.catalog(), before);
}

fn command(root: &Path) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_wukong"));
    command.current_dir(root);
    command
}

struct Fixture {
    _directory: TempDir,
    root: std::path::PathBuf,
}

impl Fixture {
    fn new(catalog: &str) -> Self {
        let directory = TempDir::new().expect("fixture directory should exist");
        let root = directory.path().join("game");
        fs::create_dir(&root).expect("project should create");
        fs::write(
            root.join("project.godot"),
            "[application]\nconfig/name=\"fixture\"\n",
        )
        .expect("project marker should write");
        fs::write(root.join("wukong.sources.toml"), catalog).expect("catalog should write");
        Self {
            _directory: directory,
            root,
        }
    }

    fn root(&self) -> &Path {
        &self.root
    }

    fn catalog(&self) -> String {
        fs::read_to_string(self.root.join("wukong.sources.toml")).expect("catalog should read")
    }
}
