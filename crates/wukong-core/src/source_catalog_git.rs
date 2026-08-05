//! Git tag discovery for validated project source-catalog candidates.

use crate::{
    git_fetch::GitFetcher, git_source::GitSourceRequest, identity::GitSourceIdentity,
    semantic_version::SemanticVersion, source::SourceResult,
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
                    source: candidate.source().clone(),
                    commit: commit.clone(),
                    root: candidate.root().to_owned(),
                },
            )
        })
        .collect()
}
