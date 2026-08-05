use std::{cell::RefCell, collections::BTreeMap, fs};
use tempfile::TempDir;
use wukong_core::{
    identity::PackageName,
    resolver::{
        InMemoryPackageUniverse, PackageCandidate, PackageUniverse, ResolutionRequest,
        ResolverResult, resolve_dependencies,
    },
    semantic_version::{SemanticVersion, VersionRequirement},
    source::CancellationToken,
};

#[test]
fn invariant_package_owned_metadata_becomes_a_transitive_candidate() {
    let fixture = TempDir::new().expect("fixture directory should exist");
    fs::write(
        fixture.path().join("wukong-package.toml"),
        "[package]\nschema = 1\nname = \"addon\"\nversion = \"1.2.3+build.4\"\ngodot = \"4\"\n\n[dependencies]\nhelper = \"^2\"\n",
    )
    .expect("metadata fixture should write");

    let candidate = PackageCandidate::load_required(&name("addon"), fixture.path())
        .expect("metadata should create a candidate");

    assert_eq!(candidate.version().to_string(), "1.2.3");
    assert_eq!(
        candidate
            .dependencies()
            .get(&name("helper"))
            .unwrap()
            .to_string(),
        "^2"
    );
}

#[test]
fn invariant_package_candidate_rejects_metadata_name_mismatch_before_resolution() {
    let fixture = TempDir::new().expect("fixture directory should exist");
    fs::write(
        fixture.path().join("wukong-package.toml"),
        "[package]\nschema = 1\nname = \"other-addon\"\nversion = \"1.2.3\"\ngodot = \"4\"\n",
    )
    .expect("metadata fixture should write");

    let error = PackageCandidate::load_required(&name("addon"), fixture.path())
        .expect_err("metadata name mismatch must fail");

    assert_eq!(
        error.code(),
        wukong_core::diagnostic::ErrorCode::IntegrityFailure
    );
    assert_eq!(error.package(), Some("addon"));
    assert!(error.message().contains("metadata name other-addon"));
}

#[test]
fn invariant_universe_is_queried_lazily_and_complete_graph_is_deterministic() {
    let mut packages = BTreeMap::new();
    packages.insert(
        name("addon"),
        vec![bound_candidate("addon", "1.0.0", &[("helper", "^1")])],
    );
    packages.insert(
        name("helper"),
        vec![
            bound_candidate("helper", "1.0.0", &[]),
            bound_candidate("helper", "1.4.0", &[]),
        ],
    );
    packages.insert(
        name("unrelated"),
        vec![bound_candidate("unrelated", "9.0.0", &[])],
    );
    let universe = RecordingUniverse::new(packages);
    let mut request = ResolutionRequest::new();
    request.require(name("addon"), requirement("^1"));

    let first = resolve_dependencies(&universe, &request, &CancellationToken::new())
        .expect("graph should resolve");
    let second = resolve_dependencies(&universe, &request, &CancellationToken::new())
        .expect("repeated graph should resolve");

    assert_eq!(first, second);
    assert_eq!(
        first
            .packages()
            .get(&name("addon"))
            .unwrap()
            .version()
            .to_string(),
        "1.0.0"
    );
    assert_eq!(
        first
            .packages()
            .get(&name("helper"))
            .unwrap()
            .version()
            .to_string(),
        "1.4.0"
    );
    assert_eq!(
        universe.queries.borrow().as_slice(),
        &[name("addon"), name("helper"), name("addon"), name("helper")]
    );
}

#[test]
fn invariant_valid_lock_is_preferred_and_avoids_an_unnecessary_update() {
    let mut universe = InMemoryPackageUniverse::new();
    add(
        &mut universe,
        "addon",
        candidate("1.0.0", &[("helper", "^1")]),
    );
    add(&mut universe, "helper", candidate("1.0.0", &[]));
    add(&mut universe, "helper", candidate("1.9.0", &[]));
    let mut request = ResolutionRequest::new();
    request.require(name("addon"), requirement("=1.0.0"));
    request.prefer_locked(name("helper"), &version("1.0.0"));

    let graph = resolve_dependencies(&universe, &request, &CancellationToken::new())
        .expect("locked graph should resolve");

    assert_eq!(
        graph
            .packages()
            .get(&name("helper"))
            .unwrap()
            .version()
            .to_string(),
        "1.0.0"
    );
}

