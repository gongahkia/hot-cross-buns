//! Transactional, comment-preserving edits to `wukong.toml`.

use crate::{
    diagnostic::{Diagnostic, ErrorCode, Modification},
    manifest::{GitReference, MANIFEST_FILE_NAME, Manifest, ManifestResult},
};
use std::{
    fs::{self, OpenOptions},
    io::{ErrorKind, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};
use toml_edit::{DocumentMut, InlineTable, Item, Table, Value};

#[cfg(windows)]
use crate::diagnostic::RollbackStatus;

static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);
const TEMP_NAME_ATTEMPTS: u8 = 16;

/// Selects the dependency table to edit.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DependencySection {
    /// Runtime dependencies in `[dependencies]`.
    Runtime,
    /// Development dependencies in `[dev-dependencies]`.
    Development,
}

impl DependencySection {
    const fn table_name(self) -> &'static str {
        match self {
            Self::Runtime => "dependencies",
            Self::Development => "dev-dependencies",
        }
    }
}

/// A dependency declaration to write to a project manifest.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DependencyDeclaration {
    /// A future catalogue version requirement.
    Version(String),
    /// A local directory path.
    Path(PathBuf),
    /// A Git URL and optional revision selector.
    Git {
        /// Repository URL.
        url: String,
        /// Optional floating or exact revision input.
        reference: Option<GitReference>,
    },
    /// A checksummed archive URL.
    Url {
        /// Archive URL.
        url: String,
        /// Expected SHA-256 checksum.
        sha256: String,
    },
}

/// Adds a dependency without changing unrelated manifest fields or comments.
///
/// # Errors
///
/// Returns a user diagnostic when the manifest is invalid, the alias exists,
/// or the proposed declaration is invalid. I/O failures leave the prior
/// complete manifest in place or report rollback status.
pub fn add_dependency(
    manifest_path: &Path,
    section: DependencySection,
    alias: &str,
    declaration: &DependencyDeclaration,
) -> ManifestResult<()> {
    edit_manifest(
        manifest_path,
        |dependencies| {
            if dependencies.contains_key(alias) {
                return Err(user_error(
                    format!("manifest dependency {alias} already exists"),
                    "remove it first or choose a different dependency alias",
                ));
            }
            dependencies.insert(alias, declaration.to_item()?);
            dependencies.sort_values();
            Ok(())
        },
        section,
    )
}

/// Removes a dependency without changing unrelated manifest fields or comments.
///
/// # Errors
///
/// Returns a user diagnostic when the manifest or alias is invalid. I/O
/// failures leave the prior complete manifest in place or report rollback
/// status.
pub fn remove_dependency(
    manifest_path: &Path,
    section: DependencySection,
    alias: &str,
) -> ManifestResult<()> {
    edit_manifest(
        manifest_path,
        |dependencies| {
            if dependencies.remove(alias).is_none() {
                return Err(user_error(
                    format!("manifest dependency {alias} does not exist"),
                    "check the dependency alias and table before retrying",
                ));
            }
            dependencies.sort_values();
            Ok(())
        },
        section,
    )
}

impl DependencyDeclaration {
    fn to_item(&self) -> ManifestResult<Item> {
        match self {
            Self::Version(requirement) => Ok(Item::Value(Value::from(requirement.clone()))),
            Self::Path(path) => Ok(Item::Value(Value::InlineTable(source_table([(
                "path",
                path_to_string(path)?,
            )])))),
            Self::Git { url, reference } => {
                let mut fields = vec![("git", url.clone())];
                if let Some(reference) = reference {
                    let (key, value) = match reference {
                        GitReference::Rev(value) => ("rev", value.clone()),
                        GitReference::Tag(value) => ("tag", value.clone()),
                        GitReference::Branch(value) => ("branch", value.clone()),
                    };
                    fields.push((key, value));
                }
                Ok(Item::Value(Value::InlineTable(source_table(fields))))
            }
            Self::Url { url, sha256 } => Ok(Item::Value(Value::InlineTable(source_table([
                ("url", url.clone()),
                ("sha256", sha256.clone()),
            ])))),
        }
    }
}

