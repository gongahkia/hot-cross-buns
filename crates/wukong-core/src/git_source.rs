//! Git source URL canonicalisation without fetching repository content.

use crate::{
    diagnostic::{Diagnostic, ErrorCode},
    identity::GitSourceIdentity,
    manifest::GitReference,
    source::SourceResult,
};
use url::Url;

/// A Git manifest declaration supplied to canonicalisation.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GitSourceRequest {
    url: String,
    reference: Option<GitReference>,
}

impl GitSourceRequest {
    /// Creates a Git source canonicalisation request.
    #[must_use]
    pub const fn new(url: String, reference: Option<GitReference>) -> Self {
        Self { url, reference }
    }

    /// Returns the declared repository URL.
    #[must_use]
    pub fn url(&self) -> &str {
        &self.url
    }

    /// Returns the optional branch, tag, or exact revision selector.
    #[must_use]
    pub fn reference(&self) -> Option<&GitReference> {
        self.reference.as_ref()
    }
}

/// Canonicalises a Git source location and validates its optional selector.
///
/// A canonical source identifies only the repository location. Git fetching
/// resolves a tag or branch to an immutable commit in W024.
///
/// # Errors
///
/// Returns a redacted diagnostic for unsupported, malformed, or credentialed
/// source locations and invalid revision selectors.
pub fn canonicalize_git_source(request: &GitSourceRequest) -> SourceResult<GitSourceIdentity> {
    if let Some(reference) = request.reference() {
        reference.validate().map_err(|error| {
            source_error(
                request.url(),
                format!("Git revision selector {error}"),
                "use a valid tag, branch, or complete commit ID",
            )
        })?;
    }
    canonicalize_git_url(request.url())
}

/// Canonicalises a supported Git repository URL without network I/O.
///
/// HTTPS URLs normalise their scheme, host, and default port through the
/// standards-compliant `url` parser. SSH URLs are validated but otherwise
/// retain their host spelling and path so user Git and SSH configuration keeps
/// its original meaning.
///
/// # Errors
///
/// Returns a redacted diagnostic when the source is malformed or unsupported.
pub fn canonicalize_git_url(value: &str) -> SourceResult<GitSourceIdentity> {
    if value.contains("://") {
        return canonicalize_uri(value);
    }
    validate_scp_style(value)?;
    Ok(GitSourceIdentity::new(value.to_owned()))
}

fn canonicalize_uri(value: &str) -> SourceResult<GitSourceIdentity> {
    let parsed = Url::parse(value).map_err(|error| {
        source_error(
            value,
            "Git repository URL is malformed",
            format!("correct the repository URL: {error}"),
        )
    })?;
    match parsed.scheme() {
        "https" => canonicalize_https(value, parsed),
        "ssh" => canonicalize_ssh(value),
        _ => Err(source_error(
            value,
            "Git repository URL must use HTTPS or SSH",
            "use https://... or ssh://...",
        )),
    }
}

fn canonicalize_https(value: &str, mut parsed: Url) -> SourceResult<GitSourceIdentity> {
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(source_error(
            value,
            "Git HTTPS URL must not contain credentials",
            "configure authentication outside wukong",
        ));
    }
    if parsed.query().is_some() || parsed.fragment().is_some() {
        return Err(source_error(
            value,
            "Git HTTPS URL must not contain a query or fragment",
            "use a repository URL without query parameters or fragments",
        ));
    }
    if parsed.host_str().is_none() || parsed.path().trim_matches('/').is_empty() {
        return Err(source_error(
            value,
            "Git HTTPS URL must identify a repository path",
            "use an HTTPS repository URL with a non-empty path",
        ));
    }
    if parsed.port() == Some(443) {
        parsed.set_port(None).map_err(|()| {
            source_error(
                value,
                "could not canonicalise Git HTTPS port",
                "use an HTTPS repository URL without an explicit default port",
            )
        })?;
    }
    Ok(GitSourceIdentity::new(parsed.into()))
}

fn canonicalize_ssh(value: &str) -> SourceResult<GitSourceIdentity> {
    validate_ssh_uri(value)?;
    Ok(GitSourceIdentity::new(format!("ssh://{}", &value[6..])))
}

fn validate_ssh_uri(value: &str) -> SourceResult<()> {
    let authority_and_path = value.get(6..).ok_or_else(|| {
        source_error(
            value,
            "Git SSH URL is malformed",
            "use ssh://[user@]host/path",
        )
    })?;
    if authority_and_path.contains(['?', '#']) {
        return Err(source_error(
            value,
            "Git SSH URL must not contain a query or fragment",
            "use an SSH repository URL without query parameters or fragments",
        ));
    }
    let (authority, path) = authority_and_path.split_once('/').ok_or_else(|| {
        source_error(
            value,
            "Git SSH URL must identify a repository path",
            "use ssh://[user@]host/path",
        )
    })?;
    validate_ssh_authority(value, authority)?;
    validate_repository_path(value, path)
}

fn validate_scp_style(value: &str) -> SourceResult<()> {
    let (authority, path) = value.split_once(':').ok_or_else(|| {
        source_error(
            value,
            "Git repository URL must use HTTPS or SSH",
            "use https://..., ssh://..., or Git's user@host:path SSH form",
        )
    })?;
    if authority.contains('/') {
        return Err(source_error(
            value,
            "Git SSH source is malformed",
            "use Git's user@host:path SSH form",
        ));
    }
    validate_ssh_authority(value, authority)?;
    validate_repository_path(value, path)
}

fn validate_ssh_authority(value: &str, authority: &str) -> SourceResult<()> {
    let (user, host_port) = match authority.split_once('@') {
        Some((user, host)) => (Some(user), host),
        None => (None, authority),
    };
    if authority.matches('@').count() > 1
        || user.is_some_and(|user| user.is_empty() || user.contains(':'))
        || host_port.is_empty()
        || host_port.chars().any(|character| {
            character.is_whitespace()
                || character.is_control()
                || matches!(character, '/' | '@' | '?' | '#')
        })
    {
        return Err(source_error(
            value,
            "Git SSH URL is malformed or contains credentials",
            "configure SSH authentication outside wukong",
        ));
    }
    if let Some((host, port)) = host_port.rsplit_once(':') {
        if host.is_empty() || port.parse::<u16>().is_err() || port == "0" {
            return Err(source_error(
                value,
                "Git SSH URL has an invalid port",
                "use an SSH port from 1 through 65535",
            ));
        }
    }
    Ok(())
}

fn validate_repository_path(value: &str, path: &str) -> SourceResult<()> {
    if path.trim_matches('/').is_empty()
        || path.contains(['?', '#'])
        || path
            .chars()
            .any(|character| character.is_whitespace() || character.is_control())
    {
        return Err(source_error(
            value,
            "Git repository URL must identify a non-empty path",
            "use a repository path without whitespace, queries, or fragments",
        ));
    }
    Ok(())
}

fn source_error(
    source: &str,
    message: impl AsRef<str>,
    recovery: impl AsRef<str>,
) -> Box<Diagnostic> {
    Box::new(
        Diagnostic::new(ErrorCode::UserInput, message)
            .with_source(source)
            .with_recovery(recovery),
    )
}
