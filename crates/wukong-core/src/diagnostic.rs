//! Structured errors that preserve context while redacting source credentials.

use std::{
    error::Error,
    fmt::{self, Display, Formatter},
    path::PathBuf,
};

/// Stable categories used to select process exit codes in the CLI.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ErrorKind {
    /// The user supplied invalid input or requested an invalid operation.
    User,
    /// A package source could not be accessed or interpreted.
    Source,
    /// Content did not match a required integrity check.
    Integrity,
    /// An unexpected failure prevented the operation from completing.
    Internal,
}

/// Stable error codes emitted by the core library.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ErrorCode {
    /// A project path, manifest, or requested operation is invalid.
    UserInput,
    /// A source cannot be fetched, read, or interpreted.
    SourceAccess,
    /// Content failed checksum, hash, or cache-integrity verification.
    IntegrityFailure,
    /// An internal I/O or invariant failure occurred.
    InternalFailure,
}

impl ErrorCode {
    /// Returns the stable category for this code.
    #[must_use]
    pub const fn kind(self) -> ErrorKind {
        match self {
            Self::UserInput => ErrorKind::User,
            Self::SourceAccess => ErrorKind::Source,
            Self::IntegrityFailure => ErrorKind::Integrity,
            Self::InternalFailure => ErrorKind::Internal,
        }
    }
}

impl Display for ErrorCode {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        let code = match self {
            Self::UserInput => "WUK001",
            Self::SourceAccess => "WUK002",
            Self::IntegrityFailure => "WUK003",
            Self::InternalFailure => "WUK004",
        };
        formatter.write_str(code)
    }
}

/// A source description that never retains embedded credentials.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RedactedSource(String);

impl RedactedSource {
    /// Redacts embedded user information and sensitive query values.
    #[must_use]
    pub fn new(value: impl AsRef<str>) -> Self {
        Self(redact_sensitive_source(value.as_ref()))
    }

    /// Returns the safe source description.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl Display for RedactedSource {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

/// Describes whether an operation changed project files.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Modification {
    /// No project file was changed.
    None,
    /// Files were prepared in a staging directory.
    Staged(PathBuf),
    /// Files were committed to the project directory.
    Applied(PathBuf),
}

impl Display for Modification {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        match self {
            Self::None => formatter.write_str("none"),
            Self::Staged(path) => write!(formatter, "staged {}", path.display()),
            Self::Applied(path) => write!(formatter, "applied {}", path.display()),
        }
    }
}

/// Describes the result of a rollback attempt.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RollbackStatus {
    /// No rollback was required because the project was unchanged.
    NotRequired,
    /// Rollback was attempted and restored the previous state.
    Succeeded,
    /// Rollback was attempted but did not restore the previous state.
    Failed,
    /// Changes exist but rollback was not attempted.
    NotAttempted,
}

impl Display for RollbackStatus {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotRequired => formatter.write_str("not required"),
            Self::Succeeded => formatter.write_str("succeeded"),
            Self::Failed => formatter.write_str("failed"),
            Self::NotAttempted => formatter.write_str("not attempted"),
        }
    }
}

/// A safe, structured error returned by the core library.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Diagnostic {
    code: ErrorCode,
    message: String,
    package: Option<String>,
    source: Option<RedactedSource>,
    modification: Modification,
    rollback: RollbackStatus,
    recovery: Option<String>,
    cause: Option<RedactedCause>,
}

impl Diagnostic {
    /// Creates a diagnostic with no project modifications recorded.
    #[must_use]
    pub fn new(code: ErrorCode, message: impl AsRef<str>) -> Self {
        Self {
            code,
            message: redact_sensitive_source(message.as_ref()),
            package: None,
            source: None,
            modification: Modification::None,
            rollback: RollbackStatus::NotRequired,
            recovery: None,
            cause: None,
        }
    }

    /// Attaches the affected package name.
    #[must_use]
    pub fn with_package(mut self, package: impl Into<String>) -> Self {
        self.package = Some(package.into());
        self
    }

    /// Attaches a source after removing embedded credentials.
    #[must_use]
    pub fn with_source(mut self, source: impl AsRef<str>) -> Self {
        self.source = Some(RedactedSource::new(source));
        self
    }

    /// Records the project modification state at failure.
    #[must_use]
    pub fn with_modification(mut self, modification: Modification) -> Self {
        self.modification = modification;
        self
    }

    /// Records the rollback state at failure.
    #[must_use]
    pub fn with_rollback(mut self, rollback: RollbackStatus) -> Self {
        self.rollback = rollback;
        self
    }

    /// Adds a concrete recovery action.
    #[must_use]
    pub fn with_recovery(mut self, recovery: impl AsRef<str>) -> Self {
        self.recovery = Some(redact_sensitive_source(recovery.as_ref()));
        self
    }

    /// Adds a cause whose displayed text is redacted before retention.
    #[must_use]
    pub fn with_cause(mut self, cause: impl Display) -> Self {
        self.cause = Some(RedactedCause(redact_sensitive_source(&cause.to_string())));
        self
    }

    /// Returns the stable diagnostic code.
    #[must_use]
    pub const fn code(&self) -> ErrorCode {
        self.code
    }

    /// Returns the diagnostic category.
    #[must_use]
    pub const fn kind(&self) -> ErrorKind {
        self.code.kind()
    }

