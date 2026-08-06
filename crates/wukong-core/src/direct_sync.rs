//! Direct-source lockfile verification and transactional project synchronisation.

use crate::{
    archive::{ExtractionLimits, extract_zip},
    cache::{
        CacheLayout, VerifiedCacheObject, acquire_verified_package_object, publish_prepared_package,
    },
    diagnostic::{Diagnostic, ErrorCode},
    git_fetch::GitFetcher,
    git_source::{GitSourceRequest, canonicalize_git_url},
    http_archive::{CachedArchive, HttpArchiveFetcher, canonicalize_archive_url},
    installed_state::{DependencyGroup, InstalledPackage},
    local_source::{LocalPathAdapter, LocalPathRequest},
    lockfile::{LockedSource, Lockfile},
    manifest::{Dependency, GitReference, Manifest},
    ownership::{PackageMaterialization, build_desired_file_map},
    package_tree::prepare_package_tree,
    project_sync::{SyncSummary, sync_project_with_cancellation},
    source::{CancellationToken, ResolvedSource, SourceAdapter},
};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
};
use tempfile::TempDir;

/// A deterministic status update emitted while synchronising locked packages.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SyncProgress {
    package: crate::identity::PackageName,
    completed: usize,
    total: usize,
    stage: SyncProgressStage,
}
impl SyncProgress {
    fn new(
        package: crate::identity::PackageName,
        completed: usize,
        total: usize,
        stage: SyncProgressStage,
    ) -> Self {
        Self {
            package,
            completed,
            total,
            stage,
        }
    }

    /// Returns the package currently being processed.
    #[must_use]
    pub fn package(&self) -> &crate::identity::PackageName {
        &self.package
    }

    /// Returns the number of packages fully prepared so far.
    #[must_use]
    pub const fn completed(&self) -> usize {
        self.completed
    }

    /// Returns the total selected package count.
    #[must_use]
    pub const fn total(&self) -> usize {
        self.total
    }

    /// Returns the current non-terminal operation stage.
    #[must_use]
    pub const fn stage(&self) -> SyncProgressStage {
        self.stage
    }
}

/// The current package-level synchronisation stage.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SyncProgressStage {
    /// The immutable source identity is being checked.
    ValidatingSource,
    /// A prepared cache object is being verified or populated.
    PreparingPackage,
    /// The package tree has been verified and is ready to materialise.
    Prepared,
}

/// Receives domain progress without depending on terminal rendering.
pub trait SyncProgressObserver {
    /// Handles one deterministic synchronisation progress update.
    fn report(&self, progress: &SyncProgress);
}

struct NoProgress;
impl SyncProgressObserver for NoProgress {
    fn report(&self, _progress: &SyncProgress) {}
}

/// Synchronises selected direct dependencies exactly as locked.
///
/// # Errors
///
/// Returns a diagnostic when the manifest, lockfile, or source content
/// disagrees before any project file is changed.
pub fn sync_direct_dependencies(
    project_root: &Path,
    manifest_path: &Path,
    manifest: &Manifest,
    lock: &Lockfile,
    include_dev: bool,
    cache: &CacheLayout,
    offline: bool,
) -> Result<SyncSummary, Box<Diagnostic>> {
    let cancellation = CancellationToken::new();
    sync_direct_dependencies_with_cancellation(
        project_root,
        manifest_path,
        manifest,
        lock,
        include_dev,
        cache,
        offline,
        &cancellation,
    )
}

/// Synchronises selected direct dependencies while observing cancellation.
///
/// # Errors
///
/// Returns a diagnostic when the manifest, lockfile, or source content
/// disagrees before any project file is changed, or when cancellation is
/// requested at a transaction-safe boundary.
#[allow(clippy::too_many_arguments)]
pub fn sync_direct_dependencies_with_cancellation(
    project_root: &Path,
    manifest_path: &Path,
    manifest: &Manifest,
    lock: &Lockfile,
    include_dev: bool,
    cache: &CacheLayout,
    offline: bool,
    cancellation: &CancellationToken,
) -> Result<SyncSummary, Box<Diagnostic>> {
    sync_direct_dependencies_with_progress_and_cancellation(
        project_root,
        manifest_path,
        manifest,
        lock,
        include_dev,
        cache,
        offline,
        cancellation,
        &NoProgress,
    )
}

