//! Reusable package-management domain logic for `wukong`.

/// Structured diagnostics shared by every non-terminal-facing subsystem.
pub mod diagnostic;

/// Atomic creation of a minimal project manifest.
pub mod init;

/// Canonical package and source identities.
pub mod identity;

/// Project-manifest parsing and validation.
pub mod manifest;

/// Transactional manifest editing.
pub mod manifest_edit;

/// Godot project-root discovery.
pub mod project;
