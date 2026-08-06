//! Discovery of a user-selected Godot executable without executing it.

use crate::diagnostic::{Diagnostic, ErrorCode};
use std::{
    env, fs,
    path::{Path, PathBuf},
};

/// Environment variable containing an explicit Godot executable path.
pub const GODOT_EXECUTABLE_ENV: &str = "WUKONG_GODOT_EXECUTABLE";

/// How the selected executable was discovered.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum GodotExecutableSource {
    /// An explicit caller-provided path.
    Explicit,
    /// The `WUKONG_GODOT_EXECUTABLE` environment variable.
    Environment,
    /// A user-selected executable in Wukong's global settings.
    Settings,
    /// A matching executable found in `PATH`.
    Path,
    /// A conventional platform install location.
    CommonLocation,
}

impl GodotExecutableSource {
    /// Returns a stable human-readable source label.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Explicit => "explicit path",
            Self::Environment => "WUKONG_GODOT_EXECUTABLE",
            Self::Settings => "Wukong settings",
            Self::Path => "PATH",
            Self::CommonLocation => "common platform location",
        }
    }
}

/// One discovered executable and its source.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GodotExecutable {
    path: PathBuf,
    source: GodotExecutableSource,
}

impl GodotExecutable {
    /// Returns the executable path.
    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Returns how the executable was selected.
    #[must_use]
    pub const fn source(&self) -> GodotExecutableSource {
        self.source
    }
}

/// Locates a Godot executable without launching it.
///
/// Precedence is an explicit path, `WUKONG_GODOT_EXECUTABLE`, `PATH`, then
/// conventional paths for the current target platform. A missing explicit or
/// environment-configured path is an error; an absent unconfigured executable
/// returns `Ok(None)`.
///
/// # Errors
///
/// Returns a diagnostic when an explicit or environment-configured path is not
/// a usable executable file.
pub fn discover_godot_executable(
    explicit: Option<&Path>,
) -> Result<Option<GodotExecutable>, Box<Diagnostic>> {
    let configured = env::var_os(GODOT_EXECUTABLE_ENV).map(PathBuf::from);
    discover_with_configured(
        explicit,
        configured.as_deref(),
        None,
        path_candidates(),
        common_candidates(),
    )
}

/// Locates Godot while considering a validated user-scoped preference.
///
/// The explicit argument and `WUKONG_GODOT_EXECUTABLE` keep their established
/// precedence. A configured Wukong setting is considered only before `PATH`
/// and common platform locations, and an invalid configured path is an error.
///
/// # Errors
///
/// Returns a diagnostic when an explicit, environment, or configured path is
/// not a usable executable file.
pub fn discover_godot_executable_with_configured(
    explicit: Option<&Path>,
    configured: Option<&Path>,
) -> Result<Option<GodotExecutable>, Box<Diagnostic>> {
    let environment = env::var_os(GODOT_EXECUTABLE_ENV).map(PathBuf::from);
    discover_with_configured(
        explicit,
        environment.as_deref(),
        configured,
        path_candidates(),
        common_candidates(),
    )
}

#[cfg(test)]
fn discover_with(
    explicit: Option<&Path>,
    configured: Option<&Path>,
    path: Vec<PathBuf>,
    common: Vec<PathBuf>,
) -> Result<Option<GodotExecutable>, Box<Diagnostic>> {
    discover_with_configured(explicit, configured, None, path, common)
}

fn discover_with_configured(
    explicit: Option<&Path>,
    environment: Option<&Path>,
    configured: Option<&Path>,
    path: Vec<PathBuf>,
    common: Vec<PathBuf>,
) -> Result<Option<GodotExecutable>, Box<Diagnostic>> {
    if let Some(path) = explicit {
        return required(path, GodotExecutableSource::Explicit).map(Some);
    }
    if let Some(path) = environment {
        return required(path, GodotExecutableSource::Environment).map(Some);
    }
    if let Some(path) = configured {
        return required(path, GodotExecutableSource::Settings).map(Some);
    }
    if let Some(path) = path.into_iter().find(|path| is_executable(path)) {
        return Ok(Some(GodotExecutable {
            path,
            source: GodotExecutableSource::Path,
        }));
    }
    Ok(common
        .into_iter()
        .find(|path| is_executable(path))
        .map(|path| GodotExecutable {
            path,
            source: GodotExecutableSource::CommonLocation,
        }))
}

fn required(
    path: &Path,
    source: GodotExecutableSource,
) -> Result<GodotExecutable, Box<Diagnostic>> {
    if is_executable(path) {
        return Ok(GodotExecutable {
            path: path.to_path_buf(),
            source,
        });
    }
    Err(Box::new(
        Diagnostic::new(
            ErrorCode::UserInput,
            format!(
                "Godot executable from {} is not usable: {}",
                source.as_str(),
                path.display()
            ),
        )
        .with_recovery("provide a readable executable file for Godot 4"),
    ))
}

