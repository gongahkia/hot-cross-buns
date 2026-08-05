//! Local-path source adapter and deterministic content snapshots.

use crate::{
    diagnostic::{Diagnostic, ErrorCode},
    identity::{LocalSourceIdentity, SourceIdentity},
    source::{
        CancellationToken, ImmutableSourceId, OfflineAvailability, ResolvedSource, SourceAdapter,
        SourceResult, VersionAvailability,
    },
};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
    ffi::OsString,
    fs,
    io::{ErrorKind, Read},
    path::{Component, Path, PathBuf},
};

/// A declared local path and its manifest-relative resolution context.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LocalPathRequest {
    manifest_path: PathBuf,
    declared_path: PathBuf,
    ignored_names: BTreeSet<OsString>,
}

impl LocalPathRequest {
    /// Creates a request that resolves `declared_path` relative to `manifest_path`.
    #[must_use]
    pub fn new(manifest_path: PathBuf, declared_path: PathBuf) -> Self {
        Self {
            manifest_path,
            declared_path,
            ignored_names: BTreeSet::from([OsString::from(".git")]),
        }
    }

    /// Adds names ignored at every depth during content hashing.
    #[must_use]
    pub fn with_ignored_names(mut self, names: impl IntoIterator<Item = OsString>) -> Self {
        self.ignored_names.extend(names);
        self
    }
}

/// A deterministic SHA-256 snapshot of a local source tree.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LocalContentSnapshot {
    sha256: String,
}

impl LocalContentSnapshot {
    /// Returns the lowercase hexadecimal SHA-256 content digest.
    #[must_use]
    pub fn sha256(&self) -> &str {
        &self.sha256
    }
}

/// A resolved local source and its immutable content snapshot.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LocalPathResolution {
    root: LocalSourceIdentity,
    snapshot: LocalContentSnapshot,
    immutable_id: ImmutableSourceId,
}

impl LocalPathResolution {
    /// Returns the canonical source root.
    #[must_use]
    pub fn root(&self) -> &LocalSourceIdentity {
        &self.root
    }

    /// Returns the resolved content snapshot.
    #[must_use]
    pub fn snapshot(&self) -> &LocalContentSnapshot {
        &self.snapshot
    }
}

impl ResolvedSource for LocalPathResolution {
    fn immutable_id(&self) -> &ImmutableSourceId {
        &self.immutable_id
    }
}

/// A fetched local source, represented by its canonical directory and snapshot.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LocalPathFetched {
    root: LocalSourceIdentity,
    snapshot: LocalContentSnapshot,
}

/// Integrity metadata for a local source fetch.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LocalIntegrityMetadata {
    /// SHA-256 of the deterministic local content snapshot.
    pub content_snapshot: LocalContentSnapshot,
}

/// Layout metadata supplied without selecting a package layout.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LocalLayoutMetadata {
    /// Canonical source directory to be analysed by later layout logic.
    pub source_root: PathBuf,
}

/// The local-path implementation of the source-adapter contract.
#[derive(Clone, Copy, Debug, Default)]
pub struct LocalPathAdapter;

impl SourceAdapter for LocalPathAdapter {
    type Request = LocalPathRequest;
    type Resolution = LocalPathResolution;
    type Fetched = LocalPathFetched;
    type IntegrityMetadata = LocalIntegrityMetadata;
    type LayoutMetadata = LocalLayoutMetadata;

    fn canonical_identity(&self, request: &Self::Request) -> SourceResult<SourceIdentity> {
        Ok(SourceIdentity::Local(resolve_root(request)?))
    }

    fn available_versions(&self, _request: &Self::Request) -> SourceResult<VersionAvailability> {
        Ok(VersionAvailability::Unsupported)
    }

    fn resolve(
        &self,
        request: &Self::Request,
        cancellation: &CancellationToken,
    ) -> SourceResult<Self::Resolution> {
        cancellation.check()?;
        let root = resolve_root(request)?;
        let snapshot = snapshot(root.path(), &request.ignored_names, cancellation)?;
        let immutable_id = ImmutableSourceId::new(format!("sha256:{}", snapshot.sha256()))
            .map_err(|error| {
                boxed(
                    Diagnostic::new(
                        ErrorCode::InternalFailure,
                        "could not create local immutable identity",
                    )
                    .with_cause(error)
                    .with_recovery("report this as a wukong bug"),
                )
            })?;
        Ok(LocalPathResolution {
            root,
            snapshot,
            immutable_id,
        })
    }

