//! Atomic creation of a minimal project manifest.

use crate::{
    diagnostic::{Diagnostic, ErrorCode, Modification},
    manifest::{MANIFEST_FILE_NAME, ManifestResult},
    project::ProjectRoot,
};
use std::{
    fmt::Write as _,
    fs::{self, OpenOptions},
    io::{ErrorKind, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);
const TEMP_NAME_ATTEMPTS: u8 = 16;

/// A manifest created by [`initialize_manifest`].
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InitializedManifest {
    path: PathBuf,
    project_name: String,
}

impl InitializedManifest {
    /// Returns the path atomically published by the initialisation operation.
    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Returns the project name written to the manifest.
    #[must_use]
    pub fn project_name(&self) -> &str {
        &self.project_name
    }
}

/// Creates a minimal `wukong.toml` without overwriting an existing manifest.
///
/// # Errors
///
/// Returns a user diagnostic when the manifest already exists. I/O failures
/// return an internal diagnostic and leave no published partial manifest.
pub fn initialize_manifest(project: &ProjectRoot) -> ManifestResult<InitializedManifest> {
    let manifest_path = project.path().join(MANIFEST_FILE_NAME);
    ensure_manifest_absent(&manifest_path)?;
    let project_name = infer_project_name(project)?;
    let content = minimal_manifest(&project_name);
    let temporary_path = stage_manifest(&manifest_path, content.as_bytes())?;

    match fs::hard_link(&temporary_path, &manifest_path) {
        Ok(()) => {
            if let Err(error) = fs::remove_file(&temporary_path) {
                return Err(boxed(
                    Diagnostic::new(
                        ErrorCode::InternalFailure,
                        format!(
                            "created {} but could not remove temporary file {}",
                            manifest_path.display(),
                            temporary_path.display()
                        ),
                    )
                    .with_cause(error)
                    .with_modification(Modification::Applied(manifest_path))
                    .with_recovery("remove the temporary file after confirming wukong.toml"),
                ));
            }
            Ok(InitializedManifest {
                path: manifest_path,
                project_name,
            })
        }
        Err(error) => {
            let _ = fs::remove_file(&temporary_path);
            let diagnostic = if error.kind() == ErrorKind::AlreadyExists {
                Diagnostic::new(
                    ErrorCode::UserInput,
                    format!("manifest {} already exists", manifest_path.display()),
                )
                .with_recovery("edit the existing manifest or choose another project")
            } else {
                Diagnostic::new(
                    ErrorCode::InternalFailure,
                    format!("could not publish manifest {}", manifest_path.display()),
                )
                .with_cause(error)
                .with_recovery("check filesystem support for hard links and retry")
            };
            Err(boxed(diagnostic))
        }
    }
}

fn ensure_manifest_absent(path: &Path) -> ManifestResult<()> {
    match fs::symlink_metadata(path) {
        Ok(_) => Err(boxed(
            Diagnostic::new(
                ErrorCode::UserInput,
                format!("manifest {} already exists", path.display()),
            )
            .with_recovery("edit the existing manifest or choose another project"),
        )),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(boxed(
            Diagnostic::new(
                ErrorCode::InternalFailure,
                format!("could not inspect manifest path {}", path.display()),
            )
            .with_cause(error)
            .with_recovery("check filesystem permissions and retry"),
        )),
    }
}

fn infer_project_name(project: &ProjectRoot) -> ManifestResult<String> {
    let project_file = project.project_file();
    let content = fs::read_to_string(&project_file).map_err(|error| {
        boxed(
            Diagnostic::new(
                ErrorCode::InternalFailure,
                format!(
                    "could not read Godot project file {}",
                    project_file.display()
                ),
            )
            .with_cause(error)
            .with_recovery("check that project.godot is readable and retry"),
        )
    })?;
    Ok(application_name(&content).unwrap_or_else(|| directory_name(project.path())))
}

fn application_name(content: &str) -> Option<String> {
    let mut in_application_section = false;
    for line in content.lines() {
        let line = line.trim();
        if line.starts_with('[') && line.ends_with(']') {
            in_application_section = line == "[application]";
            continue;
        }
        if !in_application_section {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        if key.trim() == "config/name" {
            return decode_godot_string(value.trim()).filter(|name| !name.trim().is_empty());
        }
    }
    None
}

fn decode_godot_string(value: &str) -> Option<String> {
    let value = value.strip_prefix('"')?.strip_suffix('"')?;
    let mut decoded = String::new();
    let mut characters = value.chars();
    while let Some(character) = characters.next() {
        if character != '\\' {
            decoded.push(character);
            continue;
        }
        match characters.next()? {
            '"' => decoded.push('"'),
            '\\' => decoded.push('\\'),
            'n' => decoded.push('\n'),
            'r' => decoded.push('\r'),
            't' => decoded.push('\t'),
            _ => return None,
        }
    }
    Some(decoded)
}

fn directory_name(path: &Path) -> String {
    path.file_name()
        .filter(|name| !name.is_empty())
        .map_or_else(
            || "godot-project".to_owned(),
            |name| name.to_string_lossy().into_owned(),
        )
}

fn minimal_manifest(project_name: &str) -> String {
    format!(
        "[project]\nname = \"{}\"\ngodot = \">=4.0,<5\"\n",
        escape_toml_string(project_name)
    )
}

fn escape_toml_string(value: &str) -> String {
    value.chars().fold(String::new(), |mut escaped, character| {
        match character {
            '\\' => escaped.push_str("\\\\"),
            '"' => escaped.push_str("\\\""),
            '\n' => escaped.push_str("\\n"),
            '\r' => escaped.push_str("\\r"),
            '\t' => escaped.push_str("\\t"),
            character if character.is_control() => {
                let _ = write!(escaped, "\\u{:04x}", u32::from(character));
            }
            _ => escaped.push(character),
        }
        escaped
    })
}

fn stage_manifest(manifest_path: &Path, content: &[u8]) -> ManifestResult<PathBuf> {
    let directory = manifest_path.parent().ok_or_else(|| {
        boxed(
            Diagnostic::new(
                ErrorCode::InternalFailure,
                "manifest path has no parent directory",
            )
            .with_recovery("provide a project directory and retry"),
        )
    })?;
    for _ in 0..TEMP_NAME_ATTEMPTS {
        let temporary_path = directory.join(format!(
            ".{MANIFEST_FILE_NAME}.{}.{}.tmp",
            std::process::id(),
            TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
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

fn boxed(diagnostic: Diagnostic) -> Box<Diagnostic> {
    Box::new(diagnostic)
}
