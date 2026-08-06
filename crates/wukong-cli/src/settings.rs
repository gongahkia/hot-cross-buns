//! User-scoped CLI presentation and installed-Godot preferences.

use crate::progress::{
    DEFAULT_BAR_THEME, DEFAULT_SPINNER, is_supported_bar_theme, is_supported_spinner,
};
use std::{
    env, fs,
    path::{Path, PathBuf},
};
use toml_edit::{DocumentMut, Item, TableLike};
use wukong_core::{
    diagnostic::{Diagnostic, ErrorCode},
    transactional_file::write_atomic,
};

/// The only settings schema accepted by this Wukong version.
pub const SETTINGS_SCHEMA: i64 = 1;
/// The settings file name under the platform configuration directory.
pub const SETTINGS_FILE_NAME: &str = "settings.toml";

/// User-scoped Wukong settings. These never affect a project's manifest or lockfile.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Settings {
    spinner: String,
    bar: String,
    godot_executable: Option<PathBuf>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            spinner: DEFAULT_SPINNER.to_owned(),
            bar: DEFAULT_BAR_THEME.to_owned(),
            godot_executable: None,
        }
    }
}

impl Settings {
    /// Returns the configured Rattles preset name.
    #[must_use]
    pub fn spinner(&self) -> &str {
        &self.spinner
    }

    /// Returns the configured Wukong bar theme name.
    #[must_use]
    pub fn bar(&self) -> &str {
        &self.bar
    }

    /// Returns the configured installed Godot executable, if any.
    #[must_use]
    pub fn godot_executable(&self) -> Option<&Path> {
        self.godot_executable.as_deref()
    }

    /// Updates one supported setting after validating its value.
    pub fn set(&mut self, key: &str, value: &str) -> Result<(), Box<Diagnostic>> {
        match key {
            "progress.spinner" => {
                if !is_supported_spinner(value) {
                    return Err(invalid(
                        "unknown Rattles spinner preset",
                        "run wukong settings list-spinners to inspect supported preset names",
                    ));
                }
                self.spinner = value.to_owned();
            }
            "progress.bar" => {
                if !is_supported_bar_theme(value) {
                    return Err(invalid(
                        "unknown progress bar theme",
                        "run wukong settings list-bars to inspect supported themes",
                    ));
                }
                self.bar = value.to_owned();
            }
            "godot.executable" => {
                let path = PathBuf::from(value);
                if !path.is_absolute() {
                    return Err(invalid(
                        "godot.executable must be an absolute path",
                        "provide the absolute path printed by wukong godot path",
                    ));
                }
                self.godot_executable = Some(path);
            }
            _ => {
                return Err(invalid(
                    format!("unsupported setting {key}"),
                    "use progress.spinner, progress.bar, or godot.executable",
                ));
            }
        }
        Ok(())
    }

    /// Resets one supported setting to its default or removes it.
    pub fn reset(&mut self, key: &str) -> Result<(), Box<Diagnostic>> {
        match key {
            "progress.spinner" => self.spinner = DEFAULT_SPINNER.to_owned(),
            "progress.bar" => self.bar = DEFAULT_BAR_THEME.to_owned(),
            "godot.executable" => self.godot_executable = None,
            _ => {
                return Err(invalid(
                    format!("unsupported setting {key}"),
                    "use progress.spinner, progress.bar, or godot.executable",
                ));
            }
        }
        Ok(())
    }

    /// Renders the stable schema-one TOML representation.
    #[must_use]
    pub fn to_toml(&self) -> String {
        let mut document = DocumentMut::new();
        document["schema"] = toml_edit::value(SETTINGS_SCHEMA);
        document["progress"]["spinner"] = toml_edit::value(&self.spinner);
        document["progress"]["bar"] = toml_edit::value(&self.bar);
        if let Some(executable) = &self.godot_executable {
            document["godot"]["executable"] =
                toml_edit::value(executable.to_string_lossy().as_ref());
        }
        document.to_string()
    }
}

/// Computes the platform-specific configuration path without creating it.
pub fn settings_path() -> Result<PathBuf, Box<Diagnostic>> {
    let root = if let Some(root) = env::var_os("WUKONG_CONFIG_DIR") {
        PathBuf::from(root)
    } else {
        platform_config_root().ok_or_else(|| {
            invalid(
                "could not determine a Wukong configuration directory",
                "set WUKONG_CONFIG_DIR to an accessible directory",
            )
        })?
    };
    Ok(root.join("wukong").join(SETTINGS_FILE_NAME))
}

/// Loads settings or returns defaults when the settings file is absent.
pub fn load() -> Result<(Settings, PathBuf), Box<Diagnostic>> {
    let path = settings_path()?;
    let settings = match fs::read_to_string(&path) {
        Ok(input) => parse(&path, &input)?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Settings::default(),
        Err(error) => {
            return Err(Box::new(
                Diagnostic::new(
                    ErrorCode::UserInput,
                    format!("could not read Wukong settings {}", path.display()),
                )
                .with_cause(error)
                .with_recovery("check the settings file permissions or set WUKONG_CONFIG_DIR"),
            ));
        }
    };
    Ok((settings, path))
}

