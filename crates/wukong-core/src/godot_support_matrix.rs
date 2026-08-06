//! Reviewed repository configuration for supported Godot branches.

use crate::diagnostic::{Diagnostic, ErrorCode};
use std::{collections::BTreeSet, fs, path::Path};
use toml_edit::{Document, Item, TableLike};

/// The only Godot support-matrix schema accepted by this Wukong version.
pub const GODOT_SUPPORT_MATRIX_SCHEMA: i64 = 1;

/// A validated Godot branch represented by its major and minor components.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct GodotBranch {
    major: u16,
    minor: u16,
}

impl GodotBranch {
    /// Parses a stable `4.x` branch series.
    ///
    /// # Errors
    ///
    /// Returns a user diagnostic when the series is not exactly `4.<minor>`.
    pub fn parse(series: &str) -> Result<Self, Box<Diagnostic>> {
        let Some((major, minor)) = series.split_once('.') else {
            return Err(invalid_branch(series));
        };
        if minor.contains('.') || major != "4" || minor.is_empty() || minor.starts_with('0') {
            return Err(invalid_branch(series));
        }
        let minor = minor.parse::<u16>().map_err(|_| invalid_branch(series))?;
        Ok(Self { major: 4, minor })
    }

    /// Returns the canonical stable branch series.
    #[must_use]
    pub fn as_str(self) -> String {
        format!("{}.{}", self.major, self.minor)
    }
}

/// The maintained level assigned to a reviewed Godot branch.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum GodotSupportLevel {
    /// Receives bug, security, and platform fixes.
    Supported,
    /// Receives security and platform fixes only.
    Partial,
}

impl GodotSupportLevel {
    /// Parses one allowed support status.
    ///
    /// # Errors
    ///
    /// Returns a user diagnostic for statuses that cannot be enforced locally.
    pub fn parse(value: &str) -> Result<Self, Box<Diagnostic>> {
        match value {
            "supported" => Ok(Self::Supported),
            "partial" => Ok(Self::Partial),
            _ => Err(Box::new(
                Diagnostic::new(
                    ErrorCode::UserInput,
                    format!("unsupported Godot support status {value:?}"),
                )
                .with_recovery("use supported or partial"),
            )),
        }
    }

    /// Returns the canonical support status string.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Supported => "supported",
            Self::Partial => "partial",
        }
    }
}

/// One reviewed branch in the repository support matrix.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct GodotSupportBranch {
    branch: GodotBranch,
    level: GodotSupportLevel,
}

impl GodotSupportBranch {
    /// Returns the configured Godot branch.
    #[must_use]
    pub const fn branch(self) -> GodotBranch {
        self.branch
    }

    /// Returns the configured support level.
    #[must_use]
    pub const fn level(self) -> GodotSupportLevel {
        self.level
    }
}

/// Typed, deterministically ordered repository support-matrix data.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GodotSupportMatrix {
    branches: Vec<GodotSupportBranch>,
}

impl GodotSupportMatrix {
    /// Loads and validates a repository-owned support matrix without network access.
    ///
    /// # Errors
    ///
    /// Returns a user diagnostic for unreadable, non-UTF-8, or invalid configuration.
    pub fn load(path: &Path) -> Result<Self, Box<Diagnostic>> {
        let input = fs::read_to_string(path).map_err(|error| {
            Box::new(
                Diagnostic::new(
                    ErrorCode::UserInput,
                    format!("could not read Godot support matrix {}", path.display()),
                )
                .with_cause(error)
                .with_recovery("restore config/godot-support.toml from a reviewed revision"),
            )
        })?;
        Self::parse(path, &input)
    }

