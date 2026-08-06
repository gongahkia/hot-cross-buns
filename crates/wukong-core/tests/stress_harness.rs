use std::{
    fs,
    path::{Path, PathBuf},
};
use tempfile::TempDir;
use wukong_core::{
    direct_lock::lock_direct_local_dependencies,
    direct_sync::sync_direct_local_dependencies,
    installed_state::{InstalledState, state_path},
    manifest::Manifest,
};

const PACKAGE_COUNTS: [usize; 4] = [1, 10, 100, 500];
const MANY_FILE_COUNT: usize = 512;
const LARGE_FILE_BYTES: usize = 8 * 1024 * 1024;
const SHARED_SOURCE_ALIAS_COUNT: usize = 16;

#[test]
fn invariant_stress_local_dependency_counts_are_transactional_and_idempotent() {
    for package_count in PACKAGE_COUNTS {
        let fixture = Fixture::new();
        let manifest = fixture.manifest(package_count);
        let lock = lock_direct_local_dependencies(fixture.manifest_path(), &manifest, None)
            .expect("stress local dependencies should lock");

        let first = sync_direct_local_dependencies(
            fixture.project(),
            fixture.manifest_path(),
            &manifest,
            &lock,
            true,
        )
        .expect("stress fresh sync should work");
        let second = sync_direct_local_dependencies(
            fixture.project(),
            fixture.manifest_path(),
            &manifest,
            &lock,
            true,
        )
        .expect("stress no-op sync should work");
        let state = InstalledState::parse(
            &state_path(fixture.project()),
            &fs::read_to_string(state_path(fixture.project())).expect("state should read"),
        )
        .expect("stress state should parse");

        assert_eq!(lock.packages().len(), package_count);
        assert_eq!(state.packages().len(), package_count);
        assert_eq!(first.written, package_count * 2);
        assert_eq!(second.written, 0);
        assert_eq!(second.removed, 0);
        assert_eq!(second.unchanged, package_count * 2);
        assert_eq!(
            fs::read_to_string(
                fixture
                    .project()
                    .join(format!("addons/addon-{package_count}/plugin.gd"))
            )
            .expect("last package should materialise"),
            format!("extends Node\n# {package_count}\n")
        );
    }
}

#[test]
fn invariant_stress_deep_unicode_package_tree_materialises_without_path_loss() {
    let fixture = Fixture::new();
    let source = fixture.project().join("shaped");
    let nested = (0..24).fold(source.clone(), |path, index| {
        path.join(format!("nested-{index:02}"))
    });
    let relative = nested
        .strip_prefix(&source)
        .expect("nested path should remain inside source")
        .join("東京-ß-長い名前.gd");
    fs::create_dir_all(&nested).expect("deep source path should create");
    fs::write(source.join(&relative), "extends Node\n# unicode\n")
        .expect("deep source should write");
    fs::write(
        source.join("wukong-package.toml"),
        "[package]\nschema = 1\nname = \"shaped\"\nversion = \"1.0.0\"\ngodot = \"4\"\n",
    )
    .expect("deep package metadata should write");
    let manifest_text = "[project]\nname = \"stress\"\ngodot = \"4\"\n\n[dev-dependencies]\nshaped = { path = \"shaped\" }\n";
    fs::write(fixture.manifest_path(), manifest_text).expect("deep manifest should write");
    let manifest = Manifest::parse(fixture.manifest_path(), manifest_text)
        .expect("deep manifest should parse");
    let lock = lock_direct_local_dependencies(fixture.manifest_path(), &manifest, None)
        .expect("deep package should lock");

    sync_direct_local_dependencies(
        fixture.project(),
        fixture.manifest_path(),
        &manifest,
        &lock,
        true,
    )
    .expect("deep package should sync");

    assert_eq!(
        fs::read_to_string(fixture.project().join("addons/shaped").join(relative))
            .expect("deep unicode output should read"),
        "extends Node\n# unicode\n"
    );
}

#[test]
fn invariant_stress_large_and_many_file_packages_are_idempotent() {
    let fixture = Fixture::new();
    let large = fixture.project().join("large");
    let large_content = vec![0xA5; LARGE_FILE_BYTES];
    Fixture::write_package_file(&large, "large", Path::new("plugin.gd"), &large_content);

    let many = fixture.project().join("many");
    for index in 0..MANY_FILE_COUNT {
        Fixture::write_package_file(
            &many,
            "many",
            &PathBuf::from(format!("scripts/file-{index:04}.gd")),
            format!("extends Node\n# {index}\n").as_bytes(),
        );
    }
    Fixture::write_metadata(&many, "many");
    let manifest_text = "[project]\nname = \"stress\"\ngodot = \"4\"\n\n[dev-dependencies]\nlarge = { path = \"large\" }\nmany = { path = \"many\" }\n";
    fs::write(fixture.manifest_path(), manifest_text).expect("shape manifest should write");
    let manifest = Manifest::parse(fixture.manifest_path(), manifest_text)
        .expect("shape manifest should parse");
    let lock = lock_direct_local_dependencies(fixture.manifest_path(), &manifest, None)
        .expect("shape packages should lock");

    let first = sync_direct_local_dependencies(
        fixture.project(),
        fixture.manifest_path(),
        &manifest,
        &lock,
        true,
    )
    .expect("shape packages should synchronise");
    let second = sync_direct_local_dependencies(
        fixture.project(),
        fixture.manifest_path(),
        &manifest,
        &lock,
        true,
    )
    .expect("shape package no-op should synchronise");

    assert_eq!(first.written, MANY_FILE_COUNT + 3);
    assert_eq!(second.written, 0);
    assert_eq!(second.unchanged, MANY_FILE_COUNT + 3);
    assert_eq!(
        fs::metadata(fixture.project().join("addons/large/plugin.gd"))
            .expect("large output should exist")
            .len(),
        u64::try_from(LARGE_FILE_BYTES).expect("large fixture size should fit")
    );
    assert_eq!(
        fs::read_to_string(fixture.project().join("addons/many/scripts/file-0511.gd"))
            .expect("last small output should read"),
        "extends Node\n# 511\n"
    );
}

