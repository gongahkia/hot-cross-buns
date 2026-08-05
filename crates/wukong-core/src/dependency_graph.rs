//! Deterministic dependency graph views derived from a lockfile.

use crate::{
    diagnostic::{Diagnostic, ErrorCode},
    identity::PackageName,
    lockfile::Lockfile,
    semantic_version::SemanticVersion,
};
use std::collections::{BTreeMap, BTreeSet};

/// Result type returned by locked dependency graph operations.
pub type DependencyGraphResult<T> = Result<T, Box<Diagnostic>>;

/// The manifest group from which a graph root originates.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DependencyGroup {
    /// A runtime dependency from `[dependencies]`.
    Runtime,
    /// A development dependency from `[dev-dependencies]`.
    Development,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum PackageScope {
    Runtime,
    Development,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
struct DirectGroups {
    runtime: bool,
    development: bool,
}

/// One package in a locked dependency graph.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GraphPackage {
    name: PackageName,
    version: Option<SemanticVersion>,
    dependencies: BTreeSet<PackageName>,
    direct: DirectGroups,
    scope: PackageScope,
}

impl GraphPackage {
    /// Returns the canonical package name.
    #[must_use]
    pub const fn name(&self) -> &PackageName {
        &self.name
    }

    /// Returns the resolved version, if package metadata declared one.
    #[must_use]
    pub fn version(&self) -> Option<&SemanticVersion> {
        self.version.as_ref()
    }

    /// Returns selected transitive dependencies in deterministic name order.
    #[must_use]
    pub const fn dependencies(&self) -> &BTreeSet<PackageName> {
        &self.dependencies
    }

    /// Returns whether the package is a direct runtime dependency.
    #[must_use]
    pub const fn is_direct_runtime(&self) -> bool {
        self.direct.runtime
    }

    /// Returns whether the package is a direct development dependency.
    #[must_use]
    pub const fn is_direct_development(&self) -> bool {
        self.direct.development
    }

    /// Returns whether the package is in the runtime closure.
    #[must_use]
    pub const fn is_runtime(&self) -> bool {
        matches!(self.scope, PackageScope::Runtime)
    }

    /// Returns whether the package is development-only in the lockfile.
    #[must_use]
    pub const fn is_development(&self) -> bool {
        matches!(self.scope, PackageScope::Development)
    }

    /// Returns whether the package has any direct manifest declaration.
    #[must_use]
    pub const fn is_direct(&self) -> bool {
        self.direct.runtime || self.direct.development
    }
}

/// A validated, deterministic graph of lockfile package dependencies.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LockedDependencyGraph {
    packages: BTreeMap<PackageName, GraphPackage>,
    runtime_roots: Vec<PackageName>,
    development_roots: Vec<PackageName>,
}

impl LockedDependencyGraph {
    /// Builds a graph from lockfile entries and the manifest's direct aliases.
    ///
    /// Missing lockfile dependency entries are rejected. Manifest aliases not
    /// present in the lockfile are ignored so a stale manifest can still be
    /// inspected against its last resolved lockfile.
    ///
    /// # Errors
    ///
    /// Returns a diagnostic when a lockfile package references an absent entry.
    pub fn new(
        lockfile: &Lockfile,
        direct_runtime: &BTreeSet<PackageName>,
        direct_development: &BTreeSet<PackageName>,
    ) -> DependencyGraphResult<Self> {
        let mut incoming = BTreeMap::<PackageName, usize>::new();
        let mut packages = BTreeMap::new();
        for (name, package) in lockfile.packages() {
            incoming.insert(name.clone(), 0);
            packages.insert(
                name.clone(),
                GraphPackage {
                    name: name.clone(),
                    version: package.version().cloned(),
                    dependencies: package.dependencies().clone(),
                    direct: DirectGroups {
                        runtime: direct_runtime.contains(name),
                        development: direct_development.contains(name),
                    },
                    scope: if package.development() {
                        PackageScope::Development
                    } else {
                        PackageScope::Runtime
                    },
                },
            );
        }
        for package in packages.values() {
            for dependency in package.dependencies() {
                let Some(count) = incoming.get_mut(dependency) else {
                    return Err(Box::new(
                        Diagnostic::new(
                            ErrorCode::UserInput,
                            format!(
                                "lockfile package {} depends on missing package {dependency}",
                                package.name()
                            ),
                        )
                        .with_package(package.name().to_string())
                        .with_recovery("regenerate wukong.lock before inspecting dependencies"),
                    ));
                };
                *count += 1;
            }
        }
        let mut runtime_roots = BTreeSet::new();
        let mut development_roots = BTreeSet::new();
        for (name, package) in &packages {
            if package.is_direct_runtime() {
                runtime_roots.insert(name.clone());
            }
            if package.is_direct_development() {
                development_roots.insert(name.clone());
            }
            if incoming.get(name) == Some(&0) && !package.is_direct() {
                if package.is_development() {
                    development_roots.insert(name.clone());
                } else {
                    runtime_roots.insert(name.clone());
                }
            }
        }
        Ok(Self {
            packages,
            runtime_roots: runtime_roots.into_iter().collect(),
            development_roots: development_roots.into_iter().collect(),
        })
    }

