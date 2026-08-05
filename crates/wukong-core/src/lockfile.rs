//! Deterministic schema-one and schema-two `wukong.lock` parsing and serialization.

use crate::{
    diagnostic::{Diagnostic, ErrorCode},
    git_source::canonicalize_git_url,
    http_archive::canonicalize_archive_url,
    identity::PackageName,
    manifest::GitReference,
    semantic_version::{SemanticVersion, VersionRequirement},
    source::ImmutableSourceId,
};
use std::{
    collections::{BTreeMap, BTreeSet},
    fmt::Write as _,
    path::{Component, Path, PathBuf},
};
use toml_edit::{Document, Item, TableLike};

/// The lockfile filename.
pub const LOCKFILE_FILE_NAME: &str = "wukong.lock";
/// The schema written for new lockfiles.
pub const LOCKFILE_SCHEMA: i64 = 2;
const LEGACY_LOCKFILE_SCHEMA: i64 = 1;

/// A package's declared Godot compatibility.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum GodotCompatibility {
    Unknown,
    Requirement(VersionRequirement),
}

/// A local source resolved to immutable content.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LockedLocalSource {
    immutable_id: ImmutableSourceId,
    sha256: String,
    extensions: BTreeMap<String, String>,
}
impl LockedLocalSource {
    /// Creates a local immutable source record.
    ///
    /// # Errors
    ///
    /// Returns a diagnostic when the checksum or identity is invalid.
    pub fn new(immutable_id: ImmutableSourceId, sha256: String) -> Result<Self, Box<Diagnostic>> {
        valid_hex(&sha256, 64, Path::new(LOCKFILE_FILE_NAME), "source.sha256")?;
        if immutable_id.as_str() != format!("sha256:{sha256}") {
            return Err(user(
                Path::new(LOCKFILE_FILE_NAME),
                "source.immutable_id must match source.sha256",
                "use sha256:<source checksum>",
            ));
        }
        Ok(Self {
            immutable_id,
            sha256,
            extensions: BTreeMap::new(),
        })
    }
    /// Returns the immutable source identity.
    #[must_use]
    pub fn immutable_id(&self) -> &ImmutableSourceId {
        &self.immutable_id
    }
    /// Returns the source checksum.
    #[must_use]
    pub fn sha256(&self) -> &str {
        &self.sha256
    }
}

/// A Git source resolved to one complete immutable commit.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LockedGitSource {
    immutable_id: ImmutableSourceId,
    url: String,
    commit: String,
    extensions: BTreeMap<String, String>,
}
impl LockedGitSource {
    /// Creates a canonical Git source record pinned to an exact commit.
    ///
    /// # Errors
    ///
    /// Returns a diagnostic when the URL, commit, or immutable identity is invalid.
    pub fn new(
        immutable_id: ImmutableSourceId,
        url: &str,
        commit: String,
    ) -> Result<Self, Box<Diagnostic>> {
        GitReference::Rev(commit.clone())
            .validate()
            .map_err(|error| {
                user(
                    Path::new(LOCKFILE_FILE_NAME),
                    format!("source.commit {error}"),
                    "use a complete Git commit ID",
                )
            })?;
        if immutable_id.as_str() != format!("git:{commit}") {
            return Err(user(
                Path::new(LOCKFILE_FILE_NAME),
                "source.immutable_id must match source.commit",
                "use git:<complete commit>",
            ));
        }
        let url = canonicalize_git_url(url)
            .map_err(|error| {
                user(
                    Path::new(LOCKFILE_FILE_NAME),
                    error.message(),
                    "use a safe Git URL",
                )
            })?
            .as_str()
            .to_owned();
        Ok(Self {
            immutable_id,
            url,
            commit,
            extensions: BTreeMap::new(),
        })
    }
    /// Returns the canonical credential-free repository URL.
    #[must_use]
    pub fn url(&self) -> &str {
        &self.url
    }
    /// Returns the complete resolved Git commit ID.
    #[must_use]
    pub fn commit(&self) -> &str {
        &self.commit
    }
}

