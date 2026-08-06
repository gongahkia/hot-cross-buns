use std::{fs, path::Path};
use tempfile::TempDir;
use wukong_core::{
    direct_lock::lock_direct_local_dependencies,
    direct_sync::sync_direct_local_dependencies,
    installed_state::{InstalledState, state_path},
    manifest::Manifest,
};

const PACKAGE_COUNTS: [usize; 4] = [1, 10, 100, 500];

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
}
