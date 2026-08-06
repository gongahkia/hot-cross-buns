//! Deterministic package lockfiles with schema-four managed Godot toolchains.

use crate::{
    diagnostic::{Diagnostic, ErrorCode},
    git_source::canonicalize_git_url,
    http_archive::canonicalize_archive_url,
    identity::PackageName,
    managed_godot::{
        GodotFlavor, GodotPlatform, official_editor_asset_name, official_release_asset_url,
        official_template_asset_name,
    },
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
/// The schema written for validated catalog-selected dependency graphs.
pub const CATALOG_GRAPH_LOCKFILE_SCHEMA: i64 = 3;
/// The schema written when a lockfile records an exact managed Godot toolchain.
pub const TOOLCHAIN_LOCKFILE_SCHEMA: i64 = 4;

/// One immutable official Godot release artifact recorded in a project lock.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LockedGodotArtifact {
    name: String,
    url: String,
    sha512: String,
    bytes: u64,
}

impl LockedGodotArtifact {
    /// Creates a validated official Godot artifact record.
    ///
    /// # Errors
    ///
    /// Returns a diagnostic when the artifact is not a safe official HTTPS
    /// download, does not have a SHA-512 checksum, or has no byte size.
    pub fn new(
        name: String,
        url: String,
        sha512: String,
        bytes: u64,
    ) -> Result<Self, Box<Diagnostic>> {
        validate_locked_godot_artifact(&name, &url, &sha512, bytes)?;
        Ok(Self {
            name,
            url,
            sha512,
            bytes,
        })
    }

    /// Returns the official release asset name.
    #[must_use]
    pub fn name(&self) -> &str {
        &self.name
    }

    /// Returns the official HTTPS source URL.
    #[must_use]
    pub fn url(&self) -> &str {
        &self.url
    }

    /// Returns the expected SHA-512 checksum.
    #[must_use]
    pub fn sha512(&self) -> &str {
        &self.sha512
    }

    /// Returns the exact release-declared byte size.
    #[must_use]
    pub const fn bytes(&self) -> u64 {
        self.bytes
    }
}

/// An exact official Godot toolchain selected for a project lockfile.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LockedGodotToolchain {
    version: SemanticVersion,
    flavor: GodotFlavor,
    release: String,
    editors: BTreeMap<GodotPlatform, LockedGodotArtifact>,
    templates: LockedGodotArtifact,
}

impl LockedGodotToolchain {
    /// Creates a complete toolchain selection with deterministically ordered targets.
    ///
    /// # Errors
    ///
    /// Returns a diagnostic for an incomplete version, mismatched release tag,
    /// absent editor target, or invalid artifact identity.
    pub fn new(
        version: SemanticVersion,
        flavor: GodotFlavor,
        release: String,
        editors: impl IntoIterator<Item = (GodotPlatform, LockedGodotArtifact)>,
        templates: LockedGodotArtifact,
    ) -> Result<Self, Box<Diagnostic>> {
        if version.is_prerelease() || !version.as_semver().build.is_empty() {
            return Err(user(
                Path::new(LOCKFILE_FILE_NAME),
                "toolchain.version must be one exact stable semantic version",
                "use a version such as 4.4.1",
            ));
        }
        if release != format!("{version}-stable") {
            return Err(user(
                Path::new(LOCKFILE_FILE_NAME),
                "toolchain.release must match toolchain.version",
                "use the official x.y.z-stable release tag",
            ));
        }
        let mut ordered = BTreeMap::new();
        for (platform, artifact) in editors {
            if ordered.insert(platform, artifact).is_some() {
                return Err(user(
                    Path::new(LOCKFILE_FILE_NAME),
                    "toolchain.editor contains a duplicate platform",
                    "retain one official editor artifact per platform",
                ));
            }
        }
        let expected_platforms = [
            GodotPlatform::MacosUniversal,
            GodotPlatform::LinuxX86_64,
            GodotPlatform::LinuxArm64,
            GodotPlatform::WindowsX86_64,
        ];
        for platform in expected_platforms {
            let Some(artifact) = ordered.get(&platform) else {
                return Err(user(
                    Path::new(LOCKFILE_FILE_NAME),
                    format!("toolchain.editor is missing required {platform} artifact"),
                    "regenerate the lockfile with a supported Wukong version",
                ));
            };
            validate_toolchain_artifact_identity(
                artifact,
                &release,
                &official_editor_asset_name(&version, flavor, platform),
            )?;
        }
        validate_toolchain_artifact_identity(
            &templates,
            &release,
            &official_template_asset_name(&version, flavor),
        )?;
        if ordered.len() != expected_platforms.len() {
            return Err(user(
                Path::new(LOCKFILE_FILE_NAME),
                "toolchain.editor contains an unsupported platform",
                "regenerate the lockfile with supported desktop artifacts",
            ));
        }
        Ok(Self {
            version,
            flavor,
            release,
            editors: ordered,
            templates,
        })
    }

