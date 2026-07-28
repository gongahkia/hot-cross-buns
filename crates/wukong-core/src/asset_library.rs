//! Read-only resolution for Godot's official Asset Library.

use crate::{
    diagnostic::{Diagnostic, ErrorCode},
    http_archive::{CachedArchive, HttpArchiveFetcher, canonicalize_archive_url},
};
use serde_json::Value;
use std::{
    fmt::{self, Display, Formatter},
    io::Read,
};
use ureq::Agent;

/// The official `AssetLib` API endpoint.
pub const OFFICIAL_API_URL: &str = "https://godotengine.org/asset-library/api";
const MAX_METADATA_BYTES: u64 = 1024 * 1024;

/// An `AssetLib` stable numeric asset identifier.
#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct AssetId(String);

impl AssetId {
    /// Parses a positive decimal `AssetLib` ID.
    ///
    /// # Errors
    ///
    /// Returns an error when the ID is not a positive decimal integer.
    pub fn parse(value: impl Into<String>) -> Result<Self, AssetIdError> {
        let value = value.into();
        if value.is_empty() || value == "0" || !value.bytes().all(|byte| byte.is_ascii_digit()) {
            return Err(AssetIdError);
        }
        Ok(Self(value))
    }

    /// Returns the canonical decimal ID.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Error returned for an invalid `AssetLib` ID.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct AssetIdError;
impl Display for AssetIdError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        formatter.write_str("must be a positive decimal AssetLib asset ID")
    }
}
impl std::error::Error for AssetIdError {}

/// Read-only official `AssetLib` metadata client.
#[derive(Clone, Debug)]
pub struct AssetLibraryClient {
    api_url: String,
}

impl AssetLibraryClient {
    /// Uses the official `AssetLib` endpoint.
    #[must_use]
    pub fn official() -> Self {
        Self {
            api_url: format!("{OFFICIAL_API_URL}/"),
        }
    }

    /// Creates a client for a credential-free HTTPS AssetLib-compatible endpoint.
    ///
    /// # Errors
    ///
    /// Returns a diagnostic for an unsafe API endpoint.
    pub fn new(api_url: &str) -> Result<Self, Box<Diagnostic>> {
        let api_url = canonicalize_archive_url(api_url)?;
        Ok(Self {
            api_url: format!("{}/", api_url.trim_end_matches('/')),
        })
    }

    /// Resolves one addon ID to a checksum-addressed archive.
    ///
    /// # Errors
    ///
    /// Returns a diagnostic when metadata is unavailable, incomplete, not an
    /// addon, or cannot produce a verified archive.
    pub fn resolve(
        &self,
        id: &AssetId,
        archive_fetcher: &HttpArchiveFetcher,
        offline: bool,
    ) -> Result<AssetLibraryResolution, Box<Diagnostic>> {
        if offline {
            return Err(source(
                &self.api_url,
                format!(
                    "AssetLib metadata for asset {} is unavailable offline",
                    id.as_str()
                ),
                "run without --offline to lock this AssetLib dependency",
            ));
        }
        let metadata = self.fetch_metadata(id)?;
        if metadata.asset_type != "addon" {
            return Err(incomplete(
                id,
                "AssetLib asset is not an addon",
                "select an AssetLib addon rather than a project, template, or demo",
            ));
        }
        let archive = match metadata.download_sha256.as_deref() {
            Some(sha256) => archive_fetcher.fetch(&metadata.download_url, sha256, false)?,
            None => archive_fetcher.fetch_computing_sha256(&metadata.download_url, false)?,
        };
        Ok(AssetLibraryResolution { metadata, archive })
    }

    fn fetch_metadata(&self, id: &AssetId) -> Result<AssetLibraryMetadata, Box<Diagnostic>> {
        let endpoint = format!("{}asset/{}", self.api_url, id.as_str());
        let agent: Agent = Agent::config_builder().https_only(true).build().into();
        let response = agent.get(&endpoint).call().map_err(|error| {
            source(&self.api_url, "could not retrieve AssetLib metadata", error)
        })?;
        if !response.status().is_success() {
            return Err(source(
                &self.api_url,
                "AssetLib returned an unsuccessful metadata response",
                format!("server returned HTTP {}", response.status()),
            ));
        }
        let mut input = response
            .into_body()
            .into_reader()
            .take(MAX_METADATA_BYTES + 1);
        let mut body = String::new();
        input
            .read_to_string(&mut body)
            .map_err(|error| source(&self.api_url, "could not read AssetLib metadata", error))?;
        if body.len() as u64 > MAX_METADATA_BYTES {
            return Err(source(
                &self.api_url,
                "AssetLib metadata response exceeds the size limit",
                "retry later or report the oversized upstream response",
            ));
        }
        parse_metadata(id, &body)
    }
}

