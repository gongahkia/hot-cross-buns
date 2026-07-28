//! Versioned, content-addressed cache layout and atomic object publication.

use crate::{
    diagnostic::{Diagnostic, ErrorCode},
    package_tree::{PreparedPackageTree, prepare_package_tree},
};
#[cfg(unix)]
use std::io;
use std::{
    env, fs,
    path::{Path, PathBuf},
};
use tempfile::Builder;

/// Cache schema directory name.
pub const CACHE_SCHEMA: &str = "v1";

/// A cache directory layout rooted at the platform cache location.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CacheLayout {
    root: PathBuf,
}

/// A published immutable package object.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CacheObject {
    path: PathBuf,
    sha256: String,
}
impl CacheObject {
    /// Returns the immutable object directory.
    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }
    /// Returns the verified package-tree checksum.
    #[must_use]
    pub fn sha256(&self) -> &str {
        &self.sha256
    }
}
impl CacheLayout {
    /// Derives the platform-standard cache root or honours `WUKONG_CACHE_DIR`.
    ///
    /// # Errors
    ///
    /// Returns a diagnostic when the platform does not provide a usable home or cache variable.
    pub fn from_environment() -> Result<Self, Box<Diagnostic>> {
        if let Some(root) = env::var_os("WUKONG_CACHE_DIR") {
            return Self::for_root(PathBuf::from(root));
        }
        let root = platform_cache_root().ok_or_else(|| {
            Box::new(
                Diagnostic::new(
                    ErrorCode::InternalFailure,
                    "could not determine a platform cache directory",
                )
                .with_recovery("set WUKONG_CACHE_DIR to an explicit cache directory"),
            )
        })?;
        Self::for_root(root.join("wukong"))
    }
    /// Creates a layout rooted at an explicit cache directory.
    ///
    /// # Errors
    ///
    /// Returns a diagnostic when `root` is empty.
    pub fn for_root(root: PathBuf) -> Result<Self, Box<Diagnostic>> {
        if root.as_os_str().is_empty() {
            Err(Box::new(
                Diagnostic::new(ErrorCode::UserInput, "cache root must not be empty")
                    .with_recovery("provide a non-empty cache directory"),
            ))
        } else {
            Ok(Self { root })
        }
    }
    /// Returns the cache root before schema partitioning.
    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }
    /// Returns the schema-versioned root.
    #[must_use]
    pub fn schema_root(&self) -> PathBuf {
        self.root.join(CACHE_SCHEMA)
    }
    /// Returns the download-object directory.
    #[must_use]
    pub fn downloads(&self) -> PathBuf {
        self.schema_root().join("downloads")
    }
    /// Returns the source-checkout directory.
    #[must_use]
    pub fn checkouts(&self) -> PathBuf {
        self.schema_root().join("checkouts")
    }
    /// Returns the prepared-package directory.
    #[must_use]
    pub fn packages(&self) -> PathBuf {
        self.schema_root().join("packages")
    }
    /// Returns the cache metadata directory.
    #[must_use]
    pub fn metadata(&self) -> PathBuf {
        self.schema_root().join("metadata")
    }
    /// Returns the process-lock directory.
    #[must_use]
    pub fn locks(&self) -> PathBuf {
        self.schema_root().join("locks")
    }
    /// Returns a content-addressed prepared-package object path.
    ///
    /// # Errors
    ///
    /// Returns a diagnostic for an invalid SHA-256 object name.
    pub fn package_object(&self, sha256: &str) -> Result<PathBuf, Box<Diagnostic>> {
        object_path(&self.packages(), sha256, "package checksum")
    }
    /// Returns the lockfile path for one content-addressed object.
    ///
    /// # Errors
    ///
    /// Returns a diagnostic for an invalid SHA-256 object name.
    pub fn object_lock(&self, sha256: &str) -> Result<PathBuf, Box<Diagnostic>> {
        Ok(object_path(&self.locks(), sha256, "object checksum")?.with_extension("lock"))
    }
}

