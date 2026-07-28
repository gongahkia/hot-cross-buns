//! Direct dependency locking without project materialisation.

use crate::{
    archive::{ExtractionLimits, extract_zip},
    cache::CacheLayout,
    diagnostic::{Diagnostic, ErrorCode},
    git_fetch::GitFetcher,
    git_source::GitSourceRequest,
    http_archive::{HttpArchiveFetcher, canonicalize_archive_url},
    identity::PackageName,
    layout::{LayoutOptions, detect_package_layout},
    local_source::{LocalPathAdapter, LocalPathRequest},
    lockfile::{
        GodotCompatibility, LockedGitSource, LockedHttpSource, LockedLocalSource, LockedPackage,
        LockedSource, Lockfile,
    },
    manifest::{Dependency, DependencyAlias, GitReference, Manifest},
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

/// Locks direct local, Git, and HTTPS archive dependencies without project mutation.
///
/// # Errors
///
/// Returns a diagnostic for invalid declarations, unavailable sources, failed
/// integrity verification, or package preparation errors.
pub fn lock_direct_dependencies(
    manifest_path: &Path,
    manifest: &Manifest,
    existing: Option<&Lockfile>,
    cache: &CacheLayout,
    offline: bool,
) -> Result<Lockfile, Box<Diagnostic>> {
    let declarations = direct_declarations(manifest)?;
    if let Some(lock) = existing.filter(|lock| reusable(lock, &declarations)) {
        return Ok(lock.clone());
    }
    let staging = TempDir::new()
        .map_err(|error| internal("could not create package-lock staging directory", error))?;
    let local = LocalPathAdapter;
    let git = GitFetcher::new(cache.clone());
    let http = HttpArchiveFetcher::new(cache.clone());
    let cancellation = CancellationToken::new();
    let mut packages = Vec::new();
    for declaration in declarations.values() {
        let (source_root, source) = match &declaration.source {
            DeclaredSource::Local(path) => {
                let resolution = local.resolve(
                    &LocalPathRequest::new(manifest_path.to_path_buf(), path.clone()),
                    &cancellation,
                )?;
                let source = LockedLocalSource::new(
                    resolution.immutable_id().clone(),
                    resolution.snapshot().sha256().to_owned(),
                )?;
                (resolution.root().path().to_path_buf(), source.into())
            }
            DeclaredSource::Git { url, reference } => {
                let checkout = git.fetch(
                    &GitSourceRequest::new(url.clone(), reference.clone()),
                    offline,
                )?;
                let resolution = checkout.resolution();
                let source = LockedGitSource::new(
                    resolution.immutable_id().clone(),
                    resolution.source().as_str(),
                    resolution.commit().to_owned(),
                )?;
                (checkout.root().to_path_buf(), source.into())
            }
            DeclaredSource::Http { url, sha256 } => {
                let archive = http.fetch(url, sha256, offline)?;
                let extracted =
                    extract_zip(archive.path(), staging.path(), ExtractionLimits::default())?;
                let immutable_id = crate::source::ImmutableSourceId::new(format!(
                    "sha256:{}",
                    archive.sha256()
                ))
                .map_err(|error| internal("could not create HTTP immutable identity", error))?;
                let source = LockedHttpSource::new(immutable_id, url, archive.sha256().to_owned())?;
                (extracted.root().to_path_buf(), source.into())
            }
        };
        packages.push(lock_package(
            declaration,
            &source_root,
            source,
            staging.path(),
        )?);
    }
    Lockfile::new(packages)
}

/// Locks direct local dependencies for the local-only sync path.
///
/// # Errors
///
/// Returns a diagnostic when a declaration is not local or source preparation fails.
pub fn lock_direct_local_dependencies(
    manifest_path: &Path,
    manifest: &Manifest,
    existing: Option<&Lockfile>,
) -> Result<Lockfile, Box<Diagnostic>> {
    let declarations = direct_declarations(manifest)?;
    if declarations
        .values()
        .any(|declaration| !matches!(declaration.source, DeclaredSource::Local(_)))
    {
        return Err(Box::new(
            Diagnostic::new(
                ErrorCode::UserInput,
                "synchronisation supports only local dependencies currently",
            )
            .with_recovery(
                "run wukong lock for remote dependencies; remote sync is not implemented",
            ),
        ));
    }
    let cache_root = manifest_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join(".wukong-local-lock-cache");
    let cache = CacheLayout::for_root(cache_root)?;
    lock_direct_dependencies(manifest_path, manifest, existing, &cache, true)
}

fn lock_package(
    declaration: &Declaration,
    source_root: &Path,
    source: LockedSource,
    staging: &Path,
) -> Result<LockedPackage, Box<Diagnostic>> {
    let source_root = std::fs::canonicalize(source_root)
        .map_err(|error| internal("could not canonicalize source root for locking", error))?;
    let metadata = PackageMetadata::load_optional(&source_root)?;
    let layout = detect_package_layout(
        &source_root,
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
        .strip_prefix(&source_root)
        .map_err(|error| internal("selected package layout escaped its source root", error))?;
    let prepared = prepare_package_tree(
        layout.source_root(),
        &staging.join(declaration.name.as_str()),
    )?;
    LockedPackage::new(
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
    )
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum DeclaredSource {
    Local(PathBuf),
    Git {
        url: String,
        reference: Option<GitReference>,
    },
    Http {
        url: String,
        sha256: String,
    },
}
#[derive(Clone)]
struct Declaration {
    name: PackageName,
    source: DeclaredSource,
    development: bool,
    fingerprint: String,
}
fn direct_declarations(
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
        let source = declaration_source(dependency)?;
        let name = PackageName::parse(alias.as_str()).map_err(|error| {
            Box::new(
                Diagnostic::new(ErrorCode::InternalFailure, "manifest alias was invalid")
                    .with_cause(error),
            )
        })?;
        let declaration = Declaration {
            name: name.clone(),
            fingerprint: declaration_fingerprint(alias, &source, development),
            source,
            development,
        };
        match out.get(&name) {
            None => {
                out.insert(name, declaration);
            }
            Some(existing) if existing.source == declaration.source => {}
            Some(_) => {
                return Err(Box::new(
                    Diagnostic::new(
                        ErrorCode::UserInput,
                        format!("dependency {} has conflicting sources", alias.as_str()),
                    )
                    .with_recovery("use one source per package alias"),
                ));
            }
        }
    }
    Ok(())
}
fn declaration_source(dependency: &Dependency) -> Result<DeclaredSource, Box<Diagnostic>> {
    match dependency {
        Dependency::Path(path) => Ok(DeclaredSource::Local(path.clone())),
        Dependency::Git { url, reference } => Ok(DeclaredSource::Git {
            url: crate::git_source::canonicalize_git_url(url)?
                .as_str()
                .to_owned(),
            reference: reference.clone(),
        }),
        Dependency::Url { url, sha256 } => Ok(DeclaredSource::Http {
            url: canonicalize_archive_url(url)?,
            sha256: sha256.clone(),
        }),
        Dependency::Version(_) => Err(Box::new(
            Diagnostic::new(
                ErrorCode::UserInput,
                "version-only dependencies require a package catalogue",
            )
            .with_recovery("use path, git, or url until version resolution is implemented"),
        )),
    }
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
fn declaration_fingerprint(
    alias: &DependencyAlias,
    source: &DeclaredSource,
    development: bool,
) -> String {
    let mut hasher = Sha256::new();
    update_fingerprint(&mut hasher, alias.as_str());
    match source {
        DeclaredSource::Local(path) => {
            update_fingerprint(&mut hasher, "local");
            update_fingerprint(&mut hasher, &path.to_string_lossy());
        }
        DeclaredSource::Git { url, reference } => {
            update_fingerprint(&mut hasher, "git");
            update_fingerprint(&mut hasher, url);
            match reference {
                None => update_fingerprint(&mut hasher, "head"),
                Some(GitReference::Rev(value)) => {
                    update_fingerprint(&mut hasher, &format!("rev:{value}"));
                }
                Some(GitReference::Tag(value)) => {
                    update_fingerprint(&mut hasher, &format!("tag:{value}"));
                }
                Some(GitReference::Branch(value)) => {
                    update_fingerprint(&mut hasher, &format!("branch:{value}"));
                }
            }
        }
        DeclaredSource::Http { url, sha256 } => {
            update_fingerprint(&mut hasher, "http");
            update_fingerprint(&mut hasher, url);
            update_fingerprint(&mut hasher, sha256);
        }
    }
    hasher.update([u8::from(development)]);
    format!("{:x}", hasher.finalize())
}
fn update_fingerprint(hasher: &mut Sha256, value: &str) {
    hasher.update((value.len() as u64).to_be_bytes());
    hasher.update(value.as_bytes());
}
fn internal(message: &str, error: impl std::fmt::Display) -> Box<Diagnostic> {
    Box::new(
        Diagnostic::new(ErrorCode::InternalFailure, message)
            .with_cause(error)
            .with_recovery("retry and report this as a wukong bug if it persists"),
    )
}
