//! Typed parsing for the version-one project source catalog.

use crate::{
    diagnostic::{Diagnostic, ErrorCode},
    git_fetch::GitTagPrefix,
    git_source::canonicalize_git_url,
    http_archive::canonicalize_archive_url,
    identity::{GitSourceIdentity, PackageName},
    semantic_version::SemanticVersion,
};
use std::{
    borrow::Borrow,
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Component, Path, PathBuf},
};
use toml_edit::{Document, Item, TableLike};

/// The project source-catalog filename.
pub const SOURCE_CATALOG_FILE_NAME: &str = "wukong.sources.toml";

/// The result type returned by source-catalog parsing.
pub type SourceCatalogResult<T> = Result<T, Box<Diagnostic>>;

/// A parsed source catalog with package names and candidates in deterministic order.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SourceCatalog {
    packages: BTreeMap<CatalogPackageName, Vec<CatalogCandidate>>,
}

impl SourceCatalog {
    /// Reads and parses a UTF-8 source catalog.
    ///
    /// # Errors
    ///
    /// Returns a diagnostic when the catalog cannot be read, is not UTF-8, or
    /// does not conform to schema one.
    pub fn load(path: &Path) -> SourceCatalogResult<Self> {
        let bytes = fs::read(path).map_err(|error| {
            user(
                path,
                "could not read wukong.sources.toml",
                error,
                "check that the catalog file is readable",
            )
        })?;
        let input = std::str::from_utf8(&bytes).map_err(|error| {
            user(
                path,
                "wukong.sources.toml must be UTF-8",
                error,
                "save the catalog as UTF-8 and retry",
            )
        })?;
        Self::parse(path, input)
    }

    /// Parses a source catalog located at `path`.
    ///
    /// Parsing is filesystem- and network-independent. Source URL, checksum,
    /// version, and root safety validation is performed separately.
    ///
    /// # Errors
    ///
    /// Returns a user diagnostic for invalid TOML, unsupported schema fields,
    /// or malformed schema-one structure.
    pub fn parse(path: &Path, input: &str) -> SourceCatalogResult<Self> {
        let document = Document::parse(input.to_owned()).map_err(|error| {
            user(
                path,
                "invalid wukong.sources.toml syntax",
                error,
                "fix the TOML syntax and retry",
            )
        })?;
        let root = document.as_table();
        reject_unknown(root, &["schema", "package"], path, "root")?;
        if integer(root, "schema", path, "root")? != 1 {
            return Err(user(
                path,
                "schema must be 1",
                "unsupported source catalog schema",
                "use the supported source catalog schema",
            ));
        }

        let mut packages = BTreeMap::<CatalogPackageName, Vec<CatalogCandidate>>::new();
        if let Some(item) = root.get("package") {
            let entries = item.as_array_of_tables().ok_or_else(|| {
                user(
                    path,
                    "package must be an array of tables",
                    "invalid package entry type",
                    "use one [[package]] table per source candidate",
                )
            })?;
            for (index, entry) in entries.iter().enumerate() {
                let scope = format!("package[{index}]");
                reject_unknown(entry, &["name", "git", "http"], path, &scope)?;
                let name = CatalogPackageName(string(entry, "name", path, &scope)?);
                let git = entry.get("git");
                let http = entry.get("http");
                let source_count = usize::from(git.is_some()) + usize::from(http.is_some());
                if source_count != 1 {
                    return Err(user(
                        path,
                        format!("{scope} must contain exactly one source table"),
                        "ambiguous package source",
                        "add exactly one [package.git] or [package.http] table",
                    ));
                }
                let candidate = if let Some(git) = git {
                    CatalogCandidate::Git(parse_git(git, path, &scope)?)
                } else if let Some(http) = http {
                    CatalogCandidate::Http(parse_http(http, path, &scope)?)
                } else {
                    return Err(user(
                        path,
                        format!("{scope} has no source table"),
                        "missing package source",
                        "add a [package.git] or [package.http] table",
                    ));
                };
                packages.entry(name).or_default().push(candidate);
            }
        }
        for candidates in packages.values_mut() {
            candidates.sort();
        }
        Ok(Self { packages })
    }

    /// Returns catalog candidates grouped by declared package name.
    #[must_use]
    pub const fn packages(&self) -> &BTreeMap<CatalogPackageName, Vec<CatalogCandidate>> {
        &self.packages
    }

