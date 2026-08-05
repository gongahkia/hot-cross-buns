use std::collections::BTreeSet;
use wukong_core::{
    dependency_graph::{DependencyGroup, LockedDependencyGraph},
    identity::PackageName,
    lockfile::{
        CatalogGraphRoots, GodotCompatibility, LockedGitSource, LockedLocalSource, LockedPackage,
        Lockfile,
    },
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

#[test]
fn invariant_catalog_graph_derives_roots_and_promotes_shared_runtime_dependencies() {
    let lock = catalog_lock(
        [
            catalog_package("runtime", ["shared"], 1),
            catalog_package("dev-tool", ["shared"], 2),
            catalog_package("shared", [], 3),
        ],
        CatalogGraphRoots::new([name("runtime")], [name("dev-tool")]),
    );

    let graph = LockedDependencyGraph::from_catalog_lockfile(&lock)
        .expect("catalog graph should build")
        .expect("schema-three roots should be available");

    assert_eq!(graph.roots(DependencyGroup::Runtime), &[name("runtime")]);
    assert_eq!(
        graph.roots(DependencyGroup::Development),
        &[name("dev-tool")]
    );
    assert!(graph.packages()[&name("runtime")].is_direct_runtime());
    assert!(graph.packages()[&name("dev-tool")].is_direct_development());
    assert!(graph.packages()[&name("shared")].is_runtime());
    assert!(!graph.packages()[&name("shared")].is_development());
    assert!(graph.packages()[&name("dev-tool")].is_development());
    assert!(!lock.packages()[&name("shared")].development());
    assert!(lock.packages()[&name("dev-tool")].development());
}

#[test]
fn invariant_catalog_graph_serialization_is_stable_across_equivalent_root_order() {
    let base = catalog_lock(
        [
            catalog_package("alpha", [], 1),
            catalog_package("beta", [], 2),
        ],
        CatalogGraphRoots::new([name("alpha"), name("beta")], []),
    );
    let packages = base.packages().values().cloned().collect::<Vec<_>>();
    let first = Lockfile::new_catalog_graph(
        packages.clone(),
        CatalogGraphRoots::new([name("beta"), name("alpha")], []),
    )
    .expect("first catalog lock should build");
    let second = Lockfile::new_catalog_graph(
        packages.into_iter().rev(),
        CatalogGraphRoots::new([name("alpha"), name("beta")], []),
    )
    .expect("second catalog lock should build");

    assert_eq!(first.to_toml(), second.to_toml());
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

fn catalog_lock(
    packages: impl IntoIterator<Item = LockedPackage>,
    roots: CatalogGraphRoots,
) -> Lockfile {
    Lockfile::new_catalog_graph(packages, roots).expect("catalog graph should build")
}

fn catalog_package(
    package_name: &str,
    dependencies: impl IntoIterator<Item = &'static str>,
    index: usize,
) -> LockedPackage {
    let commit = "4ab90a80b815bc1ad4a8d7eea92c785e654bfd91";
    let source = LockedGitSource::new(
        ImmutableSourceId::new(format!("git:{commit}")).expect("identity should parse"),
        "https://example.test/catalog.git",
        commit.to_owned(),
    )
    .expect("source should build");
    LockedPackage::new(
        name(package_name),
        Some(version("1.0.0")),
        source,
        format!("{:064x}", index + 100),
        format!("{:064x}", index + 200),
        dependencies.into_iter().map(name).collect(),
        format!("addons/{package_name}").into(),
        format!("addons/{package_name}").into(),
        GodotCompatibility::Requirement("4".parse().expect("Godot requirement should parse")),
        false,
    )
    .expect("package should build")
    .with_catalog_sha256(format!("{index:064x}"))
    .expect("catalog fingerprint should build")
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
