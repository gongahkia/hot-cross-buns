//! Direct-source lockfile verification and transactional project synchronisation.

use crate::{
    archive::{ExtractionLimits, extract_zip},
    cache::CacheLayout,
    diagnostic::{Diagnostic, ErrorCode},
    git_fetch::GitFetcher,
    git_source::{GitSourceRequest, canonicalize_git_url},
    http_archive::{HttpArchiveFetcher, canonicalize_archive_url},
    installed_state::{DependencyGroup, InstalledPackage},
    local_source::{LocalPathAdapter, LocalPathRequest},
    lockfile::{LockedSource, Lockfile},
    manifest::{Dependency, GitReference, Manifest},
    ownership::{PackageMaterialization, build_desired_file_map},
    package_tree::prepare_package_tree,
    project_sync::{SyncSummary, sync_project},
    source::{CancellationToken, ResolvedSource, SourceAdapter},
};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
};
use tempfile::TempDir;

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
    let git = GitFetcher::new(cache.clone());
    let http = HttpArchiveFetcher::new(cache.clone());
    if offline {
        verify_offline_cache(lock, include_dev, &git, &http)?;
    }
    let staging = TempDir::new()
        .map_err(|error| internal("could not create sync preparation directory", error))?;
    let cancellation = CancellationToken::new();
    let mut trees = BTreeMap::new();
    let mut packages = Vec::new();
    for locked in lock.packages().values() {
        if locked.development() && !include_dev {
            continue;
        }
        let dependency = dependency(manifest, locked.name().as_str(), locked.development())?;
        let source_root = source_root(
            locked.source(),
            dependency,
            manifest_path,
            &git,
            &http,
            &cancellation,
            staging.path(),
            offline,
            locked.name().as_str(),
        )?;
        let tree = prepare_package_tree(
            &source_root.join(locked.source_subdirectory()),
            &staging.path().join(locked.name().as_str()),
        )?;
        if tree.sha256() != locked.package_sha256() {
            return Err(Box::new(
                Diagnostic::new(
                    ErrorCode::IntegrityFailure,
                    format!(
                        "prepared package content changed for locked package {}",
                        locked.name()
                    ),
                )
                .with_recovery("run wukong lock to update the package checksum"),
            ));
        }
        trees.insert(locked.name().clone(), tree);
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
    sync_project(project_root, groups, packages, &desired)
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

#[allow(clippy::too_many_arguments)]
fn source_root(
    source: &LockedSource,
    dependency: &Dependency,
    manifest_path: &Path,
    git: &GitFetcher,
    http: &HttpArchiveFetcher,
    cancellation: &CancellationToken,
    staging: &Path,
    offline: bool,
    package: &str,
) -> Result<std::path::PathBuf, Box<Diagnostic>> {
    match (source, dependency) {
        (LockedSource::Local(locked), Dependency::Path(path)) => {
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
            Ok(resolution.root().path().to_path_buf())
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
            Ok(checkout.root().to_path_buf())
        }
        (LockedSource::Http(locked), Dependency::Url { url, sha256 }) => {
            if canonicalize_archive_url(url)? != locked.url() || sha256 != locked.sha256() {
                return Err(source_mismatch(package));
            }
            let archive = http.fetch(locked.url(), locked.sha256(), offline)?;
            let extracted = extract_zip(archive.path(), staging, ExtractionLimits::default())?;
            Ok(extracted.root().to_path_buf())
        }
        _ => Err(source_mismatch(package)),
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
