//! Reusable package-management domain logic for `wukong`.

/// Structured diagnostics shared by every non-terminal-facing subsystem.
pub mod diagnostic;

/// Atomic creation of a minimal project manifest.
pub mod init;

/// Project-manifest parsing and validation.
pub mod manifest;

/// Godot project-root discovery.
pub mod project;
