//! Direct dependency locking without project materialisation.

#[cfg(feature = "asset-library")]
use crate::asset_library::{AssetId, AssetLibraryClient};
use crate::{
    archive::{ExtractionLimits, extract_zip},
    cache::{CacheLayout, publish_prepared_package},
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
    manifest::{Dependency, DependencyAlias, DependencyLayout, GitReference, Manifest},
    package_metadata::PackageMetadata,
    package_tree::prepare_package_tree,
    source::{CancellationToken, ResolvedSource, SourceAdapter},
};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Path, PathBuf},
    thread,
};
use tempfile::TempDir;

const MAX_PARALLEL_PREPARATIONS: usize = 4;

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
    let cancellation = CancellationToken::new();
    lock_direct_dependencies_with_cancellation(
        manifest_path,
        manifest,
        existing,
        cache,
        offline,
        &cancellation,
    )
}

/// Locks direct dependencies while observing a caller-owned cancellation token.
///
/// # Errors
///
/// Returns a diagnostic for invalid declarations, unavailable sources, failed
/// integrity verification, package preparation errors, or cancellation.
pub fn lock_direct_dependencies_with_cancellation(
    manifest_path: &Path,
    manifest: &Manifest,
    existing: Option<&Lockfile>,
    cache: &CacheLayout,
    offline: bool,
    cancellation: &CancellationToken,
) -> Result<Lockfile, Box<Diagnostic>> {
    cancellation.check()?;
    let declarations = direct_declarations(manifest)?;
    if let Some(lock) = existing.filter(|lock| reusable(lock, &declarations)) {
        return Ok(lock.clone());
    }
    let git = GitFetcher::new(cache.clone());
    let http = HttpArchiveFetcher::new(cache.clone());
    if offline {
        verify_offline_declarations(declarations.values(), &git, &http)?;
    }
    let staging = TempDir::new()
        .map_err(|error| internal("could not create package-lock staging directory", error))?;
    let packages = lock_declarations_parallel(
        manifest_path,
        declarations.values(),
        &git,
        &http,
        cache,
        cancellation,
        staging.path(),
        offline,
    )?;
    Lockfile::new(packages)
}

/// Re-locks all direct dependencies or one selected direct dependency.
///
/// A selected update retains every unrelated package entry only when the
/// existing lockfile still exactly matches its manifest declaration. This
/// prevents an update from silently retaining a stale unrelated entry.
///
/// # Errors
///
/// Returns a diagnostic when the selected dependency is absent, the existing
/// lockfile does not match the manifest, or source preparation fails.
pub fn update_direct_dependencies(
    manifest_path: &Path,
    manifest: &Manifest,
    existing: &Lockfile,
    selected: Option<&PackageName>,
    cache: &CacheLayout,
    offline: bool,
) -> Result<Lockfile, Box<Diagnostic>> {
    let cancellation = CancellationToken::new();
    update_direct_dependencies_with_cancellation(
        manifest_path,
        manifest,
        existing,
        selected,
        cache,
        offline,
        &cancellation,
    )
}

/// Re-locks direct dependencies while observing a caller-owned cancellation token.
///
/// # Errors
///
/// Returns a diagnostic when the selected dependency is absent, the existing
/// lockfile does not match the manifest, source preparation fails, or the
/// operation is cancelled.
pub fn update_direct_dependencies_with_cancellation(
    manifest_path: &Path,
    manifest: &Manifest,
    existing: &Lockfile,
    selected: Option<&PackageName>,
    cache: &CacheLayout,
    offline: bool,
    cancellation: &CancellationToken,
) -> Result<Lockfile, Box<Diagnostic>> {
    cancellation.check()?;
    let declarations = direct_declarations(manifest)?;
    validate_existing_lock(existing, &declarations)?;
    if let Some(selected) = selected {
        if !declarations.contains_key(selected) {
            return Err(Box::new(
                Diagnostic::new(
                    ErrorCode::UserInput,
                    format!("dependency {} is not declared", selected.as_str()),
                )
                .with_recovery("select a dependency from wukong.toml"),
            ));
        }
    }
    let git = GitFetcher::new(cache.clone());
    let http = HttpArchiveFetcher::new(cache.clone());
    if offline {
        verify_offline_declarations(
            declarations
                .iter()
                .filter(|(name, _)| selected.is_none_or(|selected| selected == *name))
                .map(|(_, declaration)| declaration),
            &git,
            &http,
        )?;
    }
    let mut refreshed = BTreeMap::new();
    let selected_declarations = declarations
        .iter()
        .filter(|(name, _)| selected.is_none_or(|selected| selected == *name))
        .map(|(_, declaration)| declaration);
    let staging = TempDir::new()
        .map_err(|error| internal("could not create package-update staging directory", error))?;
    for package in lock_declarations_parallel(
        manifest_path,
        selected_declarations,
        &git,
        &http,
        cache,
        cancellation,
        staging.path(),
        offline,
    )? {
        refreshed.insert(package.name().clone(), package);
    }
    let mut packages = Vec::new();
    for name in declarations.keys() {
        if selected.is_none_or(|selected| selected == name) {
            packages.push(refreshed.remove(name).ok_or_else(|| {
                internal(
                    "selected package disappeared during parallel locking",
                    name.as_str(),
                )
            })?);
        } else {
            let package = existing.packages().get(name).ok_or_else(|| {
                internal(
                    "validated lock entry disappeared during update",
                    name.as_str(),
                )
            })?;
            packages.push(package.clone());
        }
    }
    Lockfile::new(packages)
}

