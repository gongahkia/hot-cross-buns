use std::{fs, path::Path};
use tempfile::TempDir;
use wukong_core::layout::{LayoutOptions, detect_package_layout};

#[test]
fn invariant_root_without_addons_directory_is_the_addon() {
    let fixture = Fixture::new();
    fs::write(fixture.root().join("plugin.gd"), "extends Node\n").expect("addon file should write");

    let layout = detect_package_layout(fixture.root(), &LayoutOptions::default())
        .expect("root should select");

    assert_eq!(layout.source_root(), canonical(fixture.root()));
    assert_eq!(layout.target_path(), None);
}

#[test]
fn invariant_single_addons_child_is_selected() {
    let fixture = Fixture::new();
    let addon = fixture.root().join("addons/example");
    fs::create_dir_all(&addon).expect("addon directory should create");

    let layout = detect_package_layout(fixture.root(), &LayoutOptions::default())
        .expect("addon should select");

    assert_eq!(layout.source_root(), canonical(&addon));
}

#[test]
fn invariant_single_wrapper_directory_is_unwrapped_before_detection() {
    let fixture = Fixture::new();
    let addon = fixture.root().join("release/addons/example");
    fs::create_dir_all(&addon).expect("wrapped addon should create");

    let layout = detect_package_layout(fixture.root(), &LayoutOptions::default())
        .expect("wrapped addon should select");

    assert_eq!(layout.source_root(), canonical(&addon));
}

#[test]
fn invariant_multiple_addons_fail_with_all_candidates_listed() {
    let fixture = Fixture::new();
    fs::create_dir_all(fixture.root().join("addons/alpha")).expect("alpha should create");
    fs::create_dir_all(fixture.root().join("addons/zebra")).expect("zebra should create");

    let error = detect_package_layout(fixture.root(), &LayoutOptions::default())
        .expect_err("layout should be ambiguous");

    assert!(error.message().contains("ambiguous package layout"));
    assert!(error.message().contains("alpha"));
    assert!(error.message().contains("zebra"));
}

#[test]
fn invariant_explicit_subdirectory_and_target_override_inference() {
    let fixture = Fixture::new();
    let explicit = fixture.root().join("packages/chosen");
    fs::create_dir_all(&explicit).expect("explicit source should create");
    fs::create_dir_all(fixture.root().join("addons/alpha"))
        .expect("ambiguous source should create");
    fs::create_dir_all(fixture.root().join("addons/zebra"))
        .expect("ambiguous source should create");
    let options = LayoutOptions {
        source_subdirectory: Some("packages/chosen".into()),
        target_path: Some("addons/chosen".into()),
    };

    let layout =
        detect_package_layout(fixture.root(), &options).expect("explicit layout should select");

    assert_eq!(layout.source_root(), canonical(&explicit));
    assert_eq!(layout.target_path(), Some(Path::new("addons/chosen")));
}

#[test]
fn invariant_explicit_paths_cannot_escape_the_source_root() {
    let fixture = Fixture::new();
    let options = LayoutOptions {
        source_subdirectory: Some("../outside".into()),
        target_path: None,
    };

    let error = detect_package_layout(fixture.root(), &options).expect_err("traversal should fail");

    assert!(error.message().contains("source subdirectory"));
}

struct Fixture {
    directory: TempDir,
}
impl Fixture {
    fn new() -> Self {
        Self {
            directory: TempDir::new().expect("temporary directory should create"),
        }
    }
    fn root(&self) -> &Path {
        self.directory.path()
    }
}
fn canonical(path: &Path) -> std::path::PathBuf {
    fs::canonicalize(path).expect("path should canonicalize")
}
