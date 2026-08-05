//! Atomic sibling-file replacement and verified restoration for mutations.

use crate::diagnostic::{Diagnostic, ErrorCode};
use std::{
    fs::{self, OpenOptions},
    io::{ErrorKind, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);
const TEMP_ATTEMPTS: u8 = 16;

/// Exact prior state of one project-owned file.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FileSnapshot {
    path: PathBuf,
    content: Option<Vec<u8>>,
}

impl FileSnapshot {
    /// Reads the exact current content or records that the file is absent.
    ///
    /// # Errors
    ///
    /// Returns an I/O diagnostic for any failure other than a missing file.
    pub fn capture(path: impl Into<PathBuf>) -> Result<Self, Box<Diagnostic>> {
        let path = path.into();
        let content = match fs::read(&path) {
            Ok(content) => Some(content),
            Err(error) if error.kind() == ErrorKind::NotFound => None,
            Err(error) => return Err(io_error("could not read file snapshot", &path, error)),
        };
        Ok(Self { path, content })
    }

    /// Returns the snapshot path.
    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Returns the exact captured bytes, if the file existed.
    #[must_use]
    pub fn content(&self) -> Option<&[u8]> {
        self.content.as_deref()
    }

    /// Restores the snapshot only if the current bytes still equal `expected`.
    ///
    /// # Errors
    ///
    /// Returns a diagnostic without overwriting a file changed by another
    /// process since the mutation wrote its expected bytes.
    pub fn restore_if_current(&self, expected: Option<&[u8]>) -> Result<(), Box<Diagnostic>> {
        let current = read_optional(&self.path)?;
        if current.as_deref() != expected {
            return Err(Box::new(
                Diagnostic::new(
                    ErrorCode::UserInput,
                    format!(
                        "refusing to restore {} because it changed during dependency mutation",
                        self.path.display()
                    ),
                )
                .with_recovery("inspect the file and resolve the concurrent edit manually"),
            ));
        }
        match &self.content {
            Some(content) => write_atomic(&self.path, content),
            None => match fs::remove_file(&self.path) {
                Ok(()) => Ok(()),
                Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
                Err(error) => Err(io_error(
                    "could not remove restored file",
                    &self.path,
                    error,
                )),
            },
        }
    }
}

/// Atomically replaces `path` with `content` through a sibling staging file.
///
/// # Errors
///
/// Returns an I/O diagnostic without modifying the destination when staging
/// fails. Windows replacement restores the previous destination on failure.
pub fn write_atomic(path: &Path, content: &[u8]) -> Result<(), Box<Diagnostic>> {
    let staged = stage(path, content)?;
    #[cfg(unix)]
    let result =
        fs::rename(&staged, path).map_err(|error| io_error("could not publish file", path, error));
    #[cfg(windows)]
    let result = replace_windows(path, &staged);
    #[cfg(not(any(unix, windows)))]
    let result = Err(Box::new(
        Diagnostic::new(
            ErrorCode::InternalFailure,
            "atomic file replacement is unsupported on this platform",
        )
        .with_recovery("edit the file manually on this platform"),
    ));
    if result.is_err() {
        let _ = fs::remove_file(&staged);
    }
    result
}

fn read_optional(path: &Path) -> Result<Option<Vec<u8>>, Box<Diagnostic>> {
    match fs::read(path) {
        Ok(content) => Ok(Some(content)),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(io_error("could not read current file", path, error)),
    }
}

fn stage(path: &Path, content: &[u8]) -> Result<PathBuf, Box<Diagnostic>> {
    let directory = path.parent().ok_or_else(|| {
        Box::new(
            Diagnostic::new(
                ErrorCode::InternalFailure,
                "file path has no parent directory",
            )
            .with_recovery("use an explicit project file path"),
        )
    })?;
    for _ in 0..TEMP_ATTEMPTS {
        let staged = temporary_path(directory, "stage");
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&staged)
        {
            Ok(mut file) => {
                if let Err(error) = file.write_all(content).and_then(|()| file.sync_all()) {
                    let _ = fs::remove_file(&staged);
                    return Err(io_error("could not stage file replacement", path, error));
                }
                return Ok(staged);
            }
            Err(error) if error.kind() == ErrorKind::AlreadyExists => {}
            Err(error) => return Err(io_error("could not create file staging", path, error)),
        }
    }
    Err(Box::new(
        Diagnostic::new(
            ErrorCode::InternalFailure,
            format!(
                "could not allocate a file staging path beside {}",
                path.display()
            ),
        )
        .with_recovery("remove stale temporary wukong files and retry"),
    ))
}

fn temporary_path(directory: &Path, role: &str) -> PathBuf {
    let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    directory.join(format!(".wukong-{role}-{}-{sequence}", std::process::id()))
}

#[cfg(windows)]
fn replace_windows(path: &Path, staged: &Path) -> Result<(), Box<Diagnostic>> {
    if !path.exists() {
        return fs::rename(staged, path)
            .map_err(|error| io_error("could not publish file", path, error));
    }
    let directory = path.parent().ok_or_else(|| {
        Box::new(
            Diagnostic::new(
                ErrorCode::InternalFailure,
                "file path has no parent directory",
            )
            .with_recovery("use an explicit project file path"),
        )
    })?;
    let rollback = temporary_path(directory, "rollback");
    fs::rename(path, &rollback)
        .map_err(|error| io_error("could not stage file rollback", path, error))?;
    if let Err(error) = fs::rename(staged, path) {
        return match fs::rename(&rollback, path) {
            Ok(()) => Err(io_error("could not publish file", path, error)),
            Err(restore) => Err(Box::new(
                Diagnostic::new(
                    ErrorCode::InternalFailure,
                    format!("could not publish or restore {}", path.display()),
                )
                .with_cause(format!("publish: {error}; restore: {restore}"))
                .with_recovery("restore the rollback file manually before retrying"),
            )),
        };
    }
    fs::remove_file(&rollback)
        .map_err(|error| io_error("could not clean file rollback", path, error))
}

fn io_error(message: &str, path: &Path, error: std::io::Error) -> Box<Diagnostic> {
    Box::new(
        Diagnostic::new(
            ErrorCode::InternalFailure,
            format!("{message} {}", path.display()),
        )
        .with_cause(error)
        .with_recovery("check filesystem permissions and retry"),
    )
}
