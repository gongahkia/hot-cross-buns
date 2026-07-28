//! Canonical semantic-version values and requirements.

use semver::{Op, Version, VersionReq};
use std::{
    fmt::{self, Display, Formatter},
    str::FromStr,
};

/// A validated semantic version used for package and Godot versions.
#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct SemanticVersion(Version);

impl SemanticVersion {
    /// Creates one complete stable semantic version.
    #[must_use]
    pub const fn new(major: u64, minor: u64, patch: u64) -> Self {
        Self(Version::new(major, minor, patch))
    }

    /// Parses a complete semantic version.
    ///
    /// # Errors
    ///
    /// Returns the `SemVer` parser error when `value` is invalid.
    pub fn parse(value: &str) -> Result<Self, semver::Error> {
        value.parse()
    }

    /// Returns the underlying semantic version for boundary adapters.
    #[must_use]
    pub const fn as_semver(&self) -> &Version {
        &self.0
    }

    /// Returns whether this version has a pre-release identifier.
    #[must_use]
    pub fn is_prerelease(&self) -> bool {
        !self.0.pre.is_empty()
    }

    /// Returns this version with build metadata removed.
    ///
    /// Build metadata does not affect `SemVer` precedence or resolution identity.
    #[must_use]
    pub fn without_build_metadata(&self) -> Self {
        let mut version = self.0.clone();
        version.build = semver::BuildMetadata::EMPTY;
        Self(version)
    }
}

impl Display for SemanticVersion {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

impl FromStr for SemanticVersion {
    type Err = semver::Error;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Version::parse(value).map(Self)
    }
}

/// A validated Cargo-compatible semantic-version requirement.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VersionRequirement(VersionReq);

impl VersionRequirement {
    /// Parses an exact, range, caret, or tilde version requirement.
    ///
    /// # Errors
    ///
    /// Returns the `SemVer` parser error when `value` is invalid.
    pub fn parse(value: &str) -> Result<Self, semver::Error> {
        value.parse()
    }

    /// Returns whether this requirement permits `version`.
    #[must_use]
    pub fn matches(&self, version: &SemanticVersion) -> bool {
        self.0.matches(version.as_semver())
    }

    /// Returns the underlying requirement for the solver adapter.
    #[must_use]
    pub const fn as_semver(&self) -> &VersionReq {
        &self.0
    }

    /// Determines whether two requirements share a stable semantic version.
    ///
    /// Returns `None` when either requirement uses pre-release comparators,
    /// because an installed engine version is then required for an honest
    /// compatibility decision.
    #[must_use]
    pub fn stable_overlap(&self, other: &Self) -> Option<bool> {
        let left = stable_bounds(&self.0)?;
        let right = stable_bounds(&other.0)?;
        let lower = std::cmp::max(left.lower, right.lower);
        let upper = match (left.upper, right.upper) {
            (Some(left), Some(right)) => Some(std::cmp::min(left, right)),
            (Some(value), None) | (None, Some(value)) => Some(value),
            (None, None) => None,
        };
        let candidate_is_in_bounds = upper.is_none_or(|upper| lower < upper);
        Some(candidate_is_in_bounds && self.matches(&lower) && other.matches(&lower))
    }
}

#[derive(Clone, Debug)]
struct StableBounds {
    lower: SemanticVersion,
    upper: Option<SemanticVersion>,
}

fn stable_bounds(requirement: &VersionReq) -> Option<StableBounds> {
    let mut bounds = StableBounds {
        lower: SemanticVersion::new(0, 0, 0),
        upper: None,
    };
    for comparator in &requirement.comparators {
        if !comparator.pre.is_empty() {
            return None;
        }
        let comparison = comparator_bounds(comparator)?;
        bounds.lower = std::cmp::max(bounds.lower, comparison.lower);
        bounds.upper = match (bounds.upper, comparison.upper) {
            (Some(left), Some(right)) => Some(std::cmp::min(left, right)),
            (Some(value), None) | (None, Some(value)) => Some(value),
            (None, None) => None,
        };
    }
    Some(bounds)
}

fn comparator_bounds(comparator: &semver::Comparator) -> Option<StableBounds> {
    let base = SemanticVersion::new(
        comparator.major,
        comparator.minor.unwrap_or(0),
        comparator.patch.unwrap_or(0),
    );
    let exact = || partial_exact_bounds(comparator, base.clone());
    match comparator.op {
        Op::Exact | Op::Wildcard => exact(),
        Op::Greater => Some(StableBounds {
            lower: partial_successor(comparator, &base)?,
            upper: None,
        }),
        Op::GreaterEq => Some(StableBounds {
            lower: base,
            upper: None,
        }),
        Op::Less => Some(StableBounds {
            lower: SemanticVersion::new(0, 0, 0),
            upper: Some(base),
        }),
        Op::LessEq => Some(StableBounds {
            lower: SemanticVersion::new(0, 0, 0),
            upper: Some(partial_successor(comparator, &base)?),
        }),
        Op::Tilde => Some(StableBounds {
            lower: base.clone(),
            upper: Some(if comparator.minor.is_some() {
                next_minor(&base)?
            } else {
                next_major(&base)?
            }),
        }),
        Op::Caret => Some(StableBounds {
            lower: base.clone(),
            upper: Some(caret_successor(comparator, &base)?),
        }),
        _ => None,
    }
}

fn partial_exact_bounds(
    comparator: &semver::Comparator,
    base: SemanticVersion,
) -> Option<StableBounds> {
    let upper = if comparator.minor.is_none() {
        next_major(&base)?
    } else if comparator.patch.is_none() {
        next_minor(&base)?
    } else {
        next_patch(&base)?
    };
    Some(StableBounds {
        lower: base,
        upper: Some(upper),
    })
}

fn partial_successor(
    comparator: &semver::Comparator,
    base: &SemanticVersion,
) -> Option<SemanticVersion> {
    if comparator.minor.is_none() {
        next_major(base)
    } else if comparator.patch.is_none() {
        next_minor(base)
    } else {
        next_patch(base)
    }
}

fn caret_successor(
    comparator: &semver::Comparator,
    base: &SemanticVersion,
) -> Option<SemanticVersion> {
    if comparator.major > 0 {
        next_major(base)
    } else if comparator.minor.unwrap_or(0) > 0 {
        next_minor(base)
    } else if comparator.patch.is_some() {
        next_patch(base)
    } else {
        next_minor(base)
    }
}

fn next_major(version: &SemanticVersion) -> Option<SemanticVersion> {
    version
        .as_semver()
        .major
        .checked_add(1)
        .map(|major| SemanticVersion::new(major, 0, 0))
}

fn next_minor(version: &SemanticVersion) -> Option<SemanticVersion> {
    version
        .as_semver()
        .minor
        .checked_add(1)
        .map(|minor| SemanticVersion::new(version.as_semver().major, minor, 0))
}

fn next_patch(version: &SemanticVersion) -> Option<SemanticVersion> {
    version.as_semver().patch.checked_add(1).map(|patch| {
        SemanticVersion::new(version.as_semver().major, version.as_semver().minor, patch)
    })
}

impl Display for VersionRequirement {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

impl FromStr for VersionRequirement {
    type Err = semver::Error;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        VersionReq::parse(value).map(Self)
    }
}
