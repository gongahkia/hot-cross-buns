//! Catalog-backed immutable graph-lock construction and validation.

use crate::{
    cache::CacheLayout,
    dependency_graph::LockedDependencyGraph,
    diagnostic::{Diagnostic, ErrorCode},
    identity::PackageName,
    lockfile::{
        CATALOG_GRAPH_LOCKFILE_SCHEMA, CatalogGraphRoots, GodotCompatibility, LockedGitSource,
        LockedHttpSource, LockedPackage, LockedSource, Lockfile,
    },
    manifest::{Dependency, DependencyAlias, Manifest},
    resolver::{
        PackageCandidate, PackageUniverse, ResolutionRequest, ResolvedGraph, ResolverResult,
        resolve_dependencies,
    },
    semantic_version::VersionRequirement,
    source::{CancellationToken, ImmutableSourceId},
    source_catalog::ValidatedSourceCatalog,
    source_catalog_acquisition::{
        AcquiredCatalogCandidate, AcquiredCatalogSource, CatalogCandidateAcquirer, CatalogUniverse,
    },
};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::PathBuf,
};

/// Returns whether the manifest contains version-only catalog roots.
#[must_use]
pub fn manifest_uses_catalog(manifest: &Manifest) -> bool {
    manifest
        .dependencies()
        .values()
        .chain(manifest.dev_dependencies().values())
        .any(|dependency| matches!(dependency, Dependency::Version(_)))
}

/// Resolves version-only direct roots through a validated project catalog.
///
/// The resulting schema-three lock records every selected package, immutable
/// source identity, reviewed declaration fingerprint, and dependency edge.
/// Direct-source declarations cannot share this lock shape because schema three
/// deliberately admits only catalog Git and HTTPS sources.
///
/// # Errors
///
/// Returns a diagnostic when manifest roots are mixed with direct sources,
/// catalog candidates cannot be acquired, resolution fails, or an acquired
/// candidate disagrees with the selected graph.
pub fn lock_catalog_dependencies(
    manifest: &Manifest,
    catalog: ValidatedSourceCatalog,
    existing: Option<&Lockfile>,
    cache: CacheLayout,
    offline: bool,
    cancellation: &CancellationToken,
) -> Result<Lockfile, Box<Diagnostic>> {
    let mut request = catalog_request(manifest)?;
    if let Some(existing) = existing.filter(|lock| lock.schema() == CATALOG_GRAPH_LOCKFILE_SCHEMA) {
        for (name, package) in existing.packages() {
            if let Some(version) = package.version() {
                request.prefer_locked(name.clone(), version);
            }
        }
    }
    cancellation.check()?;
    let acquirer = CatalogCandidateAcquirer::new(catalog, cache, offline);
    let universe = CatalogUniverse::new(acquirer.clone(), cancellation.clone());
    let graph = resolve_dependencies(&universe, &request, cancellation)?;
    lock_resolved_graph(&graph, &acquirer, &BTreeMap::new(), cancellation)
}

/// Resolves catalog dependencies without downloading or publishing cache data.
///
/// This is intended for previews that must prove a candidate graph from already
/// verified cached source artifacts while leaving both project and cache state
/// unchanged.
///
/// # Errors
///
/// Returns a diagnostic when the manifest is not catalog-only, cached source
/// artifacts are unavailable, resolution fails, or a candidate is invalid.
pub fn lock_catalog_dependencies_read_only(
    manifest: &Manifest,
    catalog: ValidatedSourceCatalog,
    cache: CacheLayout,
    cancellation: &CancellationToken,
) -> Result<Lockfile, Box<Diagnostic>> {
    let request = catalog_request(manifest)?;
    cancellation.check()?;
    let acquirer = CatalogCandidateAcquirer::new_read_only(catalog, cache);
    let universe = CatalogUniverse::new(acquirer.clone(), cancellation.clone());
    let graph = resolve_dependencies(&universe, &request, cancellation)?;
    lock_resolved_graph(&graph, &acquirer, &BTreeMap::new(), cancellation)
}

