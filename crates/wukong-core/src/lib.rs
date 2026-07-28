//! Reusable package-management domain logic for `wukong`.

/// Structured diagnostics shared by every non-terminal-facing subsystem.
pub mod diagnostic;

/// Secure staging extraction for ZIP archives.
pub mod archive;

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

/// Versioned content-addressed cache layout.
pub mod cache;

/// Optional package-owned metadata parsing.
pub mod package_metadata;

/// Project-manifest parsing and validation.
pub mod manifest;

/// Transactional manifest editing.
pub mod manifest_edit;

/// Godot project-root discovery.
pub mod project;

/// Source-adapter contracts.
pub mod source;
