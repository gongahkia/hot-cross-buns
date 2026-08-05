//! Transactional, comment-preserving edits to `wukong.sources.toml`.

use crate::{
    diagnostic::{Diagnostic, ErrorCode},
    operation_lock::AdvisoryLock,
    source_catalog::{
        SOURCE_CATALOG_FILE_NAME, SOURCE_CATALOG_SCHEMA, SourceCatalog, SourceCatalogResult,
        ValidatedCatalogCandidate,
    },
    transactional_file::{FileSnapshot, write_atomic},
};
use std::path::{Path, PathBuf};
use toml_edit::{ArrayOfTables, DocumentMut, Item, Table, Value};

const CATALOG_LOCK_FILE_NAME: &str = ".wukong.sources.toml.lock";

/// One declared source-catalog candidate used for an add or exact remove.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CatalogEditEntry {
    /// A Git candidate with an optional tag prefix.
    Git {
        /// Declared package name.
        name: String,
        /// Repository URL.
        url: String,
        /// Source-relative package root.
        root: PathBuf,
        /// Optional semantic-version Git tag prefix.
        tag_prefix: Option<String>,
    },
    /// A checksum-pinned HTTPS archive candidate.
    Http {
        /// Declared package name.
        name: String,
        /// Complete semantic version.
        version: String,
        /// Archive URL.
        url: String,
        /// Lowercase SHA-256 checksum.
        sha256: String,
        /// Source-relative package root.
        root: PathBuf,
    },
}

/// Adds one validated candidate without changing existing catalog entries.
///
/// Creates a schema-one catalog if it does not exist.
///
/// # Errors
///
/// Returns a diagnostic when the entry or existing catalog is invalid, another
/// Wukong process is editing the catalog, or the atomic write cannot complete.
pub fn add_entry(path: &Path, entry: &CatalogEditEntry) -> SourceCatalogResult<()> {
    edit_catalog(path, MissingCatalog::Create, |entries| {
        entries.push(entry.to_table()?);
        Ok(())
    })
}

/// Removes exactly one validated candidate without changing unrelated entries.
///
/// # Errors
///
/// Returns a diagnostic when no single candidate matches, the catalog is
/// invalid, another Wukong process is editing the catalog, or the atomic write
/// cannot complete.
pub fn remove_entry(path: &Path, entry: &CatalogEditEntry) -> SourceCatalogResult<()> {
    let selection = validated_entry(path, entry.to_table()?)?;
    edit_catalog(path, MissingCatalog::Reject, |entries| {
        let matches = entries
            .iter()
            .enumerate()
            .filter_map(|(index, table)| {
                (validated_entry(path, table.clone()).ok().as_ref() == Some(&selection))
                    .then_some(index)
            })
            .collect::<Vec<_>>();
        match matches.as_slice() {
            [index] => {
                entries.remove(*index);
                Ok(())
            }
            [] => Err(user(
                "requested source catalog candidate does not exist",
                "use wukong source list to select an existing candidate",
            )),
            _ => Err(user(
                "requested source catalog candidate is ambiguous",
                "specify one candidate with a distinct source identity",
            )),
        }
    })
}

impl CatalogEditEntry {
    fn to_table(&self) -> SourceCatalogResult<Table> {
        let mut table = Table::new();
        match self {
            Self::Git {
                name,
                url,
                root,
                tag_prefix,
            } => {
                table.insert("name", Value::from(name.clone()).into());
                let mut source = Table::new();
                source.insert("url", Value::from(url.clone()).into());
                source.insert("root", Value::from(path_string(root)?).into());
                if let Some(prefix) = tag_prefix {
                    source.insert("tag-prefix", Value::from(prefix.clone()).into());
                }
                table.insert("git", Item::Table(source));
            }
            Self::Http {
                name,
                version,
                url,
                sha256,
                root,
            } => {
                table.insert("name", Value::from(name.clone()).into());
                let mut source = Table::new();
                source.insert("version", Value::from(version.clone()).into());
                source.insert("url", Value::from(url.clone()).into());
                source.insert("sha256", Value::from(sha256.clone()).into());
                source.insert("root", Value::from(path_string(root)?).into());
                table.insert("http", Item::Table(source));
            }
        }
        Ok(table)
    }
}

