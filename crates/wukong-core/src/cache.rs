//! Versioned, content-addressed cache layout without publication side effects.

use crate::diagnostic::{Diagnostic, ErrorCode};
use std::{
    env,
    path::{Path, PathBuf},
};

/// Cache schema directory name.
pub const CACHE_SCHEMA: &str = "v1";

/// A cache directory layout rooted at the platform cache location.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CacheLayout {
    root: PathBuf,
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