/// Writes settings atomically after ensuring the parent configuration directory exists.
pub fn save(path: &Path, settings: &Settings) -> Result<(), Box<Diagnostic>> {
    let directory = path.parent().ok_or_else(|| {
        invalid(
            "Wukong settings path has no parent directory",
            "set WUKONG_CONFIG_DIR to a directory path",
        )
    })?;
    fs::create_dir_all(directory).map_err(|error| {
        Box::new(
            Diagnostic::new(
                ErrorCode::InternalFailure,
                format!(
                    "could not create Wukong settings directory {}",
                    directory.display()
                ),
            )
            .with_cause(error)
            .with_recovery("check configuration-directory permissions and retry"),
        )
    })?;
    write_atomic(path, settings.to_toml().as_bytes())
}

fn parse(path: &Path, input: &str) -> Result<Settings, Box<Diagnostic>> {
    let document = input.parse::<DocumentMut>().map_err(|error| {
        invalid(
            format!("invalid Wukong settings syntax in {}", path.display()),
            format!("{error}"),
        )
    })?;
    let root = document.as_table();
    reject_unknown(path, root, &["schema", "progress", "godot"], "root")?;
    let schema = root
        .get("schema")
        .and_then(Item::as_integer)
        .ok_or_else(|| {
            invalid(
                format!("Wukong settings {} require integer schema", path.display()),
                "missing or invalid schema",
            )
        })?;
    if schema != SETTINGS_SCHEMA {
        return Err(invalid(
            format!("Wukong settings schema must be {SETTINGS_SCHEMA}"),
            "unsupported schema",
        ));
    }

    let mut settings = Settings::default();
    if let Some(progress) = root.get("progress") {
        let progress = progress
            .as_table_like()
            .ok_or_else(|| invalid("progress must be a table", "invalid progress setting"))?;
        reject_unknown(path, progress, &["spinner", "bar"], "progress")?;
        if let Some(spinner) = progress.get("spinner") {
            settings.set("progress.spinner", string(spinner, "progress.spinner")?)?;
        }
        if let Some(bar) = progress.get("bar") {
            settings.set("progress.bar", string(bar, "progress.bar")?)?;
        }
    }
    if let Some(godot) = root.get("godot") {
        let godot = godot
            .as_table_like()
            .ok_or_else(|| invalid("godot must be a table", "invalid godot setting"))?;
        reject_unknown(path, godot, &["executable"], "godot")?;
        if let Some(executable) = godot.get("executable") {
            settings.set("godot.executable", string(executable, "godot.executable")?)?;
        }
    }
    Ok(settings)
}

fn string<'a>(item: &'a Item, key: &str) -> Result<&'a str, Box<Diagnostic>> {
    item.as_str()
        .ok_or_else(|| invalid(format!("{key} must be a string"), "invalid setting type"))
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
                format!(
                    "unknown Wukong settings field {scope}.{key} in {}",
                    path.display()
                ),
                "unknown setting",
            ));
        }
    }
    Ok(())
}

fn platform_config_root() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        env::var_os("HOME")
            .map(PathBuf::from)
            .map(|home| home.join("Library/Application Support"))
    }
    #[cfg(target_os = "windows")]
    {
        env::var_os("APPDATA")
            .or_else(|| {
                env::var_os("USERPROFILE")
                    .map(|home| PathBuf::from(home).join("AppData/Roaming").into_os_string())
            })
            .map(PathBuf::from)
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")))
    }
    #[cfg(not(any(unix, target_os = "windows")))]
    {
        None
    }
}

fn invalid(message: impl Into<String>, recovery: impl Into<String>) -> Box<Diagnostic> {
    Box::new(Diagnostic::new(ErrorCode::UserInput, message.into()).with_recovery(recovery.into()))
}

#[cfg(test)]
mod tests {
    use super::{SETTINGS_SCHEMA, Settings, parse};
    use std::path::Path;

    #[test]
    fn invariant_defaults_are_portable_and_do_not_select_an_engine() {
        assert_eq!(Settings::default().spinner(), "simple-dots");
        assert_eq!(Settings::default().bar(), "classic");
        assert!(Settings::default().godot_executable().is_none());
    }

    #[test]
    fn invariant_schema_one_settings_round_trip_deterministically() {
        let mut settings = Settings::default();
        settings
            .set("progress.spinner", "dots")
            .expect("preset should work");
        settings
            .set("progress.bar", "rect")
            .expect("bar should work");
        settings
            .set(
                "godot.executable",
                "/Applications/Godot.app/Contents/MacOS/Godot",
            )
            .expect("path should work");
        let parsed =
            parse(Path::new("settings.toml"), &settings.to_toml()).expect("settings parse");
        assert_eq!(parsed, settings);
        assert!(
            settings
                .to_toml()
                .contains(&format!("schema = {SETTINGS_SCHEMA}"))
        );
    }

    #[test]
    fn invariant_unknown_or_invalid_settings_fail_before_command_execution() {
        let unknown = parse(Path::new("settings.toml"), "schema = 1\nunknown = true\n")
            .expect_err("unknown field must fail");
        assert!(unknown.message().contains("unknown Wukong settings field"));
        let invalid_spinner = parse(
            Path::new("settings.toml"),
            "schema = 1\n[progress]\nspinner = \"not-a-spinner\"\n",
        )
        .expect_err("unknown spinner must fail");
        assert!(
            invalid_spinner
                .message()
                .contains("unknown Rattles spinner")
        );
    }
}
