//! Parsing and local verification for versioned compatibility fixtures.

use crate::{
    diagnostic::{Diagnostic, ErrorCode},
    identity::PackageName,
    layout::{LayoutOptions, detect_package_layout},
    package_tree::prepare_package_tree,
    semantic_version::VersionRequirement,
};
use std::{
    collections::BTreeSet,
    path::{Component, Path, PathBuf},
};
use toml_edit::{Document, Item, TableLike};

/// The supported compatibility-fixture schema version.
pub const COMPATIBILITY_FIXTURE_SCHEMA: i64 = 1;

/// A validated public-addon compatibility fixture.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CompatibilityFixture {
    id: PackageName,
    source_url: String,
    revision: String,
    source_subdirectory: PathBuf,
    target_path: PathBuf,
    installed_paths: Vec<PathBuf>,
    package_sha256: String,
    godot: VersionRequirement,
    headless_validation: Option<Vec<String>>,
}

impl CompatibilityFixture {
    /// Parses one schema-one fixture at `path`.
    ///
    /// # Errors
    ///
    /// Returns a diagnostic when the fixture is invalid or unsupported.
    pub fn parse(path: &Path, input: &str) -> Result<Self, Box<Diagnostic>> {
        let document = Document::parse(input.to_owned())
            .map_err(|error| syntax_error(path, "invalid compatibility-fixture syntax", error))?;
        let root = document.as_table();
        unknown(
            root,
            &[
                "schema",
                "id",
                "godot",
                "package_sha256",
                "installed_paths",
                "headless_validation",
                "source",
                "layout",
            ],
            path,
            "root",
        )?;
        let schema = integer(root, "schema", path, "root")?;
        if schema != COMPATIBILITY_FIXTURE_SCHEMA {
            return Err(user(
                path,
                format!("fixture.schema must be {COMPATIBILITY_FIXTURE_SCHEMA}"),
                "use a supported compatibility-fixture schema",
            ));
        }
        let id = PackageName::parse(&string(root, "id", path, "root")?).map_err(|error| {
            user(
                path,
                format!("fixture.id {error}"),
                "use a canonical package identifier",
            )
        })?;
        let godot =
            VersionRequirement::parse(&string(root, "godot", path, "root")?).map_err(|error| {
                user(
                    path,
                    format!("fixture.godot is invalid: {error}"),
                    "use a semantic-version requirement",
                )
            })?;
        let package_sha256 = sha256(&string(root, "package_sha256", path, "root")?, path)?;
        let installed_paths = installed_paths(root.get("installed_paths"), path)?;
        let headless_validation = headless_validation(root.get("headless_validation"), path)?;
        let source = table(root, "source", path, "root")?;
        unknown(source, &["url", "revision"], path, "source")?;
        let source_url = source_url(&string(source, "url", path, "source")?, path)?;
        let revision = revision(&string(source, "revision", path, "source")?, path)?;
        let layout = table(root, "layout", path, "root")?;
        unknown(
            layout,
            &["source_subdirectory", "target_path"],
            path,
            "layout",
        )?;
        let source_subdirectory = safe_relative_path(
            &string(layout, "source_subdirectory", path, "layout")?,
            path,
            "layout.source_subdirectory",
        )?;
        let target_path = safe_relative_path(
            &string(layout, "target_path", path, "layout")?,
            path,
            "layout.target_path",
        )?;
        if !installed_paths
            .iter()
            .all(|entry| entry.starts_with(&target_path))
        {
            return Err(user(
                path,
                "fixture.installed_paths must stay below layout.target_path",
                "record paths relative to the declared installation target",
            ));
        }
        Ok(Self {
            id,
            source_url,
            revision,
            source_subdirectory,
            target_path,
            installed_paths,
            package_sha256,
            godot,
            headless_validation,
        })
    }

    /// Returns the canonical fixture identifier.
    #[must_use]
    pub const fn id(&self) -> &PackageName {
        &self.id
    }

    /// Returns the public HTTPS Git source URL.
    #[must_use]
    pub fn source_url(&self) -> &str {
        &self.source_url
    }

    /// Returns the immutable 40-character Git commit.
    #[must_use]
    pub fn revision(&self) -> &str {
        &self.revision
    }

    /// Returns the source-relative addon directory.
    #[must_use]
    pub fn source_subdirectory(&self) -> &Path {
        &self.source_subdirectory
    }

    /// Returns the project-relative destination directory.
    #[must_use]
    pub fn target_path(&self) -> &Path {
        &self.target_path
    }