    /// Validates source declarations without accessing the filesystem or network.
    ///
    /// # Errors
    ///
    /// Returns a user diagnostic for invalid package names, source URLs, package
    /// roots, versions, checksums, tag prefixes, or duplicate candidates.
    pub fn validate(&self, path: &Path) -> SourceCatalogResult<ValidatedSourceCatalog> {
        let mut packages = BTreeMap::new();
        for (declared_name, candidates) in &self.packages {
            let package = PackageName::parse(declared_name.as_str()).map_err(|error| {
                validation_error(
                    path,
                    declared_name.as_str(),
                    &field(declared_name, "name"),
                    error,
                    "use a lowercase ASCII package name with internal hyphens only",
                )
            })?;
            let mut validated = Vec::with_capacity(candidates.len());
            let mut identities = BTreeSet::new();
            for candidate in candidates {
                let (candidate, identity) = validate_candidate(path, declared_name, candidate)?;
                if !identities.insert(identity) {
                    return Err(validation_error(
                        path,
                        declared_name.as_str(),
                        &field(declared_name, "source"),
                        "duplicate source candidate",
                        "remove the duplicate candidate or make its source identity distinct",
                    ));
                }
                validated.push(candidate);
            }
            packages.insert(package, validated);
        }
        Ok(ValidatedSourceCatalog { packages })
    }
}

/// A source catalog whose entries are safe for resolution without re-parsing.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ValidatedSourceCatalog {
    packages: BTreeMap<PackageName, Vec<ValidatedCatalogCandidate>>,
}

impl ValidatedSourceCatalog {
    /// Returns validated candidates grouped by canonical package name.
    #[must_use]
    pub const fn packages(&self) -> &BTreeMap<PackageName, Vec<ValidatedCatalogCandidate>> {
        &self.packages
    }
}

/// A validated source candidate that can be resolved without re-validating input.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ValidatedCatalogCandidate {
    /// A credential-free canonical Git repository with a safe package root.
    Git(ValidatedCatalogGitCandidate),
    /// A checksum-pinned HTTPS archive with a safe package root.
    Http(ValidatedCatalogHttpCandidate),
}

/// A validated Git source-catalog candidate.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ValidatedCatalogGitCandidate {
    source: GitSourceIdentity,
    root: PathBuf,
    tag_prefix: Option<GitTagPrefix>,
}

impl ValidatedCatalogGitCandidate {
    /// Returns the canonical Git repository source.
    #[must_use]
    pub const fn source(&self) -> &GitSourceIdentity {
        &self.source
    }

    /// Returns the normalised source-relative package root.
    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Returns the validated optional semantic-version tag prefix.
    #[must_use]
    pub fn tag_prefix(&self) -> Option<&GitTagPrefix> {
        self.tag_prefix.as_ref()
    }
}

/// A validated checksum-pinned HTTP source-catalog candidate.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ValidatedCatalogHttpCandidate {
    version: SemanticVersion,
    url: String,
    sha256: String,
    root: PathBuf,
}

impl ValidatedCatalogHttpCandidate {
    /// Returns the complete semantic version selected by this archive.
    #[must_use]
    pub const fn version(&self) -> &SemanticVersion {
        &self.version
    }

    /// Returns the canonical credential-free HTTPS archive URL.
    #[must_use]
    pub fn url(&self) -> &str {
        &self.url
    }

    /// Returns the validated lowercase SHA-256 checksum.
    #[must_use]
    pub fn sha256(&self) -> &str {
        &self.sha256
    }

    /// Returns the normalised source-relative package root.
    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }
}

/// A package name declared by an unvalidated source-catalog entry.
#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct CatalogPackageName(String);

impl CatalogPackageName {
    /// Returns the declared package name.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl Borrow<str> for CatalogPackageName {
    fn borrow(&self) -> &str {
        self.as_str()
    }
}

/// A source candidate declared in a project source catalog.
#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum CatalogCandidate {
    /// A candidate set discovered from Git semantic-version tags.
    Git(CatalogGitCandidate),
    /// A single checksum-pinned HTTPS archive candidate.
    Http(CatalogHttpCandidate),
}

/// A Git source-catalog candidate.
#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct CatalogGitCandidate {
    url: String,
    root: PathBuf,
    tag_prefix: Option<String>,
}

impl CatalogGitCandidate {
    /// Returns the declared Git URL before source validation.
    #[must_use]
    pub fn url(&self) -> &str {
        &self.url
    }

    /// Returns the declared package root before path validation.
    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Returns the optional Git tag prefix before validation.
    #[must_use]
    pub fn tag_prefix(&self) -> Option<&str> {
        self.tag_prefix.as_deref()
    }
}

/// A checksum-pinned HTTP source-catalog candidate.
#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct CatalogHttpCandidate {
    version: String,
    url: String,
    sha256: String,
    root: PathBuf,
}

impl CatalogHttpCandidate {
    /// Returns the declared semantic version before version validation.
    #[must_use]
    pub fn version(&self) -> &str {
        &self.version
    }

    /// Returns the declared archive URL before source validation.
    #[must_use]
    pub fn url(&self) -> &str {
        &self.url
    }