    /// Returns the exact stable version.
    #[must_use]
    pub const fn version(&self) -> &SemanticVersion {
        &self.version
    }

    /// Returns the selected editor family.
    #[must_use]
    pub const fn flavor(&self) -> GodotFlavor {
        self.flavor
    }

    /// Returns the official release tag.
    #[must_use]
    pub fn release(&self) -> &str {
        &self.release
    }

    /// Returns editor artifacts in canonical target order.
    #[must_use]
    pub fn editors(&self) -> &BTreeMap<GodotPlatform, LockedGodotArtifact> {
        &self.editors
    }

    /// Returns the matching export-template artifact.
    #[must_use]
    pub const fn templates(&self) -> &LockedGodotArtifact {
        &self.templates
    }
}

/// Canonical direct roots for a schema-three catalog graph.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct CatalogGraphRoots {
    runtime: BTreeSet<PackageName>,
    development: BTreeSet<PackageName>,
    extensions: BTreeMap<String, String>,
}

impl CatalogGraphRoots {
    /// Creates deterministic runtime and development root sets.
    #[must_use]
    pub fn new(
        runtime: impl IntoIterator<Item = PackageName>,
        development: impl IntoIterator<Item = PackageName>,
    ) -> Self {
        Self {
            runtime: runtime.into_iter().collect(),
            development: development.into_iter().collect(),
            extensions: BTreeMap::new(),
        }
    }

    /// Returns direct runtime roots in canonical name order.
    #[must_use]
    pub const fn runtime(&self) -> &BTreeSet<PackageName> {
        &self.runtime
    }

    /// Returns direct development roots in canonical name order.
    #[must_use]
    pub const fn development(&self) -> &BTreeSet<PackageName> {
        &self.development
    }
}

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
    catalog_sha256: Option<String>,
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
            catalog_sha256: None,
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
    /// Adds the selected source-catalog declaration fingerprint.
    ///
    /// # Errors
    ///
    /// Returns a diagnostic when the fingerprint is not lowercase SHA-256.
    pub fn with_catalog_sha256(mut self, catalog_sha256: String) -> Result<Self, Box<Diagnostic>> {
        valid_hex(
            &catalog_sha256,
            64,
            Path::new(LOCKFILE_FILE_NAME),
            "catalog_sha256",
        )?;
        self.catalog_sha256 = Some(catalog_sha256);
        Ok(self)
    }
    /// Returns the selected source-catalog declaration fingerprint, if any.
    #[must_use]
    pub fn catalog_sha256(&self) -> Option<&str> {
        self.catalog_sha256.as_deref()
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
    catalog_roots: Option<CatalogGraphRoots>,
    toolchain: Option<LockedGodotToolchain>,
    extensions: BTreeMap<String, String>,
}
impl Lockfile {
    /// Creates a lockfile, rejecting duplicate package names.
    ///
    /// # Errors
    ///
    /// Returns a diagnostic when package names are duplicated.
    pub fn new(packages: impl IntoIterator<Item = LockedPackage>) -> Result<Self, Box<Diagnostic>> {
        let entries = package_entries(packages)?;
        Ok(Self {
            schema: LOCKFILE_SCHEMA,
            packages: entries,
            catalog_roots: None,
            toolchain: None,
            extensions: BTreeMap::new(),
        })
    }
    /// Creates a complete schema-three catalog-selected dependency graph.
    ///
    /// # Errors
    ///
    /// Returns a diagnostic when an entry lacks catalog graph identity or when
    /// dependency edges are dangling or self-referential.
    pub fn new_catalog_graph(
        packages: impl IntoIterator<Item = LockedPackage>,
        roots: CatalogGraphRoots,
    ) -> Result<Self, Box<Diagnostic>> {
        let mut packages = package_entries(packages)?;
        normalize_catalog_graph_development(&mut packages, &roots)?;
        Ok(Self {
            schema: CATALOG_GRAPH_LOCKFILE_SCHEMA,
            packages,
            catalog_roots: Some(roots),
            toolchain: None,
            extensions: BTreeMap::new(),
        })
    }

