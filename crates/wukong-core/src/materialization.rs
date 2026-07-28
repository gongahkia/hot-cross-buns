//! Per-file copy, hardlink, and reflink materialisation with safe fallback.

use crate::{
    diagnostic::{Diagnostic, ErrorCode},
    installed_state::MaterializationStrategy,
};
use std::{fs, path::Path};

/// Requested materialisation policy.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum MaterializationPreference {
    /// Probe reflink and hardlink, then use a standalone copy.
    #[default]
    Auto,
    /// Always create a standalone copy.
    Copy,
    /// Require a same-filesystem hardlink.
    Hardlink,
    /// Require a copy-on-write reflink where the platform supports it.
    Reflink,
}

/// Materialises one regular file at a path that does not already exist.
///
/// Auto policy probes the destination filesystem at the staging path; an
/// unsupported optimisation falls back to the next safe strategy.
///
/// # Errors
///
/// Returns a diagnostic when an explicitly requested strategy is unavailable
/// or the source/destination cannot be accessed.
pub fn materialize_file(
    source: &Path,
    destination: &Path,
    preference: MaterializationPreference,
) -> Result<MaterializationStrategy, Box<Diagnostic>> {
    match preference {
        MaterializationPreference::Copy => copy(source, destination),
        MaterializationPreference::Hardlink => hardlink(source, destination),
        MaterializationPreference::Reflink => reflink(source, destination),
        MaterializationPreference::Auto => {
            if let Ok(strategy) = reflink(source, destination) {
                return Ok(strategy);
            }
            remove_partial(destination);
            if let Ok(strategy) = hardlink(source, destination) {
                return Ok(strategy);
            }
            remove_partial(destination);
            copy(source, destination)
        }
    }
}

fn copy(source: &Path, destination: &Path) -> Result<MaterializationStrategy, Box<Diagnostic>> {
    fs::copy(source, destination)
        .and_then(|_| fs::File::open(destination).and_then(|file| file.sync_all()))
        .map_err(|error| materialization_error("could not copy package file", error))?;
    Ok(MaterializationStrategy::Copy)
}

fn hardlink(source: &Path, destination: &Path) -> Result<MaterializationStrategy, Box<Diagnostic>> {
    fs::hard_link(source, destination)
        .map_err(|error| materialization_error("could not create requested hardlink", error))?;
    Ok(MaterializationStrategy::Hardlink)
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn reflink(source: &Path, destination: &Path) -> Result<MaterializationStrategy, Box<Diagnostic>> {
    reflink_copy::reflink(source, destination)
        .map_err(|error| materialization_error("could not create requested reflink", error))?;
    Ok(MaterializationStrategy::Reflink)
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn reflink(_: &Path, _: &Path) -> Result<MaterializationStrategy, Box<Diagnostic>> {
    Err(Box::new(
        Diagnostic::new(
            ErrorCode::UserInput,
            "reflink materialisation is not supported on this platform",
        )
        .with_recovery("use auto, copy, or hardlink materialisation"),
    ))
}

fn remove_partial(path: &Path) {
    if fs::symlink_metadata(path).is_ok() {
        let _ = fs::remove_file(path);
    }
}

fn materialization_error(message: &str, error: std::io::Error) -> Box<Diagnostic> {
    Box::new(
        Diagnostic::new(ErrorCode::InternalFailure, message)
            .with_cause(error)
            .with_recovery("use copy materialisation or check filesystem permissions"),
    )
}