    /// Returns the declared archive checksum before checksum validation.
    #[must_use]
    pub fn sha256(&self) -> &str {
        &self.sha256
    }

    /// Returns the declared package root before path validation.
    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }
}

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
enum CandidateIdentity {
    Git {
        source: String,
        root: PathBuf,
        tag_prefix: Option<String>,
    },
    Http {
        version: String,
        url: String,
        sha256: String,
        root: PathBuf,
    },
}

fn validate_candidate(
    path: &Path,
    name: &CatalogPackageName,
    candidate: &CatalogCandidate,
) -> SourceCatalogResult<(ValidatedCatalogCandidate, CandidateIdentity)> {
    match candidate {
        CatalogCandidate::Git(candidate) => validate_git_candidate(path, name, candidate),
        CatalogCandidate::Http(candidate) => validate_http_candidate(path, name, candidate),
    }
}

fn validate_git_candidate(
    path: &Path,
    name: &CatalogPackageName,
    candidate: &CatalogGitCandidate,
) -> SourceCatalogResult<(ValidatedCatalogCandidate, CandidateIdentity)> {
    let source = canonicalize_git_url(candidate.url()).map_err(|error| {
        validation_error(
            path,
            name.as_str(),
            &field(name, "git.url"),
            error.message(),
            "use a credential-free HTTPS or SSH Git repository URL",
        )
    })?;
    let root = validate_root(path, name, "git.root", candidate.root())?;
    let tag_prefix = candidate
        .tag_prefix()
        .map(|prefix| {
            GitTagPrefix::parse(prefix).map_err(|error| {
                validation_error(
                    path,
                    name.as_str(),
                    &field(name, "git.tag-prefix"),
                    error,
                    "use a non-empty prefix that forms a safe Git tag",
                )
            })
        })
        .transpose()?;
    let identity = CandidateIdentity::Git {
        source: source.as_str().to_owned(),
        root: root.clone(),
        tag_prefix: tag_prefix.as_ref().map(|prefix| prefix.as_str().to_owned()),
    };
    Ok((
        ValidatedCatalogCandidate::Git(ValidatedCatalogGitCandidate {
            source,
            root,
            tag_prefix,
        }),
        identity,
    ))
}

fn validate_http_candidate(
    path: &Path,
    name: &CatalogPackageName,
    candidate: &CatalogHttpCandidate,
) -> SourceCatalogResult<(ValidatedCatalogCandidate, CandidateIdentity)> {
    let version = SemanticVersion::parse(candidate.version()).map_err(|error| {
        validation_error(
            path,
            name.as_str(),
            &field(name, "http.version"),
            error,
            "use a complete semantic version such as 1.2.3",
        )
    })?;
    let url = canonicalize_archive_url(candidate.url()).map_err(|error| {
        validation_error(
            path,
            name.as_str(),
            &field(name, "http.url"),
            error.message(),
            "use a credential-free HTTPS archive URL without a fragment",
        )
    })?;
    validate_sha256(path, name, candidate.sha256())?;
    let root = validate_root(path, name, "http.root", candidate.root())?;
    let identity = CandidateIdentity::Http {
        version: version.to_string(),
        url: url.clone(),
        sha256: candidate.sha256().to_owned(),
        root: root.clone(),
    };
    Ok((
        ValidatedCatalogCandidate::Http(ValidatedCatalogHttpCandidate {
            version,
            url,
            sha256: candidate.sha256().to_owned(),
            root,
        }),
        identity,
    ))
}

fn validate_sha256(
    path: &Path,
    name: &CatalogPackageName,
    sha256: &str,
) -> SourceCatalogResult<()> {
    if sha256.len() == 64
        && sha256
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
    {
        return Ok(());
    }
    Err(validation_error(
        path,
        name.as_str(),
        &field(name, "http.sha256"),
        "archive checksum must be lowercase SHA-256",
        "use a 64-character lowercase hexadecimal SHA-256",
    ))
}

fn validate_root(
    path: &Path,
    name: &CatalogPackageName,
    source_field: &str,
    root: &Path,
) -> SourceCatalogResult<PathBuf> {
    let value = root.to_string_lossy();
    let windows_drive = value
        .as_bytes()
        .first()
        .is_some_and(u8::is_ascii_alphabetic)
        && value.as_bytes().get(1).is_some_and(|byte| *byte == b':');
    if value.is_empty() || value.contains(['\\', '\0']) || value.starts_with('/') || windows_drive {
        return Err(invalid_root(path, name, source_field));
    }
    let mut normalised = PathBuf::new();
    for component in root.components() {
        match component {
            Component::Normal(part) => normalised.push(part),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(invalid_root(path, name, source_field));
            }
        }
    }
    if normalised.as_os_str().is_empty() {
        return Err(validation_error(
            path,
            name.as_str(),
            &field(name, source_field),
            "package root must be non-empty",
            "use a non-empty source-relative package root",
        ));
    }
    Ok(normalised)
}