#[derive(Clone, Copy)]
enum MissingCatalog {
    Create,
    Reject,
}

fn edit_catalog(
    path: &Path,
    missing: MissingCatalog,
    edit: impl FnOnce(&mut ArrayOfTables) -> SourceCatalogResult<()>,
) -> SourceCatalogResult<()> {
    let _lock = AdvisoryLock::try_acquire(&lock_path(path)?, SOURCE_CATALOG_FILE_NAME)?;
    let snapshot = FileSnapshot::capture(path.to_path_buf())?;
    let input = match snapshot.content() {
        Some(content) => std::str::from_utf8(content).map_err(|error| {
            Box::new(
                Diagnostic::new(ErrorCode::UserInput, "wukong.sources.toml must be UTF-8")
                    .with_source(path.display().to_string())
                    .with_cause(error)
                    .with_recovery("save the catalog as UTF-8 and retry"),
            )
        })?,
        None if matches!(missing, MissingCatalog::Create) => "schema = 1\n",
        None => {
            return Err(user(
                "wukong.sources.toml does not exist",
                "add a source candidate first or create wukong.sources.toml",
            ));
        }
    };
    SourceCatalog::parse(path, input)?.validate(path)?;
    let mut document = input.parse::<DocumentMut>().map_err(|error| {
        Box::new(
            Diagnostic::new(
                ErrorCode::InternalFailure,
                "validated source catalog could not be edited",
            )
            .with_cause(error)
            .with_recovery("report this as a wukong bug"),
        )
    })?;
    edit(package_tables(&mut document)?)?;
    let output = document.to_string();
    SourceCatalog::parse(path, &output)?.validate(path)?;
    write_atomic(path, output.as_bytes())
}

fn validated_entry(
    path: &Path,
    table: Table,
) -> SourceCatalogResult<(String, ValidatedCatalogCandidate)> {
    let mut document = DocumentMut::new();
    document["schema"] = Value::from(SOURCE_CATALOG_SCHEMA).into();
    let mut entries = ArrayOfTables::new();
    entries.push(table);
    document["package"] = Item::ArrayOfTables(entries);
    let catalog = SourceCatalog::parse(path, &document.to_string())?.validate(path)?;
    let (name, candidates) = catalog.packages().first_key_value().ok_or_else(|| {
        Box::new(
            Diagnostic::new(
                ErrorCode::InternalFailure,
                "single source catalog entry did not validate",
            )
            .with_recovery("report this as a wukong bug"),
        )
    })?;
    let candidate = candidates.first().cloned().ok_or_else(|| {
        Box::new(
            Diagnostic::new(
                ErrorCode::InternalFailure,
                "single source catalog candidate did not validate",
            )
            .with_recovery("report this as a wukong bug"),
        )
    })?;
    Ok((name.to_string(), candidate))
}

fn package_tables(document: &mut DocumentMut) -> SourceCatalogResult<&mut ArrayOfTables> {
    let root = document.as_table_mut();
    if !root.contains_key("package") {
        root.insert("package", Item::ArrayOfTables(ArrayOfTables::new()));
    }
    root.get_mut("package")
        .and_then(Item::as_array_of_tables_mut)
        .ok_or_else(|| {
            Box::new(
                Diagnostic::new(
                    ErrorCode::InternalFailure,
                    "validated source catalog package entries could not be edited",
                )
                .with_recovery("report this as a wukong bug"),
            )
        })
}

fn path_string(path: &Path) -> SourceCatalogResult<String> {
    path.to_str().map(str::to_owned).ok_or_else(|| {
        user(
            "source catalog package root must be UTF-8",
            "use a UTF-8 source-relative package root",
        )
    })
}

fn lock_path(path: &Path) -> SourceCatalogResult<PathBuf> {
    path.parent()
        .map(|parent| parent.join(CATALOG_LOCK_FILE_NAME))
        .ok_or_else(|| {
            Box::new(
                Diagnostic::new(
                    ErrorCode::InternalFailure,
                    "source catalog path has no parent directory",
                )
                .with_recovery("provide an explicit catalog path"),
            )
        })
}

fn user(message: impl AsRef<str>, recovery: impl AsRef<str>) -> Box<Diagnostic> {
    Box::new(Diagnostic::new(ErrorCode::UserInput, message).with_recovery(recovery))
}
