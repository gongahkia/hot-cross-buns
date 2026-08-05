//! Typed parsing for package-owned metadata.

use crate::{
    diagnostic::{Diagnostic, ErrorCode, Modification},
    identity::PackageName,
    semantic_version::{SemanticVersion, VersionRequirement},
};
use std::{
    collections::BTreeMap,
    fs::{self, OpenOptions},
    io::{ErrorKind, Write},
    path::{Component, Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};
use toml_edit::{Document, Item, TableLike};

/// The package metadata filename.
pub const PACKAGE_METADATA_FILE_NAME: &str = "wukong-package.toml";
static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);
const TEMP_NAME_ATTEMPTS: u8 = 16;

/// Explicit fields for package metadata initialisation.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct PackageMetadataInitializationOptions {
    name: Option<String>,
    version: Option<String>,
    godot: Option<String>,
    root: Option<String>,
    target: Option<String>,
}

impl PackageMetadataInitializationOptions {
    /// Sets the package name.
    #[must_use]
    pub fn with_name(mut self, name: String) -> Self {
        self.name = Some(name);
        self
    }

    /// Sets the package version.
    #[must_use]
    pub fn with_version(mut self, version: String) -> Self {
        self.version = Some(version);
        self
    }

    /// Sets the Godot compatibility requirement.
    #[must_use]
    pub fn with_godot(mut self, godot: String) -> Self {
        self.godot = Some(godot);
        self
    }

    /// Sets the package-relative source root.
    #[must_use]
    pub fn with_root(mut self, root: String) -> Self {
        self.root = Some(root);
        self
    }

    /// Sets the project-relative materialisation target.
    #[must_use]
    pub fn with_target(mut self, target: String) -> Self {
        self.target = Some(target);
        self
    }
}

/// Metadata created by [`PackageMetadata::initialize`].
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InitializedPackageMetadata {
    path: PathBuf,
    metadata: PackageMetadata,
}

impl InitializedPackageMetadata {
    /// Returns the atomically published metadata path.
    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Returns the metadata that was written and revalidated.
    #[must_use]
    pub const fn metadata(&self) -> &PackageMetadata {
        &self.metadata
    }
}

/// A validated package manifest.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PackageMetadata {
    name: PackageName,
    version: SemanticVersion,
    godot: VersionRequirement,
    root: Option<PathBuf>,
    target: Option<PathBuf>,
    dependencies: BTreeMap<PackageName, VersionRequirement>,
}

impl PackageMetadata {
    /// Creates schema-one metadata without overwriting an existing file.
    ///
    /// The package root must be an existing directory. Omitted fields use the
    /// canonical root-directory name, `0.1.0`, and `>=4.0,<5`; layout fields
    /// remain absent. The generated file is parsed before it is published.
    ///
    /// # Errors
    ///
    /// Returns a user diagnostic for invalid input or an existing metadata file.
    /// I/O failures leave no partially published metadata file.
    pub fn initialize(
        package_root: &Path,
        options: &PackageMetadataInitializationOptions,
    ) -> Result<InitializedPackageMetadata, Box<Diagnostic>> {
        let package_root = canonical_package_root(package_root)?;
        let path = package_root.join(PACKAGE_METADATA_FILE_NAME);
        ensure_absent(&path)?;
        let name = package_name(options.name.as_deref(), &package_root, &path)?;
        let version = package_version(options.version.as_deref(), &path)?;
        let godot = godot_requirement(options.godot.as_deref(), &path)?;
        let root = options
            .root
            .as_deref()
            .map(|root| relative_path(root, &path, "root"))
            .transpose()?;
        let target = options
            .target
            .as_deref()
            .map(|target| relative_path(target, &path, "target"))
            .transpose()?;
        let content = metadata_content(&name, &version, &godot, root.as_deref(), target.as_deref());
        let metadata = Self::parse(&path, &content)?;
        let temporary_path = stage_metadata(&path, content.as_bytes())?;
        publish_metadata(&temporary_path, &path)?;
        Ok(InitializedPackageMetadata { path, metadata })
    }

