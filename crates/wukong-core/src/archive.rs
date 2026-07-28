//! Transactional extraction of validated ZIP archives into staging directories.

use crate::diagnostic::{Diagnostic, ErrorCode};
use std::{
    collections::BTreeSet,
    fs::{self, File, OpenOptions},
    io::ErrorKind,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};
use zip::ZipArchive;

static STAGING_SEQUENCE: AtomicU64 = AtomicU64::new(0);

/// Non-bypassable ZIP extraction limits.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ExtractionLimits {
    max_files: u64,
    max_expanded_bytes: u64,
    max_expansion_ratio: u64,
}

impl Default for ExtractionLimits {
    fn default() -> Self {
        Self {
            max_files: 10_000,
            max_expanded_bytes: 512 * 1024 * 1024,
            max_expansion_ratio: 100,
        }
    }
}

impl ExtractionLimits {
    /// Returns caller-requested limits clamped to the secure defaults.
    #[must_use]
    pub fn tightened(max_files: u64, max_expanded_bytes: u64, max_expansion_ratio: u64) -> Self {
        Self::default().tighten(Self {
            max_files,
            max_expanded_bytes,
            max_expansion_ratio,
        })
    }

    /// Returns a limit set no weaker than the secure defaults.
    #[must_use]
    pub fn tighten(self, requested: Self) -> Self {
        Self {
            max_files: self.max_files.min(requested.max_files),
            max_expanded_bytes: self.max_expanded_bytes.min(requested.max_expanded_bytes),
            max_expansion_ratio: self.max_expansion_ratio.min(requested.max_expansion_ratio),
        }
    }
}

/// A successfully extracted ZIP staging tree.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExtractedArchive {
    root: PathBuf,
}

impl ExtractedArchive {
    /// Returns the owned staging root containing validated ZIP content.
    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }
}

/// Extracts a ZIP archive into a new staging directory under `staging_parent`.
///
/// # Errors
///
/// Returns a structured diagnostic and removes the created staging directory
/// when validation or extraction fails.
pub fn extract_zip(
    archive_path: &Path,
    staging_parent: &Path,
    limits: ExtractionLimits,
) -> Result<ExtractedArchive, Box<Diagnostic>> {
    let archive_file =
        File::open(archive_path).map_err(|error| archive_error(archive_path, error))?;
    let mut archive = ZipArchive::new(archive_file).map_err(|error| {
        boxed(
            Diagnostic::new(ErrorCode::SourceAccess, "invalid ZIP archive")
                .with_cause(error)
                .with_source(archive_path.display().to_string())
                .with_recovery("provide a valid ZIP archive and retry"),
        )
    })?;
    let entries = preflight(&mut archive, archive_path, limits)?;
    let staging_root = create_staging_root(staging_parent)?;
    if let Err(error) = extract_entries(&mut archive, &entries, &staging_root, archive_path) {
        let _ = fs::remove_dir_all(&staging_root);
        return Err(error);
    }
    Ok(ExtractedArchive { root: staging_root })
}

#[derive(Clone, Debug)]
struct Entry {
    index: usize,
    path: PathBuf,
    directory: bool,
    size: u64,
}

fn preflight(
    archive: &mut ZipArchive<File>,
    archive_path: &Path,
    limits: ExtractionLimits,
) -> Result<Vec<Entry>, Box<Diagnostic>> {
    let mut entries = Vec::new();
    let mut paths = BTreeSet::new();
    let mut total_expanded = 0_u64;
    let mut file_count = 0_u64;
    for index in 0..archive.len() {
        let file = archive
            .by_index(index)
            .map_err(|error| zip_error(archive_path, error))?;
        let name = file.name();
        let path = validated_entry_path(name, file.enclosed_name(), archive_path)?;
        if file.is_symlink() || (!file.is_dir() && !file.is_file()) {
            return Err(boxed(
                Diagnostic::new(
                    ErrorCode::SourceAccess,
                    format!("ZIP entry {name} has an unsupported link or file type"),
                )
                .with_source(archive_path.display().to_string())
                .with_recovery("remove symbolic links and special files from the archive"),
            ));
        }
        if !paths.insert(path.clone()) {
            return Err(boxed(
                Diagnostic::new(
                    ErrorCode::SourceAccess,
                    format!("ZIP archive contains duplicate entry {name}"),
                )
                .with_source(archive_path.display().to_string())
                .with_recovery("remove duplicate archive paths and retry"),
            ));
        }
        if !file.is_dir() {
            file_count = file_count
                .checked_add(1)
                .ok_or_else(|| limit_error(archive_path, "file-count limit"))?;
            if file_count > limits.max_files {
                return Err(limit_error(archive_path, "file-count limit"));
            }
            total_expanded = total_expanded
                .checked_add(file.size())
                .ok_or_else(|| limit_error(archive_path, "expanded-size limit"))?;
            if total_expanded > limits.max_expanded_bytes {
                return Err(limit_error(archive_path, "expanded-size limit"));
            }
            if file.size() > 0
                && (file.compressed_size() == 0
                    || file.size()
                        > file
                            .compressed_size()
                            .saturating_mul(limits.max_expansion_ratio))
            {
                return Err(limit_error(archive_path, "expansion-ratio limit"));
            }
        }
        entries.push(Entry {
            index,
            path,
            directory: file.is_dir(),
            size: file.size(),
        });
    }
    Ok(entries)
}