    fn fetch(
        &self,
        resolved: &Self::Resolution,
        cancellation: &CancellationToken,
    ) -> SourceResult<Self::Fetched> {
        cancellation.check()?;
        Ok(LocalPathFetched {
            root: resolved.root.clone(),
            snapshot: resolved.snapshot.clone(),
        })
    }

    fn integrity_metadata(&self, fetched: &Self::Fetched) -> SourceResult<Self::IntegrityMetadata> {
        Ok(LocalIntegrityMetadata {
            content_snapshot: fetched.snapshot.clone(),
        })
    }

    fn layout_metadata(&self, fetched: &Self::Fetched) -> SourceResult<Self::LayoutMetadata> {
        Ok(LocalLayoutMetadata {
            source_root: fetched.root.path().to_path_buf(),
        })
    }

    fn offline_availability(
        &self,
        _resolved: &Self::Resolution,
    ) -> SourceResult<OfflineAvailability> {
        Ok(OfflineAvailability::Available)
    }
}

fn resolve_root(request: &LocalPathRequest) -> SourceResult<LocalSourceIdentity> {
    let manifest_directory = request.manifest_path.parent().ok_or_else(|| {
        boxed(
            Diagnostic::new(
                ErrorCode::UserInput,
                "manifest path has no parent directory",
            )
            .with_recovery("provide a wukong.toml path and retry"),
        )
    })?;
    let resolved = if request.declared_path.is_absolute() {
        normalize_path(&request.declared_path)
    } else {
        normalize_path(&manifest_directory.join(&request.declared_path))
    };
    let canonical =
        fs::canonicalize(&resolved).map_err(|error| source_path_error(&resolved, error))?;
    let metadata =
        fs::metadata(&canonical).map_err(|error| source_path_error(&canonical, error))?;
    if !metadata.is_dir() {
        return Err(boxed(
            Diagnostic::new(
                ErrorCode::SourceAccess,
                format!(
                    "local dependency {} is not a directory",
                    canonical.display()
                ),
            )
            .with_recovery("set path to an existing addon or repository directory"),
        ));
    }
    LocalSourceIdentity::from_canonical_path(canonical).map_err(|error| {
        boxed(
            Diagnostic::new(
                ErrorCode::InternalFailure,
                "canonical local path was invalid",
            )
            .with_cause(error)
            .with_recovery("report this as a wukong bug"),
        )
    })
}

fn snapshot(
    root: &Path,
    ignored_names: &BTreeSet<OsString>,
    cancellation: &CancellationToken,
) -> SourceResult<LocalContentSnapshot> {
    let mut hasher = Sha256::new();
    hash_directory(root, root, ignored_names, &mut hasher, cancellation)?;
    Ok(LocalContentSnapshot {
        sha256: format!("{:x}", hasher.finalize()),
    })
}

fn hash_directory(
    root: &Path,
    directory: &Path,
    ignored_names: &BTreeSet<OsString>,
    hasher: &mut Sha256,
    cancellation: &CancellationToken,
) -> SourceResult<()> {
    cancellation.check()?;
    let mut entries = fs::read_dir(directory)
        .map_err(|error| source_path_error(directory, error))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| source_path_error(directory, error))?;
    entries.sort_by_key(fs::DirEntry::file_name);
    for entry in entries {
        cancellation.check()?;
        if ignored_names.contains(&entry.file_name()) {
            continue;
        }
        let path = entry.path();
        let metadata =
            fs::symlink_metadata(&path).map_err(|error| source_path_error(&path, error))?;
        let relative = normalised_relative_path(root, &path)?;
        let file_type = metadata.file_type();
        if file_type.is_dir() {
            hash_record(hasher, b'd', &relative, None);
            hash_directory(root, &path, ignored_names, hasher, cancellation)?;
        } else if file_type.is_file() {
            hash_file(hasher, &relative, &path, cancellation)?;
        } else if file_type.is_symlink() {
            let target = fs::read_link(&path).map_err(|error| source_path_error(&path, error))?;
            let target = target.to_str().ok_or_else(|| invalid_path_error(&path))?;
            hash_record(hasher, b'l', &relative, Some(target.as_bytes()));
        } else {
            return Err(boxed(
                Diagnostic::new(
                    ErrorCode::SourceAccess,
                    format!(
                        "local dependency contains unsupported entry {}",
                        path.display()
                    ),
                )
                .with_recovery("remove special filesystem entries from the dependency"),
            ));
        }
    }
    Ok(())
}

