//! Direct local-dependency locking without project materialisation.

use crate::{
    diagnostic::{Diagnostic, ErrorCode},
    identity::PackageName,
    layout::{LayoutOptions, detect_package_layout},
    local_source::{LocalPathAdapter, LocalPathRequest},
    lockfile::{GodotCompatibility, LockedLocalSource, LockedPackage, Lockfile},
    manifest::{Dependency, DependencyAlias, Manifest},
    package_metadata::PackageMetadata,
    package_tree::prepare_package_tree,
    source::{CancellationToken, ResolvedSource, SourceAdapter},
};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Path, PathBuf},
};
use tempfile::TempDir;

/// Locks direct local dependencies without writing the lockfile or project files.
///
/// # Errors
///
/// Returns a diagnostic for unsupported source types, source/layout failures, or
/// invalid direct dependency declarations.
pub fn lock_direct_local_dependencies(
    manifest_path: &Path,
    manifest: &Manifest,
    existing: Option<&Lockfile>,
) -> Result<Lockfile, Box<Diagnostic>> {
    let declarations = direct_local_declarations(manifest)?;
    if let Some(lock) = existing.filter(|lock| reusable(lock, &declarations)) {
        return Ok(lock.clone());
    }
    let staging = TempDir::new()
        .map_err(|error| internal("could not create package-lock staging directory", error))?;
    let adapter = LocalPathAdapter;
    let cancellation = CancellationToken::new();
    let mut packages = Vec::new();
    for declaration in declarations.values() {
        let resolution = adapter.resolve(
            &LocalPathRequest::new(manifest_path.to_path_buf(), declaration.path.clone()),
            &cancellation,
        )?;
        let source_root = resolution.root().path();
        let metadata = PackageMetadata::load_optional(source_root)?;
        let layout = detect_package_layout(
            source_root,
            &LayoutOptions {
                source_subdirectory: metadata
                    .as_ref()
                    .and_then(|metadata| metadata.root())
                    .map(Path::to_path_buf),
                target_path: metadata
                    .as_ref()
                    .and_then(|metadata| metadata.target())
                    .map(Path::to_path_buf),
            },
        )?;
        let source_subdirectory = layout
            .source_root()
            .strip_prefix(source_root)
            .map_err(|error| internal("selected package layout escaped its source root", error))?;
        let prepared = prepare_package_tree(
            layout.source_root(),
            &staging.path().join(declaration.name.as_str()),
        )?;
        let source = LockedLocalSource::new(
            resolution.immutable_id().clone(),
            resolution.snapshot().sha256().to_owned(),
        )?;
        packages.push(LockedPackage::new(
            declaration.name.clone(),
            metadata.as_ref().map(|metadata| metadata.version().clone()),
            source,
            prepared.sha256().to_owned(),
            declaration.fingerprint.clone(),
            BTreeSet::new(),
            if source_subdirectory.as_os_str().is_empty() {
                PathBuf::from(".")
            } else {
                source_subdirectory.to_path_buf()
            },
            layout.target_path().map_or_else(
                || PathBuf::from("addons").join(declaration.name.as_str()),
                Path::to_path_buf,
            ),
            metadata.map_or(GodotCompatibility::Unknown, |metadata| {
                GodotCompatibility::Requirement(metadata.godot().clone())
            }),
            declaration.development,
        )?);
    }
    Lockfile::new(packages)
}

#[derive(Clone)]
struct Declaration {
    name: PackageName,
    path: PathBuf,
    development: bool,
    fingerprint: String,
}
fn direct_local_declarations(
    manifest: &Manifest,
) -> Result<BTreeMap<PackageName, Declaration>, Box<Diagnostic>> {
    let mut declarations = BTreeMap::new();
    insert_declarations(&mut declarations, manifest.dependencies(), false)?;
    insert_declarations(&mut declarations, manifest.dev_dependencies(), true)?;
    Ok(declarations)
}
fn insert_declarations(
    out: &mut BTreeMap<PackageName, Declaration>,
    dependencies: &BTreeMap<DependencyAlias, Dependency>,
    development: bool,
) -> Result<(), Box<Diagnostic>> {
    for (alias, dependency) in dependencies {
        let Dependency::Path(path) = dependency else {
            return Err(Box::new(Diagnostic::new(ErrorCode::UserInput, format!("dependency {} uses a source not implemented in the local-path vertical slice", alias.as_str())).with_recovery("use a local path dependency until Git and HTTP adapters are implemented")));
        };
        let name = PackageName::parse(alias.as_str()).map_err(|error| {
            Box::new(
                Diagnostic::new(ErrorCode::InternalFailure, "manifest alias was invalid")
                    .with_cause(error),
            )
        })?;
        let declaration = Declaration {
            name: name.clone(),
            path: path.clone(),
            development,
            fingerprint: declaration_fingerprint(alias, path, development),
        };
        match out.get(&name) {
            None => {
                out.insert(name, declaration);
            }
            Some(existing) if existing.path == declaration.path => {}
            Some(_) => {
                return Err(Box::new(
                    Diagnostic::new(
                        ErrorCode::UserInput,
                        format!("dependency {} has conflicting local paths", alias.as_str()),
                    )
                    .with_recovery("use one local path per package alias"),
                ));
            }
        }
    }
    Ok(())
}
fn reusable(lock: &Lockfile, declarations: &BTreeMap<PackageName, Declaration>) -> bool {
    lock.packages().len() == declarations.len()
        && declarations.iter().all(|(name, declaration)| {
            lock.packages().get(name).is_some_and(|package| {
                package.declaration_sha256() == declaration.fingerprint
                    && package.development() == declaration.development
            })
        })
}
fn declaration_fingerprint(alias: &DependencyAlias, path: &Path, development: bool) -> String {
    let mut hasher = Sha256::new();
    hasher.update(alias.as_str().as_bytes());
    hasher.update([0]);
    hasher.update(path.to_string_lossy().as_bytes());
    hasher.update([0, u8::from(development)]);
    format!("{:x}", hasher.finalize())
}
fn internal(message: &str, error: impl std::fmt::Display) -> Box<Diagnostic> {
    Box::new(
        Diagnostic::new(ErrorCode::InternalFailure, message)
            .with_cause(error)
            .with_recovery("retry and report this as a wukong bug if it persists"),
    )
}