/// Refreshes one catalog direct root and its closure, or every root when omitted.
///
/// A selected update treats every package outside the prior selected closure as
/// an exact locked candidate. This prevents an intentional update from
/// refreshing unrelated roots or their dependencies. A dry run uses only
/// existing cache data and disposable staging, so it does not publish cache
/// objects or change project files.
///
/// # Errors
///
/// Returns a diagnostic when the schema-three lock no longer matches manifest
/// roots, the selected package is not a direct root, cached data is unavailable
/// for a dry run, resolution cannot preserve unrelated selections, or a source
/// candidate cannot be verified.
#[allow(clippy::too_many_arguments)] // public operation inputs mirror lock/update command boundaries
pub fn update_catalog_dependencies(
    manifest: &Manifest,
    catalog: ValidatedSourceCatalog,
    existing: &Lockfile,
    selected: Option<&PackageName>,
    cache: CacheLayout,
    offline: bool,
    dry_run: bool,
    cancellation: &CancellationToken,
) -> Result<Lockfile, Box<Diagnostic>> {
    validate_catalog_lock_manifest(manifest, existing)?;
    let selected_closure = selected
        .map(|selected| catalog_root_closure(existing, selected))
        .transpose()?;
    let retained = retained_packages(existing, selected_closure.as_ref());
    let request = catalog_request(manifest)?;
    cancellation.check()?;
    let acquirer = if dry_run {
        CatalogCandidateAcquirer::new_read_only(catalog, cache)
    } else {
        CatalogCandidateAcquirer::new(catalog, cache, offline)
    };
    let universe = UpdateUniverse {
        catalog: CatalogUniverse::new(acquirer.clone(), cancellation.clone()),
        retained: retained_candidates(&retained, existing)?,
    };
    let graph = resolve_dependencies(&universe, &request, cancellation)?;
    let updated = lock_resolved_graph(&graph, &acquirer, &retained, cancellation)?;
    let mut affected = selected_closure.unwrap_or_default();
    if let Some(selected) = selected {
        affected.extend(resolved_closure(&graph, selected)?);
    } else {
        affected.extend(existing.packages().keys().cloned());
        affected.extend(updated.packages().keys().cloned());
    }
    preserve_unrelated_packages(existing, &updated, &affected)?;
    Ok(updated)
}

/// Verifies that version-only manifest roots match a schema-three lock.
///
/// This check is source-free so frozen sync can read only project metadata,
/// the immutable lock, and verified cache objects.
///
/// # Errors
///
/// Returns a diagnostic when the manifest mixes catalog and direct sources,
/// direct roots differ, or a selected direct-root version no longer satisfies
/// its declared requirement.
pub fn validate_catalog_lock_manifest(
    manifest: &Manifest,
    lock: &Lockfile,
) -> Result<(), Box<Diagnostic>> {
    if lock.schema() != CATALOG_GRAPH_LOCKFILE_SCHEMA {
        return Err(Box::new(
            Diagnostic::new(
                ErrorCode::InternalFailure,
                "catalog lock validation received a non-catalog lockfile",
            )
            .with_recovery("retry the command and report this as a wukong bug if it persists"),
        ));
    }
    let request = catalog_request(manifest)?;
    let roots = lock.catalog_graph_roots().ok_or_else(|| {
        Box::new(
            Diagnostic::new(
                ErrorCode::InternalFailure,
                "catalog lockfile roots were absent",
            )
            .with_recovery("regenerate wukong.lock"),
        )
    })?;
    if request.runtime_roots() != roots.runtime()
        || request.development_roots() != roots.development()
    {
        return Err(Box::new(
            Diagnostic::new(
                ErrorCode::UserInput,
                "manifest catalog roots differ from wukong.lock",
            )
            .with_recovery("run wukong lock to resolve the current manifest"),
        ));
    }
    for (name, requirement) in request.direct_dependencies() {
        let package = lock.packages().get(name).ok_or_else(|| {
            Box::new(
                Diagnostic::new(
                    ErrorCode::UserInput,
                    format!("catalog root {name} is absent from wukong.lock"),
                )
                .with_package(name.as_str())
                .with_recovery("run wukong lock to resolve the current manifest"),
            )
        })?;
        let version = package.version().ok_or_else(|| {
            Box::new(
                Diagnostic::new(
                    ErrorCode::IntegrityFailure,
                    format!("catalog root {name} has no locked version"),
                )
                .with_package(name.as_str())
                .with_recovery("regenerate wukong.lock"),
            )
        })?;
        if !requirement.matches(version) {
            return Err(Box::new(
                Diagnostic::new(
                    ErrorCode::UserInput,
                    format!(
                        "catalog root {name} locked at {version} does not satisfy {requirement}"
                    ),
                )
                .with_package(name.as_str())
                .with_recovery("run wukong lock to resolve the current manifest"),
            ));
        }
    }
    Ok(())
}