#[test]
fn invariant_conflicts_identify_incompatible_requirements_and_dependency_paths() {
    let mut universe = InMemoryPackageUniverse::new();
    add(
        &mut universe,
        "left",
        candidate("1.0.0", &[("shared", "=1.0.0")]),
    );
    add(
        &mut universe,
        "right",
        candidate("1.0.0", &[("shared", "=2.0.0")]),
    );
    add(&mut universe, "shared", candidate("1.0.0", &[]));
    add(&mut universe, "shared", candidate("2.0.0", &[]));
    let mut request = ResolutionRequest::new();
    request.require(name("left"), requirement("=1.0.0"));
    request.require(name("right"), requirement("=1.0.0"));

    let error = resolve_dependencies(&universe, &request, &CancellationToken::new())
        .expect_err("incompatible graph should fail");

    assert!(error.message().contains("left"));
    assert!(error.message().contains("right"));
    assert!(error.message().contains("shared"));
    assert!(error.message().contains("1.0.0"));
    assert!(error.message().contains("2.0.0"));
}

#[test]
fn invariant_selected_dependency_cycles_are_rejected() {
    let mut universe = InMemoryPackageUniverse::new();
    add(
        &mut universe,
        "alpha",
        candidate("1.0.0", &[("beta", "=1.0.0")]),
    );
    add(
        &mut universe,
        "beta",
        candidate("1.0.0", &[("alpha", "=1.0.0")]),
    );
    let mut request = ResolutionRequest::new();
    request.require(name("alpha"), requirement("=1.0.0"));

    let error = resolve_dependencies(&universe, &request, &CancellationToken::new())
        .expect_err("cyclic graph should fail");

    assert_eq!(error.message(), "dependency cycle: alpha -> beta -> alpha");
}

#[test]
fn invariant_cancelled_resolution_does_not_select_packages() {
    let mut universe = InMemoryPackageUniverse::new();
    add(&mut universe, "addon", candidate("1.0.0", &[]));
    let mut request = ResolutionRequest::new();
    request.require(name("addon"), requirement("=1.0.0"));
    let cancellation = CancellationToken::new();
    cancellation.cancel();

    let error = resolve_dependencies(&universe, &request, &cancellation)
        .expect_err("cancelled resolution should fail");

    assert_eq!(error.message(), "dependency resolution was cancelled");
}

#[test]
fn invariant_resolver_rejects_candidate_metadata_identity_mismatch() {
    let universe = MismatchedUniverse {
        candidate: bound_candidate("other-addon", "1.0.0", &[]),
    };
    let mut request = ResolutionRequest::new();
    request.require(name("addon"), requirement("=1.0.0"));

    let error = resolve_dependencies(&universe, &request, &CancellationToken::new())
        .expect_err("mismatched candidate identity must fail");

    assert_eq!(
        error.code(),
        wukong_core::diagnostic::ErrorCode::IntegrityFailure
    );
    assert_eq!(error.package(), Some("addon"));
    assert!(error.message().contains("metadata name other-addon"));
}

#[derive(Debug)]
struct RecordingUniverse {
    packages: BTreeMap<PackageName, Vec<PackageCandidate>>,
    queries: RefCell<Vec<PackageName>>,
}

impl RecordingUniverse {
    fn new(packages: BTreeMap<PackageName, Vec<PackageCandidate>>) -> Self {
        Self {
            packages,
            queries: RefCell::new(Vec::new()),
        }
    }
}

impl PackageUniverse for RecordingUniverse {
    fn candidates(&self, package: &PackageName) -> ResolverResult<Vec<PackageCandidate>> {
        self.queries.borrow_mut().push(package.clone());
        Ok(self.packages.get(package).cloned().unwrap_or_default())
    }
}

struct MismatchedUniverse {
    candidate: PackageCandidate,
}

impl PackageUniverse for MismatchedUniverse {
    fn candidates(&self, _: &PackageName) -> ResolverResult<Vec<PackageCandidate>> {
        Ok(vec![self.candidate.clone()])
    }
}

fn add(universe: &mut InMemoryPackageUniverse, package: &str, candidate: PackageCandidate) {
    universe
        .add_candidate(name(package), candidate)
        .expect("candidate should be unique");
}

fn candidate(version_raw: &str, dependencies: &[(&str, &str)]) -> PackageCandidate {
    PackageCandidate::new(
        &version(version_raw),
        dependencies
            .iter()
            .map(|(package, version_requirement)| (name(package), requirement(version_requirement)))
            .collect(),
    )
}

fn bound_candidate(
    package: &str,
    version_raw: &str,
    dependencies: &[(&str, &str)],
) -> PackageCandidate {
    PackageCandidate::for_package(
        name(package),
        &version(version_raw),
        dependencies
            .iter()
            .map(|(package, version_requirement)| (name(package), requirement(version_requirement)))
            .collect(),
    )
}

fn name(value: &str) -> PackageName {
    PackageName::parse(value).expect("package name should be valid")
}

fn requirement(value: &str) -> VersionRequirement {
    VersionRequirement::parse(value).expect("version requirement should be valid")
}

fn version(value: &str) -> SemanticVersion {
    SemanticVersion::parse(value).expect("version should be valid")
}