fn source_table(fields: impl IntoIterator<Item = (&'static str, String)>) -> InlineTable {
    let mut table = InlineTable::new();
    for (key, value) in fields {
        table.insert(key, Value::from(value));
    }
    table.fmt();
    table
}

fn path_to_string(path: &Path) -> ManifestResult<String> {
    path.to_str().map(str::to_owned).ok_or_else(|| {
        user_error(
            "local dependency paths must be valid UTF-8 for wukong.toml",
            "use a UTF-8 path or edit the manifest manually",
        )
    })
}

fn edit_manifest<F>(manifest_path: &Path, edit: F, section: DependencySection) -> ManifestResult<()>
where
    F: FnOnce(&mut Table) -> ManifestResult<()>,
{
    let input =
        fs::read_to_string(manifest_path).map_err(|error| read_error(manifest_path, error))?;
    Manifest::parse(manifest_path, &input)?;
    let mut document = input.parse::<DocumentMut>().map_err(|error| {
        boxed(
            Diagnostic::new(
                ErrorCode::InternalFailure,
                "validated manifest could not be edited",
            )
            .with_cause(error)
            .with_recovery("report this as a wukong bug"),
        )
    })?;
    edit(dependency_table(document.as_table_mut(), section)?)?;
    let output = document.to_string();
    Manifest::parse(manifest_path, &output)?;
    replace_manifest(manifest_path, output.as_bytes())
}

fn dependency_table(root: &mut Table, section: DependencySection) -> ManifestResult<&mut Table> {
    let name = section.table_name();
    if !root.contains_key(name) {
        root.insert(name, Item::Table(Table::new()));
    }
    root.get_mut(name)
        .and_then(Item::as_table_mut)
        .ok_or_else(|| {
            boxed(
                Diagnostic::new(
                    ErrorCode::InternalFailure,
                    format!("manifest table {name} could not be edited"),
                )
                .with_recovery("report this as a wukong bug"),
            )
        })
}

fn read_error(path: &Path, error: std::io::Error) -> Box<Diagnostic> {
    let (code, message, recovery) = if error.kind() == ErrorKind::NotFound {
        (
            ErrorCode::UserInput,
            format!("manifest {} does not exist", path.display()),
            "run wukong init before editing dependencies",
        )
    } else {
        (
            ErrorCode::InternalFailure,
            format!("could not read manifest {}", path.display()),
            "check filesystem permissions and retry",
        )
    };
    boxed(
        Diagnostic::new(code, message)
            .with_cause(error)
            .with_recovery(recovery),
    )
}

fn replace_manifest(manifest_path: &Path, content: &[u8]) -> ManifestResult<()> {
    let temporary_path = stage_manifest(manifest_path, content)?;
    #[cfg(unix)]
    let result = replace_unix(manifest_path, &temporary_path);
    #[cfg(windows)]
    let result = replace_windows(manifest_path, &temporary_path);
    #[cfg(not(any(unix, windows)))]
    let result = Err(boxed(
        Diagnostic::new(
            ErrorCode::InternalFailure,
            "transactional manifest replacement is unsupported on this platform",
        )
        .with_recovery("edit wukong.toml manually on this platform"),
    ));
    if result.is_err() {
        let _ = fs::remove_file(&temporary_path);
    }
    result
}

#[cfg(unix)]
fn replace_unix(manifest_path: &Path, temporary_path: &Path) -> ManifestResult<()> {
    let rollback_path = create_rollback_link(manifest_path)?;
    if let Err(error) = fs::rename(temporary_path, manifest_path) {
        let _ = fs::remove_file(&rollback_path);
        return Err(boxed(
            Diagnostic::new(
                ErrorCode::InternalFailure,
                format!("could not publish manifest {}", manifest_path.display()),
            )
            .with_cause(error)
            .with_recovery("retry after checking filesystem permissions"),
        ));
    }
    remove_rollback(&rollback_path, manifest_path)
}

#[cfg(windows)]
fn replace_windows(manifest_path: &Path, temporary_path: &Path) -> ManifestResult<()> {
    let rollback_path = move_to_rollback(manifest_path)?;
    if let Err(error) = fs::rename(temporary_path, manifest_path) {
        return restore_windows_rollback(manifest_path, &rollback_path, error);
    }
    remove_rollback(&rollback_path, manifest_path)
}

#[cfg(unix)]
fn create_rollback_link(manifest_path: &Path) -> ManifestResult<PathBuf> {
    let directory = manifest_directory(manifest_path)?;
    for _ in 0..TEMP_NAME_ATTEMPTS {
        let rollback_path = temporary_path(directory, "rollback");
        match fs::hard_link(manifest_path, &rollback_path) {
            Ok(()) => return Ok(rollback_path),
            Err(error) if error.kind() == ErrorKind::AlreadyExists => {}
            Err(error) => {
                return Err(boxed(
                    Diagnostic::new(
                        ErrorCode::InternalFailure,
                        format!(
                            "could not stage a manifest rollback in {}",
                            directory.display()
                        ),
                    )
                    .with_cause(error)
                    .with_recovery("check filesystem support for hard links and retry"),
                ));
            }
        }
    }
    Err(boxed(
        Diagnostic::new(
            ErrorCode::InternalFailure,
            format!(
                "could not allocate a manifest rollback path in {}",
                directory.display()
            ),
        )
        .with_recovery("remove stale temporary wukong files and retry"),
    ))
}

#[cfg(windows)]
fn move_to_rollback(manifest_path: &Path) -> ManifestResult<PathBuf> {
    let directory = manifest_directory(manifest_path)?;
    for _ in 0..TEMP_NAME_ATTEMPTS {
        let rollback_path = temporary_path(directory, "rollback");
        match fs::rename(manifest_path, &rollback_path) {
            Ok(()) => return Ok(rollback_path),
            Err(error) if error.kind() == ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(boxed(
                    Diagnostic::new(
                        ErrorCode::InternalFailure,
                        format!(
                            "could not stage a manifest rollback in {}",
                            directory.display()
                        ),
                    )
                    .with_cause(error)
                    .with_recovery("check filesystem permissions and retry"),
                ));
            }
        }
    }
    Err(boxed(
        Diagnostic::new(
            ErrorCode::InternalFailure,
            format!(
                "could not allocate a manifest rollback path in {}",
                directory.display()
            ),
        )
        .with_recovery("remove stale temporary wukong files and retry"),
    ))
}

