use std::{fs, path::Path, process::Command};
use tempfile::TempDir;

const CATALOG: &str = r#"schema = 1

[[package]]
name = "zeta"
[package.git]
url = "https://EXAMPLE.test:443/zeta.git"
root = "./addons/zeta"
tag-prefix = "v"

[[package]]
name = "alpha"
[package.http]
version = "1.2.3"
url = "https://127.0.0.1:9/alpha.zip"
sha256 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
root = "addons/alpha"
"#;

#[test]
fn invariant_source_list_is_read_only_and_uses_canonical_human_output() {
    let fixture = Fixture::new(CATALOG);
    let before = fixture.catalog();

    let output = command(fixture.root())
        .args(["source", "list"])
        .output()
        .expect("source list should run");

    assert!(output.status.success());
    assert_eq!(
        String::from_utf8(output.stdout).expect("output should be UTF-8"),
        "alpha:\n  http version=1.2.3 url=https://127.0.0.1:9/alpha.zip sha256=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef root=addons/alpha\nzeta:\n  git url=https://example.test/zeta.git root=addons/zeta tag-prefix=v\n"
    );
    assert_eq!(fixture.catalog(), before);
}

#[test]
fn invariant_source_list_json_is_versioned_line_framed_and_deterministic() {
    let fixture = Fixture::new(CATALOG);

    let first = command(fixture.root())
        .args(["source", "list", "--json"])
        .output()
        .expect("first source list should run");
    let second = command(fixture.root())
        .args(["source", "list", "--json"])
        .output()
        .expect("second source list should run");

    assert!(first.status.success());
    assert_eq!(first.stdout, second.stdout);
    let events = String::from_utf8(first.stdout)
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
    assert_eq!(events[0]["protocol"], 1);
    assert_eq!(events[0]["command"], "source-list");
    assert_eq!(events[1]["phase"], "reading-catalog");
    assert_eq!(
        events[2]["result"]["packages"]
            .as_array()
            .expect("packages should be an array")
            .iter()
            .map(|package| package["name"].as_str().expect("name should be a string"))
            .collect::<Vec<_>>(),
        ["alpha", "zeta"]
    );
    assert_eq!(events[2]["result"]["schema"], 1);
    assert_eq!(
        events[2]["result"]["packages"][1]["candidates"][0]["url"],
        "https://example.test/zeta.git"
    );
}

#[test]
fn invariant_source_list_json_diagnostics_redact_invalid_catalog_credentials() {
    let secret = "never-display-this";
    let fixture = Fixture::new(&format!(
        "schema = 1\n[[package]]\nname = \"alpha\"\n[package.git]\nurl = \"https://user:{secret}@example.test/alpha.git\"\nroot = \"addons/alpha\"\n"
    ));
    let before = fixture.catalog();

    let output = command(fixture.root())
        .args(["source", "list", "--json"])
        .output()
        .expect("source list should run");

    assert_eq!(output.status.code(), Some(2));
    let diagnostic: serde_json::Value =
        serde_json::from_slice(&output.stderr).expect("diagnostic should parse");
    assert_eq!(diagnostic["protocol"], 1);
    assert_eq!(diagnostic["type"], "diagnostic");
    assert_eq!(diagnostic["code"], "WUK001");
    assert!(
        !output
            .stderr
            .windows(secret.len())
            .any(|window| window == secret.as_bytes())
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
