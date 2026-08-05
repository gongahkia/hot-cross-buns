use std::{fs, path::Path, process::Command};
use tempfile::TempDir;
use wukong_core::source_catalog::SourceCatalog;

const SHA256: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const CATALOG: &str = r#"schema = 1

# alpha can be selected by name
[[package]]
name = "alpha"
[package.git]
url = "https://EXAMPLE.test:443/alpha.git"
root = "./addons/alpha"

# zeta must be selected exactly
[[package]]
name = "zeta"
[package.http]
version = "1.0.0"
url = "https://example.test/zeta.zip"
sha256 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
root = "addons/zeta"
"#;

#[test]
fn invariant_source_remove_preserves_unrelated_content_and_supports_exact_selection() {
    let fixture = Fixture::new(CATALOG);
    let zeta = r#"# zeta must be selected exactly
[[package]]
name = "zeta"
[package.http]
version = "1.0.0"
url = "https://example.test/zeta.zip"
sha256 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
root = "addons/zeta"
"#;

    let by_name = command(fixture.root())
        .args(["source", "remove", "alpha"])
        .output()
        .expect("source remove should run");

    assert!(by_name.status.success());
    assert_eq!(
        String::from_utf8(by_name.stdout).expect("output should be UTF-8"),
        "removed source candidate alpha\n"
    );
    assert!(fixture.catalog().contains(zeta));

    let exact = command(fixture.root())
        .args([
            "source",
            "remove",
            "zeta",
            "--url",
            "https://example.test/zeta.zip",
            "--version",
            "1.0.0",
            "--sha256",
            SHA256,
            "--root",
            "addons/zeta",
        ])
        .output()
        .expect("exact source remove should run");

    assert!(exact.status.success());
    assert_eq!(
        String::from_utf8(exact.stdout).expect("output should be UTF-8"),
        "removed source candidate zeta\n"
    );
    SourceCatalog::load(&fixture.catalog_path())
        .and_then(|catalog| catalog.validate(&fixture.catalog_path()))
        .expect("remaining catalog should validate");
    assert!(!fixture.catalog().contains("[[package]]"));
}

#[test]
fn invariant_source_remove_rejects_missing_and_ambiguous_candidates_without_mutation() {
    let fixture = Fixture::new(&format!(
        r#"schema = 1
[[package]]
name = "alpha"
[package.http]
version = "1.0.0"
url = "https://example.test/alpha-1.0.0.zip"
sha256 = "{SHA256}"
root = "addons/alpha"

[[package]]
name = "alpha"
[package.http]
version = "1.2.3"
url = "https://example.test/alpha-1.2.3.zip"
sha256 = "{SHA256}"
root = "addons/alpha"
"#,
    ));
    let before = fixture.catalog();

    let ambiguous = command(fixture.root())
        .args(["source", "remove", "alpha"])
        .output()
        .expect("ambiguous source remove should run");
    assert_eq!(ambiguous.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&ambiguous.stderr).contains("ambiguous"));
    assert_eq!(fixture.catalog(), before);

    let missing = command(fixture.root())
        .args(["source", "remove", "missing"])
        .output()
        .expect("missing source remove should run");
    assert_eq!(missing.status.code(), Some(2));
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

    fn catalog_path(&self) -> std::path::PathBuf {
        self.root.join("wukong.sources.toml")
    }

    fn catalog(&self) -> String {
        fs::read_to_string(self.catalog_path()).expect("catalog should read")
    }
}