/// Synchronises selected direct dependencies while reporting package progress.
///
/// The observer receives source-validation and package-preparation updates in
/// deterministic lockfile order. It must not mutate project-owned files.
///
/// # Errors
///
/// Returns a diagnostic when the manifest, lockfile, source content, or cache
/// disagrees before any project file is changed, or when cancellation occurs.
#[allow(clippy::too_many_arguments, clippy::too_many_lines)] // coordinates source validation and one project transaction
pub fn sync_direct_dependencies_with_progress_and_cancellation(
    project_root: &Path,
    manifest_path: &Path,
    manifest: &Manifest,
    lock: &Lockfile,
    include_dev: bool,
    cache: &CacheLayout,
    offline: bool,
    cancellation: &CancellationToken,
    progress: &dyn SyncProgressObserver,
) -> Result<SyncSummary, Box<Diagnostic>> {
    cancellation.check()?;
    let git = GitFetcher::new(cache.clone());
    let http = HttpArchiveFetcher::new(cache.clone());
    if offline {
        verify_offline_cache(lock, include_dev, &git, &http)?;
    }
    let staging = TempDir::new()
        .map_err(|error| internal("could not create sync preparation directory", error))?;
    let selected_total = lock
        .packages()
        .values()
        .filter(|locked| !locked.development() || include_dev)
        .count();
    let mut completed = 0;
    let mut trees = BTreeMap::new();
    let mut verified_cache_trees =
        BTreeMap::<String, crate::package_tree::PreparedPackageTree>::new();
    let mut cache_leases = Vec::<VerifiedCacheObject>::new();
    let mut validated_local_sources = BTreeMap::<String, ValidatedSource>::new();
    let mut packages = Vec::new();
    let catalog_graph = lock.catalog_graph_roots().is_some();
    for locked in lock.packages().values() {
        cancellation.check()?;
        if locked.development() && !include_dev {
            continue;
        }
        progress.report(&SyncProgress::new(
            locked.name().clone(),
            completed,
            selected_total,
            SyncProgressStage::ValidatingSource,
        ));
        let source = if catalog_graph {
            validate_locked_source(
                locked.source(),
                &git,
                &http,
                cancellation,
                offline,
                locked.name().as_str(),
            )?
        } else {
            let dependency = dependency(manifest, locked.name().as_str(), locked.development())?;
            let local_key = local_validation_key(locked.source(), dependency);
            if let Some(source) = local_key
                .as_ref()
                .and_then(|key| validated_local_sources.get(key))
            {
                source.clone()
            } else {
                let source = validate_source(
                    locked.source(),
                    dependency,
                    manifest_path,
                    &git,
                    &http,
                    cancellation,
                    offline,
                    locked.name().as_str(),
                )?;
                if let Some(key) = local_key {
                    validated_local_sources.insert(key, source.clone());
                }
                source
            }
        };
        progress.report(&SyncProgress::new(
            locked.name().clone(),
            completed,
            selected_total,
            SyncProgressStage::PreparingPackage,
        ));
        let tree = if let Some(tree) = verified_cache_trees.get(locked.package_sha256()) {
            tree.clone()
        } else {
            let tree = match acquire_verified_package_object(cache, locked.package_sha256()) {
                Ok(object) => {
                    let tree = object.prepared().clone();
                    cache_leases.push(object);
                    tree
                }
                Err(error) if error.code() == ErrorCode::SourceAccess => {
                    let source_root = source.into_root(&staging)?;
                    let prepared = prepare_package_tree(
                        &source_root.join(locked.source_subdirectory()),
                        &staging.path().join(locked.name().as_str()),
                    )?;
                    verify_prepared_hash(&prepared, locked)?;
                    match publish_prepared_package(cache, &prepared) {
                        Ok(_) => prepared,
                        Err(error) if error.code() == ErrorCode::SourceAccess => prepared,
                        Err(error) => return Err(error),
                    }
                }
                Err(error) => return Err(error),
            };
            verified_cache_trees.insert(locked.package_sha256().to_owned(), tree.clone());
            tree
        };
        trees.insert(locked.name().clone(), tree);
        completed += 1;
        progress.report(&SyncProgress::new(
            locked.name().clone(),
            completed,
            selected_total,
            SyncProgressStage::Prepared,
        ));
        packages.push(InstalledPackage::new(
            locked.name().clone(),
            locked.source().immutable_id().clone(),
            locked.package_sha256().to_owned(),
        )?);
    }
    let mut materializations = Vec::new();
    for locked in lock
        .packages()
        .values()
        .filter(|locked| !locked.development() || include_dev)
    {
        cancellation.check()?;
        let tree = trees.get(locked.name()).ok_or_else(|| {
            Box::new(
                Diagnostic::new(
                    ErrorCode::InternalFailure,
                    format!("selected locked package {} was not prepared", locked.name()),
                )
                .with_recovery("retry and report this as a wukong bug if it persists"),
            )
        })?;
        materializations.push(PackageMaterialization::new(
            locked.name(),
            tree,
            locked.target_path(),
        ));
    }
    let desired = build_desired_file_map(materializations)?;
    let mut groups = BTreeSet::from([DependencyGroup::Dependencies]);
    if include_dev {
        groups.insert(DependencyGroup::DevDependencies);
    }
    sync_project_with_cancellation(project_root, groups, packages, &desired, cancellation)
}

