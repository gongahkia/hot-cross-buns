use std::{
    collections::BTreeSet,
    env, fs,
    path::{Path, PathBuf},
    process::Command,
};
use tempfile::TempDir;
use wukong_core::{
    compatibility_fixture::{CompatibilityFixture, verify_checked_out_fixture},
    installed_state::{DependencyGroup, InstalledPackage},
    layout::{LayoutOptions, detect_package_layout},
    ownership::{PackageMaterialization, build_desired_file_map},
    package_tree::prepare_package_tree,
    project_sync::sync_project,
    source::ImmutableSourceId,
};

const PATH: &str = "fixture/compatibility.toml";
const EXPECTED_CORPUS_SIZE: usize = 100;

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
fn invariant_public_corpus_has_one_hundred_unique_complete_fixtures() {
    let fixtures = fixture_paths()
        .into_iter()
        .map(|path| {
            let input = fs::read_to_string(&path).expect("fixture should read");
            CompatibilityFixture::parse(&path, &input).expect("fixture should parse")
        })
        .collect::<Vec<_>>();

    assert_eq!(fixtures.len(), EXPECTED_CORPUS_SIZE);
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
fn invariant_ready_to_go_fixtures_select_explicit_independent_layouts() {
    let fixtures = fixture_paths()
        .into_iter()
        .map(|path| {
            let input = fs::read_to_string(&path).expect("fixture should read");
            CompatibilityFixture::parse(&path, &input).expect("fixture should parse")
        })
        .filter(|fixture| {
            fixture.source_url()
                == "https://github.com/wdjacobo/ready_to_go_godot_4.4_project_public.git"
        })
        .collect::<Vec<_>>();

    assert_eq!(fixtures.len(), 2);
    assert!(
        fixtures
            .windows(2)
            .all(|pair| pair[0].source_subdirectory() != pair[1].source_subdirectory())
    );
}

#[test]
fn invariant_bbcode_and_yati_fixtures_select_explicit_independent_layouts() {
    let fixtures = fixture_paths()
        .into_iter()
        .map(|path| {
            let input = fs::read_to_string(&path).expect("fixture should read");
            CompatibilityFixture::parse(&path, &input).expect("fixture should parse")
        })
        .collect::<Vec<_>>();

    let bbcode = fixtures
        .iter()
        .filter(|fixture| fixture.source_url() == "https://github.com/Patou-todoG/BBCodeEdit.git")
        .collect::<Vec<_>>();
    assert_eq!(bbcode.len(), 3);
    assert!(
        bbcode
            .windows(2)
            .all(|pair| pair[0].source_subdirectory() != pair[1].source_subdirectory())
    );

    let yati = fixtures
        .iter()
        .filter(|fixture| fixture.source_url() == "https://github.com/Kiamo2/YATI.git")
        .collect::<Vec<_>>();
    assert_eq!(yati.len(), 2);
    assert!(
        yati.windows(2)
            .all(|pair| pair[0].source_subdirectory() != pair[1].source_subdirectory())
    );
}

#[test]
fn invariant_native_extension_fixture_records_gdextension_descriptor() {
    let fixture_path = fixture_paths()
        .into_iter()
        .find(|path| path.file_stem().is_some_and(|stem| stem == "quarkphysics"))
        .expect("quarkphysics fixture should exist");
    let input = fs::read_to_string(&fixture_path).expect("fixture should read");
    let fixture = CompatibilityFixture::parse(&fixture_path, &input).expect("fixture should parse");

    assert_eq!(fixture.id().as_str(), "quarkphysics");
    assert_eq!(
        fixture.revision(),
        "29ca59d2536662352dc9c07c6e727c77014fdb3f"
    );
    assert!(fixture.installed_paths().contains(&PathBuf::from(
        "addons/quarkphysics/bin/quarkphysics.gdextension"
    )));
}

#[test]
fn invariant_multi_addon_repository_fixtures_select_distinct_explicit_layouts() {
    let fixtures = fixture_paths()
        .into_iter()
        .map(|path| {
            let input = fs::read_to_string(&path).expect("fixture should read");
            CompatibilityFixture::parse(&path, &input).expect("fixture should parse")
        })
        .filter(|fixture| fixture.source_url() == "https://github.com/GDQuest/godot-addons.git")
        .collect::<Vec<_>>();

    assert_eq!(fixtures.len(), 4);
    assert_eq!(
        fixtures
            .iter()
            .map(|fixture| fixture.id().as_str())
            .collect::<Vec<_>>(),
        [
            "gdquest-3d-math-visualizer",
            "gdquest-colorpicker-presets",
            "gdquest-prototype-material",
            "gdquest-sparkly-bag",
        ]
    );
    assert!(
        fixtures
            .windows(2)
            .all(|pair| pair[0].source_subdirectory() != pair[1].source_subdirectory())
    );
    assert!(
        fixtures
            .iter()
            .all(|fixture| fixture.revision() == "74cb5e8c1eab4fa442b37ba39c69fb9d0b8f5162")
    );
}

#[test]
fn invariant_fixture_verification_normalizes_prepared_path_order() {
    let temporary = TempDir::new().expect("temporary fixture root should exist");
    let source = temporary.path().join("source");
    let addon = source.join("addons/example");
    fs::create_dir_all(addon.join("plugin")).expect("addon child directory should exist");
    fs::write(addon.join("plugin/child.gd"), "extends Node\n")
        .expect("addon child file should write");
    fs::write(addon.join("plugin.cfg"), "[plugin]\nname=\"Example\"\n")
        .expect("addon root file should write");
    let prepared = prepare_package_tree(&addon, &temporary.path().join("initial-stage"))
        .expect("synthetic addon should prepare");
    let fixture = parse(&format!(
        r#"
schema = 1
id = "example-addon"
godot = ">=4.0,<5.0"
package_sha256 = "{}"
installed_paths = [
  "addons/example/plugin/child.gd",
  "addons/example/plugin.cfg",
]

[source]
url = "https://github.com/example/example-addon.git"
revision = "0123456789abcdef0123456789abcdef01234567"

[layout]
source_subdirectory = "addons/example"
target_path = "addons/example"
"#,
        prepared.sha256()
    ));

    verify_checked_out_fixture(&fixture, &source, &temporary.path().join("verify-stage"))
        .expect("fixture verification should use the persisted path ordering");
}

#[test]
#[ignore = "requires manually checked-out pinned public addon sources"]
fn invariant_pinned_public_sources_cold_warm_and_noop_materialise_as_recorded() {
    let root = env::var_os("WUKONG_COMPATIBILITY_SOURCES")
        .map(PathBuf::from)
        .expect("set WUKONG_COMPATIBILITY_SOURCES to checked-out fixture sources");
    let staging = TempDir::new().expect("staging parent should exist");
    for fixture_path in fixture_paths() {
        let input = fs::read_to_string(&fixture_path).expect("fixture should read");
        let fixture =
            CompatibilityFixture::parse(&fixture_path, &input).expect("fixture should parse");
        let source = root.join(fixture.id().as_str());
        assert_checkout_revision(&source, fixture.revision());
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
        let mut actual_paths = prepared
            .files()
            .iter()
            .map(|file| fixture.target_path().join(file.path()))
            .collect::<Vec<_>>();
        actual_paths.sort();
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
        let desired = build_desired_file_map([PackageMaterialization::new(
            fixture.id(),
            &prepared,
            fixture.target_path(),
        )])
        .expect("prepared fixture should have no ownership conflicts");
        let package = InstalledPackage::new(
            fixture.id().clone(),
            ImmutableSourceId::new(format!("git:{}", fixture.revision()))
                .expect("fixture revision should create an immutable identity"),
            fixture.package_sha256().to_owned(),
        )
        .expect("fixture package should form installed state");
        let groups = BTreeSet::from([DependencyGroup::Dependencies]);
        let cold_project = TempDir::new().expect("cold project should exist");
        let cold = sync_project(
            cold_project.path(),
            groups.clone(),
            [package.clone()],
            &desired,
        )
        .expect("cold fixture materialisation should work");
        assert_eq!(cold.written, desired.files().len(), "{}", fixture.id());
        let warm_project = TempDir::new().expect("warm project should exist");
        let warm = sync_project(
            warm_project.path(),
            groups.clone(),
            [package.clone()],
            &desired,
        )
        .expect("warm fixture materialisation should reuse the prepared tree");
        assert_eq!(warm.written, desired.files().len(), "{}", fixture.id());
        let noop = sync_project(warm_project.path(), groups, [package], &desired)
            .expect("repeat fixture materialisation should be idempotent");
        assert_eq!(noop.written, 0, "{}", fixture.id());
        assert_eq!(noop.unchanged, desired.files().len(), "{}", fixture.id());
    }
}

fn assert_checkout_revision(source: &Path, expected: &str) {
    let output = Command::new("git")
        .args(["-C"])
        .arg(source)
        .args(["rev-parse", "HEAD"])
        .output()
        .expect("Git should inspect the supplied checked-out fixture");
    assert!(output.status.success(), "{}", source.display());
    assert_eq!(
        String::from_utf8(output.stdout)
            .expect("Git revision should be UTF-8")
            .trim(),
        expected,
        "{}",
        source.display()
    );
    let output = Command::new("git")
        .args(["-C"])
        .arg(source)
        .args(["status", "--porcelain", "--untracked-files=all"])
        .output()
        .expect("Git should inspect the supplied checkout state");
    assert!(output.status.success(), "{}", source.display());
    assert!(
        String::from_utf8(output.stdout)
            .expect("Git status should be UTF-8")
            .trim()
            .is_empty(),
        "{} must be clean before fixture verification",
        source.display()
    );
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