    /// Returns the safe human-readable failure summary.
    #[must_use]
    pub fn message(&self) -> &str {
        &self.message
    }

    /// Returns the affected package, if known.
    #[must_use]
    pub fn package(&self) -> Option<&str> {
        self.package.as_deref()
    }

    /// Returns the redacted source, if known.
    #[must_use]
    pub fn source_description(&self) -> Option<&RedactedSource> {
        self.source.as_ref()
    }

    /// Returns the project modification state.
    #[must_use]
    pub const fn modification(&self) -> &Modification {
        &self.modification
    }

    /// Returns the rollback state.
    #[must_use]
    pub const fn rollback(&self) -> RollbackStatus {
        self.rollback
    }

    /// Returns the recovery action, if available.
    #[must_use]
    pub fn recovery(&self) -> Option<&str> {
        self.recovery.as_deref()
    }

    /// Returns the redacted cause, if available.
    #[must_use]
    pub fn cause(&self) -> Option<&str> {
        self.cause.as_ref().map(RedactedCause::as_str)
    }
}

impl Display for Diagnostic {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        write!(formatter, "error[{}]: {}", self.code, self.message)
    }
}

impl Error for Diagnostic {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        self.cause
            .as_ref()
            .map(|cause| cause as &(dyn Error + 'static))
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct RedactedCause(String);

impl RedactedCause {
    fn as_str(&self) -> &str {
        &self.0
    }
}

impl Display for RedactedCause {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl Error for RedactedCause {}

fn redact_sensitive_source(value: &str) -> String {
    let with_redacted_user_info = redact_user_info(value);
    redact_sensitive_query_values(&with_redacted_user_info)
}

fn redact_user_info(value: &str) -> String {
    let Some(scheme_end) = value.find("://") else {
        return value.to_owned();
    };
    let authority_start = scheme_end + 3;
    let authority_end = value[authority_start..]
        .find(['/', '?', '#'])
        .map_or(value.len(), |offset| authority_start + offset);
    let authority = &value[authority_start..authority_end];
    let Some(user_info_end) = authority.rfind('@') else {
        return value.to_owned();
    };

    let mut redacted = String::with_capacity(value.len());
    redacted.push_str(&value[..authority_start]);
    redacted.push_str("<redacted>@");
    redacted.push_str(&authority[user_info_end + 1..]);
    redacted.push_str(&value[authority_end..]);
    redacted
}

fn redact_sensitive_query_values(value: &str) -> String {
    let Some(query_start) = value.find('?') else {
        return value.to_owned();
    };
    let query_content_start = query_start + 1;
    let query_end = value[query_content_start..]
        .find(|character: char| character == '#' || character.is_whitespace())
        .map_or(value.len(), |offset| query_content_start + offset);
    let query = &value[query_content_start..query_end];
    let mut redacted = String::with_capacity(value.len());
    redacted.push_str(&value[..query_content_start]);

    for (index, parameter) in query.split('&').enumerate() {
        if index > 0 {
            redacted.push('&');
        }
        let Some((key, _)) = parameter.split_once('=') else {
            redacted.push_str(parameter);
            continue;
        };
        if is_sensitive_query_key(key) {
            redacted.push_str(key);
            redacted.push_str("=<redacted>");
        } else {
            redacted.push_str(parameter);
        }
    }

    redacted.push_str(&value[query_end..]);
    redacted
}

fn is_sensitive_query_key(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    key.contains("token")
        || key.contains("secret")
        || key.contains("password")
        || key.contains("credential")
        || key == "key"
        || key.contains("api_key")
        || key.contains("apikey")
}

#[cfg(test)]
mod tests {
    use super::{Diagnostic, ErrorCode, Modification, RedactedSource, RollbackStatus};
    use std::error::Error;

    #[test]
    fn invariant_diagnostic_redacts_source_credentials_everywhere() {
        let secret = "never-display-this";
        let source =
            format!("https://user:{secret}@example.test/addon?access_token={secret}&branch=main");
        let diagnostic = Diagnostic::new(ErrorCode::SourceAccess, format!("failed: {source}"))
            .with_source(&source)
            .with_cause(format!("request rejected: {source}"));

        assert!(!diagnostic.message().contains(secret));
        assert!(
            !diagnostic
                .source_description()
                .expect("source should be recorded")
                .as_str()
                .contains(secret)
        );
        assert!(
            !diagnostic
                .cause()
                .expect("cause should be recorded")
                .contains(secret)
        );
        assert!(Error::source(&diagnostic).is_some());
    }

    #[test]
    fn invariant_diagnostic_defaults_prove_no_project_change() {
        let diagnostic = Diagnostic::new(ErrorCode::UserInput, "manifest is invalid");

        assert_eq!(diagnostic.modification(), &Modification::None);
        assert_eq!(diagnostic.rollback(), RollbackStatus::NotRequired);
    }

    #[test]
    fn invariant_source_redaction_preserves_safe_identity() {
        let source = RedactedSource::new(
            "https://git:password@example.test/addon?version=1.2.3&api_key=secret",
        );

        assert_eq!(
            source.as_str(),
            "https://<redacted>@example.test/addon?version=1.2.3&api_key=<redacted>"
        );
    }
}