/// Asset metadata used during one lock operation.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AssetLibraryMetadata {
    asset_type: String,
    version: Option<String>,
    license: Option<String>,
    download_url: String,
    download_sha256: Option<String>,
}
impl AssetLibraryMetadata {
    /// Returns the canonical upstream artifact URL.
    #[must_use]
    pub fn download_url(&self) -> &str {
        &self.download_url
    }

    /// Returns the upstream version text, when supplied.
    #[must_use]
    pub fn version(&self) -> Option<&str> {
        self.version.as_deref()
    }
    /// Returns the upstream licence text, when supplied.
    #[must_use]
    pub fn license(&self) -> Option<&str> {
        self.license.as_deref()
    }
}

/// A selected `AssetLib` artifact converted to a generic cache object.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AssetLibraryResolution {
    metadata: AssetLibraryMetadata,
    archive: CachedArchive,
}
impl AssetLibraryResolution {
    /// Returns upstream metadata from this resolution.
    #[must_use]
    pub const fn metadata(&self) -> &AssetLibraryMetadata {
        &self.metadata
    }
    /// Returns the verified immutable archive.
    #[must_use]
    pub const fn archive(&self) -> &CachedArchive {
        &self.archive
    }
}

fn parse_metadata(id: &AssetId, input: &str) -> Result<AssetLibraryMetadata, Box<Diagnostic>> {
    let value: Value = serde_json::from_str(input)
        .map_err(|error| incomplete(id, "AssetLib returned invalid JSON metadata", error))?;
    let object = value
        .as_object()
        .ok_or_else(|| incomplete(id, "AssetLib metadata must be an object", "retry later"))?;
    if string_field(object, "asset_id") != Some(id.as_str()) {
        return Err(incomplete(
            id,
            "AssetLib metadata returned a mismatched asset ID",
            "retry later",
        ));
    }
    let asset_type = required_field(object, "type", id)?;
    let download_url = required_field(object, "download_url", id)?;
    canonicalize_archive_url(&download_url).map_err(|_| {
        incomplete(
            id,
            "AssetLib metadata returned an unsafe download URL",
            "retry later",
        )
    })?;
    let download_sha256 = string_field(object, "download_hash")
        .filter(|value| !value.is_empty())
        .map(str::to_ascii_lowercase)
        .map(|value| {
            if value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
                Ok(value)
            } else {
                Err(incomplete(
                    id,
                    "AssetLib metadata returned an invalid archive checksum",
                    "retry later",
                ))
            }
        })
        .transpose()?;
    Ok(AssetLibraryMetadata {
        asset_type,
        version: string_field(object, "version_string").map(str::to_owned),
        license: string_field(object, "cost").map(str::to_owned),
        download_url,
        download_sha256,
    })
}

fn required_field(
    object: &serde_json::Map<String, Value>,
    field: &str,
    id: &AssetId,
) -> Result<String, Box<Diagnostic>> {
    string_field(object, field)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| {
            incomplete(
                id,
                format!("AssetLib metadata is missing {field}"),
                "retry later",
            )
        })
}

fn string_field<'a>(object: &'a serde_json::Map<String, Value>, field: &str) -> Option<&'a str> {
    object.get(field).and_then(Value::as_str)
}

fn source(url: &str, message: impl AsRef<str>, recovery: impl Display) -> Box<Diagnostic> {
    Box::new(
        Diagnostic::new(ErrorCode::SourceAccess, message)
            .with_source(url)
            .with_recovery(recovery.to_string()),
    )
}

fn incomplete(id: &AssetId, message: impl AsRef<str>, recovery: impl Display) -> Box<Diagnostic> {
    Box::new(
        Diagnostic::new(ErrorCode::SourceAccess, message)
            .with_package(id.as_str())
            .with_recovery(recovery.to_string()),
    )
}

#[cfg(test)]
mod tests {
    use super::{AssetId, parse_metadata};

    #[test]
    fn invariant_asset_metadata_requires_a_matching_addon_with_a_safe_artifact() {
        let id = AssetId::parse("42").expect("asset ID should parse");
        let metadata = parse_metadata(&id, r#"{"asset_id":"42","type":"addon","download_url":"https://fixture.test/addon.zip","download_hash":""}"#).expect("metadata should parse");
        assert_eq!(metadata.version(), None);
        assert!(parse_metadata(&id, r#"{"asset_id":"41","type":"addon","download_url":"https://fixture.test/addon.zip"}"#).is_err());
        assert!(parse_metadata(&id, r#"{"asset_id":"42","type":"project","download_url":"https://fixture.test/addon.zip"}"#).is_ok());
        assert!(
            parse_metadata(
                &id,
                r#"{"asset_id":"42","type":"addon","download_url":"http://fixture.test/addon.zip"}"#
            )
            .is_err()
        );
    }

    #[test]
    fn invariant_asset_ids_are_positive_decimal_values() {
        for invalid in ["", "0", "-1", "1.5", "asset"] {
            assert!(AssetId::parse(invalid).is_err());
        }
        assert_eq!(
            AssetId::parse("123").expect("ID should parse").as_str(),
            "123"
        );
    }
}
