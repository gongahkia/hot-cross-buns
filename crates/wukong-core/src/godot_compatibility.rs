//! Project-level Godot compatibility inputs.

use crate::{
    diagnostic::{Diagnostic, ErrorCode},
    identity::PackageName,
    lockfile::{GodotCompatibility, Lockfile},
    manifest::Manifest,
    semantic_version::{SemanticVersion, VersionRequirement},
};

/// The project declaration and optional exact active Godot version.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProjectGodotCompatibility {
    requirement: VersionRequirement,
    active_version: Option<SemanticVersion>,
}

/// Explicit non-fatal package compatibility states.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PackageGodotCompatibilityReport {
    unknown: Vec<PackageName>,
    indeterminate: Vec<PackageName>,
}

impl PackageGodotCompatibilityReport {
    /// Returns packages that supplied no Godot metadata.
    #[must_use]
    pub fn unknown(&self) -> &[PackageName] {
        &self.unknown
    }

    /// Returns package requirements that cannot be compared without an exact engine version.
    #[must_use]
    pub fn indeterminate(&self) -> &[PackageName] {
        &self.indeterminate
    }
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

/// Validates locked package Godot requirements before project mutation.
///
/// An exact CLI engine version is checked directly. Without one, Wukong proves
/// overlap for stable semantic-version ranges and reports pre-release ranges as
/// indeterminate rather than selecting an arbitrary engine version.
///
/// # Errors
///
/// Returns a user diagnostic when a known package requirement is incompatible
/// with the active version or declared project range.
pub fn validate_locked_package_godot_compatibility(
    lock: &Lockfile,
    project: &ProjectGodotCompatibility,
) -> Result<PackageGodotCompatibilityReport, Box<Diagnostic>> {
    let mut unknown = Vec::new();
    let mut indeterminate = Vec::new();
    for package in lock.packages().values() {
        let GodotCompatibility::Requirement(requirement) = package.godot() else {
            unknown.push(package.name().clone());
            continue;
        };
        if let Some(version) = project.active_version() {
            if !requirement.matches(version) {
                return Err(incompatible_active_version(
                    package.name(),
                    requirement,
                    version,
                ));
            }
            continue;
        }
        match project.requirement().stable_overlap(requirement) {
            Some(true) => {}
            Some(false) => {
                return Err(incompatible_project_requirement(
                    package.name(),
                    requirement,
                    project.requirement(),
                ));
            }
            None => indeterminate.push(package.name().clone()),
        }
    }
    Ok(PackageGodotCompatibilityReport {
        unknown,
        indeterminate,
    })
}

fn incompatible_active_version(
    package: &PackageName,
    requirement: &VersionRequirement,
    version: &SemanticVersion,
) -> Box<Diagnostic> {
    Box::new(
        Diagnostic::new(
            ErrorCode::UserInput,
            format!(
                "package {} requires Godot {requirement}, but active Godot is {version}",
                package.as_str()
            ),
        )
        .with_recovery("select a compatible package or use a compatible --godot version"),
    )
}

fn incompatible_project_requirement(
    package: &PackageName,
    package_requirement: &VersionRequirement,
    project_requirement: &VersionRequirement,
) -> Box<Diagnostic> {
    Box::new(
        Diagnostic::new(
            ErrorCode::UserInput,
            format!(
                "package {} requires Godot {package_requirement}, incompatible with project requirement {project_requirement}",
                package.as_str()
            ),
        )
        .with_recovery("select a compatible package or change [project].godot"),
    )
}
