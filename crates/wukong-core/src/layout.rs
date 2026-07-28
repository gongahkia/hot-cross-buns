//! Conservative package-layout detection for prepared source trees.

use crate::diagnostic::{Diagnostic, ErrorCode};
use std::{
    fs,
    io::ErrorKind,
    path::{Component, Path, PathBuf},
};

/// Optional explicit layout inputs supplied by a source declaration or metadata.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct LayoutOptions {
    /// Source-relative addon directory that overrides inference.
    pub source_subdirectory: Option<PathBuf>,
    /// Project-relative target retained for later materialisation.
    pub target_path: Option<PathBuf>,
}

/// A source directory selected for one package, plus optional target metadata.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PackageLayout {
    source_root: PathBuf,
    target_path: Option<PathBuf>,
}

impl PackageLayout {
    /// Returns the canonical source directory selected for the addon.
    #[must_use]
    pub fn source_root(&self) -> &Path {
        &self.source_root
    }

    /// Returns the project-relative target requested by the source, if any.
    #[must_use]
    pub fn target_path(&self) -> Option<&Path> {
        self.target_path.as_deref()
    }
}

/// Detects an unambiguous package layout below `source_root`.
///
/// # Errors
///
/// Returns a diagnostic for invalid explicit paths, inaccessible source trees,
/// or multiple implicit `addons/*` candidates.
pub fn detect_package_layout(
    source_root: &Path,
    options: &LayoutOptions,
) -> Result<PackageLayout, Box<Diagnostic>> {
    let source_root = canonical_directory(source_root, "source root")?;
    let target_path = options
        .target_path
        .as_deref()
        .map(|path| safe_relative_path(path, "target path"))
        .transpose()?;
    let selected = match options.source_subdirectory.as_deref() {
        Some(path) => {
            let relative = safe_relative_path(path, "source subdirectory")?;
            canonical_directory(&source_root.join(relative), "source subdirectory")?
        }
        None => infer_layout(&source_root)?,
    };
    Ok(PackageLayout {
        source_root: selected,
        target_path,
    })
}

fn infer_layout(root: &Path) -> Result<PathBuf, Box<Diagnostic>> {
    let addons = root.join("addons");
    if addons.is_dir() {
        return select_addon(&addons);
    }
    let entries = visible_entries(root)?;
    if entries.len() == 1 && entries[0].is_dir() {
        return infer_layout(&entries[0]);
    }
    Ok(root.to_path_buf())
}

fn select_addon(addons: &Path) -> Result<PathBuf, Box<Diagnostic>> {
    let mut candidates = fs::read_dir(addons)
        .map_err(|error| io_error(addons, error))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| io_error(addons, error))?
        .into_iter()
        .filter_map(|entry| {
            entry
                .file_type()
                .ok()
                .filter(fs::FileType::is_dir)
                .map(|_| entry.path())
        })
        .collect::<Vec<_>>();
    candidates.sort();
    match candidates.len() {
        0 => Err(boxed(
            Diagnostic::new(
                ErrorCode::SourceAccess,
                format!("{} contains no addon directory", addons.display()),
            )
            .with_recovery("declare source_subdirectory explicitly"),
        )),
        1 => canonical_directory(&candidates[0], "addon directory"),
        _ => Err(boxed(
            Diagnostic::new(
                ErrorCode::UserInput,
                format!(
                    "ambiguous package layout; addon candidates: {}",
                    candidates
                        .iter()
                        .map(|path| path.display().to_string())
                        .collect::<Vec<_>>()
                        .join(", ")
                ),
            )
            .with_recovery("declare source_subdirectory explicitly"),
        )),
    }
}

fn visible_entries(root: &Path) -> Result<Vec<PathBuf>, Box<Diagnostic>> {
    let mut entries = fs::read_dir(root)
        .map_err(|error| io_error(root, error))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| io_error(root, error))?
        .into_iter()
        .filter(|entry| {
            !matches!(
                entry.file_name().to_str(),
                Some(".git" | ".hg" | ".svn" | ".DS_Store" | "__MACOSX")
            )
        })
        .map(|entry| entry.path())
        .collect::<Vec<_>>();
    entries.sort();
    Ok(entries)
}

fn safe_relative_path(path: &Path, field: &str) -> Result<PathBuf, Box<Diagnostic>> {
    if path.as_os_str().is_empty() {
        return Err(invalid_path(field));
    }
    let mut normalised = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(value) => normalised.push(value),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(invalid_path(field));
            }
        }
    }
    if normalised.as_os_str().is_empty() {
        Err(invalid_path(field))
    } else {
        Ok(normalised)
    }
}

fn canonical_directory(path: &Path, description: &str) -> Result<PathBuf, Box<Diagnostic>> {
    let canonical = fs::canonicalize(path).map_err(|error| io_error(path, error))?;
    match fs::metadata(&canonical) {
        Ok(metadata) if metadata.is_dir() => Ok(canonical),
        Ok(_) => Err(boxed(
            Diagnostic::new(
                ErrorCode::UserInput,
                format!("{description} {} is not a directory", canonical.display()),
            )
            .with_recovery("provide an existing addon directory"),
        )),
        Err(error) => Err(io_error(&canonical, error)),
    }
}

fn invalid_path(field: &str) -> Box<Diagnostic> {
    boxed(
        Diagnostic::new(
            ErrorCode::UserInput,
            format!("{field} must be a non-empty relative path without traversal"),
        )
        .with_recovery("use a safe path below the source root"),
    )
}
fn io_error(path: &Path, error: std::io::Error) -> Box<Diagnostic> {
    let code = if error.kind() == ErrorKind::NotFound {
        ErrorCode::SourceAccess
    } else {
        ErrorCode::InternalFailure
    };
    boxed(
        Diagnostic::new(
            code,
            format!("could not read package layout path {}", path.display()),
        )
        .with_cause(error)
        .with_recovery("check the source path and retry"),
    )
}
fn boxed(diagnostic: Diagnostic) -> Box<Diagnostic> {
    Box::new(diagnostic)
}
