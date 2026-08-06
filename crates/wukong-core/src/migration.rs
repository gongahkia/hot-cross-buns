//! Previewable migration from direct remote dependencies to catalog graph state.

use crate::{
    cache::CacheLayout,
    catalog_lock::{lock_catalog_dependencies, lock_catalog_dependencies_read_only},
    diagnostic::{Diagnostic, ErrorCode},
    git_source::canonicalize_git_url,
    http_archive::canonicalize_archive_url,
    identity::PackageName,
    lockfile::{GodotCompatibility, LockedPackage, LockedSource, Lockfile},
    manifest::{Dependency, DependencyAlias, GitReference, Manifest},
    source::CancellationToken,
    source_catalog::{SOURCE_CATALOG_SCHEMA, SourceCatalog},
};
use std::{collections::BTreeMap, path::Path};
use toml_edit::{ArrayOfTables, DocumentMut, Item, Table, Value};

/// Fully preflighted project-state output for a catalog migration.
#[derive(Clone, Debug)]
pub struct CatalogMigration {
    manifest: String,
    catalog: String,
    lock: Lockfile,
}

impl CatalogMigration {
    /// Returns the validated replacement `wukong.toml` text.
    #[must_use]
    pub fn manifest(&self) -> &str {
        &self.manifest
    }

    /// Returns the validated replacement `wukong.sources.toml` text.
    #[must_use]
    pub fn catalog(&self) -> &str {
        &self.catalog
    }

    /// Returns the validated schema-three catalog lockfile.
    #[must_use]
    pub const fn lock(&self) -> &Lockfile {
        &self.lock
    }
}