    /// Upgrades a newly resolved package lock to schema four with an exact
    /// managed Godot toolchain. Existing package graph state is preserved.
    #[must_use]
    pub fn with_toolchain(mut self, toolchain: LockedGodotToolchain) -> Self {
        self.schema = TOOLCHAIN_LOCKFILE_SCHEMA;
        self.toolchain = Some(toolchain);
        self
    }
    /// Parses a supported lockfile schema.
    ///
    /// # Errors
    ///
    /// Returns a diagnostic for invalid or unsupported lockfile data.
    pub fn parse(path: &Path, input: &str) -> Result<Self, Box<Diagnostic>> {
        let doc = Document::parse(input.to_owned()).map_err(|e| syntax(path, e))?;
        let root = doc.as_table();
        let schema = integer(root, "schema", path, "root")?;
        if !matches!(
            schema,
            LEGACY_LOCKFILE_SCHEMA
                | LOCKFILE_SCHEMA
                | CATALOG_GRAPH_LOCKFILE_SCHEMA
                | TOOLCHAIN_LOCKFILE_SCHEMA
        ) {
            return Err(user(
                path,
                "lockfile.schema is not supported",
                "regenerate with a supported wukong version",
            ));
        }
        let extensions = extensions(root, &root_fields(schema), path, "root")?;
        let graph_mode = match schema {
            CATALOG_GRAPH_LOCKFILE_SCHEMA => true,
            TOOLCHAIN_LOCKFILE_SCHEMA => parse_toolchain_mode(root, path)?,
            _ => false,
        };
        let package_schema = if graph_mode {
            CATALOG_GRAPH_LOCKFILE_SCHEMA
        } else if schema == LEGACY_LOCKFILE_SCHEMA {
            LEGACY_LOCKFILE_SCHEMA
        } else {
            LOCKFILE_SCHEMA
        };
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
                    .map(|table| parse_package(table, path, package_schema))
                    .collect::<Result<Vec<_>, _>>()
            })
            .transpose()?
            .unwrap_or_default();
        let catalog_roots = if graph_mode {
            Some(parse_catalog_roots(
                table(root, "roots", path, "root")?,
                path,
            )?)
        } else {
            None
        };
        let toolchain = if schema == TOOLCHAIN_LOCKFILE_SCHEMA {
            Some(parse_toolchain(
                table(root, "toolchain", path, "root")?,
                path,
            )?)
        } else {
            None
        };
        let lock = Self {
            schema,
            packages: package_entries(packages)?,
            catalog_roots,
            toolchain,
            extensions,
        };
        if graph_mode {
            let roots = lock.catalog_roots.as_ref().ok_or_else(|| {
                user(
                    path,
                    "schema-three roots are required",
                    "add sorted runtime and development root arrays",
                )
            })?;
            validate_catalog_graph(&lock.packages, roots)?;
        }
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

    /// Returns persisted direct roots when this is a schema-three catalog graph.
    #[must_use]
    pub const fn catalog_graph_roots(&self) -> Option<&CatalogGraphRoots> {
        self.catalog_roots.as_ref()
    }

    /// Returns whether this lock records a complete catalog dependency graph.
    #[must_use]
    pub const fn is_catalog_graph(&self) -> bool {
        self.catalog_roots.is_some()
    }

    /// Returns the exact managed Godot toolchain when schema four recorded one.
    #[must_use]
    pub const fn toolchain(&self) -> Option<&LockedGodotToolchain> {
        self.toolchain.as_ref()
    }
    /// Serializes canonical TOML for the lockfile's schema.
    #[must_use]
    #[allow(clippy::too_many_lines)] // schema-specific deterministic tables are clearest inline
    pub fn to_toml(&self) -> String {
        let mut out = format!("schema = {}\n", self.schema);
        if self.schema == TOOLCHAIN_LOCKFILE_SCHEMA {
            line(
                &mut out,
                "mode",
                if self.catalog_roots.is_some() {
                    "catalog"
                } else {
                    "direct"
                },
            );
        }
        for (key, value) in &self.extensions {
            line(&mut out, key, value);
        }
        if let Some(toolchain) = &self.toolchain {
            out.push_str("\n[toolchain]\n");
            line(&mut out, "version", toolchain.version.to_string());
            line(&mut out, "flavor", toolchain.flavor.as_str());
            line(&mut out, "release", &toolchain.release);
            line(&mut out, "templates_name", toolchain.templates.name());
            line(&mut out, "templates_url", toolchain.templates.url());
            line(&mut out, "templates_sha512", toolchain.templates.sha512());
            integer_line(&mut out, "templates_bytes", toolchain.templates.bytes());
            for (platform, artifact) in &toolchain.editors {
                out.push_str("\n[[toolchain.editor]]\n");
                line(&mut out, "platform", platform.as_str());
                line(&mut out, "name", artifact.name());
                line(&mut out, "url", artifact.url());
                line(&mut out, "sha512", artifact.sha512());
                integer_line(&mut out, "bytes", artifact.bytes());
            }
        }
        if let Some(roots) = &self.catalog_roots {
            out.push_str("\n[roots]\n");
            array(
                &mut out,
                "runtime",
                roots.runtime.iter().map(PackageName::as_str),
            );
            array(
                &mut out,
                "development",
                roots.development.iter().map(PackageName::as_str),
            );
            for (key, value) in &roots.extensions {
                line(&mut out, key, value);
            }
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
            if let Some(catalog_sha256) = &package.catalog_sha256 {
                line(&mut out, "catalog_sha256", catalog_sha256);
            }
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

fn package_entries(
    packages: impl IntoIterator<Item = LockedPackage>,
) -> Result<BTreeMap<PackageName, LockedPackage>, Box<Diagnostic>> {
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
    Ok(entries)
}

fn normalize_catalog_graph_development(
    packages: &mut BTreeMap<PackageName, LockedPackage>,
    roots: &CatalogGraphRoots,
) -> Result<(), Box<Diagnostic>> {
    let (runtime, development) = catalog_graph_membership(packages, roots)?;
    for (name, package) in packages {
        package.development = development.contains(name) && !runtime.contains(name);
    }
    Ok(())
}

fn validate_catalog_graph(
    packages: &BTreeMap<PackageName, LockedPackage>,
    roots: &CatalogGraphRoots,
) -> Result<(), Box<Diagnostic>> {
    let (runtime, development) = catalog_graph_membership(packages, roots)?;
    for (name, package) in packages {
        let expected_development = development.contains(name) && !runtime.contains(name);
        if package.development != expected_development {
            return Err(catalog_graph_error(
                name,
                "schema-three package.development does not match root reachability",
                "regenerate wukong.lock from the selected catalog graph",
            ));
        }
    }
    Ok(())
}

fn catalog_graph_membership(
    packages: &BTreeMap<PackageName, LockedPackage>,
    roots: &CatalogGraphRoots,
) -> Result<(BTreeSet<PackageName>, BTreeSet<PackageName>), Box<Diagnostic>> {
    for (name, package) in packages {
        if package.version.is_none() {
            return Err(catalog_graph_error(
                name,
                "schema-three package.version is required",
                "lock a complete selected catalog version",
            ));
        }
        if package.catalog_sha256.is_none() {
            return Err(catalog_graph_error(
                name,
                "schema-three package.catalog_sha256 is required",
                "record the selected catalog declaration fingerprint",
            ));
        }
        if matches!(&package.source, LockedSource::Local(_)) {
            return Err(catalog_graph_error(
                name,
                "schema-three package.source.kind must be git or http",
                "use an immutable catalog source",
            ));
        }
        if matches!(&package.godot, GodotCompatibility::Unknown) {
            return Err(catalog_graph_error(
                name,
                "schema-three package.godot must be a requirement",
                "record the package metadata Godot requirement",
            ));
        }
        for dependency in &package.dependencies {
            if dependency == name {
                return Err(catalog_graph_error(
                    name,
                    "schema-three package.dependencies must not contain itself",
                    "remove the self-referential dependency edge",
                ));
            }
            if !packages.contains_key(dependency) {
                return Err(catalog_graph_error(
                    name,
                    format!(
                        "schema-three package.dependencies contains missing package {dependency}"
                    ),
                    "lock every selected dependency edge",
                ));
            }
        }
    }
    for (group, group_roots) in [
        ("runtime", &roots.runtime),
        ("development", &roots.development),
    ] {
        for root in group_roots {
            if !packages.contains_key(root) {
                return Err(catalog_roots_error(
                    format!("schema-three roots.{group} contains missing package {root}"),
                    "retain only selected package names as direct roots",
                ));
            }
        }
    }
    let runtime = reachable_packages(packages, &roots.runtime);
    let development = reachable_packages(packages, &roots.development);
    for name in packages.keys() {
        if !runtime.contains(name) && !development.contains(name) {
            return Err(catalog_graph_error(
                name,
                "schema-three graph contains a package unreachable from all direct roots",
                "retain only the selected root closure",
            ));
        }
    }
    Ok((runtime, development))
}

fn reachable_packages(
    packages: &BTreeMap<PackageName, LockedPackage>,
    roots: &BTreeSet<PackageName>,
) -> BTreeSet<PackageName> {
    let mut reachable = BTreeSet::new();
    let mut pending = roots.iter().cloned().collect::<Vec<_>>();
    while let Some(name) = pending.pop() {
        if !reachable.insert(name.clone()) {
            continue;
        }
        if let Some(package) = packages.get(&name) {
            pending.extend(package.dependencies.iter().cloned());
        }
    }
    reachable
}

fn catalog_graph_error(
    package: &PackageName,
    message: impl AsRef<str>,
    recovery: impl AsRef<str>,
) -> Box<Diagnostic> {
    Box::new(
        Diagnostic::new(ErrorCode::UserInput, message)
            .with_package(package.as_str())
            .with_recovery(recovery),
    )
}

fn catalog_roots_error(message: impl AsRef<str>, recovery: impl AsRef<str>) -> Box<Diagnostic> {
    Box::new(Diagnostic::new(ErrorCode::UserInput, message).with_recovery(recovery))
}

#[allow(clippy::too_many_lines)]
fn parse_package(
    package_table: &dyn TableLike,
    path: &Path,
    schema: i64,
) -> Result<LockedPackage, Box<Diagnostic>> {
    let package_extensions = extensions(package_table, &package_fields(schema), path, "package")?;
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
    let catalog_sha256 = if schema == CATALOG_GRAPH_LOCKFILE_SCHEMA {
        let catalog_sha256 = string(package_table, "catalog_sha256", path, "package")?;
        valid_hex(&catalog_sha256, 64, path, "package.catalog_sha256")?;
        Some(catalog_sha256)
    } else {
        None
    };
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
    if let Some(catalog_sha256) = catalog_sha256 {
        package = package.with_catalog_sha256(catalog_sha256)?;
    }
    package.extensions = package_extensions;
    Ok(package)
}

fn package_fields(schema: i64) -> Vec<&'static str> {
    let mut fields = vec![
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
    ];
    if schema == CATALOG_GRAPH_LOCKFILE_SCHEMA {
        fields.push("catalog_sha256");
    }
    fields
}

fn root_fields(schema: i64) -> Vec<&'static str> {
    let mut fields = vec!["schema", "package"];
    if schema == CATALOG_GRAPH_LOCKFILE_SCHEMA {
        fields.push("roots");
    }
    if schema == TOOLCHAIN_LOCKFILE_SCHEMA {
        fields.extend(["mode", "toolchain", "roots"]);
    }
    fields
}

