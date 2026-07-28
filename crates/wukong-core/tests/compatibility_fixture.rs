use std::{
    env, fs,
    path::{Path, PathBuf},
};
use tempfile::TempDir;
use wukong_core::{
    compatibility_fixture::{CompatibilityFixture, verify_checked_out_fixture},
    layout::{LayoutOptions, detect_package_layout},
    package_tree::prepare_package_tree,
};

const PATH: &str = "fixture/compatibility.toml";

#[test]
fn invariant_fixture_parses_complete_immutable_metadata_without_execution() {
    let fixture = parse(
        r#"
schema = 1
id = "example-addon"
godot = ">=4.2,<5"
package_sha256 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
installed_paths = ["addons/example/plugin.cfg"]
headless_validation = ["godot", "--headless", "--quit"]

[source]
url = "https://github.com/example/example-addon.git"
revision = "0123456789abcdef0123456789abcdef01234567"

[layout]
source_subdirectory = "addons/example"
target_path = "addons/example"
"#,
    );

    assert_eq!(fixture.id().as_str(), "example-addon");
    assert_eq!(
        fixture.revision(),
        "0123456789abcdef0123456789abcdef01234567"
    );
    assert_eq!(
        fixture.installed_paths(),
        [PathBuf::from("addons/example/plugin.cfg")]
    );
    assert_eq!(
        fixture.headless_validation(),
        Some(["godot".into(), "--headless".into(), "--quit".into()].as_slice())
    );
}

#[test]
fn invariant_fixture_rejects_mutable_or_unsafe_metadata() {
    let error = CompatibilityFixture::parse(
        Path::new(PATH),
        r#"
schema = 1
id = "example-addon"
godot = "4"
package_sha256 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
installed_paths = ["addons/example/plugin.cfg"]

[source]
url = "https://user:secret@example.test/addon.git"
revision = "main"

[layout]
source_subdirectory = "../escape"
target_path = "addons/example"
"#,
    )
    .expect_err("unsafe source metadata should fail");

    assert_eq!(error.code(), wukong_core::diagnostic::ErrorCode::UserInput);
    assert!(error.message().contains("source.url"));
}

#[test]
fn invariant_initial_public_corpus_has_five_unique_complete_fixtures() {
    let fixtures = fixture_paths()
        .into_iter()
        .map(|path| {
            let input = fs::read_to_string(&path).expect("fixture should read");
            CompatibilityFixture::parse(&path, &input).expect("fixture should parse")
        })
        .collect::<Vec<_>>();

    assert_eq!(fixtures.len(), 5);
    let ids = fixtures
        .iter()
        .map(CompatibilityFixture::id)
        .collect::<std::collections::BTreeSet<_>>();
    assert_eq!(ids.len(), fixtures.len());
    assert!(
        fixtures
            .iter()
            .all(|fixture| fixture.headless_validation().is_none())
    );
}

#[test]
#[ignore = "requires manually checked-out pinned public addon sources"]
fn invariant_pinned_public_sources_match_recorded_canonical_content() {
    let root = env::var_os("WUKONG_COMPATIBILITY_SOURCES")
        .map(PathBuf::from)
        .expect("set WUKONG_COMPATIBILITY_SOURCES to checked-out fixture sources");
    let staging = TempDir::new().expect("staging parent should exist");
    for fixture_path in fixture_paths() {
        let input = fs::read_to_string(&fixture_path).expect("fixture should read");
        let fixture =
            CompatibilityFixture::parse(&fixture_path, &input).expect("fixture should parse");
        let source = root.join(fixture.id().as_str());
        let stage = staging.path().join(fixture.id().as_str());
        let layout = detect_package_layout(
            &source,
            &LayoutOptions {
                source_subdirectory: Some(fixture.source_subdirectory().to_path_buf()),
                target_path: Some(fixture.target_path().to_path_buf()),
            },
        )
        .expect("pinned source layout should resolve");
        let prepared = prepare_package_tree(layout.source_root(), &stage)
            .expect("pinned source should prepare");
        let actual_paths = prepared
            .files()
            .iter()
            .map(|file| fixture.target_path().join(file.path()))
            .collect::<Vec<_>>();
        assert_eq!(
            prepared.sha256(),
            fixture.package_sha256(),
            "{}",
            fixture.id()
        );
        assert_eq!(actual_paths, fixture.installed_paths(), "{}", fixture.id());
        verify_checked_out_fixture(
            &fixture,
            &source,
            &staging.path().join(format!("{}-verify", fixture.id())),
        )
        .expect("recorded fixture should verify without executing commands");
    }
}

fn parse(input: &str) -> CompatibilityFixture {
    CompatibilityFixture::parse(Path::new(PATH), input).expect("fixture should parse")
}

fn fixture_paths() -> Vec<PathBuf> {
    let directory = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/compatibility/v1");
    let mut paths = fs::read_dir(directory)
        .expect("fixture directory should read")
        .map(|entry| entry.expect("fixture entry should read").path())
        .collect::<Vec<_>>();
    paths.sort();
    paths
}
