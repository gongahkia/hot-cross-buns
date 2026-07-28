//! Source-neutral adapter contracts for package acquisition.

use crate::{diagnostic::Diagnostic, identity::SourceIdentity};
use semver::Version;
use std::{
    collections::BTreeSet,
    error::Error,
    fmt::{self, Display, Formatter},
};

/// The result type used by source adapters.
pub type SourceResult<T> = std::result::Result<T, Box<Diagnostic>>;

/// A source-neutral immutable revision recorded after resolution.
#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct ImmutableSourceId(String);

impl ImmutableSourceId {
    /// Creates a non-empty immutable source identifier.
    ///
    /// # Errors
    ///
    /// Returns [`ImmutableSourceIdError`] when `value` is empty or whitespace.
    pub fn new(value: impl Into<String>) -> Result<Self, ImmutableSourceIdError> {
        let value = value.into();
        if value.trim().is_empty() {
            Err(ImmutableSourceIdError)
        } else {
            Ok(Self(value))
        }
    }

    /// Returns the immutable source identifier.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl Display for ImmutableSourceId {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

/// An invalid immutable source-identifier error.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ImmutableSourceIdError;

impl Display for ImmutableSourceIdError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        formatter.write_str("immutable source identifier must not be empty")
    }
}

impl Error for ImmutableSourceIdError {}

/// A resolved source that can expose its immutable revision.
pub trait ResolvedSource {
    /// Returns the immutable source identifier.
    fn immutable_id(&self) -> &ImmutableSourceId;
}

/// Version-discovery capability for one source request.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum VersionAvailability {
    /// The source has no meaningful version catalogue.
    Unsupported,
    /// Versions known to the source, in deterministic order.
    Available(BTreeSet<Version>),
}

/// Whether a resolved source can be used with networking disabled.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OfflineAvailability {
    /// The resolved source can be acquired without network access.
    Available,
    /// Required source content is unavailable offline.
    Missing,
}

/// A source implementation boundary with no protocol-specific shared fields.
pub trait SourceAdapter {
    /// Source-specific declaration data.
    type Request;
    /// A request resolved to an immutable source revision.
    type Resolution: ResolvedSource;
    /// Source-specific fetched artifact or directory handle.
    type Fetched;
    /// Source-specific integrity information.
    type IntegrityMetadata;
    /// Source-specific package-layout information.
    type LayoutMetadata;

    /// Produces the canonical source identity for one source request.
    ///
    /// # Errors
    ///
    /// Returns a structured diagnostic when the request cannot be canonicalised.
    fn canonical_identity(&self, request: &Self::Request) -> SourceResult<SourceIdentity>;

    /// Discovers versions when the source has a version catalogue.
    ///
    /// # Errors
    ///
    /// Returns a structured diagnostic when version discovery fails.
    fn available_versions(&self, request: &Self::Request) -> SourceResult<VersionAvailability>;

    /// Resolves a request to a source revision that can be persisted immutably.
    ///
    /// # Errors
    ///
    /// Returns a structured diagnostic when immutable resolution fails.
    fn resolve(&self, request: &Self::Request) -> SourceResult<Self::Resolution>;

    /// Fetches or otherwise materialises the resolved source.
    ///
    /// # Errors
    ///
    /// Returns a structured diagnostic when source acquisition fails.
    fn fetch(&self, resolved: &Self::Resolution) -> SourceResult<Self::Fetched>;

    /// Returns integrity information for fetched source content.
    ///
    /// # Errors
    ///
    /// Returns a structured diagnostic when integrity metadata is unavailable.
    fn integrity_metadata(&self, fetched: &Self::Fetched) -> SourceResult<Self::IntegrityMetadata>;

    /// Returns package-layout metadata without selecting a layout implicitly.
    ///
    /// # Errors
    ///
    /// Returns a structured diagnostic when layout metadata cannot be read.
    fn layout_metadata(&self, fetched: &Self::Fetched) -> SourceResult<Self::LayoutMetadata>;

    /// Reports whether the resolved source can be fetched while offline.
    ///
    /// # Errors
    ///
    /// Returns a structured diagnostic when offline availability cannot be determined.
    fn offline_availability(
        &self,
        resolved: &Self::Resolution,
    ) -> SourceResult<OfflineAvailability>;
}
