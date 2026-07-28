use std::{fs, path::Path};
use tempfile::TempDir;
use wukong_core::{
    diagnostic::ErrorCode,
    init::initialize_manifest,
    manifest::{MANIFEST_FILE_NAME, Manifest},
    project::{PROJECT_FILE_NAME, ProjectRoot},
};

#[test]
fn invariant_init_publishes_a_deterministic_manifest_that_parses() {
    let fixture = Fixture::new("[application]\nconfig/name=\"My Game\"\n");
    let project = fixture.project();

    let initialized = initialize_manifest(&project).expect("initialization should succeed");
    let content = fs::read_to_string(initialized.path()).expect("manifest should be readable");
    let parsed = Manifest::parse(initialized.path(), &content).expect("manifest should parse");

    assert_eq!(initialized.project_name(), "My Game");
    assert_eq!(
        content,
        "[project]\nname = \"My Game\"\ngodot = \">=4.0,<5\"\n"
    );
    assert_eq!(parsed.project().name(), "My Game");
    assert_eq!(
        fixture
            .root()
            .read_dir()
            .expect("project directory should be readable")
            .filter_map(Result::ok)
            .filter_map(|entry| entry.file_name().into_string().ok())
            .filter(|name| name.starts_with(".wukong.toml."))
            .count(),
        0
    );
}

#[test]
fn invariant_init_never_overwrites_an_existing_manifest() {
    let fixture = Fixture::new("[application]\nconfig/name=\"My Game\"\n");
    let project = fixture.project();
    let manifest_path = fixture.root().join(MANIFEST_FILE_NAME);
    fs::write(&manifest_path, "project-owned content\n").expect("manifest fixture should write");

    let error = initialize_manifest(&project).expect_err("initialization should fail");

    assert_eq!(error.code(), ErrorCode::UserInput);
    assert!(error.message().contains("already exists"));
    assert_eq!(
        fs::read_to_string(manifest_path).expect("existing manifest should remain readable"),
        "project-owned content\n"
    );
}

#[test]
fn invariant_repeated_init_keeps_the_initial_manifest_unchanged() {
    let fixture = Fixture::new("[application]\nconfig/name=\"My Game\"\n");
    let project = fixture.project();

    let initialized = initialize_manifest(&project).expect("first initialization should succeed");
    let first = fs::read_to_string(initialized.path()).expect("manifest should be readable");
    let error = initialize_manifest(&project).expect_err("second initialization should fail");

    assert_eq!(error.code(), ErrorCode::UserInput);
    assert_eq!(
        fs::read_to_string(initialized.path()).expect("manifest should remain readable"),
        first
    );
}

#[test]
fn invariant_init_falls_back_to_the_project_directory_name() {
    let fixture = Fixture::new("[rendering]\nrenderer/rendering_method=\"gl_compatibility\"\n");
    let project = fixture.project();

    let initialized = initialize_manifest(&project).expect("initialization should succeed");

    assert_eq!(initialized.project_name(), "fixture-game");
}

#[test]
fn invariant_init_escapes_a_godot_project_name_without_changing_it() {
    let fixture = Fixture::new("[application]\nconfig/name=\"My \\\"Quoted\\\" Game\"\n");
    let project = fixture.project();
    let initialized = initialize_manifest(&project).expect("initialization should succeed");
    let content = fs::read_to_string(initialized.path()).expect("manifest should be readable");
    let parsed = Manifest::parse(initialized.path(), &content).expect("manifest should parse");

    assert_eq!(parsed.project().name(), "My \"Quoted\" Game");
}

struct Fixture {
    _directory: TempDir,
    root: std::path::PathBuf,
}

impl Fixture {
    fn new(project_content: &str) -> Self {
        let directory = TempDir::new().expect("temporary directory should be created");
        let root = directory.path().join("fixture-game");
        fs::create_dir(&root).expect("project root should be created");
        fs::write(root.join(PROJECT_FILE_NAME), project_content)
            .expect("project marker should be written");
        Self {
            _directory: directory,
            root,
        }
    }

    fn root(&self) -> &Path {
        &self.root
    }

    fn project(&self) -> ProjectRoot {
        ProjectRoot::discover(self.root(), None).expect("project should resolve")
    }
}
