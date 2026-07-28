//! Optional bounded Godot headless project checks.

use crate::{
    diagnostic::{Diagnostic, ErrorCode},
    godot_executable::GodotExecutable,
};
use std::{
    io::{self, Read},
    path::Path,
    process::{Command, ExitStatus, Stdio},
    thread,
    time::{Duration, Instant},
};

const MAX_CAPTURED_OUTPUT_BYTES: usize = 64 * 1024;
const MAX_CAPTURED_STREAM_BYTES: usize = MAX_CAPTURED_OUTPUT_BYTES / 2;

/// The result of one headless Godot project check.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum HeadlessValidationOutcome {
    /// Godot exited successfully within the timeout.
    Passed,
    /// Godot exited unsuccessfully; output has project paths redacted.
    Failed {
        /// The platform exit code, when available.
        exit_code: Option<i32>,
        /// Combined stdout and stderr with project paths redacted.
        output: String,
    },
    /// Wukong killed Godot after the configured timeout.
    TimedOut {
        /// Combined stdout and stderr with project paths redacted.
        output: String,
    },
}

/// Structured result for a bounded validation process.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HeadlessValidationReport {
    outcome: HeadlessValidationOutcome,
    elapsed: Duration,
}

impl HeadlessValidationReport {
    /// Returns the process outcome.
    #[must_use]
    pub const fn outcome(&self) -> &HeadlessValidationOutcome {
        &self.outcome
    }

    /// Returns elapsed wall-clock time.
    #[must_use]
    pub const fn elapsed(&self) -> Duration {
        self.elapsed
    }
}

/// Runs a recovery-mode headless project check with a hard timeout.
///
/// The invocation is `--headless --path <project> --editor --quit
/// --recovery-mode`. Recovery mode disables editor plugins, tool scripts, and
/// `GDExtensions` that can run during editor startup. Wukong does not pass any
/// package-defined commands or scripts to Godot.
///
/// # Errors
///
/// Returns a diagnostic when the process cannot start, cannot be observed, or
/// cannot be terminated after timeout.
pub fn run_headless_project_check(
    executable: &GodotExecutable,
    project: &Path,
    timeout: Duration,
) -> Result<HeadlessValidationReport, Box<Diagnostic>> {
    let start = Instant::now();
    let project_argument = project.to_string_lossy().into_owned();
    let mut child = Command::new(executable.path())
        .args([
            "--headless",
            "--path",
            project_argument.as_str(),
            "--editor",
            "--quit",
            "--recovery-mode",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| launch_error(executable.path(), error))?;
    let Some(stdout) = child.stdout.take() else {
        let _ = child.kill();
        let _ = child.wait();
        return Err(capture_setup_error("stdout"));
    };
    let Some(stderr) = child.stderr.take() else {
        let _ = child.kill();
        let _ = child.wait();
        return Err(capture_setup_error("stderr"));
    };
    let stdout_reader = spawn_capture(stdout);
    let stderr_reader = spawn_capture(stderr);
    let deadline = start + timeout;
    loop {
        match child.try_wait().map_err(wait_error)? {
            Some(status) => {
                return complete(
                    status,
                    project,
                    start.elapsed(),
                    stdout_reader,
                    stderr_reader,
                );
            }
            None if Instant::now() >= deadline => {
                if let Err(error) = child.kill() {
                    if error.kind() != io::ErrorKind::InvalidInput {
                        return Err(kill_error(error));
                    }
                }
                child.wait().map_err(wait_error)?;
                thread::sleep(Duration::from_millis(20));
                let output = collect_timeout_output(stdout_reader, stderr_reader)?;
                return Ok(HeadlessValidationReport {
                    outcome: HeadlessValidationOutcome::TimedOut {
                        output: redact_project_output(&output, project),
                    },
                    elapsed: start.elapsed(),
                });
            }
            None => thread::sleep(Duration::from_millis(20)),
        }
    }
}

fn complete(
    status: ExitStatus,
    project: &Path,
    elapsed: Duration,
    stdout_reader: thread::JoinHandle<io::Result<CapturedOutput>>,
    stderr_reader: thread::JoinHandle<io::Result<CapturedOutput>>,
) -> Result<HeadlessValidationReport, Box<Diagnostic>> {
    let outcome = if status.success() {
        HeadlessValidationOutcome::Passed
    } else {
        let output = collect_output(stdout_reader, stderr_reader)?;
        HeadlessValidationOutcome::Failed {
            exit_code: status.code(),
            output: redact_project_output(&output, project),
        }
    };
    Ok(HeadlessValidationReport { outcome, elapsed })
}

fn spawn_capture(
    reader: impl Read + Send + 'static,
) -> thread::JoinHandle<io::Result<CapturedOutput>> {
    thread::spawn(move || capture_stream(reader))
}

fn capture_stream(mut reader: impl Read) -> io::Result<CapturedOutput> {
    let mut output = Vec::new();
    let mut buffer = [0_u8; 8 * 1024];
    let mut truncated = false;
    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            return Ok(CapturedOutput { output, truncated });
        }
        let available = MAX_CAPTURED_STREAM_BYTES.saturating_sub(output.len());
        let retained = read.min(available);
        output.extend_from_slice(&buffer[..retained]);
        truncated |= retained < read;
    }
}

fn collect_output(
    stdout_reader: thread::JoinHandle<io::Result<CapturedOutput>>,
    stderr_reader: thread::JoinHandle<io::Result<CapturedOutput>>,
) -> Result<CapturedOutput, Box<Diagnostic>> {
    let stdout = join_capture(stdout_reader)?;
    let stderr = join_capture(stderr_reader)?;
    let mut output = stdout.output;
    output.extend_from_slice(&stderr.output);
    Ok(CapturedOutput {
        output,
        truncated: stdout.truncated || stderr.truncated,
    })
}

