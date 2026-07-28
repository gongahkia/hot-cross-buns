//! Read-only version availability reporting for immutable direct sources.

use crate::{
    cache::CacheLayout,
    diagnostic::Diagnostic,
    git_fetch::{GitFetcher, GitTagPrefix},
    git_source::GitSourceRequest,
    identity::PackageName,
    lockfile::{LockedSource, Lockfile},
    semantic_version::{SemanticVersion, VersionRequirement},
};

/// The version availability state for one locked package.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum OutdatedStatus {
    /// The locked Git tag is the newest discovered tag.
    UpToDate { current: SemanticVersion },
    /// New tags exist relative to the locked Git tag.
    Updates {
        /// The immutable tag currently in the lockfile.
        current: SemanticVersion,
        /// The newest caret-compatible tag, if any.
        compatible: Option<SemanticVersion>,
        /// The newest non-caret-compatible tag, if any.
        breaking: Option<SemanticVersion>,
    },
    /// The source cannot provide a safe version comparison.
    Unavailable { reason: String },
}

/// One deterministic entry in an outdated report.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OutdatedPackage {
    name: PackageName,
    status: OutdatedStatus,
}

impl OutdatedPackage {
    /// Returns the locked package name.
    #[must_use]
    pub const fn name(&self) -> &PackageName {
        &self.name
    }

    /// Returns the package's version availability state.
    #[must_use]
    pub const fn status(&self) -> &OutdatedStatus {
        &self.status
    }
}

/// Reports newer Git tag versions for every package in a lockfile.
///
/// Git repositories are queried for exact semantic-version tags first. If none
/// exist, a `v` prefix is retried for repositories that use tags such as
/// `v1.2.3`. Local paths and checksum-pinned archives have no mutable version
/// catalogue, so they are reported as unavailable rather than guessed.
///
/// Per-repository discovery failures are represented as unavailable entries so
/// one inaccessible source does not suppress the rest of the report.
#[must_use]
pub fn report_outdated(
    lock: &Lockfile,
    cache: &CacheLayout,
    offline: bool,
) -> Vec<OutdatedPackage> {
    let fetcher = GitFetcher::new(cache.clone());
    lock.packages()
        .values()
        .map(|package| {
            let status = match package.source() {
                LockedSource::Local(_) => OutdatedStatus::Unavailable {
                    reason: "local source has no version catalogue".to_owned(),
                },
                LockedSource::Http(_) => OutdatedStatus::Unavailable {
                    reason: "checksum-pinned archive has no version catalogue".to_owned(),
                },
                LockedSource::Git(source) => {
                    git_status(&fetcher, source.url(), source.commit(), offline)
                }
            };
            OutdatedPackage {
                name: package.name().clone(),
                status,
            }
        })
        .collect()
}

fn git_status(fetcher: &GitFetcher, url: &str, commit: &str, offline: bool) -> OutdatedStatus {
    let request = GitSourceRequest::new(url.to_owned(), None);
    let catalog = match fetcher.discover_versions(&request, None, offline) {
        Ok(catalog) if !catalog.versions().is_empty() => catalog,
        Ok(_) => match GitTagPrefix::parse("v") {
            Ok(prefix) => match fetcher.discover_versions(&request, Some(&prefix), offline) {
                Ok(catalog) => catalog,
                Err(error) => return unavailable_git_error(&error),
            },
            Err(error) => {
                return OutdatedStatus::Unavailable {
                    reason: error.to_string(),
                };
            }
        },
        Err(error) => return unavailable_git_error(&error),
    };
    status_from_versions(commit, catalog.versions())
}

fn unavailable_git_error(error: &Diagnostic) -> OutdatedStatus {
    OutdatedStatus::Unavailable {
        reason: format!("could not query Git tags: {}", error.message()),
    }
}

fn status_from_versions(
    commit: &str,
    versions: &std::collections::BTreeMap<SemanticVersion, String>,
) -> OutdatedStatus {
    if versions.is_empty() {
        return OutdatedStatus::Unavailable {
            reason: "Git source has no semantic-version tags".to_owned(),
        };
    }
    let Some(current) = versions
        .iter()
        .find_map(|(version, tagged_commit)| (tagged_commit == commit).then(|| version.clone()))
    else {
        return OutdatedStatus::Unavailable {
            reason: "locked Git commit has no semantic-version tag".to_owned(),
        };
    };
    version_status(current, versions.keys())
}

fn version_status<'a>(
    current: SemanticVersion,
    versions: impl IntoIterator<Item = &'a SemanticVersion>,
) -> OutdatedStatus {
    let requirement = match VersionRequirement::parse(&format!("^{current}")) {
        Ok(requirement) => requirement,
        Err(error) => {
            return OutdatedStatus::Unavailable {
                reason: format!("could not classify semantic-version compatibility: {error}"),
            };
        }
    };
    let mut compatible = None;
    let mut breaking = None;
    for version in versions {
        if version <= &current {
            continue;
        }
        if requirement.matches(version) {
            compatible = Some(version.clone());
        } else {
            breaking = Some(version.clone());
        }
    }
    if compatible.is_none() && breaking.is_none() {
        OutdatedStatus::UpToDate { current }
    } else {
        OutdatedStatus::Updates {
            current,
            compatible,
            breaking,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{OutdatedStatus, status_from_versions, version_status};
    use crate::semantic_version::SemanticVersion;
    use std::collections::BTreeMap;

    #[test]
    fn invariant_outdated_distinguishes_caret_compatible_and_breaking_versions() {
        let current = version("1.0.0");
        let compatible = version("1.2.0");
        let breaking = version("2.0.0");
        let status = version_status(current.clone(), [&current, &compatible, &breaking]);

        assert_eq!(
            status,
            OutdatedStatus::Updates {
                current,
                compatible: Some(compatible),
                breaking: Some(breaking),
            }
        );
    }

    #[test]
    fn invariant_outdated_uses_semver_zero_major_compatibility_rules() {
        let current = version("0.1.0");
        let compatible = version("0.1.1");
        let breaking = version("0.2.0");
        let status = version_status(current.clone(), [&current, &compatible, &breaking]);

        assert_eq!(
            status,
            OutdatedStatus::Updates {
                current,
                compatible: Some(compatible),
                breaking: Some(breaking),
            }
        );
    }

    #[test]
    fn invariant_outdated_reports_git_sources_without_semantic_version_tags() {
        assert_eq!(
            status_from_versions("0123456789012345678901234567890123456789", &BTreeMap::new()),
            OutdatedStatus::Unavailable {
                reason: "Git source has no semantic-version tags".to_owned(),
            }
        );
    }

    #[test]
    fn invariant_outdated_uses_the_locked_git_tag_as_the_update_baseline() {
        let locked_commit = "0123456789012345678901234567890123456789";
        let versions = BTreeMap::from([
            (version("1.0.0"), locked_commit.to_owned()),
            (
                version("1.1.0"),
                "1123456789012345678901234567890123456789".to_owned(),
            ),
            (
                version("2.0.0"),
                "2123456789012345678901234567890123456789".to_owned(),
            ),
        ]);

        assert_eq!(
            status_from_versions(locked_commit, &versions),
            OutdatedStatus::Updates {
                current: version("1.0.0"),
                compatible: Some(version("1.1.0")),
                breaking: Some(version("2.0.0")),
            }
        );
    }

    fn version(value: &str) -> SemanticVersion {
        SemanticVersion::parse(value).expect("fixture version should parse")
    }
}
