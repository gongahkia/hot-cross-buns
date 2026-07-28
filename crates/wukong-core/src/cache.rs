//! Versioned, content-addressed cache layout and atomic object publication.

use crate::{
    diagnostic::{Diagnostic, ErrorCode},
    operation_lock::AdvisoryLock,
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

/// A deterministic summary of prepared-package cache verification.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct CacheVerification {
    verified_packages: usize,
    removed_corrupt_packages: usize,
}

/// A deterministic, read-only summary of the active cache schema root.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct CacheStatus {
    prepared_packages: usize,
    prepared_package_bytes: u64,
    archives: usize,
    archive_bytes: u64,
    total_bytes: u64,
}
impl CacheStatus {
    /// Returns the count of recognized prepared-package objects.
    #[must_use]
    pub const fn prepared_packages(self) -> usize {
        self.prepared_packages
    }

    /// Returns the bytes occupied by recognized prepared-package objects.
    #[must_use]
    pub const fn prepared_package_bytes(self) -> u64 {
        self.prepared_package_bytes
    }

    /// Returns the count of recognized checksum-addressed archive objects.
    #[must_use]
    pub const fn archives(self) -> usize {
        self.archives
    }

    /// Returns the bytes occupied by recognized checksum-addressed archives.
    #[must_use]
    pub const fn archive_bytes(self) -> u64 {
        self.archive_bytes
    }

    /// Returns recursively counted cache bytes without following symlinks.
    #[must_use]
    pub const fn total_bytes(self) -> u64 {
        self.total_bytes
    }
}

/// A deterministic report of cache entries targeted by a maintenance run.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct CacheCleanReport {
    prepared_packages: usize,
    archives: usize,
    reclaimed_bytes: u64,
    dry_run: bool,
}

/// A non-mutating integrity audit of prepared-package cache objects.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct CacheAudit {
    verified_packages: usize,
    corrupt_packages: usize,
    unrecognized_entries: usize,
}
impl CacheAudit {
    /// Returns the number of verified prepared-package objects.
    #[must_use]
    pub const fn verified_packages(self) -> usize {
        self.verified_packages
    }

    /// Returns the number of recognized but invalid package objects.
    #[must_use]
    pub const fn corrupt_packages(self) -> usize {
        self.corrupt_packages
    }

    /// Returns the number of entries not recognized as package objects.
    #[must_use]
    pub const fn unrecognized_entries(self) -> usize {
        self.unrecognized_entries
    }
}
impl CacheCleanReport {
    /// Returns the number of prepared-package objects targeted.
    #[must_use]
    pub const fn prepared_packages(self) -> usize {
        self.prepared_packages
    }

    /// Returns the number of checksum-addressed archives targeted.
    #[must_use]
    pub const fn archives(self) -> usize {
        self.archives
    }

    /// Returns the bytes targeted for reclamation.
    #[must_use]
    pub const fn reclaimed_bytes(self) -> u64 {
        self.reclaimed_bytes
    }

    /// Returns whether the report was calculated without deleting entries.
    #[must_use]
    pub const fn dry_run(self) -> bool {
        self.dry_run
    }
}
impl CacheVerification {
    /// Returns the number of verified prepared-package objects.
    #[must_use]
    pub const fn verified_packages(self) -> usize {
        self.verified_packages
    }

    /// Returns the number of corrupt prepared-package objects removed safely.
    #[must_use]
    pub const fn removed_corrupt_packages(self) -> usize {
        self.removed_corrupt_packages
    }
}