#[allow(clippy::too_many_arguments)] // source adapters remain explicit at the scheduler boundary
fn lock_declarations_parallel<'a>(
    manifest_path: &Path,
    declarations: impl IntoIterator<Item = &'a Declaration>,
    git: &GitFetcher,
    http: &HttpArchiveFetcher,
    cache: &CacheLayout,
    cancellation: &CancellationToken,
    staging: &Path,
    offline: bool,
) -> Result<Vec<LockedPackage>, Box<Diagnostic>> {
    let declarations = declarations.into_iter().cloned().collect::<Vec<_>>();
    if declarations.is_empty() {
        return Ok(Vec::new());
    }
    let groups = preparation_groups(declarations);
    let workers = thread::available_parallelism()
        .map_or(1, std::num::NonZeroUsize::get)
        .min(MAX_PARALLEL_PREPARATIONS)
        .min(groups.len());
    let mut batches = vec![Vec::new(); workers];
    for (index, group) in groups.into_values().enumerate() {
        batches[index % workers].extend(group);
    }
    let manifest_path = manifest_path.to_path_buf();
    let staging = staging.to_path_buf();
    let git = git.clone();
    let http = http.clone();
    let cache = cache.clone();
    let cancellation = cancellation.clone();
    let mut outcomes = BTreeMap::new();
    thread::scope(|scope| {
        let handles = batches
            .into_iter()
            .map(|batch| {
                let manifest_path = manifest_path.clone();
                let staging = staging.clone();
                let git = git.clone();
                let http = http.clone();
                let cache = cache.clone();
                let cancellation = cancellation.clone();
                scope.spawn(move || {
                    batch
                        .into_iter()
                        .map(|declaration| {
                            let name = declaration.name.clone();
                            let result = cancellation.check().and_then(|()| {
                                lock_declaration(
                                    &manifest_path,
                                    &declaration,
                                    LocalPathAdapter,
                                    &git,
                                    &http,
                                    &cache,
                                    &cancellation,
                                    &staging,
                                    offline,
                                )
                            });
                            (name, result)
                        })
                        .collect::<Vec<_>>()
                })
            })
            .collect::<Vec<_>>();
        for handle in handles {
            let entries = handle.join().map_err(|_| {
                internal(
                    "parallel package preparation worker panicked",
                    "report this as a wukong bug",
                )
            })?;
            outcomes.extend(entries);
        }
        Ok::<(), Box<Diagnostic>>(())
    })?;
    outcomes
        .into_values()
        .collect::<Result<Vec<_>, Box<Diagnostic>>>()
}

fn preparation_groups(declarations: Vec<Declaration>) -> BTreeMap<String, Vec<Declaration>> {
    let mut groups = BTreeMap::new();
    for declaration in declarations {
        groups
            .entry(preparation_key(&declaration))
            .or_insert_with(Vec::new)
            .push(declaration);
    }
    groups
}