fn parse_toolchain_mode(root: &dyn TableLike, path: &Path) -> Result<bool, Box<Diagnostic>> {
    match string(root, "mode", path, "root")?.as_str() {
        "direct" => Ok(false),
        "catalog" => Ok(true),
        _ => Err(user(
            path,
            "lockfile.mode must be direct or catalog in schema four",
            "regenerate wukong.lock with a supported Wukong version",
        )),
    }
}

fn parse_toolchain(
    table: &dyn TableLike,
    path: &Path,
) -> Result<LockedGodotToolchain, Box<Diagnostic>> {
    extensions(
        table,
        &[
            "version",
            "flavor",
            "release",
            "templates_name",
            "templates_url",
            "templates_sha512",
            "templates_bytes",
            "editor",
        ],
        path,
        "toolchain",
    )?;
    let version =
        SemanticVersion::parse(&string(table, "version", path, "toolchain")?).map_err(|error| {
            user(
                path,
                format!("toolchain.version is invalid: {error}"),
                "use an exact stable semantic version",
            )
        })?;
    let flavor = string(table, "flavor", path, "toolchain")?
        .parse::<GodotFlavor>()
        .map_err(|error| {
            user(
                path,
                format!("toolchain.flavor {error}"),
                "use standard or dotnet",
            )
        })?;
    let release = string(table, "release", path, "toolchain")?;
    let templates = LockedGodotArtifact::new(
        string(table, "templates_name", path, "toolchain")?,
        string(table, "templates_url", path, "toolchain")?,
        string(table, "templates_sha512", path, "toolchain")?,
        positive_integer(table, "templates_bytes", path, "toolchain")?,
    )?;
    let editors = table
        .get("editor")
        .and_then(Item::as_array_of_tables)
        .ok_or_else(|| {
            user(
                path,
                "toolchain.editor must be an array of tables",
                "retain one [[toolchain.editor]] entry per platform",
            )
        })?
        .iter()
        .map(|editor| {
            extensions(
                editor,
                &["platform", "name", "url", "sha512", "bytes"],
                path,
                "toolchain.editor",
            )?;
            let platform = string(editor, "platform", path, "toolchain.editor")?
                .parse::<GodotPlatform>()
                .map_err(|error| {
                    user(
                        path,
                        format!("toolchain.editor.platform {error}"),
                        "use a supported platform",
                    )
                })?;
            let artifact = LockedGodotArtifact::new(
                string(editor, "name", path, "toolchain.editor")?,
                string(editor, "url", path, "toolchain.editor")?,
                string(editor, "sha512", path, "toolchain.editor")?,
                positive_integer(editor, "bytes", path, "toolchain.editor")?,
            )?;
            Ok((platform, artifact))
        })
        .collect::<Result<Vec<_>, Box<Diagnostic>>>()?;
    LockedGodotToolchain::new(version, flavor, release, editors, templates)
}