fn extract_entries(
    archive: &mut ZipArchive<File>,
    entries: &[Entry],
    root: &Path,
    archive_path: &Path,
) -> Result<(), Box<Diagnostic>> {
    for entry in entries {
        let output = root.join(&entry.path);
        if !output.starts_with(root) {
            return Err(boxed(Diagnostic::new(
                ErrorCode::InternalFailure,
                "validated ZIP path escaped staging root",
            )));
        }
        if entry.directory {
            fs::create_dir_all(&output)
                .map_err(|error| extract_error(archive_path, &output, error))?;
            continue;
        }
        let parent = output.parent().ok_or_else(|| {
            boxed(Diagnostic::new(
                ErrorCode::InternalFailure,
                "ZIP output path has no parent",
            ))
        })?;
        fs::create_dir_all(parent).map_err(|error| extract_error(archive_path, parent, error))?;
        let mut input = archive
            .by_index(entry.index)
            .map_err(|error| zip_error(archive_path, error))?;
        let mut output_file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&output)
            .map_err(|error| extract_error(archive_path, &output, error))?;
        let copied = std::io::copy(&mut input, &mut output_file)
            .map_err(|error| extract_error(archive_path, &output, error))?;
        if copied != entry.size {
            return Err(boxed(
                Diagnostic::new(
                    ErrorCode::SourceAccess,
                    "ZIP entry size changed during extraction",
                )
                .with_source(archive_path.display().to_string()),
            ));
        }
    }
    Ok(())
}

fn validated_entry_path(
    name: &str,
    enclosed_name: Option<PathBuf>,
    archive_path: &Path,
) -> Result<PathBuf, Box<Diagnostic>> {
    let invalid = name.contains('\0')
        || name.starts_with(['/', '\\'])
        || name.starts_with("\\\\")
        || name
            .split(['/', '\\'])
            .any(|part| part == ".." || is_windows_prefix(part));
    if invalid {
        return Err(archive_name_error(archive_path, name));
    }
    enclosed_name.ok_or_else(|| archive_name_error(archive_path, name))
}

fn is_windows_prefix(component: &str) -> bool {
    component.len() >= 2
        && component.as_bytes()[0].is_ascii_alphabetic()
        && component.as_bytes()[1] == b':'
}

fn create_staging_root(parent: &Path) -> Result<PathBuf, Box<Diagnostic>> {
    for _ in 0..16 {
        let path = parent.join(format!(
            ".wukong-extract.{}.{}",
            std::process::id(),
            STAGING_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        match fs::create_dir(&path) {
            Ok(()) => return Ok(path),
            Err(error) if error.kind() == ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(extract_error(parent, &path, error)),
        }
    }
    Err(boxed(Diagnostic::new(
        ErrorCode::InternalFailure,
        "could not create ZIP staging directory",
    )))
}

fn archive_name_error(path: &Path, name: &str) -> Box<Diagnostic> {
    boxed(
        Diagnostic::new(
            ErrorCode::SourceAccess,
            format!("ZIP entry {name:?} has an unsafe path"),
        )
        .with_source(path.display().to_string())
        .with_recovery("remove absolute, traversal, and Windows-prefixed archive paths"),
    )
}
fn limit_error(path: &Path, limit: &str) -> Box<Diagnostic> {
    boxed(
        Diagnostic::new(
            ErrorCode::SourceAccess,
            format!("ZIP archive exceeds the {limit}"),
        )
        .with_source(path.display().to_string())
        .with_recovery("use a smaller archive or tighter package contents"),
    )
}
fn archive_error(path: &Path, error: std::io::Error) -> Box<Diagnostic> {
    boxed(
        Diagnostic::new(
            ErrorCode::SourceAccess,
            format!("could not open ZIP archive {}", path.display()),
        )
        .with_cause(error)
        .with_recovery("check the archive path and retry"),
    )
}
fn zip_error(path: &Path, error: zip::result::ZipError) -> Box<Diagnostic> {
    boxed(
        Diagnostic::new(ErrorCode::SourceAccess, "could not read ZIP archive")
            .with_cause(error)
            .with_source(path.display().to_string())
            .with_recovery("provide a valid ZIP archive and retry"),
    )
}
fn extract_error(archive: &Path, output: &Path, error: std::io::Error) -> Box<Diagnostic> {
    boxed(
        Diagnostic::new(
            ErrorCode::SourceAccess,
            format!("could not extract ZIP archive to {}", output.display()),
        )
        .with_cause(error)
        .with_source(archive.display().to_string())
        .with_recovery("check staging-directory permissions and retry"),
    )
}
fn boxed(diagnostic: Diagnostic) -> Box<Diagnostic> {
    Box::new(diagnostic)
}
