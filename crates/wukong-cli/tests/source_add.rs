use std::{fs, path::Path, process::Command};
use tempfile::TempDir;
use wukong_core::source_catalog::SourceCatalog;

const SHA256: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

#[test]
fn invariant_source_add_creates_and_validates_git_and_http_candidates_without_fetching() {
    let fixture = Fixture::new(None);

    let git = command(fixture.root())
        .args([
            "source",
            "add",
            "zeta",
            "--git",
            "https://EXAMPLE.test:443/zeta.git",
            "--root",
            "./addons/zeta",
            "--tag-prefix",
            "v",
        ])
        .output()
        .expect("Git source add should run");
    let http = command(fixture.root())
        .args([
            "source",
            "add",
            "alpha",
            "--url",
            "https://127.0.0.1:9/alpha.zip",
            "--version",
            "1.2.3",
            "--sha256",
            SHA256,
            "--root",
            "addons/alpha",
        ])
        .output()
        .expect("HTTP source add should run");

    assert!(git.status.success());
    assert!(http.status.success());
    assert_eq!(
        String::from_utf8(git.stdout).expect("output should be UTF-8"),
        "added source candidate zeta\n"
    );
    assert_eq!(
        String::from_utf8(http.stdout).expect("output should be UTF-8"),
        "added source candidate alpha\n"
    );
    SourceCatalog::load(&fixture.catalog_path())
        .and_then(|catalog| catalog.validate(&fixture.catalog_path()))
        .expect("written catalog should validate");
    let list = command(fixture.root())
        .args(["source", "list"])
        .output()
        .expect("source list should run");
    assert_eq!(
        String::from_utf8(list.stdout).expect("output should be UTF-8"),
        format!(
            "alpha:\n  http version=1.2.3 url=https://127.0.0.1:9/alpha.zip sha256={SHA256} root=addons/alpha\nzeta:\n  git url=https://example.test/zeta.git root=addons/zeta tag-prefix=v\n"
        )
    );
}

#[test]
fn invariant_source_add_preserves_existing_catalog_content() {
    let initial = "# retained comment\nschema = 1\n";
    let fixture = Fixture::new(Some(initial));

    let output = command(fixture.root())
        .args([
            "source",
            "add",
            "alpha",
            "--url",
            "https://example.test/alpha.zip",
            "--version",
            "1.0.0",
            "--sha256",
            SHA256,
            "--root",
            "addons/alpha",
        ])
        .output()
        .expect("source add should run");

    assert!(output.status.success());
    let catalog = fixture.catalog();
    assert!(catalog.starts_with(initial));
    assert!(catalog.contains("name = \"alpha\""));
}

#[test]
fn invariant_source_add_json_is_line_framed_and_redacts_failures_with_stable_exit_codes() {
    let fixture = Fixture::new(Some("schema = 1\n"));
    let added = command(fixture.root())
        .args([
            "source",
            "add",
            "alpha",
            "--url",
            "https://example.test/alpha.zip",
            "--version",
            "1.0.0",
            "--sha256",
            SHA256,
            "--root",
            "addons/alpha",
            "--json",
        ])
        .output()
        .expect("JSON source add should run");

    assert!(added.status.success());
    let events = json_events(&added.stdout);
    assert_eq!(event_types(&events), ["started", "progress", "result"]);
    assert!(events.iter().all(|event| event["protocol"] == 1));
    assert_eq!(events[0]["command"], "source-add");
    assert_eq!(events[2]["result"]["operation"], "added");
    assert_eq!(events[2]["result"]["name"], "alpha");

    let secret = "never-display-this";
    let failed = command(fixture.root())
        .args([
            "source",
            "add",
            "beta",
            "--git",
            &format!("https://user:{secret}@example.test/beta.git"),
            "--root",
            "../addons/beta",
            "--json",
        ])
        .output()
        .expect("invalid JSON source add should run");

    assert_eq!(failed.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&failed.stderr).lines().all(|line| {
        serde_json::from_str::<serde_json::Value>(line).is_ok() && !line.contains(secret)
    }));
    let diagnostic: serde_json::Value =
        serde_json::from_slice(&failed.stderr).expect("diagnostic should parse");
    assert_eq!(diagnostic["protocol"], 1);
    assert_eq!(diagnostic["type"], "diagnostic");
}

#[test]
fn invariant_invalid_or_duplicate_source_add_leaves_catalog_unchanged_and_redacts_credentials() {
    let fixture = Fixture::new(Some("schema = 1\n"));
    let before = fixture.catalog();
    let secret = "never-display-this";

    let invalid = command(fixture.root())
        .args([
            "source",
            "add",
            "alpha",
            "--git",
            &format!("https://user:{secret}@example.test/alpha.git"),
            "--root",
            "../addons/alpha",
        ])
        .output()
        .expect("invalid source add should run");

    assert_eq!(invalid.status.code(), Some(2));
    assert!(!String::from_utf8_lossy(&invalid.stderr).contains(secret));
    assert_eq!(fixture.catalog(), before);

    let valid_arguments = [
        "source",
        "add",
        "alpha",
        "--url",
        "https://example.test/alpha.zip",
        "--version",
        "1.0.0",
        "--sha256",
        SHA256,
        "--root",
        "addons/alpha",
    ];
    assert!(
        command(fixture.root())
            .args(valid_arguments)
            .output()
            .expect("valid source add should run")
            .status
            .success()
    );
    let after_valid = fixture.catalog();
    let duplicate = command(fixture.root())
        .args(valid_arguments)
        .output()
        .expect("duplicate source add should run");
    assert_eq!(duplicate.status.code(), Some(2));
    assert_eq!(fixture.catalog(), after_valid);
}

fn command(root: &Path) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_wukong"));
    command.current_dir(root);
    command
}

fn json_events(output: &[u8]) -> Vec<serde_json::Value> {
    std::str::from_utf8(output)
        .expect("output should be UTF-8")
        .lines()
        .map(|line| serde_json::from_str(line).expect("event should parse"))
        .collect()
}

fn event_types(events: &[serde_json::Value]) -> Vec<&str> {
    events
        .iter()
        .map(|event| event["type"].as_str().expect("event should have type"))
        .collect()
}

struct Fixture {
    _directory: TempDir,
    root: std::path::PathBuf,
}

impl Fixture {
    fn new(catalog: Option<&str>) -> Self {
        let directory = TempDir::new().expect("fixture directory should exist");
        let root = directory.path().join("game");
        fs::create_dir(&root).expect("project should create");
        fs::write(
            root.join("project.godot"),
            "[application]\nconfig/name=\"fixture\"\n",
        )
        .expect("project marker should write");
        if let Some(catalog) = catalog {
            fs::write(root.join("wukong.sources.toml"), catalog).expect("catalog should write");
        }
        Self {
            _directory: directory,
            root,
        }
    }

    fn root(&self) -> &Path {
        &self.root
    }

    fn catalog_path(&self) -> std::path::PathBuf {
        self.root.join("wukong.sources.toml")
    }

    fn catalog(&self) -> String {
        fs::read_to_string(self.catalog_path()).expect("catalog should read")
    }
}