/// An HTTPS archive source pinned by checksum.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LockedHttpSource {
    immutable_id: ImmutableSourceId,
    url: String,
    sha256: String,
    extensions: BTreeMap<String, String>,
}
impl LockedHttpSource {
    /// Creates a canonical HTTPS archive source record.
    ///
    /// # Errors
    ///
    /// Returns a diagnostic when the URL, checksum, or immutable identity is invalid.
    pub fn new(
        immutable_id: ImmutableSourceId,
        url: &str,
        sha256: String,
    ) -> Result<Self, Box<Diagnostic>> {
        valid_hex(&sha256, 64, Path::new(LOCKFILE_FILE_NAME), "source.sha256")?;
        if immutable_id.as_str() != format!("sha256:{sha256}") {
            return Err(user(
                Path::new(LOCKFILE_FILE_NAME),
                "source.immutable_id must match source.sha256",
                "use sha256:<source checksum>",
            ));
        }
        let url = canonicalize_archive_url(url).map_err(|error| {
            user(
                Path::new(LOCKFILE_FILE_NAME),
                error.message(),
                "use a safe HTTPS archive URL",
            )
        })?;
        Ok(Self {
            immutable_id,
            url,
            sha256,
            extensions: BTreeMap::new(),
        })
    }
    /// Returns the canonical credential-free HTTPS archive URL.
    #[must_use]
    pub fn url(&self) -> &str {
        &self.url
    }
    /// Returns the required archive SHA-256 checksum.
    #[must_use]
    pub fn sha256(&self) -> &str {
        &self.sha256
    }
}

/// An immutable source representation supported by the lockfile schema.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum LockedSource {
    /// A local content snapshot.
    Local(LockedLocalSource),
    /// A Git checkout pinned to one complete commit.
    Git(LockedGitSource),
    /// A checksum-verified HTTPS archive.
    Http(LockedHttpSource),
}
impl LockedSource {
    /// Returns the immutable identity shared by every source kind.
    #[must_use]
    pub fn immutable_id(&self) -> &ImmutableSourceId {
        match self {
            Self::Local(source) => source.immutable_id(),
            Self::Git(source) => &source.immutable_id,
            Self::Http(source) => &source.immutable_id,
        }
    }
}
impl From<LockedLocalSource> for LockedSource {
    fn from(source: LockedLocalSource) -> Self {
        Self::Local(source)
    }
}
impl From<LockedGitSource> for LockedSource {
    fn from(source: LockedGitSource) -> Self {
        Self::Git(source)
    }
}
impl From<LockedHttpSource> for LockedSource {
    fn from(source: LockedHttpSource) -> Self {
        Self::Http(source)
    }
}

/// A resolved package entry.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LockedPackage {
    name: PackageName,
    version: Option<SemanticVersion>,
    source: LockedSource,
    package_sha256: String,
    declaration_sha256: String,
    dependencies: BTreeSet<PackageName>,
    source_subdirectory: PathBuf,
    target_path: PathBuf,
    godot: GodotCompatibility,
    development: bool,
    extensions: BTreeMap<String, String>,
}
impl LockedPackage {
    /// Creates a package entry with an immutable source.
    #[allow(clippy::too_many_arguments)]
    #[allow(clippy::needless_pass_by_value)]
    ///
    /// # Errors
    ///
    /// Returns a diagnostic when checksums or paths are invalid.
    pub fn new(
        name: PackageName,
        version: Option<SemanticVersion>,
        source: impl Into<LockedSource>,
        package_sha256: String,
        declaration_sha256: String,
        dependencies: BTreeSet<PackageName>,
        source_subdirectory: PathBuf,
        target_path: PathBuf,
        godot: GodotCompatibility,
        development: bool,
    ) -> Result<Self, Box<Diagnostic>> {
        let path = Path::new(LOCKFILE_FILE_NAME);
        valid_hex(&package_sha256, 64, path, "package_sha256")?;
        valid_hex(&declaration_sha256, 64, path, "declaration_sha256")?;
        let source_subdirectory =
            safe_path(&source_subdirectory, true, path, "source_subdirectory")?;
        let target_path = safe_path(&target_path, false, path, "target_path")?;
        Ok(Self {
            name,
            version,
            source: source.into(),
            package_sha256,
            declaration_sha256,
            dependencies,
            source_subdirectory,
            target_path,
            godot,
            development,
            extensions: BTreeMap::new(),
        })
    }
    #[must_use]
    pub fn name(&self) -> &PackageName {
        &self.name
    }
    #[must_use]
    pub fn version(&self) -> Option<&SemanticVersion> {
        self.version.as_ref()
    }
    #[must_use]
    pub fn source(&self) -> &LockedSource {
        &self.source
    }
    #[must_use]
    pub fn package_sha256(&self) -> &str {
        &self.package_sha256
    }
    /// Returns the direct-declaration fingerprint used for safe reuse.
    #[must_use]
    pub fn declaration_sha256(&self) -> &str {
        &self.declaration_sha256
    }
    #[must_use]
    pub fn dependencies(&self) -> &BTreeSet<PackageName> {
        &self.dependencies
    }
    #[must_use]
    pub fn source_subdirectory(&self) -> &Path {
        &self.source_subdirectory
    }
    #[must_use]
    pub fn target_path(&self) -> &Path {
        &self.target_path
    }
    #[must_use]
    pub const fn godot(&self) -> &GodotCompatibility {
        &self.godot
    }
    #[must_use]
    pub const fn development(&self) -> bool {
        self.development
    }
}