fn catalog_request(manifest: &Manifest) -> Result<ResolutionRequest, Box<Diagnostic>> {
    let mut requirements = BTreeMap::new();
    let mut request = ResolutionRequest::new();
    add_roots(
        &mut request,
        &mut requirements,
        manifest.dependencies(),
        RootGroup::Runtime,
    )?;
    add_roots(
        &mut request,
        &mut requirements,
        manifest.dev_dependencies(),
        RootGroup::Development,
    )?;
    Ok(request)
}

struct UpdateUniverse {
    catalog: CatalogUniverse,
    retained: BTreeMap<PackageName, PackageCandidate>,
}

impl PackageUniverse for UpdateUniverse {
    fn candidates(&self, package: &PackageName) -> ResolverResult<Vec<PackageCandidate>> {
        if let Some(candidate) = self.retained.get(package) {
            Ok(vec![candidate.clone()])
        } else {
            self.catalog.candidates(package)
        }
    }
}

fn catalog_root_closure(
    lock: &Lockfile,
    selected: &PackageName,
) -> Result<BTreeSet<PackageName>, Box<Diagnostic>> {
    let graph = LockedDependencyGraph::from_catalog_lockfile(lock)?.ok_or_else(|| {
        Box::new(
            Diagnostic::new(
                ErrorCode::InternalFailure,
                "catalog update received a lockfile without persisted roots",
            )
            .with_recovery("regenerate wukong.lock"),
        )
    })?;
    let roots = graph
        .roots(crate::dependency_graph::DependencyGroup::Runtime)
        .iter()
        .chain(
            graph
                .roots(crate::dependency_graph::DependencyGroup::Development)
                .iter(),
        );
    if !roots.clone().any(|root| root == selected) {
        return Err(Box::new(
            Diagnostic::new(
                ErrorCode::UserInput,
                format!("package {selected} is not a direct catalog root"),
            )
            .with_package(selected.as_str())
            .with_recovery("select a direct dependency from wukong.toml or run wukong update"),
        ));
    }
    let mut closure = BTreeSet::new();
    let mut pending = vec![selected.clone()];
    while let Some(name) = pending.pop() {
        if !closure.insert(name.clone()) {
            continue;
        }
        let package = graph.packages().get(&name).ok_or_else(|| {
            Box::new(
                Diagnostic::new(
                    ErrorCode::InternalFailure,
                    format!("catalog root {name} disappeared from the locked graph"),
                )
                .with_recovery("regenerate wukong.lock"),
            )
        })?;
        pending.extend(package.dependencies().iter().cloned());
    }
    Ok(closure)
}

fn resolved_closure(
    graph: &ResolvedGraph,
    selected: &PackageName,
) -> Result<BTreeSet<PackageName>, Box<Diagnostic>> {
    let mut closure = BTreeSet::new();
    let mut pending = vec![selected.clone()];
    while let Some(name) = pending.pop() {
        if !closure.insert(name.clone()) {
            continue;
        }
        let package = graph.packages().get(&name).ok_or_else(|| {
            Box::new(
                Diagnostic::new(
                    ErrorCode::InternalFailure,
                    format!("selected catalog package {name} disappeared during resolution"),
                )
                .with_recovery("retry the update and report this as a wukong bug if it persists"),
            )
        })?;
        pending.extend(package.dependencies().keys().cloned());
    }
    Ok(closure)
}