fn parse_catalog_roots(
    root_table: &dyn TableLike,
    path: &Path,
) -> Result<CatalogGraphRoots, Box<Diagnostic>> {
    let extensions = extensions(root_table, &["runtime", "development"], path, "roots")?;
    Ok(CatalogGraphRoots {
        runtime: root_names(root_table.get("runtime"), path, "roots.runtime")?,
        development: root_names(root_table.get("development"), path, "roots.development")?,
        extensions,
    })
}

fn root_names(
    item: Option<&Item>,
    path: &Path,
    field: &str,
) -> Result<BTreeSet<PackageName>, Box<Diagnostic>> {
    let array = item.and_then(Item::as_array).ok_or_else(|| {
        user(
            path,
            format!("{field} must be an array"),
            "use a sorted package-name array",
        )
    })?;
    let mut names = BTreeSet::new();
    for item in array {
        let value = item.as_str().ok_or_else(|| {
            user(
                path,
                format!("{field} entries must be strings"),
                "use canonical package names",
            )
        })?;
        let name = PackageName::parse(value).map_err(|error| {
            user(
                path,
                format!("{field} {error}"),
                "use canonical package names",
            )
        })?;
        if !names.insert(name) {
            return Err(user(
                path,
                format!("{field} must not contain duplicates"),
                "remove duplicate roots",
            ));
        }
    }
    if array.len() != names.len()
        || !array
            .iter()
            .filter_map(|value| value.as_str())
            .collect::<Vec<_>>()
            .windows(2)
            .all(|pair| pair[0] < pair[1])
    {
        return Err(user(
            path,
            format!("{field} must be sorted"),
            "sort root package names ascending",
        ));
    }
    Ok(names)
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

fn positive_integer(
    table: &dyn TableLike,
    key: &str,
    path: &Path,
    scope: &str,
) -> Result<u64, Box<Diagnostic>> {
    let value = integer(table, key, path, scope)?;
    u64::try_from(value)
        .ok()
        .filter(|value| *value > 0)
        .ok_or_else(|| {
            user(
                path,
                format!("{scope}.{key} must be a positive integer"),
                "use the exact positive byte size published by the official release",
            )
        })
}

fn validate_locked_godot_artifact(
    name: &str,
    url: &str,
    sha512: &str,
    bytes: u64,
) -> Result<(), Box<Diagnostic>> {
    if name.is_empty() || name.contains(['/', '\\']) {
        return Err(user(
            Path::new(LOCKFILE_FILE_NAME),
            "toolchain artifact name must be one file name",
            "use the official release asset name",
        ));
    }
    let parsed = url::Url::parse(url).map_err(|_| {
        user(
            Path::new(LOCKFILE_FILE_NAME),
            "toolchain artifact URL is invalid",
            "use the official GitHub release download URL",
        )
    })?;
    if parsed.scheme() != "https"
        || parsed.host_str() != Some("github.com")
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.fragment().is_some()
        || parsed.query().is_some()
    {
        return Err(user(
            Path::new(LOCKFILE_FILE_NAME),
            "toolchain artifact URL must be a credential-free official GitHub HTTPS URL",
            "regenerate the lockfile from an official stable Godot release",
        ));
    }
    if sha512.len() != 128
        || !sha512
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
    {
        return Err(user(
            Path::new(LOCKFILE_FILE_NAME),
            "toolchain artifact SHA-512 must be lowercase hexadecimal",
            "regenerate the lockfile from official SHA512-SUMS.txt",
        ));
    }
    if bytes == 0 {
        return Err(user(
            Path::new(LOCKFILE_FILE_NAME),
            "toolchain artifact bytes must be positive",
            "regenerate the lockfile from official release metadata",
        ));
    }
    Ok(())
}

fn validate_toolchain_artifact_identity(
    artifact: &LockedGodotArtifact,
    release: &str,
    expected_name: &str,
) -> Result<(), Box<Diagnostic>> {
    if artifact.name() != expected_name {
        return Err(user(
            Path::new(LOCKFILE_FILE_NAME),
            "toolchain artifact name does not match its version, flavor, and platform",
            "regenerate the lockfile from an official stable release",
        ));
    }
    if artifact.url() != official_release_asset_url(release, expected_name) {
        return Err(user(
            Path::new(LOCKFILE_FILE_NAME),
            "toolchain artifact URL does not match its official release identity",
            "regenerate the lockfile from an official stable release",
        ));
    }
    Ok(())
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
fn integer_line(out: &mut String, key: &str, value: u64) {
    let _ = writeln!(out, "{key} = {value}");
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