#[test]
fn invariant_stress_shared_source_aliases_lock_and_materialise_independently() {
    let fixture = Fixture::new();
    let shared = fixture.project().join("shared");
    let mut manifest_text =
        String::from("[project]\nname = \"stress\"\ngodot = \"4\"\n\n[dev-dependencies]\n");
    for index in 0..SHARED_SOURCE_ALIAS_COUNT {
        let alias = format!("alias-{index:02}");
        let root = shared.join("addons").join(&alias);
        Fixture::write_package_file(&root, &alias, Path::new("plugin.gd"), alias.as_bytes());
        Fixture::write_metadata(&root, &alias);
        manifest_text.push_str(&format!(
            "{alias} = {{ path = \"shared\", root = \"addons/{alias}\", target = \"addons/{alias}\" }}\n"
        ));
    }
    fs::write(fixture.manifest_path(), &manifest_text).expect("alias manifest should write");
    let manifest = Manifest::parse(fixture.manifest_path(), &manifest_text)
        .expect("alias manifest should parse");
    let lock = lock_direct_local_dependencies(fixture.manifest_path(), &manifest, None)
        .expect("shared aliases should lock");

    sync_direct_local_dependencies(
        fixture.project(),
        fixture.manifest_path(),
        &manifest,
        &lock,
        true,
    )
    .expect("shared aliases should synchronise");
    let no_op = sync_direct_local_dependencies(
        fixture.project(),
        fixture.manifest_path(),
        &manifest,
        &lock,
        true,
    )
    .expect("shared aliases should no-op");

    assert_eq!(lock.packages().len(), SHARED_SOURCE_ALIAS_COUNT);
    assert_eq!(no_op.written, 0);
    assert_eq!(no_op.unchanged, SHARED_SOURCE_ALIAS_COUNT * 2);
    assert_eq!(
        fs::read_to_string(fixture.project().join("addons/alias-15/plugin.gd"))
            .expect("last alias output should read"),
        "alias-15"
    );
}

struct Fixture {
    _directory: TempDir,
    project: std::path::PathBuf,
    manifest_path: std::path::PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let directory = TempDir::new().expect("stress fixture should create");
        let project = directory.path().join("project");
        fs::create_dir(&project).expect("stress project should create");
        let manifest_path = project.join("wukong.toml");
        Self {
            _directory: directory,
            project,
            manifest_path,
        }
    }

    fn project(&self) -> &Path {
        &self.project
    }

    fn manifest_path(&self) -> &Path {
        &self.manifest_path
    }

    fn manifest(&self, package_count: usize) -> Manifest {
        let mut input =
            String::from("[project]\nname = \"stress\"\ngodot = \"4\"\n\n[dev-dependencies]\n");
        for index in 1..=package_count {
            let name = format!("addon-{index}");
            let source = self.project.join(&name);
            fs::create_dir(&source).expect("stress source should create");
            fs::write(
                source.join("plugin.gd"),
                format!("extends Node\n# {index}\n"),
            )
            .expect("stress package content should write");
            fs::write(
                source.join("wukong-package.toml"),
                format!(
                    "[package]\nschema = 1\nname = \"{name}\"\nversion = \"1.0.0\"\ngodot = \"4\"\n"
                ),
            )
            .expect("stress package metadata should write");
            input.push_str(&format!("{name} = {{ path = \"{name}\" }}\n"));
        }
        fs::write(&self.manifest_path, &input).expect("stress manifest should write");
        Manifest::parse(&self.manifest_path, &input).expect("stress manifest should parse")
    }

    fn write_package_file(root: &Path, name: &str, relative: &Path, bytes: &[u8]) {
        fs::create_dir_all(root).expect("shape source should create");
        let destination = root.join(relative);
        fs::create_dir_all(
            destination
                .parent()
                .expect("shape package path should have a parent"),
        )
        .expect("shape package parent should create");
        fs::write(destination, bytes).expect("shape package file should write");
        Self::write_metadata(root, name);
    }

    fn write_metadata(root: &Path, name: &str) {
        fs::write(
            root.join("wukong-package.toml"),
            format!(
                "[package]\nschema = 1\nname = \"{name}\"\nversion = \"1.0.0\"\ngodot = \"4\"\n"
            ),
        )
        .expect("shape package metadata should write");
    }
}
