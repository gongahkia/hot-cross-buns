//! Git tag discovery for validated project source-catalog candidates.

use crate::{
    diagnostic::{Diagnostic, ErrorCode},
    git_fetch::GitFetcher,
    git_source::GitSourceRequest,
    identity::GitSourceIdentity,
    identity::PackageName,
    package_metadata::PackageMetadata,
    semantic_version::SemanticVersion,
    source::SourceResult,
    source_catalog::ValidatedCatalogGitCandidate,
};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};

/// A semantic-version candidate observed from a project-reviewed Git source.
///
/// The commit is the complete commit currently named by the matching tag. This
/// adapter does not write a lockfile; a later lock operation decides whether to
/// persist that observed commit as an immutable source identity.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CatalogGitVersionCandidate {
    version: SemanticVersion,
    tag: String,
    source: GitSourceIdentity,
    commit: String,
    root: PathBuf,
}

impl CatalogGitVersionCandidate {
    /// Returns the semantic version selected by the matching Git tag.
    #[must_use]
    pub const fn version(&self) -> &SemanticVersion {
        &self.version
    }

    /// Returns the canonical tag name used to discover this version.
    #[must_use]
    pub fn tag(&self) -> &str {
        &self.tag
    }

    /// Returns the canonical project-reviewed Git source.
    #[must_use]
    pub const fn source(&self) -> &GitSourceIdentity {
        &self.source
    }

    /// Returns the complete commit currently observed for this version.
    #[must_use]
    pub fn commit(&self) -> &str {
        &self.commit
    }

    /// Returns the normalised package root within the Git checkout.
    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Loads required metadata and verifies its canonical version against this tag.
    ///
    /// The metadata file must be under this candidate's declared package root.
    /// This validation reads only the checked-out source and never writes a
    /// lockfile; callers must run it before lockfile publication.
    ///
    /// # Errors
    ///
    /// Returns a diagnostic when metadata is missing or unreadable, or when its
    /// canonical semantic version differs from the selected Git tag version.
    pub fn verify_package_metadata(
        &self,
        package: &PackageName,
        checkout_root: &Path,
    ) -> SourceResult<PackageMetadata> {
        let metadata_root = checkout_root.join(&self.root);
        let metadata = PackageMetadata::load_optional(&metadata_root)?.ok_or_else(|| {
            Box::new(
                Diagnostic::new(
                    ErrorCode::IntegrityFailure,
                    format!(
                        "package {} selected by Git tag {} has no wukong-package.toml",
                        package.as_str(),
                        self.tag
                    ),
                )
                .with_package(package.as_str())
                .with_source(self.source.as_str())
                .with_recovery("add valid package metadata before locking"),
            )
        })?;
        if metadata.version().without_build_metadata() != self.version {
            return Err(Box::new(
                Diagnostic::new(
                    ErrorCode::IntegrityFailure,
                    format!(
                        "package {} selected by Git tag {} has metadata version {}, expected {}",
                        package.as_str(),
                        self.tag,
                        metadata.version(),
                        self.version
                    ),
                )
                .with_package(package.as_str())
                .with_source(self.source.as_str())
                .with_recovery("retag the package or correct package.version before locking"),
            ));
        }
        Ok(metadata)
    }
}

/// Git-specific version-discovery adapter for validated source-catalog entries.
#[derive(Clone, Debug)]
pub struct CatalogGitAdapter {
    fetcher: GitFetcher,
}

impl CatalogGitAdapter {
    /// Creates an adapter backed by `fetcher`'s Git metadata cache.
    #[must_use]
    pub const fn new(fetcher: GitFetcher) -> Self {
        Self { fetcher }
    }

    /// Discovers deterministic semantic-version candidates for one Git entry.
    ///
    /// With `offline`, only verified cached tag metadata for the same canonical
    /// source and configured prefix is accepted; no network access is attempted.
    /// This method does not fetch package content or write lockfile state.
    ///
    /// # Errors
    ///
    /// Returns a diagnostic when Git tag metadata cannot be discovered, or when
    /// offline metadata is absent or invalid.
    pub fn discover_candidates(
        &self,
        candidate: &ValidatedCatalogGitCandidate,
        offline: bool,
    ) -> SourceResult<BTreeMap<SemanticVersion, CatalogGitVersionCandidate>> {
        let request = GitSourceRequest::new(candidate.source().as_str().to_owned(), None);
        let versions = self
            .fetcher
            .discover_versions(&request, candidate.tag_prefix(), offline)?;
        Ok(candidates_from_catalog(candidate, &versions))
    }
}