    /// Returns expected installed files in deterministic path order.
    #[must_use]
    pub fn installed_paths(&self) -> &[PathBuf] {
        &self.installed_paths
    }

    /// Returns the expected lowercase hexadecimal canonical package hash.
    #[must_use]
    pub fn package_sha256(&self) -> &str {
        &self.package_sha256
    }

    /// Returns the declared Godot semantic-version requirement.
    #[must_use]
    pub const fn godot(&self) -> &VersionRequirement {
        &self.godot
    }

    /// Returns the optional non-shell headless-validation argument vector.
    #[must_use]
    pub fn headless_validation(&self) -> Option<&[String]> {
        self.headless_validation.as_deref()
    }
}

/// Verifies a fixture against a manually checked-out source tree.
///
/// This function does not fetch from `source_url` and does not execute
/// `headless_validation`.
///
/// # Errors
///
/// Returns a diagnostic when layout detection, tree preparation, the expected
/// package hash, or the expected installed file list differs from the source.
pub fn verify_checked_out_fixture(
    fixture: &CompatibilityFixture,
    source_checkout: &Path,
    staging_root: &Path,
) -> Result<(), Box<Diagnostic>> {
    let layout = detect_package_layout(
        source_checkout,
        &LayoutOptions {
            source_subdirectory: Some(fixture.source_subdirectory.clone()),
            target_path: Some(fixture.target_path.clone()),
        },
    )?;
    let prepared = prepare_package_tree(layout.source_root(), staging_root)?;
    if prepared.sha256() != fixture.package_sha256() {
        return Err(user(
            source_checkout,
            format!(
                "fixture {} expected package hash {} but prepared {}",
                fixture.id(),
                fixture.package_sha256(),
                prepared.sha256()
            ),
            "refresh the fixture only after reviewing the pinned source change",
        ));
    }
    let mut actual_paths = prepared
        .files()
        .iter()
        .map(|file| fixture.target_path.join(file.path()))
        .collect::<Vec<_>>();
    actual_paths.sort();
    if actual_paths != fixture.installed_paths {
        return Err(user(
            source_checkout,
            format!(
                "fixture {} expected {} installed files but prepared {}",
                fixture.id(),
                fixture.installed_paths.len(),
                actual_paths.len()
            ),
            "refresh the fixture only after reviewing the pinned source change",
        ));
    }
    Ok(())
}

fn installed_paths(item: Option<&Item>, path: &Path) -> Result<Vec<PathBuf>, Box<Diagnostic>> {
    let array = item
        .ok_or_else(|| {
            user(
                path,
                "root.installed_paths is required",
                "record every expected installed file",
            )
        })?
        .as_array()
        .ok_or_else(|| {
            user(
                path,
                "root.installed_paths must be an array",
                "use an array of safe relative paths",
            )
        })?;
    let paths = array
        .iter()
        .map(|item| {
            item.as_str().ok_or_else(|| {
                user(
                    path,
                    "root.installed_paths entries must be strings",
                    "use an array of safe relative paths",
                )
            })
        })
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .map(|value| safe_relative_path(value, path, "installed_paths"))
        .collect::<Result<Vec<_>, _>>()?;
    if paths.is_empty() {
        return Err(user(
            path,
            "root.installed_paths must not be empty",
            "record every expected installed file",
        ));
    }
    let unique = paths.iter().collect::<BTreeSet<_>>();
    if unique.len() != paths.len() || paths.windows(2).any(|pair| pair[0] >= pair[1]) {
        return Err(user(
            path,
            "root.installed_paths must be unique and sorted",
            "sort installed paths in ascending order without duplicates",
        ));
    }
    Ok(paths)
}