fn preparation_key(declaration: &Declaration) -> String {
    match &declaration.source {
        DeclaredSource::Local(_) => format!("local:{}", declaration.name.as_str()),
        DeclaredSource::Git { url, .. } => format!("git:{url}"),
        DeclaredSource::Http { sha256, .. } => format!("http:{sha256}"),
        #[cfg(feature = "asset-library")]
        DeclaredSource::Asset(_) => "asset-library".to_owned(),
    }
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
    cache: &CacheLayout,
    staging: &Path,
) -> Result<LockedPackage, Box<Diagnostic>> {
    let source_root = std::fs::canonicalize(source_root)
        .map_err(|error| internal("could not canonicalize source root for locking", error))?;
    let metadata = PackageMetadata::load_optional(&source_root)?;
    let layout =
        detect_package_layout(
            &source_root,
            &LayoutOptions {
                source_subdirectory: declaration.layout.root().map(Path::to_path_buf).or_else(
                    || {
                        metadata
                            .as_ref()
                            .and_then(|metadata| metadata.root())
                            .map(Path::to_path_buf)
                    },
                ),
                target_path: declaration
                    .layout
                    .target()
                    .map(Path::to_path_buf)
                    .or_else(|| {
                        metadata
                            .as_ref()
                            .and_then(|metadata| metadata.target())
                            .map(Path::to_path_buf)
                    }),
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
    let package = LockedPackage::new(
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
    )?;
    if let Err(error) = publish_prepared_package(cache, &prepared) {
        if error.code() != ErrorCode::SourceAccess {
            return Err(error);
        }
    }
    Ok(package)
}

#[allow(clippy::too_many_arguments)] // each source adapter remains explicit
fn lock_declaration(
    manifest_path: &Path,
    declaration: &Declaration,
    local: LocalPathAdapter,
    git: &GitFetcher,
    http: &HttpArchiveFetcher,
    cache: &CacheLayout,
    cancellation: &CancellationToken,
    staging: &Path,
    offline: bool,
) -> Result<LockedPackage, Box<Diagnostic>> {
    let (source_root, source) = match &declaration.source {
        DeclaredSource::Local(path) => {
            let resolution = local.resolve(
                &LocalPathRequest::new(manifest_path.to_path_buf(), path.clone()),
                cancellation,
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
            let extracted = extract_zip(archive.path(), staging, ExtractionLimits::default())?;
            let immutable_id =
                crate::source::ImmutableSourceId::new(format!("sha256:{}", archive.sha256()))
                    .map_err(|error| internal("could not create HTTP immutable identity", error))?;
            let source = LockedHttpSource::new(immutable_id, url, archive.sha256().to_owned())?;
            (extracted.root().to_path_buf(), source.into())
        }
        #[cfg(feature = "asset-library")]
        DeclaredSource::Asset(id) => {
            let resolution = AssetLibraryClient::official().resolve(id, http, offline)?;
            let archive = resolution.archive();
            let extracted = extract_zip(archive.path(), staging, ExtractionLimits::default())?;
            let immutable_id =
                crate::source::ImmutableSourceId::new(format!("sha256:{}", archive.sha256()))
                    .map_err(|error| {
                        internal("could not create AssetLib immutable identity", error)
                    })?;
            let source = LockedHttpSource::new(
                immutable_id,
                resolution.metadata().download_url(),
                archive.sha256().to_owned(),
            )?;
            (extracted.root().to_path_buf(), source.into())
        }
    };
    lock_package(declaration, &source_root, source, cache, staging)
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
    #[cfg(feature = "asset-library")]
    Asset(AssetId),
}
#[derive(Clone)]
struct Declaration {
    name: PackageName,
    source: DeclaredSource,
    layout: DependencyLayout,
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
        let (source, layout) = declaration_source(dependency)?;
        let name = PackageName::parse(alias.as_str()).map_err(|error| {
            Box::new(
                Diagnostic::new(ErrorCode::InternalFailure, "manifest alias was invalid")
                    .with_cause(error),
            )
        })?;
        let declaration = Declaration {
            name: name.clone(),
            fingerprint: declaration_fingerprint(alias, &source, &layout, development),
            source,
            layout,
            development,
        };
        match out.get(&name) {
            None => {
                out.insert(name, declaration);
            }
            Some(existing)
                if existing.source == declaration.source
                    && existing.layout == declaration.layout => {}
            Some(_) => {
                return Err(Box::new(
                    Diagnostic::new(
                        ErrorCode::UserInput,
                        format!(
                            "dependency {} has conflicting sources or layouts",
                            alias.as_str()
                        ),
                    )
                    .with_recovery("use one source and layout per package alias"),
                ));
            }
        }
    }
    Ok(())
}
fn declaration_source(
    dependency: &Dependency,
) -> Result<(DeclaredSource, DependencyLayout), Box<Diagnostic>> {
    match dependency {
        Dependency::Path { path, layout } => {
            Ok((DeclaredSource::Local(path.clone()), layout.clone()))
        }
        Dependency::Git {
            url,
            reference,
            layout,
        } => Ok((
            DeclaredSource::Git {
                url: crate::git_source::canonicalize_git_url(url)?
                    .as_str()
                    .to_owned(),
                reference: reference.clone(),
            },
            layout.clone(),
        )),
        Dependency::Url {
            url,
            sha256,
            layout,
        } => Ok((
            DeclaredSource::Http {
                url: canonicalize_archive_url(url)?,
                sha256: sha256.clone(),
            },
            layout.clone(),
        )),
        #[cfg(feature = "asset-library")]
        Dependency::Asset { id, layout } => Ok((DeclaredSource::Asset(id.clone()), layout.clone())),
        Dependency::Version(_) => Err(Box::new(
            Diagnostic::new(
                ErrorCode::UserInput,
                "version-only dependencies require a package catalogue",
            )
            .with_recovery("use path, git, or url until version resolution is implemented"),
        )),
    }
}

fn verify_offline_declarations<'a>(
    declarations: impl IntoIterator<Item = &'a Declaration>,
    git: &GitFetcher,
    http: &HttpArchiveFetcher,
) -> Result<(), Box<Diagnostic>> {
    let mut unavailable = Vec::new();
    for declaration in declarations {
        match &declaration.source {
            DeclaredSource::Local(_) => {}
            DeclaredSource::Git { url, reference } => {
                let request = GitSourceRequest::new(url.clone(), reference.clone());
                if let Err(error) = git.fetch(&request, true) {
                    if error.code() != ErrorCode::SourceAccess {
                        return Err(error);
                    }
                    unavailable.push(format!(
                        "{} ({})",
                        declaration.name,
                        git_cache_requirement(reference.as_ref())
                    ));
                }
            }
            DeclaredSource::Http { url, sha256 } => {
                if let Err(error) = http.fetch(url, sha256, true) {
                    if error.code() != ErrorCode::SourceAccess {
                        return Err(error);
                    }
                    unavailable.push(format!(
                        "{} (HTTPS archive sha256:{sha256})",
                        declaration.name
                    ));
                }
            }
            #[cfg(feature = "asset-library")]
            DeclaredSource::Asset(id) => unavailable.push(format!(
                "{} (AssetLib metadata for asset {})",
                declaration.name,
                id.as_str()
            )),
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
            .with_recovery("run wukong lock without --offline to fetch the listed artifacts"),
        ))
    }
}