pub(crate) fn candidates_from_catalog(
    candidate: &ValidatedCatalogGitCandidate,
    versions: &crate::git_fetch::GitVersionCatalog,
) -> BTreeMap<SemanticVersion, CatalogGitVersionCandidate> {
    versions
        .versions()
        .iter()
        .map(|(version, commit)| {
            (
                version.clone(),
                CatalogGitVersionCandidate {
                    version: version.clone(),
                    tag: format!(
                        "{}{}",
                        candidate.tag_prefix().map_or("", |prefix| prefix.as_str()),
                        version
                    ),
                    source: candidate.source().clone(),
                    commit: commit.clone(),
                    root: candidate.root().to_owned(),
                },
            )
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::CatalogGitVersionCandidate;
    use crate::{
        diagnostic::{ErrorCode, RedactedSource},
        identity::{GitSourceIdentity, PackageName},
        semantic_version::SemanticVersion,
    };
    use std::{fs, path::PathBuf};
    use tempfile::TempDir;

    #[test]
    fn invariant_catalog_git_metadata_rejects_tag_version_mismatch_before_locking() {
        let fixture = TempDir::new().expect("fixture should exist");
        let candidate = candidate("1.2.3", "release-1.2.3");
        write_metadata(fixture.path(), "1.2.4");

        let error = candidate
            .verify_package_metadata(&package(), fixture.path())
            .expect_err("mismatched metadata must fail");

        assert_eq!(error.code(), ErrorCode::IntegrityFailure);
        assert_eq!(error.package(), Some("catalog"));
        assert_eq!(
            error.source_description().map(RedactedSource::as_str),
            Some("https://fixture.test/catalog.git")
        );
        assert!(error.message().contains("catalog"));
        assert!(error.message().contains("release-1.2.3"));
        assert!(error.message().contains("1.2.4"));
    }

    #[test]
    fn invariant_catalog_git_metadata_accepts_prefixed_prerelease_tag_versions() {
        let fixture = TempDir::new().expect("fixture should exist");
        let candidate = candidate("1.2.3-rc.1", "release-1.2.3-rc.1");
        write_metadata(fixture.path(), "1.2.3-rc.1");

        let metadata = candidate
            .verify_package_metadata(&package(), fixture.path())
            .expect("prefixed prerelease tag should agree with metadata");

        assert_eq!(candidate.tag(), "release-1.2.3-rc.1");
        assert_eq!(metadata.version().to_string(), "1.2.3-rc.1");
    }

    #[test]
    fn invariant_catalog_git_metadata_compares_versions_without_build_metadata() {
        let fixture = TempDir::new().expect("fixture should exist");
        let candidate = candidate("1.2.3", "v1.2.3");
        write_metadata(fixture.path(), "1.2.3+build.7");

        let metadata = candidate
            .verify_package_metadata(&package(), fixture.path())
            .expect("build metadata must not change candidate identity");

        assert_eq!(metadata.version().to_string(), "1.2.3+build.7");
    }

    #[test]
    fn invariant_catalog_git_metadata_is_required_for_selected_tags() {
        let fixture = TempDir::new().expect("fixture should exist");
        let candidate = candidate("1.2.3", "v1.2.3");
        fs::create_dir_all(fixture.path().join("addons/catalog"))
            .expect("package root should create");

        let error = candidate
            .verify_package_metadata(&package(), fixture.path())
            .expect_err("selected Git tag must require metadata");

        assert_eq!(error.code(), ErrorCode::IntegrityFailure);
        assert!(error.message().contains("catalog"));
        assert!(error.message().contains("v1.2.3"));
    }

    fn candidate(version: &str, tag: &str) -> CatalogGitVersionCandidate {
        CatalogGitVersionCandidate {
            version: SemanticVersion::parse(version).expect("version should parse"),
            tag: tag.to_owned(),
            source: GitSourceIdentity::new("https://fixture.test/catalog.git".to_owned()),
            commit: "0123456789012345678901234567890123456789".to_owned(),
            root: PathBuf::from("addons/catalog"),
        }
    }

    fn package() -> PackageName {
        PackageName::parse("catalog").expect("package name should parse")
    }

    fn write_metadata(root: &std::path::Path, version: &str) {
        let package_root = root.join("addons/catalog");
        fs::create_dir_all(&package_root).expect("package root should create");
        fs::write(
            package_root.join("wukong-package.toml"),
            format!(
                "[package]\nschema = 1\nname = \"catalog\"\nversion = \"{version}\"\ngodot = \"4\"\n"
            ),
        )
        .expect("metadata should write");
    }
}