fn headless_validation(
    item: Option<&Item>,
    path: &Path,
) -> Result<Option<Vec<String>>, Box<Diagnostic>> {
    let Some(item) = item else {
        return Ok(None);
    };
    let array = item.as_array().ok_or_else(|| {
        user(
            path,
            "root.headless_validation must be an array",
            "use an argument vector without shell syntax",
        )
    })?;
    let command = array
        .iter()
        .map(|item| {
            item.as_str().map(str::to_owned).ok_or_else(|| {
                user(
                    path,
                    "root.headless_validation entries must be strings",
                    "use an argument vector without shell syntax",
                )
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    if command.is_empty() || command.iter().any(String::is_empty) {
        return Err(user(
            path,
            "root.headless_validation must contain non-empty arguments",
            "use an argument vector without shell syntax",
        ));
    }
    Ok(Some(command))
}

fn source_url(value: &str, path: &Path) -> Result<String, Box<Diagnostic>> {
    let valid = value
        .strip_prefix("https://")
        .is_some_and(|remainder| !remainder.is_empty())
        && !value.contains(['@', '?', '#']);
    if valid {
        Ok(value.to_owned())
    } else {
        Err(user(
            path,
            "source.url must be a public HTTPS URL without credentials",
            "use an HTTPS Git URL without user information or query parameters",
        ))
    }
}

fn revision(value: &str, path: &Path) -> Result<String, Box<Diagnostic>> {
    if value.len() == 40 && lower_hex(value) {
        Ok(value.to_owned())
    } else {
        Err(user(
            path,
            "source.revision must be a full 40-character Git commit",
            "pin the source to an immutable Git commit",
        ))
    }
}

fn sha256(value: &str, path: &Path) -> Result<String, Box<Diagnostic>> {
    if value.len() == 64 && lower_hex(value) {
        Ok(value.to_owned())
    } else {
        Err(user(
            path,
            "root.package_sha256 must be a 64-character SHA-256 digest",
            "record the canonical package-tree SHA-256 digest",
        ))
    }
}

fn lower_hex(value: &str) -> bool {
    value
        .bytes()
        .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
}

fn safe_relative_path(value: &str, path: &Path, field: &str) -> Result<PathBuf, Box<Diagnostic>> {
    if value.is_empty() {
        return Err(user(
            path,
            format!("{field} must not be empty"),
            "use a safe relative path",
        ));
    }
    let mut normalized = PathBuf::new();
    for component in Path::new(value).components() {
        match component {
            Component::Normal(component) => normalized.push(component),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(user(
                    path,
                    format!("{field} must stay below its root"),
                    "use a safe relative path",
                ));
            }
        }
    }
    if normalized.as_os_str().is_empty() {
        Err(user(
            path,
            format!("{field} must not be empty"),
            "use a safe relative path",
        ))
    } else {
        Ok(normalized)
    }
}

fn table<'a>(
    table: &'a dyn TableLike,
    key: &str,
    path: &Path,
    scope: &str,
) -> Result<&'a dyn TableLike, Box<Diagnostic>> {
    table
        .get(key)
        .ok_or_else(|| {
            user(
                path,
                format!("{scope}.{key} is required"),
                "add the required fixture table",
            )
        })?
        .as_table_like()
        .ok_or_else(|| {
            user(
                path,
                format!("{scope}.{key} must be a table"),
                "use a TOML table",
            )
        })
}

fn string(
    table: &dyn TableLike,
    key: &str,
    path: &Path,
    scope: &str,
) -> Result<String, Box<Diagnostic>> {
    table
        .get(key)
        .ok_or_else(|| {
            user(
                path,
                format!("{scope}.{key} is required"),
                "add the required fixture field",
            )
        })?
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| {
            user(
                path,
                format!("{scope}.{key} must be a string"),
                "use a string value",
            )
        })
}

fn integer(
    table: &dyn TableLike,
    key: &str,
    path: &Path,
    scope: &str,
) -> Result<i64, Box<Diagnostic>> {
    table
        .get(key)
        .ok_or_else(|| {
            user(
                path,
                format!("{scope}.{key} is required"),
                "add the required fixture field",
            )
        })?
        .as_integer()
        .ok_or_else(|| {
            user(
                path,
                format!("{scope}.{key} must be an integer"),
                "use an integer value",
            )
        })
}

fn unknown(
    table: &dyn TableLike,
    allowed: &[&str],
    path: &Path,
    scope: &str,
) -> Result<(), Box<Diagnostic>> {
    if let Some((key, _)) = table.iter().find(|(key, _)| !allowed.contains(key)) {
        Err(user(
            path,
            format!("{scope}.{key} is not supported"),
            "remove unsupported fixture fields",
        ))
    } else {
        Ok(())
    }
}

fn user(path: &Path, message: impl AsRef<str>, recovery: impl AsRef<str>) -> Box<Diagnostic> {
    Box::new(
        Diagnostic::new(ErrorCode::UserInput, message)
            .with_source(path.display().to_string())
            .with_recovery(recovery),
    )
}

fn syntax_error(path: &Path, message: &str, error: impl std::fmt::Display) -> Box<Diagnostic> {
    Box::new(
        Diagnostic::new(ErrorCode::UserInput, message)
            .with_cause(error)
            .with_source(path.display().to_string())
            .with_recovery("fix the fixture syntax and retry"),
    )
}
