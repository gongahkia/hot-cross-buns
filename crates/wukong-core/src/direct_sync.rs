//! Local-path lockfile verification and transactional project synchronisation.

use crate::{
    diagnostic::{Diagnostic, ErrorCode},
    installed_state::{DependencyGroup, InstalledPackage},
    local_source::{LocalPathAdapter, LocalPathRequest},
    lockfile::Lockfile,
    manifest::{Dependency, Manifest},
    ownership::{PackageMaterialization, build_desired_file_map},
    package_tree::prepare_package_tree,
    project_sync::{SyncSummary, sync_project},
    source::{ResolvedSource, SourceAdapter},
};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
};
use tempfile::TempDir;

/// Synchronises selected direct local dependencies exactly as locked.
///
/// # Errors
///
/// Returns a diagnostic when the manifest, lockfile, or current local content
/// disagrees before any project file is changed.
pub fn sync_direct_local_dependencies(
    project_root: &Path,
    manifest_path: &Path,
    manifest: &Manifest,
    lock: &Lockfile,
    include_dev: bool,
) -> Result<SyncSummary, Box<Diagnostic>> {
    let staging = TempDir::new()
        .map_err(|error| internal("could not create local sync preparation directory", error))?;
    let adapter = LocalPathAdapter;
    let mut trees = BTreeMap::new();
    let mut packages = Vec::new();
    for locked in lock.packages().values() {
        if locked.development() && !include_dev {
            continue;
        }
        let dependency = dependency(manifest, locked.name().as_str(), locked.development())?;
        let Dependency::Path(path) = dependency else {
            return Err(Box::new(
                Diagnostic::new(
                    ErrorCode::UserInput,
                    format!(
                        "locked package {} is not a local path dependency",
                        locked.name()
                    ),
                )
                .with_recovery("regenerate wukong.lock with an implemented source adapter"),
            ));
        };
        let resolution = adapter.resolve(&LocalPathRequest::new(
            manifest_path.to_path_buf(),
            path.clone(),
        ))?;
        if resolution.immutable_id() != locked.source().immutable_id() {
            return Err(Box::new(
                Diagnostic::new(
                    ErrorCode::IntegrityFailure,
                    format!(
                        "local source content changed for locked package {}",
                        locked.name()
                    ),
                )
                .with_recovery("run wukong lock to update the immutable local source identity"),
            ));
        }
        let tree = prepare_package_tree(
            &resolution.root().path().join(locked.source_subdirectory()),
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