    /// Reads required metadata from a package root.
    ///
    /// # Errors
    ///
    /// Returns a user diagnostic when metadata is absent or invalid, and a
    /// source-access diagnostic when the existing file cannot be read.
    pub fn load_required(package_root: &Path) -> Result<Self, Box<Diagnostic>> {
        let path = package_root.join(PACKAGE_METADATA_FILE_NAME);
        match fs::read_to_string(&path) {
            Ok(input) => Self::parse(&path, &input),
            Err(error) if error.kind() == ErrorKind::NotFound => Err(user(
                &path,
                "wukong-package.toml is required",
                "add valid package metadata before locking",
            )),
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

    /// Reads metadata when the package supplies it.
    ///
    /// # Errors
    ///
    /// Returns a diagnostic when an existing metadata file cannot be read or
    /// does not satisfy schema one. This helper is for callers that explicitly
    /// allow absence; lock and resolver admission use [`Self::load_required`].
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
        let version = SemanticVersion::parse(&string(package, "version", path, "package")?)
            .map_err(|error| {
                user(
                    path,
                    format!("package.version is invalid: {error}"),
                    "use a semantic version",
                )
            })?;
        let godot = VersionRequirement::parse(&string(package, "godot", path, "package")?)
            .map_err(|error| {
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
    pub const fn version(&self) -> &SemanticVersion {
        &self.version
    }
    #[must_use]
    pub const fn godot(&self) -> &VersionRequirement {
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
    pub const fn dependencies(&self) -> &BTreeMap<PackageName, VersionRequirement> {
        &self.dependencies
    }
}

fn canonical_package_root(package_root: &Path) -> Result<PathBuf, Box<Diagnostic>> {
    let package_root = fs::canonicalize(package_root).map_err(|error| {
        Box::new(
            Diagnostic::new(
                ErrorCode::UserInput,
                format!("could not access package root {}", package_root.display()),
            )
            .with_cause(error)
            .with_source(package_root.display().to_string())
            .with_recovery("provide an existing package directory"),
        )
    })?;
    if package_root.is_dir() {
        Ok(package_root)
    } else {
        Err(Box::new(
            Diagnostic::new(
                ErrorCode::UserInput,
                format!("package root {} is not a directory", package_root.display()),
            )
            .with_source(package_root.display().to_string())
            .with_recovery("provide a package directory"),
        ))
    }
}

fn ensure_absent(path: &Path) -> Result<(), Box<Diagnostic>> {
    match fs::symlink_metadata(path) {
        Ok(_) => Err(user(
            path,
            "wukong-package.toml already exists",
            "edit the existing metadata or choose another package directory",
        )),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(Box::new(
            Diagnostic::new(
                ErrorCode::SourceAccess,
                format!("could not inspect package metadata {}", path.display()),
            )
            .with_cause(error)
            .with_source(path.display().to_string())
            .with_recovery("check package directory permissions and retry"),
        )),
    }
}

fn package_name(
    value: Option<&str>,
    package_root: &Path,
    path: &Path,
) -> Result<PackageName, Box<Diagnostic>> {
    let value = match value {
        Some(value) => value,
        None => package_root
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| {
                user(
                    path,
                    "could not derive a package name from the package directory",
                    "supply --name with a canonical package name",
                )
            })?,
    };
    PackageName::parse(value).map_err(|error| {
        user(
            path,
            format!("package.name {error}"),
            "supply --name using lowercase ASCII letters, digits, and internal hyphens",
        )
    })
}

fn package_version(value: Option<&str>, path: &Path) -> Result<SemanticVersion, Box<Diagnostic>> {
    SemanticVersion::parse(value.unwrap_or("0.1.0")).map_err(|error| {
        user(
            path,
            format!("package.version is invalid: {error}"),
            "supply --version with a complete semantic version",
        )
    })
}

fn godot_requirement(
    value: Option<&str>,
    path: &Path,
) -> Result<VersionRequirement, Box<Diagnostic>> {
    VersionRequirement::parse(value.unwrap_or(">=4.0,<5")).map_err(|error| {
        user(
            path,
            format!("package.godot is invalid: {error}"),
            "supply --godot with a semantic version requirement",
        )
    })
}

fn metadata_content(
    name: &PackageName,
    version: &SemanticVersion,
    godot: &VersionRequirement,
    root: Option<&Path>,
    target: Option<&Path>,
) -> String {
    let mut content = format!(
        "[package]\nschema = 1\nname = \"{}\"\nversion = \"{version}\"\ngodot = \"{}\"\n",
        name.as_str(),
        godot.as_semver(),
    );
    if let Some(root) = root {
        content.push_str(&format!(
            "root = \"{}\"\n",
            escape_toml_string(&root.to_string_lossy())
        ));
    }
    if let Some(target) = target {
        content.push_str(&format!(
            "target = \"{}\"\n",
            escape_toml_string(&target.to_string_lossy())
        ));
    }
    content
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
                use std::fmt::Write as _;
                let _ = write!(escaped, "\\u{:04x}", u32::from(character));
            }
            _ => escaped.push(character),
        }
        escaped
    })
}