/// A complete deterministic lockfile.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Lockfile {
    schema: i64,
    packages: BTreeMap<PackageName, LockedPackage>,
    extensions: BTreeMap<String, String>,
}
impl Lockfile {
    /// Creates a lockfile, rejecting duplicate package names.
    ///
    /// # Errors
    ///
    /// Returns a diagnostic when package names are duplicated.
    pub fn new(packages: impl IntoIterator<Item = LockedPackage>) -> Result<Self, Box<Diagnostic>> {
        let mut entries = BTreeMap::new();
        for package in packages {
            if entries.insert(package.name.clone(), package).is_some() {
                return Err(user(
                    Path::new(LOCKFILE_FILE_NAME),
                    "lockfile contains a duplicate package name",
                    "retain one resolved entry per package",
                ));
            }
        }
        Ok(Self {
            schema: LOCKFILE_SCHEMA,
            packages: entries,
            extensions: BTreeMap::new(),
        })
    }
    /// Parses a supported lockfile schema.
    ///
    /// # Errors
    ///
    /// Returns a diagnostic for invalid or unsupported lockfile data.
    pub fn parse(path: &Path, input: &str) -> Result<Self, Box<Diagnostic>> {
        let doc = Document::parse(input.to_owned()).map_err(|e| syntax(path, e))?;
        let root = doc.as_table();
        let extensions = extensions(root, &["schema", "package"], path, "root")?;
        let schema = integer(root, "schema", path, "root")?;
        if !matches!(schema, LEGACY_LOCKFILE_SCHEMA | LOCKFILE_SCHEMA) {
            return Err(user(
                path,
                "lockfile.schema is not supported",
                "regenerate with a supported wukong version",
            ));
        }
        let packages = root
            .get("package")
            .map(|item| {
                item.as_array_of_tables().ok_or_else(|| {
                    user(
                        path,
                        "root.package must be an array of tables",
                        "use [[package]] entries",
                    )
                })
            })
            .transpose()?
            .map(|tables| {
                tables
                    .iter()
                    .map(|table| parse_package(table, path, schema))
                    .collect::<Result<Vec<_>, _>>()
            })
            .transpose()?
            .unwrap_or_default();
        let mut lock = Self::new(packages)?;
        lock.schema = schema;
        lock.extensions = extensions;
        Ok(lock)
    }
    /// Returns the parsed or generated lockfile schema.
    #[must_use]
    pub const fn schema(&self) -> i64 {
        self.schema
    }
    /// Returns packages in canonical name order.
    #[must_use]
    pub fn packages(&self) -> &BTreeMap<PackageName, LockedPackage> {
        &self.packages
    }
    /// Serializes canonical TOML for the lockfile's schema.
    #[must_use]
    pub fn to_toml(&self) -> String {
        let mut out = format!("schema = {}\n", self.schema);
        for (key, value) in &self.extensions {
            line(&mut out, key, value);
        }
        for package in self.packages.values() {
            out.push_str("\n[[package]]\n");
            line(&mut out, "name", package.name.as_str());
            if let Some(version) = &package.version {
                line(&mut out, "version", version.to_string());
            }
            array(
                &mut out,
                "dependencies",
                package.dependencies.iter().map(PackageName::as_str),
            );
            line(
                &mut out,
                "source_subdirectory",
                path_string(&package.source_subdirectory),
            );
            line(&mut out, "target_path", path_string(&package.target_path));
            line(
                &mut out,
                "godot",
                match &package.godot {
                    GodotCompatibility::Unknown => "unknown".to_owned(),
                    GodotCompatibility::Requirement(req) => req.to_string(),
                },
            );
            out.push_str(if package.development {
                "development = true\n"
            } else {
                "development = false\n"
            });
            line(&mut out, "package_sha256", &package.package_sha256);
            line(&mut out, "declaration_sha256", &package.declaration_sha256);
            for (key, value) in &package.extensions {
                line(&mut out, key, value);
            }
            out.push_str("\n[package.source]\n");
            match &package.source {
                LockedSource::Local(source) => {
                    line(&mut out, "kind", "local");
                    line(&mut out, "immutable_id", source.immutable_id.as_str());
                    line(&mut out, "sha256", &source.sha256);
                    for (key, value) in &source.extensions {
                        line(&mut out, key, value);
                    }
                }
                LockedSource::Git(source) => {
                    line(&mut out, "kind", "git");
                    line(&mut out, "immutable_id", source.immutable_id.as_str());
                    line(&mut out, "url", &source.url);
                    line(&mut out, "commit", &source.commit);
                    for (key, value) in &source.extensions {
                        line(&mut out, key, value);
                    }
                }
                LockedSource::Http(source) => {
                    line(&mut out, "kind", "http");
                    line(&mut out, "immutable_id", source.immutable_id.as_str());
                    line(&mut out, "url", &source.url);
                    line(&mut out, "sha256", &source.sha256);
                    for (key, value) in &source.extensions {
                        line(&mut out, key, value);
                    }
                }
            }
        }
        out
    }
}