fn verify_offline_cache(
    lock: &Lockfile,
    include_dev: bool,
    git: &GitFetcher,
    http: &HttpArchiveFetcher,
) -> Result<(), Box<Diagnostic>> {
    let mut unavailable = Vec::new();
    for locked in lock
        .packages()
        .values()
        .filter(|locked| !locked.development() || include_dev)
    {
        match locked.source() {
            LockedSource::Local(_) => {}
            LockedSource::Git(source) => {
                let request = GitSourceRequest::new(
                    source.url().to_owned(),
                    Some(GitReference::Rev(source.commit().to_owned())),
                );
                if let Err(error) = git.fetch(&request, true) {
                    if error.code() != ErrorCode::SourceAccess {
                        return Err(error);
                    }
                    unavailable.push(format!(
                        "{} (Git checkout {})",
                        locked.name(),
                        source.commit()
                    ));
                }
            }
            LockedSource::Http(source) => {
                if let Err(error) = http.fetch(source.url(), source.sha256(), true) {
                    if error.code() != ErrorCode::SourceAccess {
                        return Err(error);
                    }
                    unavailable.push(format!(
                        "{} (HTTPS archive sha256:{})",
                        locked.name(),
                        source.sha256()
                    ));
                }
            }
        }
    }
    if unavailable.is_empty() {
        Ok(())
    } else {
        Err(Box::new(
            Diagnostic::new(
                ErrorCode::SourceAccess,
                format!("offline cache is incomplete: {}", unavailable.join(", ")),
            )
            .with_recovery("run wukong sync without --offline to fetch the listed artifacts"),
        ))
    }
}

/// Synchronises selected direct local dependencies exactly as locked.
///
/// # Errors
///
/// Returns a diagnostic when a lockfile contains a non-local source or when
/// local source content differs from its immutable lock identity.
pub fn sync_direct_local_dependencies(
    project_root: &Path,
    manifest_path: &Path,
    manifest: &Manifest,
    lock: &Lockfile,
    include_dev: bool,
) -> Result<SyncSummary, Box<Diagnostic>> {
    if lock
        .packages()
        .values()
        .any(|package| !matches!(package.source(), LockedSource::Local(_)))
    {
        return Err(Box::new(
            Diagnostic::new(
                ErrorCode::UserInput,
                "synchronisation supports only local dependencies currently",
            )
            .with_recovery("use sync_direct_dependencies for locked Git or HTTPS sources"),
        ));
    }
    let cache = CacheLayout::for_root(
        manifest_path
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join(".wukong-local-sync-cache"),
    )?;
    sync_direct_dependencies(
        project_root,
        manifest_path,
        manifest,
        lock,
        include_dev,
        &cache,
        true,
    )
}

#[derive(Clone)]
enum ValidatedSource {
    Directory(std::path::PathBuf),
    Archive(CachedArchive),
}

impl ValidatedSource {
    fn into_root(self, staging: &TempDir) -> Result<std::path::PathBuf, Box<Diagnostic>> {
        match self {
            Self::Directory(root) => Ok(root),
            Self::Archive(archive) => {
                Ok(
                    extract_zip(archive.path(), staging.path(), ExtractionLimits::default())?
                        .root()
                        .to_path_buf(),
                )
            }
        }
    }
}

#[allow(clippy::too_many_arguments)] // source adapters remain explicit at the validation boundary
fn validate_source(
    source: &LockedSource,
    dependency: &Dependency,
    manifest_path: &Path,
    git: &GitFetcher,
    http: &HttpArchiveFetcher,
    cancellation: &CancellationToken,
    offline: bool,
    package: &str,
) -> Result<ValidatedSource, Box<Diagnostic>> {
    match (source, dependency) {
        (LockedSource::Local(locked), Dependency::Path { path, .. }) => {
            let resolution = LocalPathAdapter.resolve(
                &LocalPathRequest::new(manifest_path.to_path_buf(), path.clone()),
                cancellation,
            )?;
            if resolution.immutable_id() != locked.immutable_id() {
                return Err(Box::new(
                    Diagnostic::new(
                        ErrorCode::IntegrityFailure,
                        format!("local source content changed for locked package {package}"),
                    )
                    .with_package(package)
                    .with_recovery("run wukong lock to update the immutable local source identity"),
                ));
            }
            Ok(ValidatedSource::Directory(
                resolution.root().path().to_path_buf(),
            ))
        }
        (LockedSource::Git(locked), Dependency::Git { url, .. }) => {
            if canonicalize_git_url(url)?.as_str() != locked.url() {
                return Err(source_mismatch(package));
            }
            let checkout = git.fetch(
                &GitSourceRequest::new(
                    locked.url().to_owned(),
                    Some(GitReference::Rev(locked.commit().to_owned())),
                ),
                offline,
            )?;
            if checkout.resolution().immutable_id() != source.immutable_id() {
                return Err(Box::new(
                    Diagnostic::new(
                        ErrorCode::IntegrityFailure,
                        format!("Git source identity changed for locked package {package}"),
                    )
                    .with_package(package)
                    .with_recovery("run wukong lock to update the immutable Git commit"),
                ));
            }
            Ok(ValidatedSource::Directory(checkout.root().to_path_buf()))
        }
        (LockedSource::Http(locked), Dependency::Url { url, sha256, .. }) => {
            if canonicalize_archive_url(url)? != locked.url() || sha256 != locked.sha256() {
                return Err(source_mismatch(package));
            }
            Ok(ValidatedSource::Archive(http.fetch(
                locked.url(),
                locked.sha256(),
                offline,
            )?))
        }
        #[cfg(feature = "asset-library")]
        (LockedSource::Http(locked), Dependency::Asset { .. }) => Ok(ValidatedSource::Archive(
            http.fetch(locked.url(), locked.sha256(), offline)?,
        )),
        _ => Err(source_mismatch(package)),
    }
}