enum ObjectVerification {
    Valid(CacheObject),
    CorruptRemoved,
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
    let _lock = AdvisoryLock::try_acquire(
        &layout.object_lock(prepared.sha256())?,
        &format!("cache object {}", prepared.sha256()),
    )?;
    let parent = final_path
        .parent()
        .ok_or_else(|| internal("cache object path has no parent", "invalid cache layout"))?;
    fs::create_dir_all(parent)
        .map_err(|error| internal("could not create cache package directory", error))?;
    clean_abandoned_package_staging(parent, prepared.sha256())?;
    if final_path.exists() {
        return verify_existing(&final_path, prepared.sha256(), parent);
    }
    let temporary = Builder::new()
        .prefix(&package_staging_prefix(prepared.sha256()))
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

/// Verifies a prepared cache object before it is used.
///
/// A corrupt object is removed from the cache and reported as an integrity
/// failure. A missing object is reported as unavailable without mutation.
///
/// # Errors
///
/// Returns a diagnostic when the object is missing, corrupt, or inaccessible.
pub fn verify_package_object(
    layout: &CacheLayout,
    sha256: &str,
) -> Result<CacheObject, Box<Diagnostic>> {
    let path = layout.package_object(sha256)?;
    let _lock = AdvisoryLock::try_acquire(
        &layout.object_lock(sha256)?,
        &format!("cache object {sha256}"),
    )?;
    let parent = path
        .parent()
        .ok_or_else(|| internal("cache object path has no parent", "invalid cache layout"))?;
    match inspect_package_object(&path, sha256, parent)? {
        ObjectVerification::Valid(object) => Ok(object),
        ObjectVerification::CorruptRemoved => Err(corrupt_removed(sha256)),
    }
}

/// Verifies every prepared cache object currently stored in the cache.
///
/// Entries with names that are not content-addressed SHA-256 values cause an
/// integrity diagnostic and are left unchanged. Corrupt recognized objects are
/// removed and counted in the returned report.
///
/// # Errors
///
/// Returns a diagnostic for unreadable cache directories or unexpected entries.
pub fn verify_cached_packages(layout: &CacheLayout) -> Result<CacheVerification, Box<Diagnostic>> {
    let objects = layout.packages().join("sha256");
    let entries = match fs::read_dir(&objects) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(CacheVerification::default());
        }
        Err(error) => {
            return Err(internal("could not read cache package directory", error));
        }
    };
    let mut entries = entries
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| internal("could not enumerate cache package objects", error))?;
    entries.sort_by_key(fs::DirEntry::file_name);
    let mut report = CacheVerification::default();
    for entry in entries {
        let name = entry.file_name();
        if name.to_string_lossy().starts_with('.') {
            continue;
        }
        let digest = name
            .to_str()
            .filter(|name| is_sha256(name))
            .ok_or_else(|| {
                integrity(format!(
                    "cache package directory contains an unrecognized entry {}",
                    name.to_string_lossy()
                ))
            })?;
        let _lock = AdvisoryLock::try_acquire(
            &layout.object_lock(digest)?,
            &format!("cache object {digest}"),
        )?;
        match inspect_package_object(&entry.path(), digest, &objects)? {
            ObjectVerification::Valid(_) => report.verified_packages += 1,
            ObjectVerification::CorruptRemoved => report.removed_corrupt_packages += 1,
        }
    }
    Ok(report)
}

/// Audits every prepared cache object without deleting corrupt entries.
///
/// # Errors
///
/// Returns a diagnostic when cache entries cannot be inspected or are actively locked.
pub fn audit_cached_packages(layout: &CacheLayout) -> Result<CacheAudit, Box<Diagnostic>> {
    let objects = layout.packages().join("sha256");
    let entries = match fs::read_dir(&objects) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(CacheAudit::default());
        }
        Err(error) => return Err(internal("could not read cache package directory", error)),
    };
    let mut entries = entries
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| internal("could not enumerate cache package objects", error))?;
    entries.sort_by_key(fs::DirEntry::file_name);
    let mut report = CacheAudit::default();
    for entry in entries {
        let name = entry.file_name();
        if name.to_string_lossy().starts_with('.') {
            continue;
        }
        let Some(digest) = name.to_str().filter(|name| is_sha256(name)) else {
            report.unrecognized_entries += 1;
            continue;
        };
        let _lock = AdvisoryLock::try_acquire(
            &layout.object_lock(digest)?,
            &format!("cache object {digest}"),
        )?;
        if package_object_matches(&entry.path(), digest, &objects)? {
            report.verified_packages += 1;
        } else {
            report.corrupt_packages += 1;
        }
    }
    Ok(report)
}

