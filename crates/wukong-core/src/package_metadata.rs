//! Typed parsing for optional package-owned metadata.

use crate::{
    diagnostic::{Diagnostic, ErrorCode},
    identity::PackageName,
};
use semver::{Version, VersionReq};
use std::{
    collections::BTreeMap,
    fs,
    io::ErrorKind,
    path::{Component, Path, PathBuf},
};
use toml_edit::{Document, Item, TableLike};

/// The optional package metadata filename.
pub const PACKAGE_METADATA_FILE_NAME: &str = "wukong-package.toml";

/// A validated optional package manifest.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PackageMetadata {
    name: PackageName,
    version: Version,
    godot: VersionReq,
    root: Option<PathBuf>,
    target: Option<PathBuf>,
    dependencies: BTreeMap<PackageName, VersionReq>,
}

impl PackageMetadata {
    /// Reads metadata when the package supplies it.
    ///
    /// # Errors
    ///
    /// Returns a diagnostic when an existing metadata file cannot be read or
    /// does not satisfy schema one. A missing file is valid for direct package
    /// installation and returns `Ok(None)`.
    pub fn load_optional(package_root: &Path) -> Result<Option<Self>, Box<Diagnostic>> {
        let path = package_root.join(PACKAGE_METADATA_FILE_NAME);
        match fs::read_to_string(&path) {
            Ok(input) => Self::parse(&path, &input).map(Some),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
            Err(error) => Err(Box::new(
                Diagnostic::new(
                    ErrorCode::SourceAccess,
                    format!("could not read package metadata {}", path.display()),
                )
                .with_cause(error)
                .with_source(path.display().to_string())
                .with_recovery("check that the metadata file is readable"),
            )),
        }
    }

    /// Parses metadata at `path`.
    ///
    /// # Errors
    ///
    /// Returns a user diagnostic for invalid schema-one metadata.
    pub fn parse(path: &Path, input: &str) -> Result<Self, Box<Diagnostic>> {
        let document = Document::parse(input.to_owned())
            .map_err(|error| diag(path, "invalid wukong-package.toml syntax", error))?;
        let root = document.as_table();
        unknown(root, &["package", "dependencies"], path, "root")?;
        let package = table(root, "package", path, "root")?;
        unknown(
            package,
            &["schema", "name", "version", "godot", "root", "target"],
            path,
            "package",
        )?;
        let schema = integer(package, "schema", path, "package")?;
        if schema != 1 {
            return Err(user(
                path,
                "package.schema must be 1",
                "use the supported metadata schema",
            ));
        }
        let name_raw = string(package, "name", path, "package")?;
        let name = PackageName::parse(&name_raw).map_err(|error| {
            user(
                path,
                format!("package.name {error}"),
                "use a canonical package name",
            )
        })?;
        let version =
            Version::parse(&string(package, "version", path, "package")?).map_err(|error| {
                user(
                    path,
                    format!("package.version is invalid: {error}"),
                    "use a semantic version",
                )
            })?;
        let godot =
            VersionReq::parse(&string(package, "godot", path, "package")?).map_err(|error| {
                user(
                    path,
                    format!("package.godot is invalid: {error}"),
                    "use a semantic version requirement",
                )
            })?;
        let root_path = optional_path(package, "root", path)?;
        let target = optional_path(package, "target", path)?;
        let dependencies = dependencies(root.get("dependencies"), path)?;
        Ok(Self {
            name,
            version,
            godot,
            root: root_path,
            target,
            dependencies,
        })
    }
    #[must_use]
    pub const fn name(&self) -> &PackageName {
        &self.name
    }
    #[must_use]
    pub const fn version(&self) -> &Version {
        &self.version
    }
    #[must_use]
    pub const fn godot(&self) -> &VersionReq {
        &self.godot
    }
    #[must_use]
    pub fn root(&self) -> Option<&Path> {
        self.root.as_deref()
    }
    #[must_use]
    pub fn target(&self) -> Option<&Path> {
        self.target.as_deref()
    }
    #[must_use]
    pub const fn dependencies(&self) -> &BTreeMap<PackageName, VersionReq> {
        &self.dependencies
    }
}

fn dependencies(
    item: Option<&Item>,
    path: &Path,
) -> Result<BTreeMap<PackageName, VersionReq>, Box<Diagnostic>> {
    let Some(item) = item else {
        return Ok(BTreeMap::new());
    };
    let table = item
        .as_table()
        .ok_or_else(|| user(path, "dependencies must be a table", "use [dependencies]"))?;
    let mut dependencies = BTreeMap::new();
    for (name, item) in table {
        let name = PackageName::parse(name).map_err(|error| {
            user(
                path,
                format!("dependency name {error}"),
                "use a canonical package name",
            )
        })?;
        let value = item.as_str().ok_or_else(|| {
            user(
                path,
                "dependency requirement must be a string",
                "use a semantic version requirement",
            )
        })?;
        let requirement = VersionReq::parse(value).map_err(|error| {
            user(
                path,
                format!("dependency {} is invalid: {error}", name.as_str()),
                "use a semantic version requirement",
            )
        })?;
        dependencies.insert(name, requirement);
    }
    Ok(dependencies)
}

fn optional_path(
    table: &dyn TableLike,
    key: &str,
    path: &Path,
) -> Result<Option<PathBuf>, Box<Diagnostic>> {
    table
        .get(key)
        .map(|item| {
            item.as_str()
                .ok_or_else(|| {
                    user(
                        path,
                        format!("package.{key} must be a string"),
                        "use a safe relative path",
                    )
                })
                .and_then(|value| relative_path(value, path, key))
        })
        .transpose()
}
fn relative_path(value: &str, path: &Path, field: &str) -> Result<PathBuf, Box<Diagnostic>> {
    let raw = Path::new(value);
    let mut out = PathBuf::new();
    if value.is_empty() {
        return Err(user(
            path,
            format!("package.{field} must not be empty"),
            "use a safe relative path",
        ));
    }
    for component in raw.components() {
        match component {
            Component::Normal(value) => out.push(value),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(user(
                    path,
                    format!("package.{field} must stay below the package root"),
                    "use a safe relative path",
                ));
            }
        }
    }
    if out.as_os_str().is_empty() {
        Err(user(
            path,
            format!("package.{field} must not be empty"),
            "use a safe relative path",
        ))
    } else {
        Ok(out)
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
                "add the required metadata table",
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
                "add the required metadata field",
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
                "add the required metadata field",
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
            "remove unsupported metadata fields",
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
fn diag(path: &Path, message: &str, error: impl std::fmt::Display) -> Box<Diagnostic> {
    Box::new(
        Diagnostic::new(ErrorCode::UserInput, message)
            .with_cause(error)
            .with_source(path.display().to_string())
            .with_recovery("fix the metadata syntax and retry"),
    )
}
