use std::collections::BTreeSet;
use wukong_core::{
    dependency_graph::{DependencyGroup, LockedDependencyGraph},
    identity::PackageName,
    lockfile::{GodotCompatibility, LockedLocalSource, LockedPackage, Lockfile},
    semantic_version::SemanticVersion,
    source::ImmutableSourceId,
};

#[test]
fn invariant_graph_classifies_direct_transitive_and_development_packages() {
    let lock = lock([
        package("alpha", ["shared"], false, 1),
        package("beta", ["shared"], false, 2),
        package("shared", [], false, 3),
        package("dev-tool", [], true, 4),
    ]);
    let graph = LockedDependencyGraph::new(&lock, &names(["alpha", "beta"]), &names(["dev-tool"]))
        .expect("graph should build");

    assert_eq!(
        graph.roots(DependencyGroup::Runtime),
        &[name("alpha"), name("beta")]
    );
    assert_eq!(
        graph.roots(DependencyGroup::Development),
        &[name("dev-tool")]
    );
    assert!(
        graph
            .packages()
            .get(&name("alpha"))
            .unwrap()
            .is_direct_runtime()
    );
    assert!(
        graph
            .packages()
            .get(&name("dev-tool"))
            .unwrap()
            .is_direct_development()
    );
    assert!(!graph.packages().get(&name("shared")).unwrap().is_direct());
    assert!(
        graph
            .packages()
            .get(&name("dev-tool"))
            .unwrap()
            .is_development()
    );
}

#[test]
fn invariant_graph_reports_every_root_to_package_path_in_name_order() {
    let lock = lock([
        package("alpha", ["shared"], false, 1),
        package("beta", ["shared"], false, 2),
        package("shared", [], false, 3),
    ]);
    let graph = LockedDependencyGraph::new(&lock, &names(["alpha", "beta"]), &BTreeSet::new())
        .expect("graph should build");

    assert_eq!(
        graph.paths_to(&name("shared")),
        vec![
            vec![name("alpha"), name("shared")],
            vec![name("beta"), name("shared")]
        ]
    );
}

#[test]
fn invariant_graph_rejects_missing_locked_dependency_entries() {
    let lock = lock([package("alpha", ["missing"], false, 1)]);

    let error = LockedDependencyGraph::new(&lock, &names(["alpha"]), &BTreeSet::new())
        .expect_err("missing package should fail");

    assert_eq!(error.package(), Some("alpha"));
    assert!(error.message().contains("missing package missing"));
}

fn lock(packages: impl IntoIterator<Item = LockedPackage>) -> Lockfile {
    Lockfile::new(packages).expect("lock should build")
}

fn package(
    package_name: &str,
    dependencies: impl IntoIterator<Item = &'static str>,
    development: bool,
    index: usize,
) -> LockedPackage {
    let checksum = format!("{index:064x}");
    let source = LockedLocalSource::new(
        ImmutableSourceId::new(format!("sha256:{checksum}")).expect("identity should parse"),
        checksum.clone(),
    )
    .expect("source should build");
    LockedPackage::new(
        name(package_name),
        Some(version("1.0.0")),
        source,
        checksum,
        format!("{:064x}", index + 100),
        dependencies.into_iter().map(name).collect(),
        ".".into(),
        format!("addons/{package_name}").into(),
        GodotCompatibility::Unknown,
        development,
    )
    .expect("package should build")
}

fn names(values: impl IntoIterator<Item = &'static str>) -> BTreeSet<PackageName> {
    values.into_iter().map(name).collect()
}

fn name(value: &str) -> PackageName {
    PackageName::parse(value).expect("name should parse")
}

fn version(value: &str) -> SemanticVersion {
    SemanticVersion::parse(value).expect("version should parse")
}
