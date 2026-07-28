//! Project-level Godot compatibility inputs.

use crate::{
    diagnostic::{Diagnostic, ErrorCode},
    manifest::Manifest,
    semantic_version::{SemanticVersion, VersionRequirement},
};

/// The project declaration and optional exact active Godot version.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProjectGodotCompatibility {
    requirement: VersionRequirement,
    active_version: Option<SemanticVersion>,
}

impl ProjectGodotCompatibility {
    /// Returns the manifest-declared supported Godot range.
    #[must_use]
    pub const fn requirement(&self) -> &VersionRequirement {
        &self.requirement
    }

    /// Returns an exact active Godot version supplied by the CLI, if any.
    #[must_use]
    pub const fn active_version(&self) -> Option<&SemanticVersion> {
        self.active_version.as_ref()
    }
}

/// Resolves project compatibility without inferring an engine version.
///
/// `project.godot` is intentionally not used as an engine-version source: its
/// settings are project data and do not provide a reliable installed-engine
/// identity. `--godot` therefore accepts one complete semantic version and
/// must satisfy the manifest's `[project].godot` requirement.
///
/// # Errors
///
/// Returns a user diagnostic when an explicit version is invalid or does not
/// satisfy the manifest declaration.
pub fn resolve_project_godot_compatibility(
    manifest: &Manifest,
    explicit_version: Option<&str>,
) -> Result<ProjectGodotCompatibility, Box<Diagnostic>> {
    let requirement = manifest.project().godot().clone();
    let active_version = explicit_version
        .map(|value| {
            SemanticVersion::parse(value).map_err(|error| {
                Box::new(
                    Diagnostic::new(
                        ErrorCode::UserInput,
                        format!("--godot must be a complete semantic version: {error}"),
                    )
                    .with_recovery("use a value such as 4.4.1"),
                )
            })
        })
        .transpose()?;
    if let Some(version) = &active_version {
        if !requirement.matches(version) {
            return Err(Box::new(
                Diagnostic::new(
                    ErrorCode::UserInput,
                    format!(
                        "--godot {version} does not satisfy project.godot requirement {requirement}"
                    ),
                )
                .with_recovery("supply an engine version allowed by [project].godot"),
            ));
        }
    }
    Ok(ProjectGodotCompatibility {
        requirement,
        active_version,
    })
}