#[cfg(windows)]
fn restore_windows_rollback(
    manifest_path: &Path,
    rollback_path: &Path,
    publication_error: std::io::Error,
) -> ManifestResult<()> {
    match fs::rename(rollback_path, manifest_path) {
        Ok(()) => Err(boxed(
            Diagnostic::new(
                ErrorCode::InternalFailure,
                format!("could not publish manifest {}", manifest_path.display()),
            )
            .with_cause(publication_error)
            .with_rollback(RollbackStatus::Succeeded)
            .with_recovery("the previous manifest was restored; retry after checking permissions"),
        )),
        Err(rollback_error) => Err(boxed(
            Diagnostic::new(
                ErrorCode::InternalFailure,
                format!("could not publish manifest {}", manifest_path.display()),
            )
            .with_cause(format!(
                "publication: {publication_error}; rollback: {rollback_error}"
            ))
            .with_rollback(RollbackStatus::Failed)
            .with_recovery("restore the rollback manifest file manually before retrying"),
        )),
    }
}

fn remove_rollback(rollback_path: &Path, manifest_path: &Path) -> ManifestResult<()> {
    fs::remove_file(rollback_path).map_err(|error| {
        boxed(
            Diagnostic::new(
                ErrorCode::InternalFailure,
                format!(
                    "updated {} but could not remove rollback file {}",
                    manifest_path.display(),
                    rollback_path.display()
                ),
            )
            .with_cause(error)
            .with_modification(Modification::Applied(manifest_path.to_path_buf()))
            .with_recovery("remove the rollback file after confirming wukong.toml"),
        )
    })
}

fn stage_manifest(manifest_path: &Path, content: &[u8]) -> ManifestResult<PathBuf> {
    let directory = manifest_directory(manifest_path)?;
    for _ in 0..TEMP_NAME_ATTEMPTS {
        let temporary_path = temporary_path(directory, "edit");
        let mut file = match OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary_path)
        {
            Ok(file) => file,
            Err(error) if error.kind() == ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(boxed(
                    Diagnostic::new(
                        ErrorCode::InternalFailure,
                        format!("could not stage manifest in {}", directory.display()),
                    )
                    .with_cause(error)
                    .with_recovery("check filesystem permissions and retry"),
                ));
            }
        };
        let write_result = file.write_all(content).and_then(|()| file.sync_all());
        drop(file);
        if let Err(error) = write_result {
            let _ = fs::remove_file(&temporary_path);
            return Err(boxed(
                Diagnostic::new(
                    ErrorCode::InternalFailure,
                    format!(
                        "could not write staged manifest {}",
                        temporary_path.display()
                    ),
                )
                .with_cause(error)
                .with_recovery("check available disk space and retry"),
            ));
        }
        return Ok(temporary_path);
    }
    Err(boxed(
        Diagnostic::new(
            ErrorCode::InternalFailure,
            format!(
                "could not allocate a temporary manifest file in {}",
                directory.display()
            ),
        )
        .with_recovery("remove stale temporary wukong files and retry"),
    ))
}

fn manifest_directory(manifest_path: &Path) -> ManifestResult<&Path> {
    manifest_path.parent().ok_or_else(|| {
        boxed(
            Diagnostic::new(
                ErrorCode::InternalFailure,
                "manifest path has no parent directory",
            )
            .with_recovery("provide a project directory and retry"),
        )
    })
}

fn temporary_path(directory: &Path, operation: &str) -> PathBuf {
    directory.join(format!(
        ".{MANIFEST_FILE_NAME}.{}.{}.{}.tmp",
        operation,
        std::process::id(),
        TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ))
}

fn user_error(message: impl AsRef<str>, recovery: impl AsRef<str>) -> Box<Diagnostic> {
    boxed(Diagnostic::new(ErrorCode::UserInput, message).with_recovery(recovery))
}

fn boxed(diagnostic: Diagnostic) -> Box<Diagnostic> {
    Box::new(diagnostic)
}