    /// Parses and validates a schema-one support matrix without filesystem or network access.
    ///
    /// # Errors
    ///
    /// Returns a user diagnostic for invalid schema, unknown fields, duplicates, or stale shape.
    pub fn parse(path: &Path, input: &str) -> Result<Self, Box<Diagnostic>> {
        let document = Document::parse(input.to_owned())
            .map_err(|error| invalid(path, "invalid Godot support matrix syntax", error))?;
        let root = document.as_table();
        reject_unknown(path, root, &["schema", "branch"], "root")?;
        if integer(path, root.get("schema"), "schema")? != GODOT_SUPPORT_MATRIX_SCHEMA {
            return Err(invalid(
                path,
                "Godot support matrix schema must be 1",
                "unsupported schema",
            ));
        }
        let entries = root.get("branch").ok_or_else(|| {
            invalid(
                path,
                "Godot support matrix requires at least one branch",
                "missing branch entries",
            )
        })?;
        let entries = entries.as_array_of_tables().ok_or_else(|| {
            invalid(
                path,
                "branch must be an array of tables",
                "invalid branch entries",
            )
        })?;
        if entries.is_empty() {
            return Err(invalid(
                path,
                "Godot support matrix requires at least one branch",
                "empty branch entries",
            ));
        }
        let mut seen = BTreeSet::new();
        let mut previous = None;
        let mut branches = Vec::with_capacity(entries.len());
        for (index, entry) in entries.iter().enumerate() {
            let scope = format!("branch[{index}]");
            reject_unknown(path, entry, &["series", "support"], &scope)?;
            let branch = GodotBranch::parse(string(path, entry.get("series"), &scope, "series")?)?;
            let level =
                GodotSupportLevel::parse(string(path, entry.get("support"), &scope, "support")?)?;
            if !seen.insert(branch) {
                return Err(invalid(
                    path,
                    format!("duplicate Godot branch {}", branch.as_str()),
                    "duplicate branch",
                ));
            }
            if previous.is_some_and(|previous| previous >= branch) {
                return Err(invalid(
                    path,
                    "Godot support branches must be ascending",
                    "stale branch ordering",
                ));
            }
            previous = Some(branch);
            branches.push(GodotSupportBranch { branch, level });
        }
        Ok(Self { branches })
    }

    /// Returns branches in canonical ascending order.
    #[must_use]
    pub fn branches(&self) -> &[GodotSupportBranch] {
        &self.branches
    }
}

fn invalid_branch(series: &str) -> Box<Diagnostic> {
    Box::new(
        Diagnostic::new(
            ErrorCode::UserInput,
            format!("invalid Godot branch series {series:?}"),
        )
        .with_recovery("use a stable 4.x series such as 4.6"),
    )
}

fn invalid(
    path: &Path,
    message: impl Into<String>,
    cause: impl std::fmt::Display,
) -> Box<Diagnostic> {
    Box::new(
        Diagnostic::new(ErrorCode::UserInput, message.into())
            .with_cause(format!("{}: {cause}", path.display()))
            .with_recovery("restore config/godot-support.toml from a reviewed revision"),
    )
}

fn reject_unknown(
    path: &Path,
    table: &dyn TableLike,
    allowed: &[&str],
    scope: &str,
) -> Result<(), Box<Diagnostic>> {
    for (key, _) in table.iter() {
        if !allowed.contains(&key) {
            return Err(invalid(
                path,
                format!("unknown field {scope}.{key}"),
                "unknown field",
            ));
        }
    }
    Ok(())
}

fn integer(path: &Path, item: Option<&Item>, field: &str) -> Result<i64, Box<Diagnostic>> {
    item.and_then(Item::as_integer).ok_or_else(|| {
        invalid(
            path,
            format!("{field} must be an integer"),
            "invalid field type",
        )
    })
}

fn string<'a>(
    path: &Path,
    item: Option<&'a Item>,
    scope: &str,
    field: &str,
) -> Result<&'a str, Box<Diagnostic>> {
    item.and_then(Item::as_str).ok_or_else(|| {
        invalid(
            path,
            format!("{scope}.{field} must be a string"),
            "invalid field type",
        )
    })
}