fn validate_locked_source(
    source: &LockedSource,
    git: &GitFetcher,
    http: &HttpArchiveFetcher,
    cancellation: &CancellationToken,
    offline: bool,
    package: &str,
) -> Result<ValidatedSource, Box<Diagnostic>> {
    cancellation.check()?;
    match source {
        LockedSource::Git(locked) => {
            let checkout = git.fetch(
                &GitSourceRequest::new(
                    locked.url().to_owned(),
                    Some(GitReference::Rev(locked.commit().to_owned())),
                ),
                offline,
            )?;
            if checkout.resolution().immutable_id() != source.immutable_id() {
                return Err(Box::new(
                    Diagnostic::new(
                        ErrorCode::IntegrityFailure,
                        format!("Git source identity changed for locked package {package}"),
                    )
                    .with_package(package)
                    .with_recovery("regenerate wukong.lock from the reviewed catalog"),
                ));
            }
            Ok(ValidatedSource::Directory(checkout.root().to_path_buf()))
        }
        LockedSource::Http(locked) => Ok(ValidatedSource::Archive(http.fetch(
            locked.url(),
            locked.sha256(),
            offline,
        )?)),
        LockedSource::Local(_) => Err(Box::new(
            Diagnostic::new(
                ErrorCode::IntegrityFailure,
                format!("catalog graph package {package} has a local source"),
            )
            .with_package(package)
            .with_recovery("regenerate wukong.lock from the reviewed catalog"),
        )),
    }
}

fn verify_prepared_hash(
    prepared: &crate::package_tree::PreparedPackageTree,
    locked: &crate::lockfile::LockedPackage,
) -> Result<(), Box<Diagnostic>> {
    if prepared.sha256() == locked.package_sha256() {
        Ok(())
    } else {
        Err(Box::new(
            Diagnostic::new(
                ErrorCode::IntegrityFailure,
                format!(
                    "prepared package content changed for locked package {}",
                    locked.name()
                ),
            )
            .with_recovery("run wukong lock to update the package checksum"),
        ))
    }
}

fn local_validation_key(source: &LockedSource, dependency: &Dependency) -> Option<String> {
    match (source, dependency) {
        (LockedSource::Local(locked), Dependency::Path { path, .. }) => Some(format!(
            "{}:{}",
            locked.immutable_id().as_str(),
            path.display()
        )),
        _ => None,
    }
}

fn source_mismatch(package: &str) -> Box<Diagnostic> {
    Box::new(
        Diagnostic::new(
            ErrorCode::UserInput,
            format!("manifest source differs from locked package {package}"),
        )
        .with_package(package)
        .with_recovery("run wukong lock to reconcile the manifest and lockfile"),
    )
}

fn dependency<'a>(
    manifest: &'a Manifest,
    name: &str,
    development: bool,
) -> Result<&'a Dependency, Box<Diagnostic>> {
    let dependencies = if development {
        manifest.dev_dependencies()
    } else {
        manifest.dependencies()
    };
    dependencies.get(name).ok_or_else(|| {
        Box::new(
            Diagnostic::new(
                ErrorCode::UserInput,
                format!("locked package {name} is absent from the selected manifest group"),
            )
            .with_recovery("run wukong lock to reconcile the manifest and lockfile"),
        )
    })
}

fn internal(message: &str, error: impl std::fmt::Display) -> Box<Diagnostic> {
    Box::new(
        Diagnostic::new(ErrorCode::InternalFailure, message)
            .with_cause(error)
            .with_recovery("retry and report this as a wukong bug if it persists"),
    )
}