fn path_candidates() -> Vec<PathBuf> {
    let names = executable_names();
    env::var_os("PATH")
        .map(|value| {
            env::split_paths(&value)
                .flat_map(|directory| names.iter().map(move |name| directory.join(name)))
                .collect()
        })
        .unwrap_or_default()
}

fn common_candidates() -> Vec<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        let mut paths = vec![
            PathBuf::from("/Applications/Godot.app/Contents/MacOS/Godot"),
            PathBuf::from("/Applications/Godot_mono.app/Contents/MacOS/Godot"),
        ];
        if let Some(home) = env::var_os("HOME") {
            paths.push(PathBuf::from(home).join("Applications/Godot.app/Contents/MacOS/Godot"));
        }
        paths
    }
    #[cfg(target_os = "linux")]
    {
        vec![
            PathBuf::from("/usr/local/bin/godot4"),
            PathBuf::from("/usr/bin/godot4"),
            PathBuf::from("/snap/bin/godot4"),
            PathBuf::from("/usr/local/bin/godot"),
            PathBuf::from("/usr/bin/godot"),
        ]
    }
    #[cfg(target_os = "windows")]
    {
        let mut paths = Vec::new();
        for variable in ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"] {
            if let Some(root) = env::var_os(variable) {
                paths.push(PathBuf::from(root).join("Godot/Godot.exe"));
            }
        }
        paths
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        Vec::new()
    }
}

fn executable_names() -> &'static [&'static str] {
    #[cfg(target_os = "windows")]
    {
        &["Godot.exe", "godot.exe", "godot4.exe"]
    }
    #[cfg(not(target_os = "windows"))]
    {
        &["godot4", "godot", "Godot"]
    }
}

fn is_executable(path: &Path) -> bool {
    let Ok(metadata) = fs::metadata(path) else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o111 != 0
    }
    #[cfg(windows)]
    {
        path.extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("exe"))
    }
    #[cfg(not(any(unix, windows)))]
    {
        true
    }
}

#[cfg(test)]
mod tests {
    use super::{GodotExecutableSource, discover_with, discover_with_configured};
    use std::{fs, path::Path};
    use tempfile::TempDir;

    #[test]
    fn invariant_explicit_and_environment_executables_have_deterministic_precedence() {
        let fixture = Fixture::new();
        let explicit = fixture.executable("explicit");
        let environment = fixture.executable("environment");
        let path = fixture.executable("path");

        let selected = discover_with(Some(&explicit), Some(&environment), vec![path], Vec::new())
            .expect("selection should work")
            .expect("explicit executable should select");

        assert_eq!(selected.path(), explicit);
        assert_eq!(selected.source(), GodotExecutableSource::Explicit);
    }

    #[test]
    fn invariant_invalid_configured_executable_does_not_silently_fall_back() {
        let fixture = Fixture::new();
        let missing = fixture.path().join("missing-godot");
        let fallback = fixture.executable("fallback");

        let error = discover_with(None, Some(&missing), vec![fallback], Vec::new())
            .expect_err("invalid configured path should fail");

        assert!(error.message().contains("WUKONG_GODOT_EXECUTABLE"));
    }

    #[test]
    fn invariant_settings_executable_precedes_path_but_not_environment() {
        let fixture = Fixture::new();
        let environment = fixture.executable("environment");
        let configured = fixture.executable("configured");
        let path = fixture.executable("path");

        let selected = discover_with_configured(
            None,
            Some(&environment),
            Some(&configured),
            vec![path],
            Vec::new(),
        )
        .expect("selection should work")
        .expect("environment executable should select");
        assert_eq!(selected.source(), GodotExecutableSource::Environment);

        let selected = discover_with_configured(
            None,
            None,
            Some(&configured),
            vec![fixture.executable("path-second")],
            Vec::new(),
        )
        .expect("selection should work")
        .expect("settings executable should select");
        assert_eq!(selected.path(), configured);
        assert_eq!(selected.source(), GodotExecutableSource::Settings);
    }

    #[test]
    fn invariant_absent_unconfigured_executable_is_reported_without_guessing() {
        assert!(
            discover_with(None, None, Vec::new(), Vec::new())
                .expect("unconfigured discovery should work")
                .is_none()
        );
    }

    struct Fixture {
        directory: TempDir,
    }

    impl Fixture {
        fn new() -> Self {
            Self {
                directory: TempDir::new().expect("fixture directory should exist"),
            }
        }

        fn path(&self) -> &Path {
            self.directory.path()
        }

        fn executable(&self, name: &str) -> std::path::PathBuf {
            #[cfg(windows)]
            let path = self.path().join(format!("{name}.exe"));
            #[cfg(not(windows))]
            let path = self.path().join(name);
            fs::write(&path, "fixture").expect("fixture executable should write");
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let mut permissions = fs::metadata(&path)
                    .expect("fixture executable should stat")
                    .permissions();
                permissions.set_mode(0o755);
                fs::set_permissions(&path, permissions).expect("fixture executable should chmod");
            }
            path
        }
    }
}
