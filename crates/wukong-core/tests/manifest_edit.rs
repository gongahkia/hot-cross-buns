use std::{fs, path::PathBuf};
use tempfile::TempDir;
use wukong_core::{
    diagnostic::ErrorCode,
    manifest::{GitReference, Manifest},
    manifest_edit::{DependencyDeclaration, DependencySection, add_dependency, remove_dependency},
};

const INITIAL_MANIFEST: &str = r#"# project comment
[project]
name = "fixture"
godot = "4"

[dependencies]
# zebra comment
zebra = "^1"
alpha = "^1"

[dev-dependencies]
# developer tool comment
tool = "^2"
local-tool = { path = "../local-tool" }
"#;

#[test]
fn invariant_add_preserves_unrelated_fields_and_comments() {
    let fixture = Fixture::new(INITIAL_MANIFEST);

    add_dependency(
        fixture.manifest_path(),
        DependencySection::Runtime,
        "beta",
        &DependencyDeclaration::Version("^3".to_owned()),
    )
    .expect("dependency should be added");
    let content = fixture.content();
    let parsed = Manifest::parse(fixture.manifest_path(), &content).expect("manifest should parse");

    assert!(content.contains("# project comment"));
    assert!(content.contains("# zebra comment"));
    assert!(content.contains("# developer tool comment"));
    assert!(content.contains("tool = \"^2\""));
    assert!(content.contains("beta = \"^3\""));
    assert!(parsed.dependencies().contains_key("beta"));
}

#[test]
fn invariant_add_sorts_the_modified_dependency_table_deterministically() {
    let first = Fixture::new(INITIAL_MANIFEST);
    let second = Fixture::new(INITIAL_MANIFEST);
    let declaration = DependencyDeclaration::Git {
        url: "https://example.test/beta".to_owned(),
        reference: Some(GitReference::Tag("v1.0.0".to_owned())),
    };

    add_dependency(
        first.manifest_path(),
        DependencySection::Runtime,
        "beta",
        &declaration,
    )
    .expect("first edit should succeed");
    add_dependency(
        second.manifest_path(),
        DependencySection::Runtime,
        "beta",
        &declaration,
    )
    .expect("second edit should succeed");
    let content = first.content();

    assert_eq!(content, second.content());
    assert!(
        content.find("alpha").expect("alpha should exist")
            < content.find("beta").expect("beta should exist")
    );
    assert!(
        content.find("beta").expect("beta should exist")
            < content.find("zebra").expect("zebra should exist")
    );
    assert!(content.contains("beta = { git = \"https://example.test/beta\", tag = \"v1.0.0\" }"));
}

#[test]
fn invariant_remove_only_changes_the_requested_dependency() {
    let fixture = Fixture::new(INITIAL_MANIFEST);

    remove_dependency(fixture.manifest_path(), DependencySection::Runtime, "zebra")
        .expect("dependency should be removed");
    let content = fixture.content();
    let parsed = Manifest::parse(fixture.manifest_path(), &content).expect("manifest should parse");

    assert!(!content.contains("zebra"));
    assert!(content.contains("alpha = \"^1\""));
    assert!(content.contains("# developer tool comment"));
    assert!(parsed.dependencies().contains_key("alpha"));
    assert!(parsed.dev_dependencies().contains_key("tool"));
}

#[test]
fn invariant_runtime_local_path_edit_leaves_the_manifest_unchanged() {
    let fixture = Fixture::new(INITIAL_MANIFEST);
    let before = fixture.content();

    let error = add_dependency(
        fixture.manifest_path(),
        DependencySection::Runtime,
        "beta",
        &DependencyDeclaration::Path(PathBuf::from("../beta")),
    )
    .expect_err("runtime local paths must be rejected");

    assert_eq!(error.code(), ErrorCode::UserInput);
    assert!(error.message().contains("only in [dev-dependencies]"));
    assert_eq!(fixture.content(), before);
}

#[test]
fn invariant_invalid_edit_leaves_the_existing_manifest_unchanged() {
    let fixture = Fixture::new(INITIAL_MANIFEST);
    let before = fixture.content();

    let error = add_dependency(
        fixture.manifest_path(),
        DependencySection::Runtime,
        "invalid",
        &DependencyDeclaration::Version("not-a-version".to_owned()),
    )
    .expect_err("invalid dependency should fail");

    assert_eq!(error.code(), ErrorCode::UserInput);
    assert!(error.message().contains("dependencies.invalid"));
    assert_eq!(fixture.content(), before);
}

#[test]
fn invariant_duplicate_and_missing_aliases_leave_the_manifest_unchanged() {
    let fixture = Fixture::new(INITIAL_MANIFEST);
    let before = fixture.content();

    let duplicate = add_dependency(
        fixture.manifest_path(),
        DependencySection::Runtime,
        "alpha",
        &DependencyDeclaration::Version("1".to_owned()),
    )
    .expect_err("duplicate dependency should fail");
    let missing = remove_dependency(
        fixture.manifest_path(),
        DependencySection::Development,
        "missing",
    )
    .expect_err("missing dependency should fail");

    assert_eq!(duplicate.code(), ErrorCode::UserInput);
    assert_eq!(missing.code(), ErrorCode::UserInput);
    assert_eq!(fixture.content(), before);
}

struct Fixture {
    _directory: TempDir,
    manifest_path: PathBuf,
}

impl Fixture {
    fn new(content: &str) -> Self {
        let directory = TempDir::new().expect("temporary directory should be created");
        let manifest_path = directory.path().join("wukong.toml");
        fs::write(&manifest_path, content).expect("manifest fixture should be written");
        Self {
            _directory: directory,
            manifest_path,
        }
    }

    fn manifest_path(&self) -> &std::path::Path {
        &self.manifest_path
    }

    fn content(&self) -> String {
        fs::read_to_string(&self.manifest_path).expect("manifest should be readable")
    }
}