fn retained_packages(
    existing: &Lockfile,
    selected_closure: Option<&BTreeSet<PackageName>>,
) -> BTreeMap<PackageName, LockedPackage> {
    if selected_closure.is_none() {
        return BTreeMap::new();
    }
    existing
        .packages()
        .iter()
        .filter(|(name, _)| !selected_closure.is_some_and(|closure| closure.contains(*name)))
        .map(|(name, package)| (name.clone(), package.clone()))
        .collect()
}

fn retained_candidates(
    retained: &BTreeMap<PackageName, LockedPackage>,
    existing: &Lockfile,
) -> Result<BTreeMap<PackageName, PackageCandidate>, Box<Diagnostic>> {
    retained
        .iter()
        .map(|(name, package)| {
            let version = package.version().ok_or_else(|| {
                Box::new(
                    Diagnostic::new(
                        ErrorCode::IntegrityFailure,
                        format!("retained catalog package {name} has no version"),
                    )
                    .with_package(name.as_str())
                    .with_recovery("regenerate wukong.lock"),
                )
            })?;
            let dependencies = package
                .dependencies()
                .iter()
                .map(|dependency| {
                    let version = retained
                        .get(dependency)
                        .or_else(|| existing.packages().get(dependency))
                        .and_then(LockedPackage::version)
                        .ok_or_else(|| {
                            Box::new(
                                Diagnostic::new(
                                    ErrorCode::IntegrityFailure,
                                    format!(
                                        "retained catalog package {name} depends on refreshable package {dependency}"
                                    ),
                                )
                                .with_package(name.as_str())
                                .with_recovery("run wukong update without selecting one package"),
                            )
                        })?;
                    VersionRequirement::parse(&format!("={version}"))
                        .map(|requirement| (dependency.clone(), requirement))
                        .map_err(|error| {
                            Box::new(
                                Diagnostic::new(
                                    ErrorCode::InternalFailure,
                                    "could not construct retained dependency requirement",
                                )
                                .with_cause(error)
                                .with_recovery(
                                    "retry the update and report this as a wukong bug if it persists",
                                ),
                            )
                        })
                })
                .collect::<Result<BTreeMap<_, _>, Box<Diagnostic>>>()?;
            Ok((
                name.clone(),
                PackageCandidate::for_package(name.clone(), version, dependencies),
            ))
        })
        .collect()
}

fn preserve_unrelated_packages(
    existing: &Lockfile,
    updated: &Lockfile,
    affected: &BTreeSet<PackageName>,
) -> Result<(), Box<Diagnostic>> {
    for (name, package) in existing.packages() {
        if affected.contains(name) {
            continue;
        }
        if updated.packages().get(name) != Some(package) {
            return Err(Box::new(
                Diagnostic::new(
                    ErrorCode::UserInput,
                    format!("selected update would change unrelated package {name}"),
                )
                .with_package(name.as_str())
                .with_recovery("run wukong update without selecting one package"),
            ));
        }
    }
    Ok(())
}

#[derive(Clone, Copy)]
enum RootGroup {
    Runtime,
    Development,
}

fn add_roots(
    request: &mut ResolutionRequest,
    requirements: &mut BTreeMap<PackageName, crate::semantic_version::VersionRequirement>,
    dependencies: &BTreeMap<DependencyAlias, Dependency>,
    group: RootGroup,
) -> Result<(), Box<Diagnostic>> {
    for (alias, dependency) in dependencies {
        let Dependency::Version(requirement) = dependency else {
            return Err(Box::new(
                Diagnostic::new(
                    ErrorCode::UserInput,
                    "catalog graph locking cannot mix version-only and direct-source dependencies",
                )
                .with_package(alias.as_str())
                .with_recovery(
                    "use only version requirements or retain the existing direct-source workflow",
                ),
            ));
        };
        let name = PackageName::parse(alias.as_str()).map_err(|error| {
            Box::new(
                Diagnostic::new(ErrorCode::InternalFailure, "manifest alias was invalid")
                    .with_cause(error)
                    .with_recovery("retry and report this as a wukong bug if it persists"),
            )
        })?;
        if let Some(existing) = requirements.get(&name) {
            if existing != requirement {
                return Err(Box::new(
                    Diagnostic::new(
                        ErrorCode::UserInput,
                        format!("catalog root {name} has conflicting runtime and development requirements"),
                    )
                    .with_package(name.as_str())
                    .with_recovery("use the same version requirement in both dependency groups"),
                ));
            }
        } else {
            requirements.insert(name.clone(), requirement.clone());
        }
        match group {
            RootGroup::Runtime => request.require_runtime(name, requirement.clone()),
            RootGroup::Development => request.require_development(name, requirement.clone()),
        }
    }
    Ok(())
}

