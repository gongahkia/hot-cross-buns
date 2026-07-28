use std::{fs, path::Path};
use tempfile::TempDir;
use wukong_core::{
    diagnostic::ErrorCode,
    project::{PROJECT_FILE_NAME, ProjectRoot},
};

#[test]
fn invariant_project_root_is_detected_from_the_current_directory() {
    let fixture = Fixture::new();
    Fixture::create_project(fixture.root());

    let project = ProjectRoot::discover(fixture.root(), None).expect("project root should resolve");
    let expected_root = canonical_path(fixture.root());

    assert_eq!(project.path(), expected_root);
    assert_eq!(
        project.project_file(),
        expected_root.join(PROJECT_FILE_NAME)
    );
}

#[test]
fn invariant_project_root_is_detected_from_a_nested_directory() {
    let fixture = Fixture::new();
    Fixture::create_project(fixture.root());
    let nested = fixture.root().join("scenes").join("menus");
    fs::create_dir_all(&nested).expect("nested directory should be created");

    let project = ProjectRoot::discover(&nested, None).expect("ancestor project should resolve");

    assert_eq!(project.path(), canonical_path(fixture.root()));
}

#[test]
fn invariant_explicit_project_file_overrides_starting_directory() {
    let fixture = Fixture::new();
    let project_root = fixture.root().join("game");
    Fixture::create_project(&project_root);
    let unrelated = fixture.root().join("outside");
    fs::create_dir_all(&unrelated).expect("unrelated directory should be created");

    let project = ProjectRoot::discover(&unrelated, Some(&project_root.join(PROJECT_FILE_NAME)))
        .expect("explicit project file should resolve");

    assert_eq!(project.path(), canonical_path(&project_root));
}

#[test]
fn invariant_explicit_project_directory_overrides_starting_directory() {
    let fixture = Fixture::new();
    let project_root = fixture.root().join("game");
    Fixture::create_project(&project_root);
    let unrelated = fixture.root().join("outside");
    fs::create_dir_all(&unrelated).expect("unrelated directory should be created");

    let project = ProjectRoot::discover(&unrelated, Some(&project_root))
        .expect("explicit root should resolve");

    assert_eq!(project.path(), canonical_path(&project_root));
}

#[test]
fn invariant_missing_project_returns_a_recoverable_user_error() {
    let fixture = Fixture::new();
    let start = fixture.root().join("empty");
    fs::create_dir(&start).expect("empty directory should be created");

    let error = ProjectRoot::discover(&start, None).expect_err("missing project should fail");

    assert_eq!(error.code(), ErrorCode::UserInput);
    assert!(error.message().contains("no Godot project"));
    assert_eq!(
        error.recovery(),
        Some("run inside a Godot project or provide --project <path>")
    );
}

#[test]
fn invariant_nearest_nested_project_root_wins_deterministically() {
    let fixture = Fixture::new();
    Fixture::create_project(fixture.root());
    let nested_root = fixture.root().join("tools").join("inner-game");
    Fixture::create_project(&nested_root);
    let start = nested_root.join("addons").join("example");
    fs::create_dir_all(&start).expect("nested project directory should be created");

    let project = ProjectRoot::discover(&start, None).expect("nearest project should resolve");

    assert_eq!(project.path(), canonical_path(&nested_root));
}

struct Fixture {
    directory: TempDir,
}

impl Fixture {
    fn new() -> Self {
        Self {
            directory: TempDir::new().expect("temporary fixture should be created"),
        }
    }

    fn root(&self) -> &Path {
        self.directory.path()
    }

    fn create_project(root: &Path) {
        fs::create_dir_all(root).expect("project directory should be created");
        fs::write(
            root.join(PROJECT_FILE_NAME),
            "[application]\nconfig/name=\"fixture\"\n",
        )
        .expect("project marker should be written");
    }
}

fn canonical_path(path: &Path) -> std::path::PathBuf {
    fs::canonicalize(path).expect("fixture path should canonicalize")
}