/// Checks that the managed cache root permits temporary file creation.
///
/// # Errors
///
/// Returns a diagnostic when the cache root cannot be created or written.
pub fn check_cache_permissions(layout: &CacheLayout) -> Result<(), Box<Diagnostic>> {
    let root = layout.schema_root();
    fs::create_dir_all(&root).map_err(|error| {
        internal(
            "could not create cache directory for permission check",
            error,
        )
    })?;
    let probe = Builder::new()
        .prefix(".wukong-doctor-")
        .tempdir_in(&root)
        .map_err(|error| internal("could not create cache permission probe", error))?;
    fs::File::create(probe.path().join("write-probe"))
        .map_err(|error| internal("could not write cache permission probe", error))?;
    Ok(())
}

/// Inspects recognized cache objects and recursively calculates active-cache size.
///
/// Symlinks are not followed. Missing cache directories report zero usage.
///
/// # Errors
///
/// Returns a diagnostic when cache content cannot be inspected.
pub fn inspect_cache(layout: &CacheLayout) -> Result<CacheStatus, Box<Diagnostic>> {
    let packages = collect_package_candidates(layout)?;
    let archives = collect_archive_candidates(layout)?;
    Ok(CacheStatus {
        prepared_packages: packages.len(),
        prepared_package_bytes: sum_bytes(&packages)?,
        archives: archives.len(),
        archive_bytes: sum_bytes(&archives)?,
        total_bytes: path_size(&layout.schema_root())?,
    })
}

/// Removes recognized cache-owned packages and archives, unless `dry_run` is set.
///
/// Git checkouts, metadata, lock files, and unrecognized cache entries are
/// retained because this operation cannot prove their matching lock identity.
///
/// # Errors
///
/// Returns a diagnostic before deletion when any targeted object is actively locked.
pub fn clean_cache(
    layout: &CacheLayout,
    dry_run: bool,
) -> Result<CacheCleanReport, Box<Diagnostic>> {
    let mut candidates = collect_package_candidates(layout)?;
    candidates.extend(collect_archive_candidates(layout)?);
    let report = CacheCleanReport {
        prepared_packages: candidates
            .iter()
            .filter(|candidate| candidate.kind == CacheCandidateKind::Package)
            .count(),
        archives: candidates
            .iter()
            .filter(|candidate| candidate.kind == CacheCandidateKind::Archive)
            .count(),
        reclaimed_bytes: sum_bytes(&candidates)?,
        dry_run,
    };
    if dry_run {
        return Ok(report);
    }
    let _locks = candidates
        .iter()
        .map(|candidate| AdvisoryLock::try_acquire(&candidate.lock, &candidate.resource()))
        .collect::<Result<Vec<_>, _>>()?;
    for candidate in candidates {
        remove_candidate(&candidate)?;
    }
    Ok(report)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum CacheCandidateKind {
    Package,
    Archive,
}

struct CacheCandidate {
    path: PathBuf,
    lock: PathBuf,
    bytes: u64,
    kind: CacheCandidateKind,
}
impl CacheCandidate {
    fn resource(&self) -> String {
        let identity = self
            .path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("unknown");
        let kind = match self.kind {
            CacheCandidateKind::Package => "cache object",
            CacheCandidateKind::Archive => "HTTPS archive cache entry",
        };
        format!("{kind} {identity}")
    }
}

fn collect_package_candidates(
    layout: &CacheLayout,
) -> Result<Vec<CacheCandidate>, Box<Diagnostic>> {
    let parent = layout.packages().join("sha256");
    collect_candidates(&parent, CacheCandidateKind::Package, |digest| {
        layout.object_lock(digest)
    })
}

fn collect_archive_candidates(
    layout: &CacheLayout,
) -> Result<Vec<CacheCandidate>, Box<Diagnostic>> {
    let parent = layout.downloads().join("sha256");
    collect_candidates(&parent, CacheCandidateKind::Archive, |digest| {
        Ok(layout.locks().join("http").join(format!("{digest}.lock")))
    })
}

fn collect_candidates(
    parent: &Path,
    kind: CacheCandidateKind,
    lock_path: impl Fn(&str) -> Result<PathBuf, Box<Diagnostic>>,
) -> Result<Vec<CacheCandidate>, Box<Diagnostic>> {
    let entries = match fs::read_dir(parent) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => {
            return Err(internal(
                "could not inspect cache maintenance candidates",
                error,
            ));
        }
    };
    let mut entries = entries
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| internal("could not enumerate cache maintenance candidates", error))?;
    entries.sort_by_key(fs::DirEntry::file_name);
    let mut candidates = Vec::new();
    for entry in entries {
        let name = entry.file_name();
        let Some(digest) = name.to_str().filter(|name| is_sha256(name)) else {
            continue;
        };
        let file_type = entry
            .file_type()
            .map_err(|error| internal("could not inspect cache maintenance candidate", error))?;
        let expected = match kind {
            CacheCandidateKind::Package => file_type.is_dir(),
            CacheCandidateKind::Archive => file_type.is_file(),
        };
        if !expected {
            continue;
        }
        let path = entry.path();
        candidates.push(CacheCandidate {
            lock: lock_path(digest)?,
            bytes: path_size(&path)?,
            path,
            kind,
        });
    }
    Ok(candidates)
}