fn lock_resolved_graph(
    graph: &ResolvedGraph,
    acquirer: &CatalogCandidateAcquirer,
    retained: &BTreeMap<PackageName, LockedPackage>,
    cancellation: &CancellationToken,
) -> Result<Lockfile, Box<Diagnostic>> {
    let mut packages = Vec::with_capacity(graph.packages().len());
    for (name, resolved) in graph.packages() {
        cancellation.check()?;
        if let Some(package) = retained.get(name) {
            packages.push(package.clone());
            continue;
        }
        let candidate = acquirer
            .acquire(name, cancellation)?
            .into_iter()
            .find(|candidate| candidate.version() == resolved.version())
            .ok_or_else(|| selected_candidate_missing(name, resolved.version()))?;
        packages.push(locked_package(name, resolved, &candidate)?);
    }
    Lockfile::new_catalog_graph(
        packages,
        CatalogGraphRoots::new(
            graph.runtime_roots().iter().cloned(),
            graph.development_roots().iter().cloned(),
        ),
    )
}

fn locked_package(
    name: &PackageName,
    resolved: &crate::resolver::ResolvedPackage,
    candidate: &AcquiredCatalogCandidate,
) -> Result<LockedPackage, Box<Diagnostic>> {
    let (source, source_subdirectory) = locked_source(candidate.source())?;
    let catalog_sha256 = candidate.catalog_sha256().to_owned();
    let target_path = candidate.metadata().target().map_or_else(
        || PathBuf::from("addons").join(name.as_str()),
        PathBuf::from,
    );
    LockedPackage::new(
        name.clone(),
        Some(resolved.version().clone()),
        source,
        candidate.package_sha256().to_owned(),
        catalog_sha256.clone(),
        resolved.dependencies().keys().cloned().collect(),
        source_subdirectory,
        target_path,
        GodotCompatibility::Requirement(candidate.metadata().godot().clone()),
        resolved.is_development(),
    )?
    .with_catalog_sha256(catalog_sha256)
}

fn locked_source(
    source: &AcquiredCatalogSource,
) -> Result<(LockedSource, PathBuf), Box<Diagnostic>> {
    match source {
        AcquiredCatalogSource::Git {
            source,
            commit,
            root,
        } => Ok((
            LockedGitSource::new(
                immutable_id(format!("git:{commit}"))?,
                source.as_str(),
                commit.clone(),
            )?
            .into(),
            root.clone(),
        )),
        AcquiredCatalogSource::Http { url, sha256, root } => Ok((
            LockedHttpSource::new(
                immutable_id(format!("sha256:{sha256}"))?,
                url,
                sha256.clone(),
            )?
            .into(),
            root.clone(),
        )),
    }
}

fn immutable_id(value: String) -> Result<ImmutableSourceId, Box<Diagnostic>> {
    ImmutableSourceId::new(value).map_err(|error| {
        Box::new(
            Diagnostic::new(
                ErrorCode::InternalFailure,
                "could not construct immutable source identity",
            )
            .with_cause(error)
            .with_recovery("retry and report this as a wukong bug if it persists"),
        )
    })
}

fn selected_candidate_missing(
    name: &PackageName,
    version: &crate::semantic_version::SemanticVersion,
) -> Box<Diagnostic> {
    Box::new(
        Diagnostic::new(
            ErrorCode::InternalFailure,
            format!("resolved catalog candidate {name} {version} disappeared"),
        )
        .with_package(name.as_str())
        .with_recovery("retry the lock operation and report this as a wukong bug if it persists"),
    )
}