#[allow(clippy::too_many_lines)]
fn parse_package(
    package_table: &dyn TableLike,
    path: &Path,
    schema: i64,
) -> Result<LockedPackage, Box<Diagnostic>> {
    let package_extensions = extensions(
        package_table,
        &[
            "name",
            "version",
            "dependencies",
            "source_subdirectory",
            "target_path",
            "godot",
            "development",
            "package_sha256",
            "declaration_sha256",
            "source",
        ],
        path,
        "package",
    )?;
    let name =
        PackageName::parse(&string(package_table, "name", path, "package")?).map_err(|e| {
            user(
                path,
                format!("package.name {e}"),
                "use a canonical package name",
            )
        })?;
    let version = package_table
        .get("version")
        .map(|item| {
            SemanticVersion::parse(item.as_str().ok_or_else(|| {
                user(
                    path,
                    "package.version must be a string",
                    "use semantic version text",
                )
            })?)
            .map_err(|e| {
                user(
                    path,
                    format!("package.version is invalid: {e}"),
                    "use a semantic version",
                )
            })
        })
        .transpose()?;
    let dependencies = dependencies(package_table.get("dependencies"), path)?;
    let source_subdirectory = safe_path(
        Path::new(&string(
            package_table,
            "source_subdirectory",
            path,
            "package",
        )?),
        true,
        path,
        "package.source_subdirectory",
    )?;
    let target_path = safe_path(
        Path::new(&string(package_table, "target_path", path, "package")?),
        false,
        path,
        "package.target_path",
    )?;
    let godot_raw = string(package_table, "godot", path, "package")?;
    let godot = if godot_raw == "unknown" {
        GodotCompatibility::Unknown
    } else {
        GodotCompatibility::Requirement(VersionRequirement::parse(&godot_raw).map_err(|e| {
            user(
                path,
                format!("package.godot is invalid: {e}"),
                "use a semantic version requirement or unknown",
            )
        })?)
    };
    let development = package_table
        .get("development")
        .and_then(Item::as_bool)
        .ok_or_else(|| {
            user(
                path,
                "package.development must be a boolean",
                "set development to true or false",
            )
        })?;
    let package_sha256 = string(package_table, "package_sha256", path, "package")?;
    valid_hex(&package_sha256, 64, path, "package.package_sha256")?;
    let declaration_sha256 = string(package_table, "declaration_sha256", path, "package")?;
    valid_hex(&declaration_sha256, 64, path, "package.declaration_sha256")?;
    let source_table = table(package_table, "source", path, "package")?;
    let source = parse_source(source_table, path, schema)?;
    let mut package = LockedPackage::new(
        name,
        version,
        source,
        package_sha256,
        declaration_sha256,
        dependencies,
        source_subdirectory,
        target_path,
        godot,
        development,
    )?;
    package.extensions = package_extensions;
    Ok(package)
}
fn parse_source(
    table: &dyn TableLike,
    path: &Path,
    schema: i64,
) -> Result<LockedSource, Box<Diagnostic>> {
    let kind = string(table, "kind", path, "package.source")?;
    if schema == LEGACY_LOCKFILE_SCHEMA && kind != "local" {
        return Err(user(
            path,
            "package.source.kind must be local in schema one",
            "regenerate this lockfile with schema two",
        ));
    }
    match kind.as_str() {
        "local" => {
            let extensions = extensions(
                table,
                &["kind", "immutable_id", "sha256"],
                path,
                "package.source",
            )?;
            let immutable = source_immutable(table, path, "use sha256:<source checksum>")?;
            let mut source = LockedLocalSource::new(
                immutable,
                string(table, "sha256", path, "package.source")?,
            )?;
            source.extensions = extensions;
            Ok(source.into())
        }
        "git" => {
            let extensions = extensions(
                table,
                &["kind", "immutable_id", "url", "commit"],
                path,
                "package.source",
            )?;
            let immutable = source_immutable(table, path, "use git:<complete commit>")?;
            let url = string(table, "url", path, "package.source")?;
            let mut source = LockedGitSource::new(
                immutable,
                &url,
                string(table, "commit", path, "package.source")?,
            )?;
            source.extensions = extensions;
            Ok(source.into())
        }
        "http" => {
            let extensions = extensions(
                table,
                &["kind", "immutable_id", "url", "sha256"],
                path,
                "package.source",
            )?;
            let immutable = source_immutable(table, path, "use sha256:<source checksum>")?;
            let url = string(table, "url", path, "package.source")?;
            let mut source = LockedHttpSource::new(
                immutable,
                &url,
                string(table, "sha256", path, "package.source")?,
            )?;
            source.extensions = extensions;
            Ok(source.into())
        }
        _ => Err(user(
            path,
            "package.source.kind is not supported",
            "use local, git, or http in schema two",
        )),
    }
}
fn source_immutable(
    table: &dyn TableLike,
    path: &Path,
    recovery: &str,
) -> Result<ImmutableSourceId, Box<Diagnostic>> {
    ImmutableSourceId::new(string(table, "immutable_id", path, "package.source")?)
        .map_err(|error| user(path, error.to_string(), recovery))
}
fn dependencies(
    item: Option<&Item>,
    path: &Path,
) -> Result<BTreeSet<PackageName>, Box<Diagnostic>> {
    let array = item.and_then(Item::as_array).ok_or_else(|| {
        user(
            path,
            "package.dependencies must be an array",
            "use a sorted dependency array",
        )
    })?;
    let mut out = BTreeSet::new();
    for item in array {
        let value = item.as_str().ok_or_else(|| {
            user(
                path,
                "package.dependencies entries must be strings",
                "use canonical package names",
            )
        })?;
        let name = PackageName::parse(value).map_err(|e| {
            user(
                path,
                format!("package.dependencies {e}"),
                "use canonical package names",
            )
        })?;
        if !out.insert(name) {
            return Err(user(
                path,
                "package.dependencies must not contain duplicates",
                "remove duplicate dependencies",
            ));
        }
    }
    if array.len() != out.len()
        || !array
            .iter()
            .filter_map(|value| value.as_str())
            .collect::<Vec<_>>()
            .windows(2)
            .all(|pair| pair[0] < pair[1])
    {
        return Err(user(
            path,
            "package.dependencies must be sorted",
            "sort dependency names ascending",
        ));
    }
    Ok(out)
}
fn extensions(
    table: &dyn TableLike,
    known: &[&str],
    path: &Path,
    scope: &str,
) -> Result<BTreeMap<String, String>, Box<Diagnostic>> {
    let mut out = BTreeMap::new();
    for (key, item) in table.iter() {
        if known.contains(&key) {
            continue;
        }
        if !key.starts_with("x-") || !valid_extension(key) {
            return Err(user(
                path,
                format!("{scope}.{key} is not supported"),
                "remove it or use a supported x- extension",
            ));
        }
        let value = item.as_str().ok_or_else(|| {
            user(
                path,
                format!("{scope}.{key} must be a string"),
                "use a string x- extension value",
            )
        })?;
        out.insert(key.to_owned(), value.to_owned());
    }
    Ok(out)
}
fn valid_extension(value: &str) -> bool {
    value.len() > 2
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}
fn safe_path(
    value: &Path,
    allow_root: bool,
    path: &Path,
    field: &str,
) -> Result<PathBuf, Box<Diagnostic>> {
    if allow_root && value == Path::new(".") {
        return Ok(PathBuf::from("."));
    }
    let mut out = PathBuf::new();
    for component in value.components() {
        match component {
            Component::Normal(v) => out.push(v),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(user(
                    path,
                    format!("{field} must be a safe relative path"),
                    "use a path below the package root",
                ));
            }
        }
    }
    if out.as_os_str().is_empty() {
        Err(user(
            path,
            format!("{field} must not be empty"),
            "use a safe relative path",
        ))
    } else {
        Ok(out)
    }
}
fn valid_hex(value: &str, length: usize, path: &Path, field: &str) -> Result<(), Box<Diagnostic>> {
    if value.len() == length
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
    {
        Ok(())
    } else {
        Err(user(
            path,
            format!("{field} must be a lowercase SHA-256 digest"),
            "use lowercase hexadecimal",
        ))
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
                "add the required table",
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
                "add the required field",
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
        .ok_or_else(|| user(path, format!("{scope}.{key} is required"), "add schema"))?
        .as_integer()
        .ok_or_else(|| {
            user(
                path,
                format!("{scope}.{key} must be an integer"),
                "use an integer",
            )
        })
}
fn user(path: &Path, message: impl AsRef<str>, recovery: impl AsRef<str>) -> Box<Diagnostic> {
    Box::new(
        Diagnostic::new(ErrorCode::UserInput, message)
            .with_source(path.display().to_string())
            .with_recovery(recovery),
    )
}
fn syntax(path: &Path, error: impl std::fmt::Display) -> Box<Diagnostic> {
    Box::new(
        Diagnostic::new(ErrorCode::UserInput, "invalid wukong.lock syntax")
            .with_cause(error)
            .with_source(path.display().to_string())
            .with_recovery("fix lockfile syntax and retry"),
    )
}
fn path_string(path: &Path) -> String {
    if path == Path::new(".") {
        ".".to_owned()
    } else {
        path.to_string_lossy().replace('\\', "/")
    }
}
fn line(out: &mut String, key: &str, value: impl AsRef<str>) {
    out.push_str(key);
    out.push_str(" = ");
    out.push_str(&quote(value.as_ref()));
    out.push('\n');
}
fn array<'a>(out: &mut String, key: &str, values: impl IntoIterator<Item = &'a str>) {
    out.push_str(key);
    out.push_str(" = [");
    let mut first = true;
    for value in values {
        if !first {
            out.push_str(", ");
        }
        out.push_str(&quote(value));
        first = false;
    }
    out.push_str("]\n");
}
fn quote(value: &str) -> String {
    let mut out = String::from("\"");
    for character in value.chars() {
        match character {
            '\\' => out.push_str("\\\\"),
            '\"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if c < ' ' => {
                let _ = write!(out, "\\u{:04x}", c as u32);
            }
            c => out.push(c),
        }
    }
    out.push('\"');
    out
}
