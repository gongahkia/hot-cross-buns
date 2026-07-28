//! Cross-process advisory locking for mutable Wukong resources.

use crate::diagnostic::{Diagnostic, ErrorCode};
use fs2::FileExt;
use std::{
    fs::{self, File, OpenOptions},
    io::ErrorKind,
    path::Path,
};

/// An exclusively held advisory lock released when dropped or when its process exits.
#[derive(Debug)]
pub struct AdvisoryLock(File);

impl AdvisoryLock {
    /// Acquires an exclusive lock without waiting for another Wukong process.
    ///
    /// # Errors
    ///
    /// Returns a retryable diagnostic when another operation holds `path`.
    pub fn try_acquire(path: &Path, resource: &str) -> Result<Self, Box<Diagnostic>> {
        let parent = path.parent().ok_or_else(|| {
            Box::new(
                Diagnostic::new(
                    ErrorCode::InternalFailure,
                    "lock path has no parent directory",
                )
                .with_recovery("retry and report this as a wukong bug if it persists"),
            )
        })?;
        fs::create_dir_all(parent).map_err(|error| {
            Box::new(
                Diagnostic::new(
                    ErrorCode::InternalFailure,
                    "could not create lock directory",
                )
                .with_cause(error)
                .with_recovery("check cache or project permissions and retry"),
            )
        })?;
        let file = OpenOptions::new()
            .create(true)
            .read(true)
            .truncate(false)
            .write(true)
            .open(path)
            .map_err(|error| {
                Box::new(
                    Diagnostic::new(ErrorCode::InternalFailure, "could not open operation lock")
                        .with_cause(error)
                        .with_recovery("check cache or project permissions and retry"),
                )
            })?;
        match file.try_lock_exclusive() {
            Ok(()) => Ok(Self(file)),
            Err(error) if error.kind() == ErrorKind::WouldBlock => Err(Box::new(
                Diagnostic::new(
                    ErrorCode::SourceAccess,
                    format!("another wukong operation is active for {resource}"),
                )
                .with_recovery("wait for the active operation to finish, then retry"),
            )),
            Err(error) => Err(Box::new(
                Diagnostic::new(
                    ErrorCode::InternalFailure,
                    "could not acquire operation lock",
                )
                .with_cause(error)
                .with_recovery("check cache or project permissions and retry"),
            )),
        }
    }
}

impl Drop for AdvisoryLock {
    fn drop(&mut self) {
        let _ = FileExt::unlock(&self.0);
    }
}

#[cfg(test)]
mod tests {
    use super::AdvisoryLock;
    use crate::diagnostic::ErrorCode;
    use tempfile::TempDir;

    #[test]
    fn invariant_released_advisory_lock_recovers_without_deleting_its_lockfile() {
        let fixture = TempDir::new().expect("fixture should exist");
        let path = fixture.path().join("locks/resource.lock");
        let held = AdvisoryLock::try_acquire(&path, "fixture resource")
            .expect("first lock should acquire");

        let error = AdvisoryLock::try_acquire(&path, "fixture resource")
            .expect_err("second lock should report active operation");
        assert_eq!(error.code(), ErrorCode::SourceAccess);
        assert!(
            error
                .message()
                .contains("another wukong operation is active")
        );
        drop(held);

        let recovered = AdvisoryLock::try_acquire(&path, "fixture resource")
            .expect("released advisory lock should recover");
        assert!(path.is_file());
        drop(recovered);
    }
}