fn git_cache_requirement(reference: Option<&GitReference>) -> String {
    match reference {
        None => "Git selector HEAD".to_owned(),
        Some(GitReference::Rev(commit)) => format!("Git checkout {commit}"),
        Some(GitReference::Tag(tag)) => format!("Git selector tag:{tag}"),
        Some(GitReference::Branch(branch)) => format!("Git selector branch:{branch}"),
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

fn validate_existing_lock(
    lock: &Lockfile,
    declarations: &BTreeMap<PackageName, Declaration>,
) -> Result<(), Box<Diagnostic>> {
    if reusable(lock, declarations) {
        return Ok(());
    }
    Err(Box::new(
        Diagnostic::new(
            ErrorCode::UserInput,
            "manifest and lockfile differ before update",
        )
        .with_recovery("run wukong lock before updating one selected dependency"),
    ))
}
fn declaration_fingerprint(
    alias: &DependencyAlias,
    source: &DeclaredSource,
    layout: &DependencyLayout,
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
        #[cfg(feature = "asset-library")]
        DeclaredSource::Asset(id) => {
            update_fingerprint(&mut hasher, "asset-library");
            update_fingerprint(&mut hasher, id.as_str());
        }
    }
    update_fingerprint(
        &mut hasher,
        &layout
            .root()
            .map_or_else(String::new, |path| path.to_string_lossy().into()),
    );
    update_fingerprint(
        &mut hasher,
        &layout
            .target()
            .map_or_else(String::new, |path| path.to_string_lossy().into()),
    );
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

#[cfg(test)]
mod tests {
    use super::{Declaration, DeclaredSource, preparation_groups};
    use crate::{
        identity::PackageName,
        manifest::{DependencyLayout, GitReference},
    };

    #[test]
    fn invariant_parallel_preparation_serializes_shared_cache_resources() {
        let declarations = vec![
            declaration(
                "alpha",
                DeclaredSource::Git {
                    url: "https://example.test/shared.git".to_owned(),
                    reference: Some(GitReference::Rev("1".repeat(40))),
                },
            ),
            declaration(
                "zebra",
                DeclaredSource::Git {
                    url: "https://example.test/shared.git".to_owned(),
                    reference: Some(GitReference::Rev("2".repeat(40))),
                },
            ),
        ];

        let groups = preparation_groups(declarations);

        assert_eq!(groups.len(), 1);
        assert_eq!(groups.values().next().expect("group should exist").len(), 2);
    }

    fn declaration(name: &str, source: DeclaredSource) -> Declaration {
        Declaration {
            name: PackageName::parse(name).expect("fixture package name should parse"),
            source,
            layout: DependencyLayout::default(),
            development: false,
            fingerprint: String::new(),
        }
    }
}
