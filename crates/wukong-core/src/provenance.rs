//! Deterministic dependency provenance derived from immutable lockfile entries.

use crate::{
    dependency_graph::LockedDependencyGraph,
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

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ProvenanceScope {
    Runtime,
    Development,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
struct ProvenanceDirectGroups {
    runtime: bool,
    development: bool,
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
    direct: ProvenanceDirectGroups,
    scope: ProvenanceScope,
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

    /// Returns whether the package is a direct runtime root.
    #[must_use]
    pub const fn is_direct_runtime(&self) -> bool {
        self.direct.runtime
    }

    /// Returns whether the package is a direct development root.
    #[must_use]
    pub const fn is_direct_development(&self) -> bool {
        self.direct.development
    }

    /// Returns whether the package belongs to the runtime closure.
    #[must_use]
    pub const fn is_runtime(&self) -> bool {
        matches!(self.scope, ProvenanceScope::Runtime)
    }

    /// Returns whether the package is development-only.
    #[must_use]
    pub const fn is_development(&self) -> bool {
        matches!(self.scope, ProvenanceScope::Development)
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
        Self::build(lockfile, None)
    }

    /// Derives provenance and canonical group state from a locked graph.
    #[must_use]
    pub fn from_graph(lockfile: &Lockfile, graph: &LockedDependencyGraph) -> Self {
        Self::build(lockfile, Some(graph))
    }

    fn build(lockfile: &Lockfile, graph: Option<&LockedDependencyGraph>) -> Self {
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
                let (direct, scope) = graph
                    .and_then(|graph| graph.packages().get(package.name()))
                    .map_or_else(
                        || {
                            (
                                ProvenanceDirectGroups::default(),
                                if package.development() {
                                    ProvenanceScope::Development
                                } else {
                                    ProvenanceScope::Runtime
                                },
                            )
                        },
                        |package| {
                            (
                                ProvenanceDirectGroups {
                                    runtime: package.is_direct_runtime(),
                                    development: package.is_direct_development(),
                                },
                                if package.is_development() {
                                    ProvenanceScope::Development
                                } else {
                                    ProvenanceScope::Runtime
                                },
                            )
                        },
                    );
                ProvenancePackage {
                    name: package.name().clone(),
                    source_kind,
                    canonical_source,
                    immutable_id: package.source().immutable_id().clone(),
                    immutable_revision,
                    source_sha256,
                    package_sha256: package.package_sha256().to_owned(),
                    direct,
                    scope,
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