    /// Builds the persisted canonical view of a schema-three catalog graph.
    ///
    /// Returns `None` for legacy lockfiles, which do not persist direct roots.
    /// Shared runtime and development closure members are runtime packages.
    ///
    /// # Errors
    ///
    /// Returns a diagnostic when the graph has a missing dependency entry.
    pub fn from_catalog_lockfile(lockfile: &Lockfile) -> DependencyGraphResult<Option<Self>> {
        let Some(roots) = lockfile.catalog_graph_roots() else {
            return Ok(None);
        };
        let mut packages = BTreeMap::new();
        for (name, package) in lockfile.packages() {
            packages.insert(
                name.clone(),
                GraphPackage {
                    name: name.clone(),
                    version: package.version().cloned(),
                    dependencies: package.dependencies().clone(),
                    direct: DirectGroups {
                        runtime: roots.runtime().contains(name),
                        development: roots.development().contains(name),
                    },
                    scope: PackageScope::Runtime,
                },
            );
        }
        validate_dependencies(&packages)?;
        let runtime = reachable_packages(&packages, roots.runtime());
        let development = reachable_packages(&packages, roots.development());
        for (name, package) in &mut packages {
            package.scope = if development.contains(name) && !runtime.contains(name) {
                PackageScope::Development
            } else {
                PackageScope::Runtime
            };
        }
        Ok(Some(Self {
            packages,
            runtime_roots: roots.runtime().iter().cloned().collect(),
            development_roots: roots.development().iter().cloned().collect(),
        }))
    }

    /// Returns every package in deterministic name order.
    #[must_use]
    pub const fn packages(&self) -> &BTreeMap<PackageName, GraphPackage> {
        &self.packages
    }

    /// Returns tree roots for one manifest dependency group.
    #[must_use]
    pub fn roots(&self, group: DependencyGroup) -> &[PackageName] {
        match group {
            DependencyGroup::Runtime => &self.runtime_roots,
            DependencyGroup::Development => &self.development_roots,
        }
    }

    /// Returns every deterministic simple path from any root to `target`.
    ///
    /// Cycles are truncated at their repeated package, so invalid hand-edited
    /// lockfiles cannot cause unbounded traversal.
    #[must_use]
    pub fn paths_to(&self, target: &PackageName) -> Vec<Vec<PackageName>> {
        let mut paths = Vec::new();
        let mut roots = self.runtime_roots.clone();
        roots.extend(self.development_roots.iter().cloned());
        roots.sort();
        roots.dedup();
        for root in roots {
            let mut path = Vec::new();
            let mut active = BTreeSet::new();
            self.collect_paths(&root, target, &mut active, &mut path, &mut paths);
        }
        paths
    }

    fn collect_paths(
        &self,
        current: &PackageName,
        target: &PackageName,
        active: &mut BTreeSet<PackageName>,
        path: &mut Vec<PackageName>,
        paths: &mut Vec<Vec<PackageName>>,
    ) {
        if !active.insert(current.clone()) {
            return;
        }
        path.push(current.clone());
        if current == target {
            paths.push(path.clone());
        } else if let Some(package) = self.packages.get(current) {
            for dependency in package.dependencies() {
                self.collect_paths(dependency, target, active, path, paths);
            }
        }
        path.pop();
        active.remove(current);
    }
}

fn validate_dependencies(
    packages: &BTreeMap<PackageName, GraphPackage>,
) -> DependencyGraphResult<()> {
    for package in packages.values() {
        for dependency in package.dependencies() {
            if !packages.contains_key(dependency) {
                return Err(Box::new(
                    Diagnostic::new(
                        ErrorCode::UserInput,
                        format!(
                            "lockfile package {} depends on missing package {dependency}",
                            package.name()
                        ),
                    )
                    .with_package(package.name().to_string())
                    .with_recovery("regenerate wukong.lock before inspecting dependencies"),
                ));
            }
        }
    }
    Ok(())
}

fn reachable_packages(
    packages: &BTreeMap<PackageName, GraphPackage>,
    roots: &BTreeSet<PackageName>,
) -> BTreeSet<PackageName> {
    let mut reachable = BTreeSet::new();
    let mut pending = roots.iter().cloned().collect::<Vec<_>>();
    while let Some(name) = pending.pop() {
        if !reachable.insert(name.clone()) {
            continue;
        }
        if let Some(package) = packages.get(&name) {
            pending.extend(package.dependencies().iter().cloned());
        }
    }
    reachable
}
