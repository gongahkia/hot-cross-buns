//! Canonical semantic-version values and requirements.

use semver::{Version, VersionReq};
use std::{
    fmt::{self, Display, Formatter},
    str::FromStr,
};

/// A validated semantic version used for package and Godot versions.
#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct SemanticVersion(Version);

impl SemanticVersion {
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