fn invalid_root(path: &Path, name: &CatalogPackageName, source_field: &str) -> Box<Diagnostic> {
    validation_error(
        path,
        name.as_str(),
        &field(name, source_field),
        "package root must be a safe relative path without traversal or a platform prefix",
        "use a non-empty source-relative package root without traversal",
    )
}

fn field(name: &CatalogPackageName, suffix: &str) -> String {
    format!("package.{}.{suffix}", name.as_str())
}

fn parse_git(item: &Item, path: &Path, scope: &str) -> SourceCatalogResult<CatalogGitCandidate> {
    let scope = format!("{scope}.git");
    let table = item.as_table_like().ok_or_else(|| {
        user(
            path,
            format!("{scope} must be a table"),
            "invalid Git source type",
            "use a [package.git] table",
        )
    })?;
    reject_unknown(table, &["url", "root", "tag-prefix"], path, &scope)?;
    Ok(CatalogGitCandidate {
        url: string(table, "url", path, &scope)?,
        root: PathBuf::from(string(table, "root", path, &scope)?),
        tag_prefix: optional_string(table, "tag-prefix", path, &scope)?,
    })
}

fn parse_http(item: &Item, path: &Path, scope: &str) -> SourceCatalogResult<CatalogHttpCandidate> {
    let scope = format!("{scope}.http");
    let table = item.as_table_like().ok_or_else(|| {
        user(
            path,
            format!("{scope} must be a table"),
            "invalid HTTP source type",
            "use a [package.http] table",
        )
    })?;
    reject_unknown(table, &["version", "url", "sha256", "root"], path, &scope)?;
    Ok(CatalogHttpCandidate {
        version: string(table, "version", path, &scope)?,
        url: string(table, "url", path, &scope)?,
        sha256: string(table, "sha256", path, &scope)?,
        root: PathBuf::from(string(table, "root", path, &scope)?),
    })
}

fn integer(table: &dyn TableLike, key: &str, path: &Path, scope: &str) -> SourceCatalogResult<i64> {
    table
        .get(key)
        .ok_or_else(|| {
            user(
                path,
                format!("{scope}.{key} is required"),
                "missing required field",
                "add the required source catalog field",
            )
        })?
        .as_integer()
        .ok_or_else(|| {
            user(
                path,
                format!("{scope}.{key} must be an integer"),
                "invalid field type",
                "use an integer value",
            )
        })
}

fn string(
    table: &dyn TableLike,
    key: &str,
    path: &Path,
    scope: &str,
) -> SourceCatalogResult<String> {
    table
        .get(key)
        .ok_or_else(|| {
            user(
                path,
                format!("{scope}.{key} is required"),
                "missing required field",
                "add the required source catalog field",
            )
        })?
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| {
            user(
                path,
                format!("{scope}.{key} must be a string"),
                "invalid field type",
                "use a string value",
            )
        })
}

fn optional_string(
    table: &dyn TableLike,
    key: &str,
    path: &Path,
    scope: &str,
) -> SourceCatalogResult<Option<String>> {
    table
        .get(key)
        .map(|item| {
            item.as_str().map(str::to_owned).ok_or_else(|| {
                user(
                    path,
                    format!("{scope}.{key} must be a string"),
                    "invalid field type",
                    "use a string value",
                )
            })
        })
        .transpose()
}

fn reject_unknown(
    table: &dyn TableLike,
    allowed: &[&str],
    path: &Path,
    scope: &str,
) -> SourceCatalogResult<()> {
    if let Some((key, _)) = table.iter().find(|(key, _)| !allowed.contains(key)) {
        return Err(user(
            path,
            format!("{scope}.{key} is not supported"),
            "unsupported field",
            "remove the unsupported source catalog field",
        ));
    }
    Ok(())
}

fn user(
    path: &Path,
    message: impl AsRef<str>,
    cause: impl std::fmt::Display,
    recovery: impl AsRef<str>,
) -> Box<Diagnostic> {
    Box::new(
        Diagnostic::new(ErrorCode::UserInput, message)
            .with_source(path.display().to_string())
            .with_cause(cause)
            .with_recovery(recovery),
    )
}

fn validation_error(
    path: &Path,
    package: &str,
    field: &str,
    cause: impl std::fmt::Display,
    recovery: impl AsRef<str>,
) -> Box<Diagnostic> {
    Box::new(
        Diagnostic::new(ErrorCode::UserInput, format!("{field} is invalid"))
            .with_package(package)
            .with_source(path.display().to_string())
            .with_cause(cause)
            .with_recovery(recovery),
    )
}