fn sum_bytes(candidates: &[CacheCandidate]) -> Result<u64, Box<Diagnostic>> {
    candidates.iter().try_fold(0_u64, |total, candidate| {
        total.checked_add(candidate.bytes).ok_or_else(|| {
            internal(
                "cache size exceeds supported range",
                "byte count overflowed u64",
            )
        })
    })
}

fn path_size(path: &Path) -> Result<u64, Box<Diagnostic>> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(error) => return Err(internal("could not inspect cache size", error)),
    };
    if metadata.file_type().is_symlink() {
        return Ok(0);
    }
    if metadata.file_type().is_file() {
        return Ok(metadata.len());
    }
    if !metadata.file_type().is_dir() {
        return Ok(0);
    }
    let mut entries = fs::read_dir(path)
        .map_err(|error| internal("could not inspect cache directory size", error))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| internal("could not enumerate cache directory size", error))?;
    entries.sort_by_key(fs::DirEntry::file_name);
    entries.into_iter().try_fold(0_u64, |total, entry| {
        total.checked_add(path_size(&entry.path())?).ok_or_else(|| {
            internal(
                "cache size exceeds supported range",
                "byte count overflowed u64",
            )
        })
    })
}

fn remove_candidate(candidate: &CacheCandidate) -> Result<(), Box<Diagnostic>> {
    let metadata = fs::symlink_metadata(&candidate.path)
        .map_err(|error| internal("could not recheck cache clean candidate", error))?;
    let expected = match candidate.kind {
        CacheCandidateKind::Package => metadata.file_type().is_dir(),
        CacheCandidateKind::Archive => metadata.file_type().is_file(),
    };
    if !expected {
        return Err(integrity(format!(
            "cache clean candidate changed unexpectedly: {}",
            candidate.path.display()
        )));
    }
    let removal = match candidate.kind {
        CacheCandidateKind::Package => fs::remove_dir_all(&candidate.path),
        CacheCandidateKind::Archive => fs::remove_file(&candidate.path),
    };
    removal.map_err(|error| internal("could not remove cache clean candidate", error))
}

fn package_staging_prefix(sha256: &str) -> String {
    format!(".wukong-package-{sha256}-")
}