#[cfg(test)]
mod tests {
    use super::{lock_catalog_dependencies, validate_catalog_lock_manifest};
    use crate::{
        cache::CacheLayout, direct_sync::sync_direct_dependencies,
        lockfile::CATALOG_GRAPH_LOCKFILE_SCHEMA, manifest::Manifest, source::CancellationToken,
        source_catalog::SourceCatalog,
    };
    use sha2::{Digest, Sha256};
    use std::{fs, io::Write, path::Path};
    use tempfile::TempDir;
    use zip::{CompressionMethod, ZipWriter, write::SimpleFileOptions};

    #[test]
    fn invariant_catalog_lock_records_the_complete_selected_graph_deterministically() {
        let fixture = Fixture::new(false);
        let first = fixture.lock(None);
        let second = fixture.lock(Some(&first));

        assert_eq!(first.schema(), CATALOG_GRAPH_LOCKFILE_SCHEMA);
        assert_eq!(first, second);
        assert_eq!(
            first
                .catalog_graph_roots()
                .expect("catalog roots should persist")
                .runtime()
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>(),
            ["root"]
        );
        assert_eq!(
            first
                .packages()
                .get("root")
                .expect("root should lock")
                .dependencies()
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>(),
            ["helper"]
        );
        assert!(
            first
                .packages()
                .get("dev-tool")
                .expect("development root should lock")
                .development()
        );
        assert!(
            !first
                .packages()
                .get("helper")
                .expect("transitive package should lock")
                .development()
        );
        assert!(
            first
                .packages()
                .values()
                .all(|package| package.catalog_sha256().is_some())
        );
        validate_catalog_lock_manifest(&fixture.manifest, &first)
            .expect("matching manifest should validate");
    }

    #[test]
    fn invariant_catalog_sync_materializes_the_full_graph_idempotently_and_removes_dev_ownership() {
        let fixture = Fixture::new(false);
        let lock = fixture.lock(None);
        let first = sync_direct_dependencies(
            fixture.project(),
            fixture.manifest_path(),
            &fixture.manifest,
            &lock,
            true,
            &fixture.cache,
            true,
        )
        .expect("full graph sync should work");
        let repeat = sync_direct_dependencies(
            fixture.project(),
            fixture.manifest_path(),
            &fixture.manifest,
            &lock,
            true,
            &fixture.cache,
            true,
        )
        .expect("repeated graph sync should work");
        let runtime_only = sync_direct_dependencies(
            fixture.project(),
            fixture.manifest_path(),
            &fixture.manifest,
            &lock,
            false,
            &fixture.cache,
            true,
        )
        .expect("runtime-only graph sync should work");

        assert_eq!(first.written, 6);
        assert_eq!(repeat.written, 0);
        assert_eq!(repeat.unchanged, 6);
        assert_eq!(runtime_only.removed, 2);
        assert!(fixture.project().join("addons/root/plugin.gd").is_file());
        assert!(fixture.project().join("addons/helper/plugin.gd").is_file());
        assert!(!fixture.project().join("addons/dev-tool/plugin.gd").exists());
    }

    #[test]
    fn invariant_catalog_transitive_conflicts_fail_before_project_mutation() {
        let fixture = Fixture::new(true);
        let lock = fixture.lock(None);

        let error = sync_direct_dependencies(
            fixture.project(),
            fixture.manifest_path(),
            &fixture.manifest,
            &lock,
            false,
            &fixture.cache,
            true,
        )
        .expect_err("conflicting direct and transitive files must fail");

        assert_eq!(error.code(), crate::diagnostic::ErrorCode::UserInput);
        assert!(!fixture.project().join("addons").exists());
        assert!(!fixture.project().join(".wukong/state.toml").exists());
    }

    struct Fixture {
        directory: TempDir,
        cache: CacheLayout,
        manifest_path: std::path::PathBuf,
        manifest: Manifest,
        catalog: crate::source_catalog::ValidatedSourceCatalog,
    }

