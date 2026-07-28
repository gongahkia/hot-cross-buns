//! Reusable package-management domain logic for `wukong`.

/// Structured diagnostics shared by every non-terminal-facing subsystem.
pub mod diagnostic;

/// Project-manifest parsing and validation.
pub mod manifest;

/// Godot project-root discovery.
pub mod project;