fn clean_abandoned_package_staging(parent: &Path, sha256: &str) -> Result<(), Box<Diagnostic>> {
    let prefix = package_staging_prefix(sha256);
    let entries = fs::read_dir(parent)
        .map_err(|error| internal("could not inspect cache package staging", error))?;
    for entry in entries {
        let entry = entry
            .map_err(|error| internal("could not inspect cache package staging entry", error))?;
        if !entry.file_name().to_string_lossy().starts_with(&prefix) {
            continue;
        }
        if entry
            .file_type()
            .map_err(|error| internal("could not inspect cache package staging entry", error))?
            .is_dir()
        {
            fs::remove_dir_all(entry.path()).map_err(|error| {
                internal("could not remove abandoned cache package staging", error)
            })?;
        }
    }
    Ok(())
}

fn verify_existing(
    path: &Path,
    expected: &str,
    parent: &Path,
) -> Result<CacheObject, Box<Diagnostic>> {
    match inspect_package_object(path, expected, parent)? {
        ObjectVerification::Valid(object) => Ok(object),
        ObjectVerification::CorruptRemoved => Err(corrupt_removed(expected)),
    }
}

fn package_object_matches(
    path: &Path,
    expected: &str,
    parent: &Path,
) -> Result<bool, Box<Diagnostic>> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(internal("could not inspect cache object", error)),
    };
    if !metadata.file_type().is_dir() {
        return Ok(false);
    }
    let temporary = Builder::new()
        .prefix(".wukong-audit-")
        .tempdir_in(parent)
        .map_err(|error| internal("could not create cache audit directory", error))?;
    Ok(prepare_package_tree(path, &temporary.path().join("object"))
        .is_ok_and(|prepared| prepared.sha256() == expected))
}

fn inspect_package_object(
    path: &Path,
    expected: &str,
    parent: &Path,
) -> Result<ObjectVerification, Box<Diagnostic>> {
    let metadata = fs::symlink_metadata(path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            Box::new(
                Diagnostic::new(
                    ErrorCode::SourceAccess,
                    format!("cache object {expected} is not available"),
                )
                .with_recovery("run wukong lock or sync without --offline to restore it"),
            )
        } else {
            internal("could not inspect cache object", error)
        }
    })?;
    if !metadata.file_type().is_dir() {
        remove_corrupt_object(path, expected, &metadata)?;
        return Ok(ObjectVerification::CorruptRemoved);
    }
    let temporary = Builder::new()
        .prefix(".wukong-verify-")
        .tempdir_in(parent)
        .map_err(|error| internal("could not create cache verification directory", error))?;
    let verified = prepare_package_tree(path, &temporary.path().join("object"));
    if verified
        .as_ref()
        .is_ok_and(|verified| verified.sha256() == expected)
    {
        Ok(ObjectVerification::Valid(CacheObject {
            path: path.to_path_buf(),
            sha256: expected.to_owned(),
        }))
    } else {
        remove_corrupt_object(path, expected, &metadata)?;
        Ok(ObjectVerification::CorruptRemoved)
    }
}

fn remove_corrupt_object(
    path: &Path,
    expected: &str,
    metadata: &fs::Metadata,
) -> Result<(), Box<Diagnostic>> {
    let removal = if metadata.file_type().is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    };
    removal.map_err(|error| {
        Box::new(
            Diagnostic::new(
                ErrorCode::IntegrityFailure,
                format!("cache object {expected} is corrupt but could not be removed"),
            )
            .with_cause(error)
            .with_recovery("remove the cache object manually and check cache permissions"),
        )
    })
}

fn corrupt_removed(expected: &str) -> Box<Diagnostic> {
    integrity(format!(
        "cache object {expected} failed verification and was removed"
    ))
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
fn integrity(message: impl AsRef<str>) -> Box<Diagnostic> {
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
    if is_sha256(sha256) {
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

fn is_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
}