fn collect_timeout_output(
    stdout_reader: thread::JoinHandle<io::Result<CapturedOutput>>,
    stderr_reader: thread::JoinHandle<io::Result<CapturedOutput>>,
) -> Result<CapturedOutput, Box<Diagnostic>> {
    if stdout_reader.is_finished() && stderr_reader.is_finished() {
        return collect_output(stdout_reader, stderr_reader);
    }
    Ok(CapturedOutput {
        output: b"<output capture incomplete after timeout>".to_vec(),
        truncated: false,
    })
}

fn join_capture(
    reader: thread::JoinHandle<io::Result<CapturedOutput>>,
) -> Result<CapturedOutput, Box<Diagnostic>> {
    reader
        .join()
        .map_err(|_| {
            Box::new(
                Diagnostic::new(
                    ErrorCode::InternalFailure,
                    "Godot validation output capture panicked",
                )
                .with_recovery("retry validation and report this if it persists"),
            )
        })?
        .map_err(wait_error)
}

struct CapturedOutput {
    output: Vec<u8>,
    truncated: bool,
}

fn redact_project_output(output: &CapturedOutput, project: &Path) -> String {
    let project = project.to_string_lossy();
    let mut combined = String::from_utf8_lossy(&output.output).into_owned();
    if output.truncated {
        combined.push_str("\n<output truncated>");
    }
    combined = combined.replace(project.as_ref(), "<project>");
    combined
}

fn launch_error(path: &Path, error: io::Error) -> Box<Diagnostic> {
    Box::new(
        Diagnostic::new(
            ErrorCode::SourceAccess,
            format!("could not start Godot executable {}", path.display()),
        )
        .with_cause(error)
        .with_recovery("check the Godot executable path and permissions"),
    )
}

fn capture_setup_error(stream: &str) -> Box<Diagnostic> {
    Box::new(
        Diagnostic::new(
            ErrorCode::InternalFailure,
            format!("could not capture Godot validation {stream}"),
        )
        .with_recovery("retry validation and report this if it persists"),
    )
}

fn wait_error(error: io::Error) -> Box<Diagnostic> {
    Box::new(
        Diagnostic::new(
            ErrorCode::InternalFailure,
            "could not observe Godot validation",
        )
        .with_cause(error)
        .with_recovery("retry validation and report this if it persists"),
    )
}

fn kill_error(error: io::Error) -> Box<Diagnostic> {
    Box::new(
        Diagnostic::new(
            ErrorCode::InternalFailure,
            "could not stop timed out Godot validation",
        )
        .with_cause(error)
        .with_recovery("stop the Godot process manually before retrying"),
    )
}

#[cfg(all(test, unix))]
mod tests {
    use super::{HeadlessValidationOutcome, MAX_CAPTURED_OUTPUT_BYTES, run_headless_project_check};
    use crate::godot_executable::{GodotExecutable, discover_godot_executable};
    use std::{fs, path::Path, time::Duration};
    use tempfile::TempDir;

    #[cfg(unix)]
    #[test]
    fn invariant_failed_validation_redacts_project_paths_from_structured_output() {
        let fixture = Fixture::new();
        let executable = fixture.script("fail", "printf '%s' \"$3\"; exit 7");
        let report =
            run_headless_project_check(&executable, fixture.project(), Duration::from_secs(1))
                .expect("validation should complete");

        assert!(matches!(
            report.outcome(),
            HeadlessValidationOutcome::Failed {
                exit_code: Some(7),
                output,
            } if output.contains("<project>") && !output.contains(&fixture.project().display().to_string())
        ));
    }

    #[cfg(unix)]
    #[test]
    fn invariant_validation_timeout_does_not_wait_for_child_output() {
        let fixture = Fixture::new();
        let executable = fixture.script("sleep", "sleep 0.1");
        let report =
            run_headless_project_check(&executable, fixture.project(), Duration::from_millis(40))
                .expect("timed validation should complete");

        assert!(report.elapsed() < Duration::from_millis(500));
        assert!(matches!(
            report.outcome(),
            HeadlessValidationOutcome::TimedOut { .. }
        ));
    }

    #[cfg(unix)]
    #[test]
    fn invariant_validation_diagnostics_are_bounded() {
        let fixture = Fixture::new();
        let executable = fixture.script("noisy", "yes x | head -c 70000; exit 9");
        let report =
            run_headless_project_check(&executable, fixture.project(), Duration::from_secs(1))
                .expect("validation should complete");

        assert!(matches!(
            report.outcome(),
            HeadlessValidationOutcome::Failed { output, .. }
                if output.contains("<output truncated>")
                    && output.len() <= MAX_CAPTURED_OUTPUT_BYTES + 32
        ));
    }

    #[cfg(unix)]
    struct Fixture {
        directory: TempDir,
        project: std::path::PathBuf,
    }

    #[cfg(unix)]
    impl Fixture {
        fn new() -> Self {
            let directory = TempDir::new().expect("fixture directory should exist");
            let project = directory.path().join("project");
            fs::create_dir(&project).expect("project should create");
            Self { directory, project }
        }

        fn project(&self) -> &Path {
            &self.project
        }

        fn script(&self, name: &str, body: &str) -> GodotExecutable {
            use std::os::unix::fs::PermissionsExt;
            let path = self.directory.path().join(name);
            fs::write(&path, format!("#!/bin/sh\n{body}\n")).expect("script should write");
            let mut permissions = fs::metadata(&path)
                .expect("script should stat")
                .permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(&path, permissions).expect("script should chmod");
            discover_godot_executable(Some(&path))
                .expect("fixture executable should discover")
                .expect("explicit fixture executable should select")
        }
    }
}