fn hash_file(
    hasher: &mut Sha256,
    relative: &str,
    path: &Path,
    cancellation: &CancellationToken,
) -> SourceResult<()> {
    cancellation.check()?;
    let mut file = fs::File::open(path).map_err(|error| source_path_error(path, error))?;
    let length = file
        .metadata()
        .map_err(|error| source_path_error(path, error))?
        .len();
    hasher.update(b"f");
    update_length_prefixed(hasher, relative.as_bytes());
    hasher.update(length.to_be_bytes());
    let mut buffer = [0_u8; 8192];
    let mut total = 0_u64;
    loop {
        cancellation.check()?;
        let read = file
            .read(&mut buffer)
            .map_err(|error| source_path_error(path, error))?;
        if read == 0 {
            break;
        }
        total = total.checked_add(read as u64).ok_or_else(|| {
            boxed(
                Diagnostic::new(
                    ErrorCode::SourceAccess,
                    format!(
                        "local dependency file changed while snapshotting {}",
                        path.display()
                    ),
                )
                .with_recovery("retry after the local dependency stops changing"),
            )
        })?;
        hasher.update(&buffer[..read]);
    }
    if total != length {
        return Err(boxed(
            Diagnostic::new(
                ErrorCode::SourceAccess,
                format!(
                    "local dependency file changed while snapshotting {}",
                    path.display()
                ),
            )
            .with_recovery("retry after the local dependency stops changing"),
        ));
    }
    Ok(())
}

fn hash_record(hasher: &mut Sha256, kind: u8, relative: &str, payload: Option<&[u8]>) {
    hasher.update([kind]);
    update_length_prefixed(hasher, relative.as_bytes());
    update_length_prefixed(hasher, payload.unwrap_or_default());
}

fn update_length_prefixed(hasher: &mut Sha256, bytes: &[u8]) {
    hasher.update((bytes.len() as u64).to_be_bytes());
    hasher.update(bytes);
}

fn normalised_relative_path(root: &Path, path: &Path) -> SourceResult<String> {
    let relative = path.strip_prefix(root).map_err(|error| {
        boxed(
            Diagnostic::new(
                ErrorCode::InternalFailure,
                "local path escaped its snapshot root",
            )
            .with_cause(error)
            .with_recovery("report this as a wukong bug"),
        )
    })?;
    let mut components = Vec::new();
    for component in relative.components() {
        match component {
            Component::Normal(value) => {
                components.push(value.to_str().ok_or_else(|| invalid_path_error(path))?);
            }
            Component::CurDir => {}
            _ => return Err(invalid_path_error(path)),
        }
    }
    Ok(components.join("/"))
}

fn normalize_path(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            Component::RootDir => normalized.push(component.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => {
                if !normalized.pop() && !normalized.has_root() {
                    normalized.push(component.as_os_str());
                }
            }
            Component::Normal(value) => normalized.push(value),
        }
    }
    normalized
}

fn source_path_error(path: &Path, error: std::io::Error) -> Box<Diagnostic> {
    let message = if error.kind() == ErrorKind::NotFound {
        format!("local dependency {} does not exist", path.display())
    } else {
        format!("could not read local dependency {}", path.display())
    };
    boxed(
        Diagnostic::new(ErrorCode::SourceAccess, message)
            .with_cause(error)
            .with_recovery("check the local dependency path and retry"),
    )
}

fn invalid_path_error(path: &Path) -> Box<Diagnostic> {
    boxed(
        Diagnostic::new(
            ErrorCode::SourceAccess,
            format!(
                "local dependency path {} is not valid UTF-8",
                path.display()
            ),
        )
        .with_recovery("use UTF-8 file names in local dependencies"),
    )
}

fn boxed(diagnostic: Diagnostic) -> Box<Diagnostic> {
    Box::new(diagnostic)
}
