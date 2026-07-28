//! Godot project discovery anchored by a `project.godot` file.

use crate::diagnostic::{Diagnostic, ErrorCode};
use std::{
    fs,
    io::ErrorKind,
    path::{Path, PathBuf},
};

/// The file that defines a Godot project root.
pub const PROJECT_FILE_NAME: &str = "project.godot";

/// The result type returned by project discovery.
pub type ProjectResult<T> = std::result::Result<T, Box<Diagnostic>>;

/// A canonical Godot project root.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProjectRoot {
    root: PathBuf,
}

impl ProjectRoot {
    /// Discovers the nearest project from `start` or validates `--project`.
    ///
    /// An explicit path may identify either a project directory or its
    /// `project.godot` file. It takes precedence over upward discovery.
    ///
    /// # Errors
    ///
    /// Returns a user diagnostic when no project can be selected or the input
    /// path is invalid, and an internal diagnostic for filesystem failures.
    pub fn discover(start: &Path, explicit_project: Option<&Path>) -> ProjectResult<Self> {
        match explicit_project {
            Some(path) => Self::from_explicit_path(path),
            None => Self::from_start_path(start),
        }
    }

    /// Returns the canonical project directory.
    #[must_use]
    pub fn path(&self) -> &Path {
        &self.root
    }

    /// Returns the canonical path to `project.godot`.
    #[must_use]
    pub fn project_file(&self) -> PathBuf {
        self.root.join(PROJECT_FILE_NAME)
    }

    fn from_explicit_path(path: &Path) -> ProjectResult<Self> {
        let canonical = canonicalize_path(path, "explicit project path")?;
        let metadata = metadata(&canonical, "explicit project path")?;
        let root = if metadata.is_dir() {
            canonical
        } else if metadata.is_file()
            && canonical
                .file_name()
                .is_some_and(|name| name == PROJECT_FILE_NAME)
        {
            canonical.parent().map(Path::to_path_buf).ok_or_else(|| {
                boxed(
                    Diagnostic::new(
                        ErrorCode::UserInput,
                        "the explicit project file has no parent directory",
                    )
                    .with_recovery("provide a project directory or project.godot file"),
                )
            })?
        } else {
            return Err(boxed(
                Diagnostic::new(
                    ErrorCode::UserInput,
                    format!(
                        "explicit project path {} must be a directory or {PROJECT_FILE_NAME}",
                        canonical.display()
                    ),
                )
                .with_recovery("provide a project directory or project.godot file"),
            ));
        };

        validate_project_root(root, "explicit project path")
    }

    fn from_start_path(start: &Path) -> ProjectResult<Self> {
        let mut current = directory_for_start_path(start)?;

        loop {
            match marker_state(&current)? {
                MarkerState::Present => return Ok(Self { root: current }),
                MarkerState::Absent => {}
            }

            let Some(parent) = current.parent().map(Path::to_path_buf) else {
                break;
            };
            #[cfg(unix)]
            if crosses_filesystem_boundary(&current, &parent)? {
                break;
            }
            #[cfg(not(unix))]
            if crosses_filesystem_boundary(&current, &parent) {
                break;
            }
            current = parent;
        }

        Err(boxed(
            Diagnostic::new(
                ErrorCode::UserInput,
                format!(
                    "no Godot project containing {PROJECT_FILE_NAME} was found from {}",
                    start.display()
                ),
            )
            .with_recovery("run inside a Godot project or provide --project <path>"),
        ))
    }
}

enum MarkerState {
    Present,
    Absent,
}

fn boxed(diagnostic: Diagnostic) -> Box<Diagnostic> {
    Box::new(diagnostic)
}

fn validate_project_root(root: PathBuf, description: &str) -> ProjectResult<ProjectRoot> {
    match marker_state(&root)? {
        MarkerState::Present => Ok(ProjectRoot { root }),
        MarkerState::Absent => Err(boxed(
            Diagnostic::new(
                ErrorCode::UserInput,
                format!(
                    "{description} {} does not contain {PROJECT_FILE_NAME}",
                    root.display()
                ),
            )
            .with_recovery("provide a directory containing project.godot"),
        )),
    }
}

fn directory_for_start_path(path: &Path) -> ProjectResult<PathBuf> {
    let canonical = canonicalize_path(path, "starting directory")?;
    let metadata = metadata(&canonical, "starting directory")?;
    if metadata.is_dir() {
        return Ok(canonical);
    }
    if metadata.is_file() {
        return canonical.parent().map(Path::to_path_buf).ok_or_else(|| {
            boxed(
                Diagnostic::new(
                    ErrorCode::UserInput,
                    "the starting file has no parent directory",
                )
                .with_recovery("run from a directory inside a Godot project"),
            )
        });
    }

    Err(boxed(
        Diagnostic::new(
            ErrorCode::UserInput,
            format!(
                "starting path {} is not a file or directory",
                canonical.display()
            ),
        )
        .with_recovery("provide a project directory or a path inside one"),
    ))
}

fn canonicalize_path(path: &Path, description: &str) -> ProjectResult<PathBuf> {
    fs::canonicalize(path).map_err(|error| {
        let message = match error.kind() {
            ErrorKind::NotFound => format!("{description} {} does not exist", path.display()),
            ErrorKind::PermissionDenied => {
                format!("{description} {} cannot be accessed", path.display())
            }
            _ => format!("{description} {} could not be resolved", path.display()),
        };
        boxed(
            Diagnostic::new(ErrorCode::UserInput, message)
                .with_cause(error)
                .with_recovery(
                    "provide an existing accessible project directory or project.godot file",
                ),
        )
    })
}

fn metadata(path: &Path, description: &str) -> ProjectResult<fs::Metadata> {
    fs::metadata(path).map_err(|error| {
        boxed(
            Diagnostic::new(
                ErrorCode::InternalFailure,
                format!("could not inspect {description} {}", path.display()),
            )
            .with_cause(error)
            .with_recovery("check filesystem permissions and retry"),
        )
    })
}

fn marker_state(root: &Path) -> ProjectResult<MarkerState> {
    let marker = root.join(PROJECT_FILE_NAME);
    match fs::metadata(&marker) {
        Ok(metadata) if metadata.is_file() => Ok(MarkerState::Present),
        Ok(_) => Err(boxed(
            Diagnostic::new(
                ErrorCode::UserInput,
                format!("{} exists but is not a regular file", marker.display()),
            )
            .with_recovery("replace it with a regular project.godot file"),
        )),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(MarkerState::Absent),
        Err(error) => Err(boxed(
            Diagnostic::new(
                ErrorCode::InternalFailure,
                format!("could not inspect project marker {}", marker.display()),
            )
            .with_cause(error)
            .with_recovery("check filesystem permissions and retry"),
        )),
    }
}

#[cfg(unix)]
fn crosses_filesystem_boundary(current: &Path, parent: &Path) -> ProjectResult<bool> {
    use std::os::unix::fs::MetadataExt;

    let current = metadata(current, "project search directory")?;
    let parent = metadata(parent, "project search parent")?;
    Ok(current.dev() != parent.dev())
}

#[cfg(not(unix))]
fn crosses_filesystem_boundary(_current: &Path, _parent: &Path) -> bool {
    false
}