/// Publishes a prepared package tree under its verified content hash.
///
/// # Errors
///
/// Returns a diagnostic when staging, verification, or publication fails.
pub fn publish_prepared_package(
    layout: &CacheLayout,
    prepared: &PreparedPackageTree,
) -> Result<CacheObject, Box<Diagnostic>> {
    let final_path = layout.package_object(prepared.sha256())?;
    let parent = final_path
        .parent()
        .ok_or_else(|| internal("cache object path has no parent", "invalid cache layout"))?;
    fs::create_dir_all(parent)
        .map_err(|error| internal("could not create cache package directory", error))?;
    if final_path.exists() {
        return verify_existing(&final_path, prepared.sha256(), parent);
    }
    let temporary = Builder::new()
        .prefix(".wukong-tmp-")
        .tempdir_in(parent)
        .map_err(|error| internal("could not create unique cache staging directory", error))?;
    let staged_path = temporary.path().join("object");
    let staged = prepare_package_tree(prepared.root(), &staged_path)?;
    if staged.sha256() != prepared.sha256() {
        return Err(integrity(
            "prepared cache staging hash did not match the expected package hash",
        ));
    }
    sync_staged_tree(&staged)?;
    match fs::rename(&staged_path, &final_path) {
        Ok(()) => {
            #[cfg(unix)]
            sync_directory(parent)?;
            verify_existing(&final_path, prepared.sha256(), parent)
        }
        Err(_) if final_path.exists() => verify_existing(&final_path, prepared.sha256(), parent),
        Err(error) => Err(internal("could not atomically publish cache object", error)),
    }
}
fn verify_existing(
    path: &Path,
    expected: &str,
    parent: &Path,
) -> Result<CacheObject, Box<Diagnostic>> {
    let temporary = Builder::new()
        .prefix(".wukong-verify-")
        .tempdir_in(parent)
        .map_err(|error| internal("could not create cache verification directory", error))?;
    let verified = prepare_package_tree(path, &temporary.path().join("object"))?;
    if verified.sha256() == expected {
        Ok(CacheObject {
            path: path.to_path_buf(),
            sha256: expected.to_owned(),
        })
    } else {
        Err(integrity(
            "existing cache object hash did not match its content-addressed name",
        ))
    }
}
fn sync_staged_tree(tree: &PreparedPackageTree) -> Result<(), Box<Diagnostic>> {
    for file in tree.files() {
        fs::File::open(tree.root().join(file.path()))
            .and_then(|file| file.sync_all())
            .map_err(|error| internal("could not flush cache staging file", error))?;
    }
    #[cfg(unix)]
    sync_directory(tree.root())?;
    Ok(())
}
#[cfg(unix)]
fn sync_directory(path: &Path) -> Result<(), Box<Diagnostic>> {
    match fs::File::open(path).and_then(|directory| directory.sync_all()) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::InvalidInput => Ok(()),
        Err(error) => Err(internal("could not flush cache staging directory", error)),
    }
}
fn integrity(message: &str) -> Box<Diagnostic> {
    Box::new(
        Diagnostic::new(ErrorCode::IntegrityFailure, message)
            .with_recovery("remove the cache object and retry"),
    )
}
fn internal(message: &str, error: impl std::fmt::Display) -> Box<Diagnostic> {
    Box::new(
        Diagnostic::new(ErrorCode::InternalFailure, message)
            .with_cause(error)
            .with_recovery("check cache permissions and retry"),
    )
}
fn platform_cache_root() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        env::var_os("HOME")
            .map(PathBuf::from)
            .map(|home| home.join("Library/Caches"))
    }
    #[cfg(target_os = "windows")]
    {
        env::var_os("LOCALAPPDATA")
            .or_else(|| {
                env::var_os("USERPROFILE")
                    .map(|home| PathBuf::from(home).join("AppData/Local").into_os_string())
            })
            .map(PathBuf::from)
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        env::var_os("XDG_CACHE_HOME")
            .map(PathBuf::from)
            .or_else(|| env::var_os("HOME").map(|home| PathBuf::from(home).join(".cache")))
    }
    #[cfg(not(any(unix, target_os = "windows")))]
    {
        None
    }
}
fn object_path(parent: &Path, sha256: &str, field: &str) -> Result<PathBuf, Box<Diagnostic>> {
    if sha256.len() == 64
        && sha256
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
    {
        Ok(parent.join("sha256").join(sha256))
    } else {
        Err(Box::new(
            Diagnostic::new(
                ErrorCode::UserInput,
                format!("{field} must be a lowercase SHA-256 digest"),
            )
            .with_recovery("use a 64-character lowercase hexadecimal digest"),
        ))
    }
}
