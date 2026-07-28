//! Human-readable diagnostics and stable process exit codes.

use wukong_core::diagnostic::{Diagnostic, ErrorKind};

/// Stable process exit codes for automation.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum ProcessExit {
    /// The command completed successfully.
    Success = 0,
    /// The manifest, arguments, or requested operation are invalid.
    User = 2,
    /// A package source could not be accessed or interpreted.
    Source = 3,
    /// Content failed a required integrity check.
    Integrity = 4,
    /// An unexpected internal failure occurred.
    Internal = 70,
}

impl ProcessExit {
    /// Returns the platform process exit code.
    #[must_use]
    pub const fn code(self) -> u8 {
        self as u8
    }

    /// Maps a core diagnostic to the CLI's stable exit-code family.
    #[must_use]
    pub const fn from_diagnostic(diagnostic: &Diagnostic) -> Self {
        match diagnostic.kind() {
            ErrorKind::User => Self::User,
            ErrorKind::Source => Self::Source,
            ErrorKind::Integrity => Self::Integrity,
            ErrorKind::Internal => Self::Internal,
        }
    }
}

/// Renders a diagnostic without terminal-control sequences.
#[must_use]
pub fn render_human(diagnostic: &Diagnostic, verbose: bool) -> String {
    let mut lines = vec![diagnostic.to_string()];
    if let Some(package) = diagnostic.package() {
        lines.push(format!("package: {package}"));
    }
    if let Some(source) = diagnostic.source_description() {
        lines.push(format!("source: {source}"));
    }
    lines.push(format!("modified: {}", diagnostic.modification()));
    lines.push(format!("rollback: {}", diagnostic.rollback()));
    if let Some(recovery) = diagnostic.recovery() {
        lines.push(format!("recovery: {recovery}"));
    }
    if verbose {
        if let Some(cause) = diagnostic.cause() {
            lines.push(format!("cause: {cause}"));
        }
    }
    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::{ProcessExit, render_human};
    use wukong_core::diagnostic::{Diagnostic, ErrorCode, Modification, RollbackStatus};

    #[test]
    fn diagnostic_output_answers_recovery_questions_without_a_cause() {
        let diagnostic = Diagnostic::new(ErrorCode::IntegrityFailure, "hash mismatch")
            .with_package("terrain3d")
            .with_source("https://user:secret@example.test/terrain3d")
            .with_modification(Modification::Staged("/tmp/wukong-stage".into()))
            .with_rollback(RollbackStatus::Succeeded)
            .with_recovery("remove the corrupted cache object and retry");
        let output = render_human(&diagnostic, false);

        assert!(output.contains("error[WUK003]: hash mismatch"));
        assert!(output.contains("package: terrain3d"));
        assert!(output.contains("source: https://<redacted>@example.test/terrain3d"));
        assert!(output.contains("modified: staged /tmp/wukong-stage"));
        assert!(output.contains("rollback: succeeded"));
        assert!(output.contains("recovery: remove the corrupted cache object and retry"));
        assert!(!output.contains("cause:"));
        assert!(!output.contains("secret"));
    }

    #[test]
    fn verbose_diagnostics_expose_only_redacted_causes() {
        let diagnostic = Diagnostic::new(ErrorCode::SourceAccess, "source unavailable")
            .with_cause("request https://user:secret@example.test/addon?token=secret failed");
        let output = render_human(&diagnostic, true);

        assert!(output.contains(
            "cause: request https://<redacted>@example.test/addon?token=<redacted> failed"
        ));
        assert!(!output.contains("secret"));
    }

    #[test]
    fn stable_exit_codes_cover_every_error_kind() {
        assert_eq!(ProcessExit::Success.code(), 0);
        assert_eq!(
            ProcessExit::from_diagnostic(&Diagnostic::new(ErrorCode::UserInput, "invalid")),
            ProcessExit::User
        );
        assert_eq!(
            ProcessExit::from_diagnostic(&Diagnostic::new(ErrorCode::SourceAccess, "missing")),
            ProcessExit::Source
        );
        assert_eq!(
            ProcessExit::from_diagnostic(&Diagnostic::new(ErrorCode::IntegrityFailure, "mismatch")),
            ProcessExit::Integrity
        );
        assert_eq!(
            ProcessExit::from_diagnostic(&Diagnostic::new(ErrorCode::InternalFailure, "failed")),
            ProcessExit::Internal
        );
    }
}
