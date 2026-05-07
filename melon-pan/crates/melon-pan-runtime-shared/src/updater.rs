//! Lightweight self-update probe against GitHub Releases.
//!
//! No auto-download or auto-restart; the goal is to tell the user that a
//! newer release exists and link them to the latest macOS DMG.

use melon_pan_core::{parse_json, JsonError, JsonValue};
use melon_pan_net::HttpClient;

/// Default repo for the upstream release feed. Override per-binary if forks
/// publish their own releases.
pub const DEFAULT_REPO: &str = "gongahkia/melon-pan";

#[derive(Debug)]
pub enum UpdaterError {
    Http(String),
    InvalidJson(JsonError),
    MissingField(&'static str),
}

impl std::fmt::Display for UpdaterError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            UpdaterError::Http(message) => write!(f, "update probe HTTP failed: {message}"),
            UpdaterError::InvalidJson(error) => write!(f, "release JSON parse error: {error:?}"),
            UpdaterError::MissingField(field) => {
                write!(f, "release JSON missing field: {field}")
            }
        }
    }
}

impl std::error::Error for UpdaterError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpdateStatus {
    pub current: String,
    pub latest: String,
    pub release_url: String,
    pub has_update: bool,
}

pub fn check_for_updates(repo: &str, current_version: &str) -> Result<UpdateStatus, UpdaterError> {
    let url = format!("https://api.github.com/repos/{repo}/releases/latest");
    let raw =
        HttpClient::public_get_text(&url).map_err(|error| UpdaterError::Http(error.to_string()))?;
    let root = parse_json(&raw).map_err(UpdaterError::InvalidJson)?;
    let tag = root
        .get("tag_name")
        .and_then(JsonValue::as_str)
        .ok_or(UpdaterError::MissingField("tag_name"))?
        .to_string();
    let release_url = root
        .get("html_url")
        .and_then(JsonValue::as_str)
        .unwrap_or("")
        .to_string();
    let latest_normalized = tag.trim_start_matches('v').to_string();
    let has_update = compare_versions(current_version, &latest_normalized).is_lt();
    Ok(UpdateStatus {
        current: current_version.to_string(),
        latest: latest_normalized,
        release_url,
        has_update,
    })
}

/// Numeric semver-ish comparison that ignores anything past the third dotted
/// segment. Pre-release tags like `0.2.0-rc1` parse to (0,2,0).
fn compare_versions(left: &str, right: &str) -> std::cmp::Ordering {
    let parts = |value: &str| {
        value
            .split(['-', '+'])
            .next()
            .unwrap_or("")
            .split('.')
            .map(|segment| segment.parse::<u64>().unwrap_or(0))
            .collect::<Vec<_>>()
    };
    let mut left_parts = parts(left);
    let mut right_parts = parts(right);
    while left_parts.len() < 3 {
        left_parts.push(0);
    }
    while right_parts.len() < 3 {
        right_parts.push(0);
    }
    left_parts[..3].cmp(&right_parts[..3])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compare_versions_ignores_pre_release_suffix() {
        assert!(compare_versions("0.1.0", "0.2.0-rc1").is_lt());
        assert!(compare_versions("0.2.0", "0.2.0-rc1").is_eq());
        assert!(compare_versions("1.0.0", "0.99.99").is_gt());
        assert!(compare_versions("0.1", "0.1.0").is_eq());
    }
}
