//! Reusable package-management domain logic for `wukong`.

/// Structured diagnostics shared by every non-terminal-facing subsystem.
pub mod diagnostic;

/// Credential detection and redaction shared by source handling and diagnostics.
pub(crate) mod credentials;

/// Secure staging extraction for ZIP archives.
pub mod archive;

/// Feature-gated official Godot Asset Library metadata client.
#[cfg(feature = "asset-library")]
pub mod asset_library;

/// Atomic creation of a minimal project manifest.
pub mod init;

/// Deterministic installed-package ownership metadata.
pub mod installed_state;

/// Canonical package and source identities.
pub mod identity;

/// Local-path source adapter and content snapshots.
pub mod local_source;

/// Conservative package-layout detection.
pub mod layout;

/// Canonical package-tree preparation.
pub mod package_tree;

/// Versioned compatibility-corpus fixture parsing and verification.
pub mod compatibility_fixture;

/// Deterministic lockfile parsing and serialization.
pub mod lockfile;

/// Direct local-dependency lock construction.
pub mod direct_lock;

/// Direct local-path lockfile verification and synchronisation.
pub mod direct_sync;

/// Git source URL and revision canonicalisation.
pub mod git_source;

/// Project-level Godot compatibility inputs.
pub mod godot_compatibility;

/// Reviewed repository configuration for supported Godot branches.
pub mod godot_support_matrix;

/// Godot executable discovery without execution.
pub mod godot_executable;

/// Optional bounded headless Godot validation.
pub mod godot_validation;

/// Git fetching through the user-installed Git executable.
pub mod git_fetch;

/// HTTPS archive download, integrity verification, and cache publication.
pub mod http_archive;

/// Versioned content-addressed cache layout.
pub mod cache;

/// Required package-owned metadata parsing and authoring.
pub mod package_metadata;

/// Project-manifest parsing and validation.
pub mod manifest;

/// Project-owned source-catalog parsing.
pub mod source_catalog;

/// Git tag discovery for validated project source-catalog candidates.
pub mod source_catalog_git;

/// HTTPS archive acquisition for validated project source-catalog candidates.
pub mod source_catalog_http;

/// Lazy package-scoped source-catalog candidate acquisition.
pub mod source_catalog_acquisition;

/// Catalog-backed immutable graph-lock construction.
pub mod catalog_lock;

/// Previewable conversion from direct remote locks to catalog graph state.
pub mod migration;

/// Transactional project source-catalog editing.
pub mod source_catalog_edit;

/// Transactional manifest editing.
pub mod manifest_edit;

/// Read-only direct-source version availability reporting.
pub mod outdated;

/// Copy, hardlink, and reflink package-file materialisation.
pub mod materialization;

/// Desired package-file ownership maps and conflict checks.
pub mod ownership;

/// Godot project-root discovery.
pub mod project;

/// Transactional project-file reconciliation.
pub mod project_sync;

/// Cross-process advisory locking for mutable Wukong resources.
pub mod operation_lock;

/// Source-adapter contracts.
pub mod source;

/// Canonical semantic-version values and requirements.
pub mod semantic_version;

/// Lazy, deterministic transitive dependency resolution.
pub mod resolver;

/// Immutable dependency provenance derived from a lockfile.
pub mod provenance;

/// Deterministic views over the locked dependency graph.
pub mod dependency_graph;

/// Atomic project-file snapshots and replacement for dependency mutations.
pub mod transactional_file;
