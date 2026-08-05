//! Typed parsing for the version-one project source catalog.

use crate::diagnostic::{Diagnostic, ErrorCode};
use std::{
    borrow::Borrow,
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
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