fn stage_metadata(metadata_path: &Path, content: &[u8]) -> Result<PathBuf, Box<Diagnostic>> {
    let directory = metadata_path.parent().ok_or_else(|| {
        Box::new(
            Diagnostic::new(
                ErrorCode::InternalFailure,
                "metadata path has no parent directory",
            )
            .with_recovery("provide a package directory and retry"),
        )
    })?;
    for _ in 0..TEMP_NAME_ATTEMPTS {
        let temporary_path = directory.join(format!(
            ".{PACKAGE_METADATA_FILE_NAME}.{}.{}.tmp",
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
                return Err(Box::new(
                    Diagnostic::new(
                        ErrorCode::InternalFailure,
                        format!(
                            "could not stage package metadata in {}",
                            directory.display()
                        ),
                    )
                    .with_cause(error)
                    .with_recovery("check package directory permissions and retry"),
                ));
            }
        };
        let write_result = file.write_all(content).and_then(|()| file.sync_all());
        drop(file);
        if let Err(error) = write_result {
            let _ = fs::remove_file(&temporary_path);
            return Err(Box::new(
                Diagnostic::new(
                    ErrorCode::InternalFailure,
                    format!(
                        "could not write staged package metadata {}",
                        temporary_path.display()
                    ),
                )
                .with_cause(error)
                .with_recovery("check available disk space and retry"),
            ));
        }
        return Ok(temporary_path);
    }
    Err(Box::new(
        Diagnostic::new(
            ErrorCode::InternalFailure,
            format!(
                "could not allocate a temporary package metadata file in {}",
                directory.display()
            ),
        )
        .with_recovery("remove stale temporary wukong files and retry"),
    ))
}

fn publish_metadata(temporary_path: &Path, metadata_path: &Path) -> Result<(), Box<Diagnostic>> {
    match fs::hard_link(temporary_path, metadata_path) {
        Ok(()) => {
            if let Err(error) = fs::remove_file(temporary_path) {
                return Err(Box::new(
                    Diagnostic::new(
                        ErrorCode::InternalFailure,
                        format!(
                            "created {} but could not remove temporary file {}",
                            metadata_path.display(),
                            temporary_path.display()
                        ),
                    )
                    .with_cause(error)
                    .with_modification(Modification::Applied(metadata_path.to_path_buf()))
                    .with_recovery(
                        "remove the temporary file after confirming wukong-package.toml",
                    ),
                ));
            }
            Ok(())
        }
        Err(error) => {
            let _ = fs::remove_file(temporary_path);
            let diagnostic = if error.kind() == ErrorKind::AlreadyExists {
                Diagnostic::new(
                    ErrorCode::UserInput,
                    format!(
                        "package metadata {} already exists",
                        metadata_path.display()
                    ),
                )
                .with_recovery("edit the existing metadata or choose another package directory")
            } else {
                Diagnostic::new(
                    ErrorCode::InternalFailure,
                    format!(
                        "could not publish package metadata {}",
                        metadata_path.display()
                    ),
                )
                .with_cause(error)
                .with_recovery("check filesystem support for hard links and retry")
            };
            Err(Box::new(diagnostic))
        }
    }
}

fn dependencies(
    item: Option<&Item>,
    path: &Path,
) -> Result<BTreeMap<PackageName, VersionRequirement>, Box<Diagnostic>> {
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
        let requirement = VersionRequirement::parse(value).map_err(|error| {
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