    impl Fixture {
        fn new(conflicting_targets: bool) -> Self {
            let directory = TempDir::new().expect("fixture directory should create");
            let cache = CacheLayout::for_root(directory.path().join("cache"))
                .expect("cache layout should create");
            let root = archive(
                "root",
                [("helper", "^1")],
                conflicting_targets.then_some("addons/conflict"),
            );
            let helper = archive(
                "helper",
                [],
                conflicting_targets.then_some("addons/conflict"),
            );
            let dev_tool = archive("dev-tool", [], None);
            let root_sha256 = cache_archive(&cache, &root);
            let helper_sha256 = cache_archive(&cache, &helper);
            let dev_tool_sha256 = cache_archive(&cache, &dev_tool);
            let manifest_path = directory.path().join("wukong.toml");
            let manifest = Manifest::parse(
                &manifest_path,
                "[project]\nname = \"fixture\"\ngodot = \"4\"\n\n[dependencies]\nroot = \"^1\"\n\n[dev-dependencies]\ndev-tool = \"^1\"\n",
            )
            .expect("fixture manifest should parse");
            let catalog_path = directory.path().join("wukong.sources.toml");
            let catalog = SourceCatalog::parse(
                &catalog_path,
                &format!(
                    "schema = 1\n\n[[package]]\nname = \"root\"\n[package.http]\nversion = \"1.0.0\"\nurl = \"https://fixture.test/root.zip\"\nsha256 = \"{root_sha256}\"\nroot = \"addons/root\"\n\n[[package]]\nname = \"helper\"\n[package.http]\nversion = \"1.0.0\"\nurl = \"https://fixture.test/helper.zip\"\nsha256 = \"{helper_sha256}\"\nroot = \"addons/helper\"\n\n[[package]]\nname = \"dev-tool\"\n[package.http]\nversion = \"1.0.0\"\nurl = \"https://fixture.test/dev-tool.zip\"\nsha256 = \"{dev_tool_sha256}\"\nroot = \"addons/dev-tool\"\n"
                ),
            )
            .expect("fixture catalog should parse")
            .validate(&catalog_path)
            .expect("fixture catalog should validate");
            Self {
                directory,
                cache,
                manifest_path,
                manifest,
                catalog,
            }
        }

        fn project(&self) -> &Path {
            self.directory.path()
        }

        fn manifest_path(&self) -> &Path {
            &self.manifest_path
        }

        fn lock(&self, existing: Option<&crate::lockfile::Lockfile>) -> crate::lockfile::Lockfile {
            lock_catalog_dependencies(
                &self.manifest,
                self.catalog.clone(),
                existing,
                self.cache.clone(),
                true,
                &CancellationToken::new(),
            )
            .expect("catalog graph should lock")
        }
    }

    fn archive(
        name: &str,
        dependencies: impl IntoIterator<Item = (&'static str, &'static str)>,
        target: Option<&str>,
    ) -> Vec<u8> {
        let mut output = Vec::new();
        let mut archive = ZipWriter::new(std::io::Cursor::new(&mut output));
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        let dependencies = dependencies
            .into_iter()
            .map(|(name, requirement)| format!("{name} = {requirement:?}"))
            .collect::<Vec<_>>()
            .join("\n");
        let target = target.map_or_else(String::new, |target| format!("\ntarget = {target:?}"));
        let dependencies = if dependencies.is_empty() {
            String::new()
        } else {
            format!("\n[dependencies]\n{dependencies}\n")
        };
        let metadata = format!(
            "[package]\nschema = 1\nname = {name:?}\nversion = \"1.0.0\"\ngodot = \"4\"{target}{dependencies}"
        );
        archive
            .start_file(format!("addons/{name}/wukong-package.toml"), options)
            .expect("metadata entry should start");
        archive
            .write_all(metadata.as_bytes())
            .expect("metadata should write");
        archive
            .start_file(format!("addons/{name}/plugin.gd"), options)
            .expect("plugin entry should start");
        archive
            .write_all(name.as_bytes())
            .expect("plugin should write");
        archive.finish().expect("archive should finish");
        output
    }

    fn cache_archive(cache: &CacheLayout, archive: &[u8]) -> String {
        let sha256 = format!("{:x}", Sha256::digest(archive));
        let path = cache.downloads().join("sha256").join(&sha256);
        fs::create_dir_all(path.parent().expect("archive cache parent should exist"))
            .expect("archive cache parent should create");
        fs::write(path, archive).expect("archive cache should write");
        sha256
    }
}
