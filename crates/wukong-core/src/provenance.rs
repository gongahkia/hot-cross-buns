//! Deterministic dependency provenance derived from immutable lockfile entries.

use crate::{
    identity::PackageName,
    lockfile::{LockedSource, Lockfile},
    source::ImmutableSourceId,
};

/// The kind of source recorded for a locked package.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProvenanceSourceKind {
    /// A local content snapshot.
    Local,
    /// A Git checkout pinned to a commit.
    Git,
    /// A checksum-pinned HTTPS archive.
    Http,
}

impl ProvenanceSourceKind {
    /// Returns the stable machine-readable source-kind label.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Local => "local",
            Self::Git => "git",
            Self::Http => "http",
        }
    }
}

/// Immutable provenance for one package.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProvenancePackage {
    name: PackageName,
    source_kind: ProvenanceSourceKind,
    canonical_source: String,
    immutable_id: ImmutableSourceId,
    immutable_revision: Option<String>,
    source_sha256: Option<String>,
    package_sha256: String,
}

impl ProvenancePackage {
    /// Returns the package name.
    #[must_use]
    pub const fn name(&self) -> &PackageName {
        &self.name
    }

    /// Returns the source kind.
    #[must_use]
    pub const fn source_kind(&self) -> ProvenanceSourceKind {
        self.source_kind
    }

    /// Returns the canonical source location or local snapshot marker.
    #[must_use]
    pub fn canonical_source(&self) -> &str {
        &self.canonical_source
    }

    /// Returns the lockfile's immutable source identity.
    #[must_use]
    pub const fn immutable_id(&self) -> &ImmutableSourceId {
        &self.immutable_id
    }

    /// Returns the exact Git revision when the source is Git.
    #[must_use]
    pub fn immutable_revision(&self) -> Option<&str> {
        self.immutable_revision.as_deref()
    }

    /// Returns the source checksum for local and HTTPS sources.
    #[must_use]
    pub fn source_sha256(&self) -> Option<&str> {
        self.source_sha256.as_deref()
    }

    /// Returns the verified prepared-package tree checksum.
    #[must_use]
    pub fn package_sha256(&self) -> &str {
        &self.package_sha256
    }
}

/// A deterministic read-only report over every locked package.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProvenanceReport {
    packages: Vec<ProvenancePackage>,
}

impl ProvenanceReport {
    /// Derives provenance from a validated lockfile in package-name order.
    #[must_use]
    pub fn from_lockfile(lockfile: &Lockfile) -> Self {
        let packages = lockfile
            .packages()
            .values()
            .map(|package| {
                let (source_kind, canonical_source, immutable_revision, source_sha256) =
                    match package.source() {
                        LockedSource::Local(source) => (
                            ProvenanceSourceKind::Local,
                            format!("local:sha256:{}", source.sha256()),
                            None,
                            Some(source.sha256().to_owned()),
                        ),
                        LockedSource::Git(source) => (
                            ProvenanceSourceKind::Git,
                            source.url().to_owned(),
                            Some(source.commit().to_owned()),
                            None,
                        ),
                        LockedSource::Http(source) => (
                            ProvenanceSourceKind::Http,
                            source.url().to_owned(),
                            None,
                            Some(source.sha256().to_owned()),
                        ),
                    };
                ProvenancePackage {
                    name: package.name().clone(),
                    source_kind,
                    canonical_source,
                    immutable_id: package.source().immutable_id().clone(),
                    immutable_revision,
                    source_sha256,
                    package_sha256: package.package_sha256().to_owned(),
                }
            })
            .collect();
        Self { packages }
    }

    /// Returns provenance entries in canonical package-name order.
    #[must_use]
    pub fn packages(&self) -> &[ProvenancePackage] {
        &self.packages
    }
}