/// Preflights a lossless conversion from a direct remote lock to a catalog graph.
///
/// Direct HTTPS archives are converted to matching catalog candidates. Git is
/// converted only from a semantic-version tag, because an exact revision or a
/// mutable branch cannot be represented by catalog tag discovery. The generated
/// catalog is resolved before this function returns and must retain every locked
/// source, package tree, layout, compatibility declaration, and edge exactly.
///
/// With `dry_run`, acquisition is restricted to existing cache data and
/// disposable staging. This function never writes project files.
///
/// # Errors
///
/// Returns actionable blockers when a direct source cannot be represented
/// losslessly, package metadata is absent or invalid, cache/source acquisition
/// fails, or catalog resolution would change the installed package state.
#[allow(clippy::too_many_arguments)] // command-level migration inputs remain explicit
pub fn plan_catalog_migration(
    manifest_path: &Path,
    manifest_input: &str,
    manifest: &Manifest,
    existing: &Lockfile,
    catalog_path: &Path,
    cache: CacheLayout,
    dry_run: bool,
    cancellation: &CancellationToken,
) -> Result<CatalogMigration, Box<Diagnostic>> {
    if existing.schema() != crate::lockfile::LOCKFILE_SCHEMA {
        return Err(blocker(
            "migration requires a schema-two direct-source lockfile",
            "run wukong lock first, or use the existing schema-three catalog state",
        ));
    }
    let candidates = direct_candidates(manifest, existing)?;
    if candidates.len() != existing.packages().len()
        || candidates
            .keys()
            .any(|name| !existing.packages().contains_key(name))
    {
        return Err(blocker(
            "direct dependencies and wukong.lock do not describe the same package set",
            "run wukong lock before migration",
        ));
    }
    let catalog_output = catalog_text(&candidates, catalog_path)?;
    let catalog = SourceCatalog::parse(catalog_path, &catalog_output)?.validate(catalog_path)?;
    let (migrated_manifest_text, migrated_manifest) =
        migrated_manifest(manifest_path, manifest_input, manifest, &candidates)?;
    cancellation.check()?;
    let lock = if dry_run {
        lock_catalog_dependencies_read_only(&migrated_manifest, catalog, cache, cancellation)?
    } else {
        lock_catalog_dependencies(
            &migrated_manifest,
            catalog,
            None,
            cache,
            false,
            cancellation,
        )?
    };
    verify_preserved_state(existing, &lock)?;
    Ok(CatalogMigration {
        manifest: migrated_manifest_text,
        catalog: catalog_output,
        lock,
    })
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum CandidateSource {
    Git {
        url: String,
        tag_prefix: Option<String>,
    },
    Http {
        url: String,
        sha256: String,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct Candidate {
    version: String,
    root: String,
    source: CandidateSource,
}

fn direct_candidates(
    manifest: &Manifest,
    existing: &Lockfile,
) -> Result<BTreeMap<PackageName, Candidate>, Box<Diagnostic>> {
    let mut candidates = BTreeMap::new();
    insert_candidates(&mut candidates, manifest.dependencies(), existing)?;
    insert_candidates(&mut candidates, manifest.dev_dependencies(), existing)?;
    if candidates.is_empty() {
        return Err(blocker(
            "migration requires at least one direct remote dependency",
            "add a supported HTTPS archive or Git tag dependency before migration",
        ));
    }
    Ok(candidates)
}

fn insert_candidates(
    candidates: &mut BTreeMap<PackageName, Candidate>,
    dependencies: &BTreeMap<DependencyAlias, Dependency>,
    existing: &Lockfile,
) -> Result<(), Box<Diagnostic>> {
    for (alias, dependency) in dependencies {
        let name = PackageName::parse(alias.as_str()).map_err(|error| {
            Box::new(
                Diagnostic::new(
                    ErrorCode::InternalFailure,
                    "manifest dependency alias was invalid",
                )
                .with_cause(error)
                .with_recovery("retry and report this as a wukong bug if it persists"),
            )
        })?;
        let package = existing.packages().get(&name).ok_or_else(|| {
            blocker(
                format!("direct dependency {name} has no locked package"),
                "run wukong lock before migration",
            )
        })?;
        let candidate = candidate_for_dependency(&name, dependency, package)?;
        match candidates.get(&name) {
            Some(existing) if existing != &candidate => {
                return Err(blocker(
                    format!("direct dependency {name} has conflicting declarations"),
                    "use one direct source declaration per package before migration",
                ));
            }
            Some(_) => {}
            None => {
                candidates.insert(name, candidate);
            }
        }
    }
    Ok(())
}

#[allow(clippy::too_many_lines)] // maps every direct-source migration blocker explicitly
fn candidate_for_dependency(
    name: &PackageName,
    dependency: &Dependency,
    package: &LockedPackage,
) -> Result<Candidate, Box<Diagnostic>> {
    let version = package.version().ok_or_else(|| {
        blocker(
            format!("locked package {name} has no metadata version"),
            "add valid wukong-package.toml metadata and run wukong lock before migration",
        )
    })?;
    if matches!(package.godot(), GodotCompatibility::Unknown) {
        return Err(blocker(
            format!("locked package {name} has no metadata Godot requirement"),
            "add valid wukong-package.toml metadata and run wukong lock before migration",
        ));
    }
    let root = package.source_subdirectory().to_str().ok_or_else(|| {
        blocker(
            format!("locked package {name} has a non-UTF-8 source root"),
            "use a UTF-8 source-relative package root before migration",
        )
    })?;
    if root == "." {
        return Err(blocker(
            format!("locked package {name} is rooted at the source top level"),
            "catalog candidates require a non-empty source-relative package root",
        ));
    }
    let source = match (dependency, package.source()) {
        (Dependency::Url { url, sha256, .. }, LockedSource::Http(locked)) => {
            let url = canonicalize_archive_url(url)?;
            if url != locked.url() || sha256 != locked.sha256() {
                return Err(blocker(
                    format!("direct HTTPS declaration for {name} differs from its lockfile source"),
                    "run wukong lock before migration",
                ));
            }
            if sha256.bytes().any(|byte| byte.is_ascii_uppercase()) {
                return Err(blocker(
                    format!("direct HTTPS checksum for {name} is not lowercase"),
                    "rewrite the checksum in lowercase, run wukong lock, then retry migration",
                ));
            }
            CandidateSource::Http {
                url,
                sha256: sha256.clone(),
            }
        }
        (
            Dependency::Git {
                url,
                reference: Some(GitReference::Tag(tag)),
                ..
            },
            LockedSource::Git(locked),
        ) => {
            let url = canonicalize_git_url(url)?.as_str().to_owned();
            if url != locked.url() {
                return Err(blocker(
                    format!("direct Git declaration for {name} differs from its lockfile source"),
                    "run wukong lock before migration",
                ));
            }
            let version = version.to_string();
            let tag_prefix = tag.strip_suffix(&version).ok_or_else(|| {
                blocker(
                    format!("Git tag {tag} for {name} does not end with locked version {version}"),
                    "use a semantic-version Git tag, run wukong lock, then retry migration",
                )
            })?;
            CandidateSource::Git {
                url,
                tag_prefix: (!tag_prefix.is_empty()).then(|| tag_prefix.to_owned()),
            }
        }
        (Dependency::Path { .. }, _) => {
            return Err(blocker(
                format!("local dependency {name} cannot enter a source catalog"),
                "keep it as a development path dependency or replace it with a reviewed remote source",
            ));
        }
        (Dependency::Git { .. }, _) => {
            return Err(blocker(
                format!("Git dependency {name} is not pinned by a semantic-version tag"),
                "use a semantic-version Git tag, run wukong lock, then retry migration",
            ));
        }
        (Dependency::Url { .. }, _) => {
            return Err(blocker(
                format!("direct HTTPS dependency {name} does not match its lockfile source"),
                "run wukong lock before migration",
            ));
        }
        (Dependency::Version(_), _) => {
            return Err(blocker(
                format!("dependency {name} already uses a catalog version requirement"),
                "run wukong lock with the existing catalog instead of migrating",
            ));
        }
        #[cfg(feature = "asset-library")]
        (Dependency::Asset { .. }, _) => {
            return Err(blocker(
                format!("AssetLib dependency {name} cannot enter a project source catalog"),
                "replace it with a reviewed Git or HTTPS catalog candidate before migration",
            ));
        }
    };
    Ok(Candidate {
        version: version.to_string(),
        root: root.replace('\\', "/"),
        source,
    })
}

fn catalog_text(
    candidates: &BTreeMap<PackageName, Candidate>,
    path: &Path,
) -> Result<String, Box<Diagnostic>> {
    let mut document = DocumentMut::new();
    document["schema"] = Item::Value(Value::from(SOURCE_CATALOG_SCHEMA));
    let mut entries = ArrayOfTables::new();
    for (name, candidate) in candidates {
        let mut entry = Table::new();
        entry.insert("name", Item::Value(Value::from(name.as_str())));
        let mut source = Table::new();
        match &candidate.source {
            CandidateSource::Git { url, tag_prefix } => {
                source.insert("url", Item::Value(Value::from(url.as_str())));
                source.insert("root", Item::Value(Value::from(candidate.root.as_str())));
                if let Some(tag_prefix) = tag_prefix {
                    source.insert("tag-prefix", Item::Value(Value::from(tag_prefix.as_str())));
                }
                entry.insert("git", Item::Table(source));
            }
            CandidateSource::Http { url, sha256 } => {
                source.insert(
                    "version",
                    Item::Value(Value::from(candidate.version.as_str())),
                );
                source.insert("url", Item::Value(Value::from(url.as_str())));
                source.insert("sha256", Item::Value(Value::from(sha256.as_str())));
                source.insert("root", Item::Value(Value::from(candidate.root.as_str())));
                entry.insert("http", Item::Table(source));
            }
        }
        entries.push(entry);
    }
    document["package"] = Item::ArrayOfTables(entries);
    SourceCatalog::parse(path, &document.to_string())?.to_toml(path)
}

fn migrated_manifest(
    manifest_path: &Path,
    input: &str,
    manifest: &Manifest,
    candidates: &BTreeMap<PackageName, Candidate>,
) -> Result<(String, Manifest), Box<Diagnostic>> {
    let mut document = input.parse::<DocumentMut>().map_err(|error| {
        Box::new(
            Diagnostic::new(
                ErrorCode::InternalFailure,
                "validated manifest could not be prepared for migration",
            )
            .with_cause(error)
            .with_recovery("retry and report this as a wukong bug if it persists"),
        )
    })?;
    replace_manifest_section(
        &mut document,
        "dependencies",
        manifest.dependencies(),
        candidates,
    )?;
    replace_manifest_section(
        &mut document,
        "dev-dependencies",
        manifest.dev_dependencies(),
        candidates,
    )?;
    let output = document.to_string();
    let manifest = Manifest::parse(manifest_path, &output)?;
    Ok((output, manifest))
}

fn replace_manifest_section(
    document: &mut DocumentMut,
    section: &str,
    dependencies: &BTreeMap<DependencyAlias, Dependency>,
    candidates: &BTreeMap<PackageName, Candidate>,
) -> Result<(), Box<Diagnostic>> {
    if dependencies.is_empty() {
        return Ok(());
    }
    let table = document[section].as_table_mut().ok_or_else(|| {
        Box::new(
            Diagnostic::new(
                ErrorCode::InternalFailure,
                format!("validated manifest section {section} could not be edited"),
            )
            .with_recovery("retry and report this as a wukong bug if it persists"),
        )
    })?;
    for alias in dependencies.keys() {
        let candidate = candidates.get(alias.as_str()).ok_or_else(|| {
            Box::new(
                Diagnostic::new(
                    ErrorCode::InternalFailure,
                    format!("migration candidate for {} disappeared", alias.as_str()),
                )
                .with_recovery("retry and report this as a wukong bug if it persists"),
            )
        })?;
        table.insert(
            alias.as_str(),
            Item::Value(Value::from(format!("={}", candidate.version))),
        );
    }
    Ok(())
}

fn verify_preserved_state(existing: &Lockfile, migrated: &Lockfile) -> Result<(), Box<Diagnostic>> {
    if existing.packages().len() != migrated.packages().len() {
        return Err(blocker(
            "catalog resolution changed the locked package set",
            "add reviewed catalog candidates for every transitive dependency, then retry migration",
        ));
    }
    for (name, existing_package) in existing.packages() {
        let migrated_package = migrated.packages().get(name).ok_or_else(|| {
            blocker(
                format!("catalog resolution removed locked package {name}"),
                "review the catalog candidates and retry migration",
            )
        })?;
        if existing_package.version() != migrated_package.version()
            || existing_package.source().immutable_id() != migrated_package.source().immutable_id()
            || existing_package.package_sha256() != migrated_package.package_sha256()
            || existing_package.dependencies() != migrated_package.dependencies()
            || existing_package.source_subdirectory() != migrated_package.source_subdirectory()
            || existing_package.target_path() != migrated_package.target_path()
            || existing_package.godot() != migrated_package.godot()
        {
            return Err(blocker(
                format!("catalog resolution would change locked package state for {name}"),
                "review package metadata and catalog candidates, then retry migration",
            ));
        }
    }
    Ok(())
}

fn blocker(message: impl Into<String>, recovery: impl Into<String>) -> Box<Diagnostic> {
    let message = message.into();
    let recovery = recovery.into();
    Box::new(Diagnostic::new(ErrorCode::UserInput, message).with_recovery(recovery))
}

#[cfg(test)]
mod tests {
    use super::{CandidateSource, candidate_for_dependency};
    use crate::{
        identity::PackageName,
        lockfile::{GodotCompatibility, LockedGitSource, LockedPackage},
        manifest::Manifest,
        semantic_version::{SemanticVersion, VersionRequirement},
        source::ImmutableSourceId,
    };
    use std::{collections::BTreeSet, path::PathBuf};

    #[test]
    fn invariant_git_tag_migration_derives_only_the_semantic_tag_prefix() {
        let manifest_path = PathBuf::from("wukong.toml");
        let manifest = Manifest::parse(
            &manifest_path,
            "[project]\nname = \"fixture\"\ngodot = \"4\"\n\n[dependencies]\nalpha = { git = \"https://fixture.test/alpha.git\", tag = \"v1.2.3\" }\n",
        )
        .expect("manifest should parse");
        let name = PackageName::parse("alpha").expect("name should parse");
        let source = LockedGitSource::new(
            ImmutableSourceId::new(format!("git:{}", "a".repeat(40)))
                .expect("immutable ID should parse"),
            "https://fixture.test/alpha.git",
            "a".repeat(40),
        )
        .expect("source should construct");
        let package = LockedPackage::new(
            name.clone(),
            Some(SemanticVersion::parse("1.2.3").expect("version should parse")),
            source,
            "b".repeat(64),
            "c".repeat(64),
            BTreeSet::new(),
            PathBuf::from("addons/alpha"),
            PathBuf::from("addons/alpha"),
            GodotCompatibility::Requirement(
                VersionRequirement::parse("4").expect("Godot requirement should parse"),
            ),
            false,
        )
        .expect("package should construct");

        let candidate = candidate_for_dependency(
            &name,
            manifest
                .dependencies()
                .get("alpha")
                .expect("dependency should exist"),
            &package,
        )
        .expect("tagged Git dependency should migrate");

        assert!(matches!(
            candidate.source,
            CandidateSource::Git { tag_prefix: Some(prefix), .. } if prefix == "v"
        ));
    }
}
