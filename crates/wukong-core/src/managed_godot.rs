//! Resolution, verification, and ownership-safe installation of official Godot editors.
//!
//! This module deliberately accepts only official stable artifacts from
//! `godotengine/godot-builds`. It has no package-script surface and keeps
//! managed editors outside Wukong's disposable addon cache.

use crate::{
    archive::{ExtractionLimits, extract_zip},
    diagnostic::{Diagnostic, ErrorCode},
    operation_lock::AdvisoryLock,
    semantic_version::{SemanticVersion, VersionRequirement},
    transactional_file::write_atomic,
};
use serde_json::Value;
use sha2::{Digest, Sha512};
use std::{
    collections::BTreeMap,
    env, fmt,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    process::Command,
    str::FromStr,
    time::Duration,
};
use tempfile::Builder;
use ureq::Agent;

/// Environment variable overriding the managed Godot data root.
pub const GODOT_ENGINE_DIR_ENV: &str = "WUKONG_ENGINE_DIR";
/// The managed-engine layout version below the data root.
pub const MANAGED_GODOT_SCHEMA: &str = "v1";
const GITHUB_API: &str = "https://api.github.com/repos/godotengine/godot-builds";
const MAX_ENGINE_DOWNLOAD_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_METADATA_BYTES: u64 = 4 * 1024 * 1024;
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(10 * 60);

/// The official editor distribution family.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum GodotFlavor {
    /// The regular Godot editor.
    Standard,
    /// The official .NET-enabled Godot editor.
    Dotnet,
}

impl GodotFlavor {
    /// Returns the stable manifest and lockfile spelling.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Standard => "standard",
            Self::Dotnet => "dotnet",
        }
    }

    fn asset_suffix(self) -> &'static str {
        match self {
            Self::Standard => "",
            Self::Dotnet => "_mono",
        }
    }
}

impl fmt::Display for GodotFlavor {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl FromStr for GodotFlavor {
    type Err = GodotFlavorParseError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "standard" => Ok(Self::Standard),
            "dotnet" => Ok(Self::Dotnet),
            _ => Err(GodotFlavorParseError),
        }
    }
}

/// A stable parse error that does not expose untrusted input in diagnostics.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct GodotFlavorParseError;

impl fmt::Display for GodotFlavorParseError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("must be standard or dotnet")
    }
}

impl std::error::Error for GodotFlavorParseError {}

/// One supported official desktop editor target.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum GodotPlatform {
    /// A universal macOS editor bundle.
    MacosUniversal,
    /// A 64-bit x86 Linux editor.
    LinuxX86_64,
    /// A 64-bit ARM Linux editor.
    LinuxArm64,
    /// A 64-bit Windows editor.
    WindowsX86_64,
}

impl GodotPlatform {
    /// Returns the stable lockfile and installation-directory spelling.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::MacosUniversal => "macos-universal",
            Self::LinuxX86_64 => "linux-x86_64",
            Self::LinuxArm64 => "linux-arm64",
            Self::WindowsX86_64 => "windows-x86_64",
        }
    }

    fn asset_component(self) -> &'static str {
        match self {
            Self::MacosUniversal => "macos.universal",
            Self::LinuxX86_64 => "linux.x86_64",
            Self::LinuxArm64 => "linux.arm64",
            Self::WindowsX86_64 => "win64.exe",
        }
    }

    /// Returns the current supported target.
    #[must_use]
    pub const fn current() -> Option<Self> {
        #[cfg(target_os = "macos")]
        {
            Some(Self::MacosUniversal)
        }
        #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
        {
            Some(Self::LinuxX86_64)
        }
        #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
        {
            Some(Self::LinuxArm64)
        }
        #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
        {
            Some(Self::WindowsX86_64)
        }
        #[cfg(not(any(
            target_os = "macos",
            all(target_os = "linux", target_arch = "x86_64"),
            all(target_os = "linux", target_arch = "aarch64"),
            all(target_os = "windows", target_arch = "x86_64")
        )))]
        {
            None
        }
    }
}

impl fmt::Display for GodotPlatform {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl FromStr for GodotPlatform {
    type Err = GodotPlatformParseError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "macos-universal" => Ok(Self::MacosUniversal),
            "linux-x86_64" => Ok(Self::LinuxX86_64),
            "linux-arm64" => Ok(Self::LinuxArm64),
            "windows-x86_64" => Ok(Self::WindowsX86_64),
            _ => Err(GodotPlatformParseError),
        }
    }
}

/// A stable parse error for a managed target name.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct GodotPlatformParseError;

impl fmt::Display for GodotPlatformParseError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("must be macos-universal, linux-x86_64, linux-arm64, or windows-x86_64")
    }
}

impl std::error::Error for GodotPlatformParseError {}

/// A release artifact whose source and size were selected from the fixed official release.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GodotArtifact {
    name: String,
    url: String,
    sha512: String,
    bytes: u64,
}

impl GodotArtifact {
    /// Reconstructs a validated artifact from immutable lockfile fields.
    ///
    /// # Errors
    ///
    /// Returns a diagnostic when the persisted official artifact identity is
    /// malformed or unsafe.
    pub fn from_locked(
        name: String,
        url: String,
        sha512: String,
        bytes: u64,
    ) -> Result<Self, Box<Diagnostic>> {
        if name.is_empty() || name.contains(['/', '\\']) || bytes == 0 || bytes > MAX_ENGINE_DOWNLOAD_BYTES {
            return Err(source_error(
                "locked Godot artifact identity is invalid",
                "regenerate wukong.lock from an official stable release",
            ));
        }
        verified_official_url(&url, false)?;
        validate_sha512(&sha512)?;
        Ok(Self { name, url, sha512, bytes })
    }
    /// Returns the official asset name.
    #[must_use]
    pub fn name(&self) -> &str {
        &self.name
    }

    /// Returns the official HTTPS download URL.
    #[must_use]
    pub fn url(&self) -> &str {
        &self.url
    }

    /// Returns the lower-case SHA-512 checksum from `SHA512-SUMS.txt`.
    #[must_use]
    pub fn sha512(&self) -> &str {
        &self.sha512
    }

    /// Returns the exact release-declared byte size.
    #[must_use]
    pub const fn bytes(&self) -> u64 {
        self.bytes
    }
}

/// A fully verified official stable release selection for one platform and flavor.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OfficialGodotRelease {
    version: SemanticVersion,
    flavor: GodotFlavor,
    platform: GodotPlatform,
    tag: String,
    editor: GodotArtifact,
    templates: GodotArtifact,
}

impl OfficialGodotRelease {
    /// Reconstructs one selected platform release from immutable lockfile data.
    ///
    /// # Errors
    ///
    /// Returns a diagnostic when the release tag and exact stable version do
    /// not agree with the persisted official artifacts.
    pub fn from_locked(
        version: SemanticVersion,
        flavor: GodotFlavor,
        platform: GodotPlatform,
        tag: String,
        editor: GodotArtifact,
        templates: GodotArtifact,
    ) -> Result<Self, Box<Diagnostic>> {
        if tag != stable_tag(&version)? {
            return Err(source_error(
                "locked Godot release tag does not match its exact version",
                "regenerate wukong.lock from an official stable release",
            ));
        }
        if editor.name != editor_asset_name(&version, flavor, platform)
            || templates.name != template_asset_name(&version, flavor)
        {
            return Err(source_error(
                "locked Godot artifact name does not match the selected release identity",
                "regenerate wukong.lock from an official stable release",
            ));
        }
        Ok(Self { version, flavor, platform, tag, editor, templates })
    }
    /// Returns the exact stable editor version.
    #[must_use]
    pub const fn version(&self) -> &SemanticVersion {
        &self.version
    }

    /// Returns the editor family.
    #[must_use]
    pub const fn flavor(&self) -> GodotFlavor {
        self.flavor
    }

    /// Returns the selected target platform.
    #[must_use]
    pub const fn platform(&self) -> GodotPlatform {
        self.platform
    }

    /// Returns the canonical GitHub release tag.
    #[must_use]
    pub fn tag(&self) -> &str {
        &self.tag
    }

    /// Returns the verified editor archive.
    #[must_use]
    pub const fn editor(&self) -> &GodotArtifact {
        &self.editor
    }

    /// Returns the verified export-template archive.
    #[must_use]
    pub const fn templates(&self) -> &GodotArtifact {
        &self.templates
    }
}

/// Terminal-neutral managed-engine lifecycle feedback.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum EngineProgress {
    /// Beginning an indeterminate phase.
    Phase(&'static str),
    /// Download byte progress with an exact expected total.
    Download {
        /// Official artifact label.
        artifact: String,
        /// Bytes safely written so far.
        completed: u64,
        /// Exact release-declared total bytes.
        total: u64,
    },
}

/// Receiver for terminal-neutral managed-engine progress.
pub trait EngineProgressObserver: Send + Sync {
    /// Receives one lifecycle event.
    fn on_progress(&self, event: EngineProgress);
}

/// No-op default progress observer.
#[derive(Debug)]
pub struct NoEngineProgress;

impl EngineProgressObserver for NoEngineProgress {
    fn on_progress(&self, _: EngineProgress) {}
}

/// Resolves official release metadata from the fixed Godot builds repository.
#[derive(Clone, Debug)]
pub struct OfficialGodotClient {
    agent: Agent,
}

impl Default for OfficialGodotClient {
    fn default() -> Self {
        Self::new()
    }
}

impl OfficialGodotClient {
    /// Creates a client with bounded HTTPS-only requests.
    #[must_use]
    pub fn new() -> Self {
        Self {
            agent: Agent::config_builder()
                .https_only(true)
                .max_redirects(0)
                .timeout_global(Some(DOWNLOAD_TIMEOUT))
                .build()
                .into(),
        }
    }

    /// Fetches and verifies one exact official stable release for the target and flavor.
    pub fn exact_release(
        &self,
        version: &SemanticVersion,
        flavor: GodotFlavor,
        platform: GodotPlatform,
        observer: &dyn EngineProgressObserver,
    ) -> Result<OfficialGodotRelease, Box<Diagnostic>> {
        observer.on_progress(EngineProgress::Phase("resolving official Godot release"));
        let tag = stable_tag(version)?;
        let metadata = self.fetch_json(&format!("{GITHUB_API}/releases/tags/{tag}"))?;
        self.release_from_metadata(metadata, &tag, flavor, platform, observer)
    }

    /// Resolves the newest official stable release permitted by `requirement`.
    pub fn latest_compatible(
        &self,
        requirement: &VersionRequirement,
        flavor: GodotFlavor,
        platform: GodotPlatform,
        observer: &dyn EngineProgressObserver,
    ) -> Result<OfficialGodotRelease, Box<Diagnostic>> {
        observer.on_progress(EngineProgress::Phase("resolving latest compatible Godot"));
        let metadata = self.fetch_json(&format!("{GITHUB_API}/releases?per_page=100"))?;
        let releases = metadata.as_array().ok_or_else(|| source_error(
            "official Godot release listing was not an array",
            "retry later; report the release metadata shape if it persists",
        ))?;
        let mut versions = releases
            .iter()
            .filter(|release| !release.get("draft").and_then(Value::as_bool).unwrap_or(false))
            .filter(|release| !release.get("prerelease").and_then(Value::as_bool).unwrap_or(false))
            .filter_map(|release| {
                let tag = release.get("tag_name")?.as_str()?;
                let version = stable_version_from_tag(tag)?;
                requirement.matches(&version).then_some((version, tag.to_owned(), release))
            })
            .collect::<Vec<_>>();
        versions.sort_by(|left, right| right.0.cmp(&left.0));
        let Some((_, tag, release)) = versions.into_iter().next() else {
            return Err(source_error(
                format!("no official stable Godot release satisfies {requirement}"),
                "pin an available stable version or broaden project.godot",
            ));
        };
        self.release_from_metadata(release.clone(), &tag, flavor, platform, observer)
    }

    fn release_from_metadata(
        &self,
        metadata: Value,
        expected_tag: &str,
        flavor: GodotFlavor,
        platform: GodotPlatform,
        observer: &dyn EngineProgressObserver,
    ) -> Result<OfficialGodotRelease, Box<Diagnostic>> {
        let tag = metadata
            .get("tag_name")
            .and_then(Value::as_str)
            .filter(|tag| *tag == expected_tag)
            .ok_or_else(|| source_error(
                "official Godot release tag did not match the requested stable version",
                "retry later; report the release metadata shape if it persists",
            ))?;
        let version = stable_version_from_tag(tag).ok_or_else(|| source_error(
            "official Godot release tag was not a stable semantic version",
            "use an official stable Godot release",
        ))?;
        let assets = metadata
            .get("assets")
            .and_then(Value::as_array)
            .ok_or_else(|| source_error(
                "official Godot release did not include an assets array",
                "retry later; report the release metadata shape if it persists",
            ))?;
        let editor_name = editor_asset_name(&version, flavor, platform);
        let template_name = template_asset_name(&version, flavor);
        let sums_name = "SHA512-SUMS.txt";
        let editor = release_asset(assets, &editor_name)?;
        let templates = release_asset(assets, &template_name)?;
        let sums = release_asset(assets, sums_name)?;
        observer.on_progress(EngineProgress::Phase("fetching official Godot checksums"));
        let checksums = self.fetch_small_text(&sums.url, MAX_METADATA_BYTES)?;
        let checksums = parse_sha512_sums(&checksums)?;
        let editor = editor.with_sha512(checksums.get(&editor_name).ok_or_else(|| source_error(
            "official SHA512-SUMS.txt did not contain the expected editor asset",
            "retry later; do not install an unverified release artifact",
        ))?)?;
        let templates = templates.with_sha512(checksums.get(&template_name).ok_or_else(|| source_error(
            "official SHA512-SUMS.txt did not contain the expected export-template asset",
            "retry later; do not install an unverified release artifact",
        ))?)?;
        Ok(OfficialGodotRelease {
            version,
            flavor,
            platform,
            tag: tag.to_owned(),
            editor,
            templates,
        })
    }

    fn fetch_json(&self, url: &str) -> Result<Value, Box<Diagnostic>> {
        verified_official_url(url, true)?;
        let text = self.fetch_small_text(url, MAX_METADATA_BYTES)?;
        serde_json::from_str(&text).map_err(|error| {
            source_error(
                "official Godot release response was not valid JSON",
                format!("retry later; metadata parse error: {error}"),
            )
        })
    }

    fn fetch_small_text(&self, url: &str, limit: u64) -> Result<String, Box<Diagnostic>> {
        let mut response = self.open_official(url)?;
        let mut reader = response.body_mut().as_reader();
        let bytes = read_limited(&mut reader, limit, "official Godot release metadata")?;
        String::from_utf8(bytes).map_err(|_| source_error(
            "official Godot release metadata was not UTF-8",
            "retry later; report the release metadata shape if it persists",
        ))
    }

    fn open_official(&self, url: &str) -> Result<ureq::http::Response<ureq::Body>, Box<Diagnostic>> {
        let mut current = verified_official_initial_url(url)?;
        let mut redirects = 0_u8;
        loop {
            let response = self
                .agent
                .get(current.as_str())
                .header("Accept", "application/vnd.github+json")
                .header("User-Agent", "wukong-managed-godot")
                .call()
                .map_err(|_| source_error(
                    "could not contact the official Godot release service",
                    "check network access and retry",
                ))?;
            if !response.status().is_redirection() {
                if !response.status().is_success() {
                    return Err(source_error(
                        format!("official Godot release service returned HTTP {}", response.status()),
                        "check the requested stable version and retry",
                    ));
                }
                return Ok(response);
            }
            if redirects == 5 {
                return Err(source_error(
                    "official Godot release redirect limit was exceeded",
                    "retry later; do not use an untrusted release mirror",
                ));
            }
            let next = response
                .headers()
                .get("location")
                .and_then(|value| value.to_str().ok())
                .ok_or_else(|| source_error(
                    "official Godot release redirect did not include a valid location",
                    "retry later; do not use an untrusted release mirror",
                ))?;
            current = current.join(next).map_err(|_| source_error(
                "official Godot release redirect was invalid",
                "retry later; do not use an untrusted release mirror",
            ))?;
            verified_official_redirect(&current)?;
            redirects += 1;
        }
    }
}

#[derive(Clone, Debug)]
struct UnverifiedReleaseAsset {
    name: String,
    url: String,
    bytes: u64,
}

impl UnverifiedReleaseAsset {
    fn with_sha512(self, sha512: &str) -> Result<GodotArtifact, Box<Diagnostic>> {
        validate_sha512(sha512)?;
        Ok(GodotArtifact {
            name: self.name,
            url: self.url,
            sha512: sha512.to_owned(),
            bytes: self.bytes,
        })
    }
}

/// Wukong-owned managed-engine data root and install transaction service.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ManagedGodotStore {
    root: PathBuf,
}

impl ManagedGodotStore {
    /// Creates a managed store under an explicit root.
    pub fn new(root: PathBuf) -> Result<Self, Box<Diagnostic>> {
        if root.as_os_str().is_empty() {
            return Err(internal_error(
                "managed Godot root must not be empty",
                "set WUKONG_ENGINE_DIR to a non-empty directory",
            ));
        }
        Ok(Self { root })
    }

    /// Returns the configured root before schema partitioning.
    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Resolves the platform data directory or honours `WUKONG_ENGINE_DIR`.
    pub fn from_environment(configured: Option<&Path>) -> Result<Self, Box<Diagnostic>> {
        if let Some(root) = env::var_os(GODOT_ENGINE_DIR_ENV) {
            return Self::new(PathBuf::from(root));
        }
        if let Some(root) = configured {
            return Self::new(root.to_path_buf());
        }
        let root = platform_data_root().ok_or_else(|| internal_error(
            "could not determine a platform data directory for managed Godot",
            "set WUKONG_ENGINE_DIR or godot.engine-dir",
        ))?;
        Self::new(root.join("wukong").join("engines"))
    }

    /// Installs a verified editor transactionally or reuses a valid owned install.
    pub fn install(
        &self,
        release: &OfficialGodotRelease,
        include_templates: bool,
        client: &OfficialGodotClient,
        offline: bool,
        observer: &dyn EngineProgressObserver,
    ) -> Result<ManagedGodot, Box<Diagnostic>> {
        let destination = self.installation_directory(release);
        let lock_path = self.lock_path(release);
        let _lock = AdvisoryLock::try_acquire(&lock_path, "this managed Godot editor")?;
        if let Some(installed) = self.read_installed(release)? {
            if include_templates && !installed.templates_installed() {
                self.install_templates_locked(&installed, release, client, offline, observer)?;
            }
            return self.read_installed(release)?.ok_or_else(|| internal_error(
                "managed Godot install disappeared while completing templates",
                "retry the installation",
            ));
        }
        let parent = destination.parent().ok_or_else(|| internal_error(
            "managed Godot installation path has no parent",
            "set WUKONG_ENGINE_DIR to a directory",
        ))?;
        fs::create_dir_all(parent).map_err(|error| io_error(
            "could not create managed Godot installation directory",
            parent,
            error,
        ))?;
        observer.on_progress(EngineProgress::Phase("downloading Godot editor"));
        let archive = self.fetch_artifact(&release.editor, client, offline, observer)?;
        observer.on_progress(EngineProgress::Phase("extracting verified Godot editor"));
        let staging = Builder::new()
            .prefix(".wukong-engine-stage-")
            .tempdir_in(parent)
            .map_err(|error| io_error("could not create managed Godot staging", parent, error))?;
        let extracted = extract_zip(&archive, staging.path(), ExtractionLimits::default())?;
        let editor = locate_editor(extracted.root(), release.platform)?;
        enable_self_contained_mode(&editor, release.platform)?;
        let inspected = inspect_godot_version(&editor)?;
        if &inspected != release.version() {
            return Err(source_error(
                "verified Godot editor did not report the selected release version",
                "remove the staged installation and retry; do not use this artifact",
            ));
        }
        let metadata = managed_metadata(release, extracted.root(), &editor, false)?;
        write_atomic(&extracted.root().join("wukong-engine.toml"), metadata.as_bytes())?;
        if destination.exists() {
            return self.read_installed(release)?.ok_or_else(|| internal_error(
                "managed Godot destination exists but is not a valid Wukong install",
                "remove only the Wukong-owned engine directory and retry",
            ));
        }
        fs::rename(extracted.root(), &destination).map_err(|error| io_error(
            "could not publish managed Godot installation",
            &destination,
            error,
        ))?;
        let mut installed = self.read_installed(release)?.ok_or_else(|| internal_error(
            "managed Godot installation was not readable after publication",
            "retry the installation",
        ))?;
        if include_templates {
            self.install_templates_locked(&installed, release, client, offline, observer)?;
            installed = self.read_installed(release)?.ok_or_else(|| internal_error(
                "managed Godot installation disappeared while completing templates",
                "retry the installation",
            ))?;
        }
        Ok(installed)
    }

    /// Installs matching verified export templates for an owned managed editor.
    pub fn install_templates(
        &self,
        release: &OfficialGodotRelease,
        client: &OfficialGodotClient,
        offline: bool,
        observer: &dyn EngineProgressObserver,
    ) -> Result<ManagedGodot, Box<Diagnostic>> {
        let lock_path = self.lock_path(release);
        let _lock = AdvisoryLock::try_acquire(&lock_path, "this managed Godot editor")?;
        let installed = self.read_installed(release)?.ok_or_else(|| source_error(
            "matching managed Godot editor is not installed",
            format!("run wukong godot install {} --flavor {}", release.version(), release.flavor()),
        ))?;
        self.install_templates_locked(&installed, release, client, offline, observer)?;
        self.read_installed(release)?.ok_or_else(|| internal_error(
            "managed Godot installation disappeared while installing templates",
            "retry the template installation",
        ))
    }

    /// Lists only validated Wukong-owned managed installations.
    pub fn list(&self) -> Result<Vec<ManagedGodot>, Box<Diagnostic>> {
        let root = self.root.join(MANAGED_GODOT_SCHEMA);
        let mut entries = Vec::new();
        let Ok(versions) = fs::read_dir(&root) else {
            return Ok(entries);
        };
        for version in versions.flatten() {
            let Ok(flavors) = fs::read_dir(version.path()) else { continue };
            for flavor in flavors.flatten() {
                let Ok(platforms) = fs::read_dir(flavor.path()) else { continue };
                for platform in platforms.flatten() {
                    if let Some(installed) = parse_managed_metadata(&platform.path())? {
                        entries.push(installed);
                    }
                }
            }
        }
        entries.sort_by(|left, right| {
            left.version
                .cmp(&right.version)
                .then(left.flavor.cmp(&right.flavor))
                .then(left.platform.cmp(&right.platform))
        });
        Ok(entries)
    }

    /// Safely removes a validated Wukong-owned managed editor installation.
    pub fn remove(
        &self,
        version: &SemanticVersion,
        flavor: GodotFlavor,
        platform: GodotPlatform,
    ) -> Result<bool, Box<Diagnostic>> {
        let release = ReleaseIdentity { version, flavor, platform };
        let destination = self.installation_directory_for(&release);
        let lock_path = self.lock_path_for(&release);
        let _lock = AdvisoryLock::try_acquire(&lock_path, "this managed Godot editor")?;
        let Some(installed) = parse_managed_metadata(&destination)? else {
            return Ok(false);
        };
        if installed.version != *version || installed.flavor != flavor || installed.platform != platform {
            return Err(source_error(
                "refusing to remove a directory not owned by the requested managed Godot identity",
                "inspect the managed engine directory manually",
            ));
        }
        fs::remove_dir_all(&destination).map_err(|error| io_error(
            "could not remove Wukong-owned managed Godot installation",
            &destination,
            error,
        ))?;
        Ok(true)
    }

    fn installation_directory(&self, release: &OfficialGodotRelease) -> PathBuf {
        self.installation_directory_for(&ReleaseIdentity {
            version: release.version(),
            flavor: release.flavor(),
            platform: release.platform(),
        })
    }

    fn installation_directory_for(&self, release: &ReleaseIdentity<'_>) -> PathBuf {
        self.root
            .join(MANAGED_GODOT_SCHEMA)
            .join(release.version.to_string())
            .join(release.flavor.as_str())
            .join(release.platform.as_str())
    }

    fn lock_path(&self, release: &OfficialGodotRelease) -> PathBuf {
        self.lock_path_for(&ReleaseIdentity {
            version: release.version(),
            flavor: release.flavor(),
            platform: release.platform(),
        })
    }

    fn lock_path_for(&self, release: &ReleaseIdentity<'_>) -> PathBuf {
        self.root
            .join(MANAGED_GODOT_SCHEMA)
            .join("locks")
            .join(format!("{}-{}-{}.lock", release.version, release.flavor, release.platform))
    }

    fn artifact_path(&self, artifact: &GodotArtifact) -> PathBuf {
        self.root
            .join(MANAGED_GODOT_SCHEMA)
            .join("downloads")
            .join("sha512")
            .join(artifact.sha512())
    }

    fn fetch_artifact(
        &self,
        artifact: &GodotArtifact,
        client: &OfficialGodotClient,
        offline: bool,
        observer: &dyn EngineProgressObserver,
    ) -> Result<PathBuf, Box<Diagnostic>> {
        let final_path = self.artifact_path(artifact);
        let lock = final_path.with_extension("lock");
        let _lock = AdvisoryLock::try_acquire(&lock, "this verified Godot download")?;
        if final_path.is_file() {
            verify_artifact_file(&final_path, artifact)?;
            return Ok(final_path);
        }
        if offline {
            return Err(source_error(
                "verified Godot artifact is unavailable locally while offline",
                "run without --offline or install the selected Godot version first",
            ));
        }
        let parent = final_path.parent().ok_or_else(|| internal_error(
            "managed Godot download path has no parent",
            "set WUKONG_ENGINE_DIR to a directory",
        ))?;
        fs::create_dir_all(parent).map_err(|error| io_error(
            "could not create managed Godot download directory",
            parent,
            error,
        ))?;
        let staging = Builder::new()
            .prefix(".wukong-download-")
            .tempdir_in(parent)
            .map_err(|error| io_error("could not create Godot download staging", parent, error))?;
        let staged = staging.path().join("artifact");
        download_official_artifact(client, artifact, &staged, observer)?;
        match fs::rename(&staged, &final_path) {
            Ok(()) => Ok(final_path),
            Err(_) if final_path.is_file() => {
                verify_artifact_file(&final_path, artifact)?;
                Ok(final_path)
            }
            Err(error) => Err(io_error(
                "could not publish verified Godot download",
                &final_path,
                error,
            )),
        }
    }

    fn read_installed(
        &self,
        release: &OfficialGodotRelease,
    ) -> Result<Option<ManagedGodot>, Box<Diagnostic>> {
        let path = self.installation_directory(release);
        let Some(installed) = parse_managed_metadata(&path)? else {
            return Ok(None);
        };
        if installed.version != *release.version()
            || installed.flavor != release.flavor()
            || installed.platform != release.platform()
            || !installed.executable.is_file()
        {
            return Ok(None);
        }
        Ok(Some(installed))
    }

    fn install_templates_locked(
        &self,
        installed: &ManagedGodot,
        release: &OfficialGodotRelease,
        client: &OfficialGodotClient,
        offline: bool,
        observer: &dyn EngineProgressObserver,
    ) -> Result<(), Box<Diagnostic>> {
        if installed.templates_installed() {
            return Ok(());
        }
        observer.on_progress(EngineProgress::Phase("downloading Godot export templates"));
        let templates = self.fetch_artifact(&release.templates, client, offline, observer)?;
        observer.on_progress(EngineProgress::Phase("installing verified Godot export templates"));
        let output = Command::new(installed.executable())
            .arg("--headless")
            .arg("--install-export-templates")
            .arg(&templates)
            .output()
            .map_err(|error| io_error(
                "could not launch managed Godot to install export templates",
                installed.executable(),
                error,
            ))?;
        if !output.status.success() {
            return Err(source_error(
                "managed Godot could not install the verified export templates",
                "remove the managed engine and retry; inspect Godot output if the failure persists",
            ));
        }
        let metadata_path = installed.root.join("wukong-engine.toml");
        let metadata = managed_metadata(release, installed.root(), installed.executable(), true)?;
        write_atomic(&metadata_path, metadata.as_bytes())
    }
}

struct ReleaseIdentity<'a> {
    version: &'a SemanticVersion,
    flavor: GodotFlavor,
    platform: GodotPlatform,
}

/// One verified Wukong-owned managed Godot installation.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ManagedGodot {
    root: PathBuf,
    executable: PathBuf,
    version: SemanticVersion,
    flavor: GodotFlavor,
    platform: GodotPlatform,
    templates: bool,
}

impl ManagedGodot {
    /// Returns the Wukong-owned installation directory.
    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Returns the selected editor executable.
    #[must_use]
    pub fn executable(&self) -> &Path {
        &self.executable
    }

    /// Returns the inspected exact Godot version.
    #[must_use]
    pub const fn version(&self) -> &SemanticVersion {
        &self.version
    }

    /// Returns the installed editor flavor.
    #[must_use]
    pub const fn flavor(&self) -> GodotFlavor {
        self.flavor
    }

    /// Returns the installed platform target.
    #[must_use]
    pub const fn platform(&self) -> GodotPlatform {
        self.platform
    }

    /// Returns whether matching templates were installed by Wukong.
    #[must_use]
    pub const fn templates_installed(&self) -> bool {
        self.templates
    }
}

/// Inspects a Godot executable using its bounded `--version` output.
pub fn inspect_godot_version(executable: &Path) -> Result<SemanticVersion, Box<Diagnostic>> {
    let output = Command::new(executable).arg("--version").output().map_err(|error| {
        io_error("could not execute Godot --version", executable, error)
    })?;
    if !output.status.success() {
        return Err(source_error(
            "Godot --version exited unsuccessfully",
            "verify the selected executable is a working Godot editor",
        ));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    parse_godot_version_output(&stdout).ok_or_else(|| source_error(
        "Godot --version did not report a stable semantic version",
        "use a Godot stable editor that reports x.y.z.stable",
    ))
}

/// Parses the stable version prefix produced by `godot --version`.
#[must_use]
pub fn parse_godot_version_output(output: &str) -> Option<SemanticVersion> {
    output.split_whitespace().find_map(|token| {
        let token = token.strip_suffix(".stable")?;
        let version = SemanticVersion::parse(token).ok()?;
        (!version.is_prerelease() && version.as_semver().build.is_empty()).then_some(version)
    })
}

fn release_asset(assets: &[Value], expected: &str) -> Result<UnverifiedReleaseAsset, Box<Diagnostic>> {
    let matches = assets
        .iter()
        .filter(|asset| asset.get("name").and_then(Value::as_str) == Some(expected))
        .collect::<Vec<_>>();
    let Some(asset) = matches.first() else {
        return Err(source_error(
            format!("official Godot release is missing expected asset {expected}"),
            "choose a supported stable desktop release",
        ));
    };
    if matches.len() != 1 {
        return Err(source_error(
            "official Godot release listed an editor artifact more than once",
            "retry later; do not install ambiguous release metadata",
        ));
    }
    let url = asset
        .get("browser_download_url")
        .and_then(Value::as_str)
        .ok_or_else(|| source_error(
            "official Godot release asset did not include a download URL",
            "retry later; do not use an untrusted release mirror",
        ))?;
    verified_official_url(url, true)?;
    let bytes = asset
        .get("size")
        .and_then(Value::as_u64)
        .filter(|bytes| *bytes > 0 && *bytes <= MAX_ENGINE_DOWNLOAD_BYTES)
        .ok_or_else(|| source_error(
            "official Godot release asset has an invalid size",
            "retry later; do not install an oversized artifact",
        ))?;
    Ok(UnverifiedReleaseAsset {
        name: expected.to_owned(),
        url: url.to_owned(),
        bytes,
    })
}

fn stable_tag(version: &SemanticVersion) -> Result<String, Box<Diagnostic>> {
    if version.is_prerelease() || !version.as_semver().build.is_empty() {
        return Err(source_error(
            "managed Godot requires an exact stable semantic version",
            "use a version such as 4.4.1",
        ));
    }
    Ok(format!("{version}-stable"))
}

fn stable_version_from_tag(tag: &str) -> Option<SemanticVersion> {
    let version = tag.strip_suffix("-stable")?;
    let version = SemanticVersion::parse(version).ok()?;
    (!version.is_prerelease() && version.as_semver().build.is_empty()).then_some(version)
}

fn editor_asset_name(version: &SemanticVersion, flavor: GodotFlavor, platform: GodotPlatform) -> String {
    format!(
        "Godot_v{version}-stable{}_{}.zip",
        flavor.asset_suffix(),
        platform.asset_component()
    )
}

fn template_asset_name(version: &SemanticVersion, flavor: GodotFlavor) -> String {
    format!("Godot_v{version}-stable{}_export_templates.tpz", flavor.asset_suffix())
}

fn parse_sha512_sums(input: &str) -> Result<BTreeMap<String, String>, Box<Diagnostic>> {
    let mut values = BTreeMap::new();
    for line in input.lines().filter(|line| !line.trim().is_empty()) {
        let line = line.trim();
        let parsed = line
            .split_once("  ")
            .map(|(hash, name)| (hash, name.trim_start_matches('*')))
            .or_else(|| {
                let body = line.strip_prefix("SHA512 (")?;
                let (name, hash) = body.split_once(") = ")?;
                Some((hash, name))
            });
        let Some((hash, name)) = parsed else { continue };
        if validate_sha512(hash).is_err() || name.is_empty() || name.contains(['/', '\\']) {
            continue;
        }
        if values.insert(name.to_owned(), hash.to_owned()).is_some() {
            return Err(source_error(
                "official SHA512-SUMS.txt listed an artifact more than once",
                "retry later; do not install ambiguous release metadata",
            ));
        }
    }
    if values.is_empty() {
        return Err(source_error(
            "official SHA512-SUMS.txt did not contain valid checksum entries",
            "retry later; do not install unverified release artifacts",
        ));
    }
    Ok(values)
}

fn validate_sha512(value: &str) -> Result<(), Box<Diagnostic>> {
    if value.len() == 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
    {
        Ok(())
    } else {
        Err(source_error(
            "official Godot checksum must be a lowercase SHA-512 digest",
            "retry later; do not install an unverified release artifact",
        ))
    }
}

fn download_official_artifact(
    client: &OfficialGodotClient,
    artifact: &GodotArtifact,
    staged: &Path,
    observer: &dyn EngineProgressObserver,
) -> Result<(), Box<Diagnostic>> {
    let mut response = client.open_official(artifact.url())?;
    let length = response
        .headers()
        .get("content-length")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .ok_or_else(|| source_error(
            "official Godot download did not provide content-length",
            "retry later; do not install an unbounded artifact",
        ))?;
    if length != artifact.bytes() {
        return Err(source_error(
            "official Godot download length did not match the release metadata",
            "retry later; do not install an inconsistent artifact",
        ));
    }
    let mut input = response.body_mut().as_reader();
    let mut output = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(staged)
        .map_err(|error| io_error("could not stage verified Godot download", staged, error))?;
    let mut hasher = Sha512::new();
    let mut total = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = input.read(&mut buffer).map_err(|error| io_error(
            "could not read official Godot download",
            staged,
            error,
        ))?;
        if count == 0 { break; }
        total = total.checked_add(count as u64).ok_or_else(|| source_error(
            "official Godot download exceeds its declared size",
            "retry later; do not install an oversized artifact",
        ))?;
        if total > artifact.bytes() || total > MAX_ENGINE_DOWNLOAD_BYTES {
            return Err(source_error(
                "official Godot download exceeds its declared size limit",
                "retry later; do not install an oversized artifact",
            ));
        }
        output.write_all(&buffer[..count]).map_err(|error| io_error(
            "could not stage verified Godot download",
            staged,
            error,
        ))?;
        hasher.update(&buffer[..count]);
        observer.on_progress(EngineProgress::Download {
            artifact: artifact.name().to_owned(),
            completed: total,
            total: artifact.bytes(),
        });
    }
    output.sync_all().map_err(|error| io_error(
        "could not flush verified Godot download",
        staged,
        error,
    ))?;
    if total != artifact.bytes() || format!("{:x}", hasher.finalize()) != artifact.sha512() {
        return Err(source_error(
            "official Godot artifact failed checksum or size verification",
            "retry later; the unverified download was not installed",
        ));
    }
    Ok(())
}

fn verify_artifact_file(path: &Path, artifact: &GodotArtifact) -> Result<(), Box<Diagnostic>> {
    let metadata = path.metadata().map_err(|error| io_error(
        "could not inspect cached Godot artifact",
        path,
        error,
    ))?;
    if !metadata.is_file() || metadata.len() != artifact.bytes() {
        return Err(source_error(
            "cached Godot artifact has an unexpected type or size",
            "remove the cached artifact and retry",
        ));
    }
    let mut file = File::open(path).map_err(|error| io_error(
        "could not read cached Godot artifact",
        path,
        error,
    ))?;
    let mut hash = Sha512::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer).map_err(|error| io_error(
            "could not verify cached Godot artifact",
            path,
            error,
        ))?;
        if count == 0 { break; }
        hash.update(&buffer[..count]);
    }
    if format!("{:x}", hash.finalize()) != artifact.sha512() {
        return Err(source_error(
            "cached Godot artifact failed checksum verification",
            "remove the cached artifact and retry",
        ));
    }
    Ok(())
}

fn locate_editor(root: &Path, platform: GodotPlatform) -> Result<PathBuf, Box<Diagnostic>> {
    let candidate = match platform {
        GodotPlatform::MacosUniversal => PathBufOrOption::Path(root.join("Godot.app/Contents/MacOS/Godot")),
        GodotPlatform::WindowsX86_64 => find_child(root, |path| {
            path.extension().is_some_and(|extension| extension.eq_ignore_ascii_case("exe"))
                && path.file_name().is_some_and(|name| name.to_string_lossy().starts_with("Godot"))
        }),
        GodotPlatform::LinuxX86_64 | GodotPlatform::LinuxArm64 => find_child(root, |path| {
            path.file_name().is_some_and(|name| name.to_string_lossy().starts_with("Godot"))
                && path.extension().is_none()
        }),
    };
    let candidate = match candidate {
        PathBufOrOption::Path(path) => path,
        PathBufOrOption::Option(Some(path)) => path,
        PathBufOrOption::Option(None) => return Err(source_error(
            "verified Godot archive did not contain the expected editor executable",
            "retry later; do not install an unexpected release archive",
        )),
    };
    if !candidate.is_file() {
        return Err(source_error(
            "verified Godot archive did not contain the expected editor executable",
            "retry later; do not install an unexpected release archive",
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(&candidate)
            .map_err(|error| io_error("could not inspect managed Godot executable", &candidate, error))?
            .permissions();
        permissions.set_mode(permissions.mode() | 0o111);
        fs::set_permissions(&candidate, permissions).map_err(|error| io_error(
            "could not set managed Godot executable permissions",
            &candidate,
            error,
        ))?;
    }
    Ok(candidate)
}

enum PathBufOrOption {
    Path(PathBuf),
    Option(Option<PathBuf>),
}

impl From<PathBuf> for PathBufOrOption {
    fn from(value: PathBuf) -> Self { Self::Path(value) }
}

impl From<Option<PathBuf>> for PathBufOrOption {
    fn from(value: Option<PathBuf>) -> Self { Self::Option(value) }
}

fn find_child(root: &Path, predicate: impl Fn(&Path) -> bool) -> PathBufOrOption {
    let mut entries = fs::read_dir(root)
        .ok()
        .into_iter()
        .flat_map(|entries| entries.flatten())
        .map(|entry| entry.path())
        .filter(|path| path.is_file() && predicate(path))
        .collect::<Vec<_>>();
    entries.sort();
    PathBufOrOption::Option(entries.into_iter().next())
}

fn enable_self_contained_mode(executable: &Path, platform: GodotPlatform) -> Result<(), Box<Diagnostic>> {
    let marker = match platform {
        GodotPlatform::MacosUniversal => executable
            .parent()
            .and_then(Path::parent)
            .map(|contents| contents.join("._sc_")),
        GodotPlatform::LinuxX86_64 | GodotPlatform::LinuxArm64 | GodotPlatform::WindowsX86_64 => {
            executable.parent().map(|parent| parent.join("._sc_"))
        }
    }
    .ok_or_else(|| internal_error(
        "managed Godot executable path has no self-contained marker location",
        "retry the managed installation",
    ))?;
    File::create(&marker).map_err(|error| io_error(
        "could not enable managed Godot self-contained mode",
        &marker,
        error,
    ))?;
    Ok(())
}

fn managed_metadata(
    release: &OfficialGodotRelease,
    root: &Path,
    executable: &Path,
    templates: bool,
) -> Result<String, Box<Diagnostic>> {
    let executable = executable
        .strip_prefix(root)
        .map_err(|_| internal_error(
            "managed Godot executable is outside its installation root",
            "retry the managed installation",
        ))?;
    Ok(format!(
        "schema = 1\nversion = \"{}\"\nflavor = \"{}\"\nplatform = \"{}\"\nexecutable = \"{}\"\ntemplates = {}\neditor_sha512 = \"{}\"\ntemplates_sha512 = \"{}\"\n",
        release.version(),
        release.flavor(),
        release.platform(),
        toml_path(executable),
        templates,
        release.editor().sha512(),
        release.templates().sha512(),
    ))
}

fn parse_managed_metadata(root: &Path) -> Result<Option<ManagedGodot>, Box<Diagnostic>> {
    let metadata = root.join("wukong-engine.toml");
    let input = match fs::read_to_string(&metadata) {
        Ok(input) => input,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(io_error("could not read managed Godot metadata", &metadata, error)),
    };
    let document = input.parse::<toml_edit::DocumentMut>().map_err(|_| source_error(
        "managed Godot metadata is invalid",
        "remove only this Wukong-owned engine directory and reinstall it",
    ))?;
    let table = document.as_table();
    let schema = table.get("schema").and_then(toml_edit::Item::as_integer);
    if schema != Some(1) {
        return Ok(None);
    }
    let version = table.get("version").and_then(toml_edit::Item::as_str)
        .and_then(|value| SemanticVersion::parse(value).ok());
    let flavor = table.get("flavor").and_then(toml_edit::Item::as_str)
        .and_then(|value| value.parse().ok());
    let platform = table.get("platform").and_then(toml_edit::Item::as_str)
        .and_then(|value| value.parse().ok());
    let executable = table.get("executable").and_then(toml_edit::Item::as_str).map(PathBuf::from);
    let templates = table.get("templates").and_then(toml_edit::Item::as_bool);
    let (Some(version), Some(flavor), Some(platform), Some(executable), Some(templates)) =
        (version, flavor, platform, executable, templates) else { return Ok(None) };
    if executable.is_absolute() || executable.components().any(|part| matches!(part, std::path::Component::ParentDir | std::path::Component::RootDir | std::path::Component::Prefix(_))) {
        return Ok(None);
    }
    Ok(Some(ManagedGodot {
        root: root.to_path_buf(),
        executable: root.join(executable),
        version,
        flavor,
        platform,
        templates,
    }))
}

fn toml_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/").replace('"', "\\\"")
}

fn read_limited(input: &mut impl Read, limit: u64, description: &str) -> Result<Vec<u8>, Box<Diagnostic>> {
    let mut output = Vec::new();
    let mut buffer = [0_u8; 8192];
    loop {
        let count = input.read(&mut buffer).map_err(|_| source_error(
            format!("could not read {description}"),
            "check network access and retry",
        ))?;
        if count == 0 { break; }
        if output.len().checked_add(count).is_none_or(|size| size as u64 > limit) {
            return Err(source_error(
                format!("{description} exceeded its size limit"),
                "retry later; do not use oversized release metadata",
            ));
        }
        output.extend_from_slice(&buffer[..count]);
    }
    Ok(output)
}

fn verified_official_url(value: &str, api: bool) -> Result<url::Url, Box<Diagnostic>> {
    let url = url::Url::parse(value).map_err(|_| source_error(
        "official Godot release URL was invalid",
        "retry later; do not use an untrusted release mirror",
    ))?;
    let expected = if api { "api.github.com" } else { "github.com" };
    if url.scheme() != "https"
        || url.host_str() != Some(expected)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err(source_error(
            "official Godot release URL was outside the approved origin",
            "use only official Godot stable releases",
        ));
    }
    Ok(url)
}

fn verified_official_initial_url(value: &str) -> Result<url::Url, Box<Diagnostic>> {
    verified_official_url(value, false).or_else(|_| verified_official_url(value, true))
}

fn verified_official_redirect(url: &url::Url) -> Result<(), Box<Diagnostic>> {
    let host = url.host_str();
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || !matches!(host, Some("github.com" | "release-assets.githubusercontent.com" | "objects.githubusercontent.com"))
    {
        return Err(source_error(
            "official Godot release redirect left the approved HTTPS origins",
            "retry later; do not use an untrusted release mirror",
        ));
    }
    Ok(())
}

fn platform_data_root() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    { env::var_os("HOME").map(PathBuf::from).map(|home| home.join("Library/Application Support")) }
    #[cfg(target_os = "windows")]
    { env::var_os("LOCALAPPDATA").or_else(|| env::var_os("APPDATA")).map(PathBuf::from) }
    #[cfg(all(unix, not(target_os = "macos")))]
    { env::var_os("XDG_DATA_HOME").map(PathBuf::from).or_else(|| env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share"))) }
    #[cfg(not(any(unix, target_os = "windows")))]
    { None }
}

fn source_error(message: impl Into<String>, recovery: impl Into<String>) -> Box<Diagnostic> {
    Box::new(
        Diagnostic::new(ErrorCode::SourceAccess, message.into())
            .with_recovery(recovery.into()),
    )
}

fn internal_error(message: impl Into<String>, recovery: impl Into<String>) -> Box<Diagnostic> {
    Box::new(
        Diagnostic::new(ErrorCode::InternalFailure, message.into())
            .with_recovery(recovery.into()),
    )
}

fn io_error(message: impl Into<String>, path: &Path, error: std::io::Error) -> Box<Diagnostic> {
    Box::new(
        Diagnostic::new(ErrorCode::InternalFailure, format!("{} {}", message.into(), path.display()))
            .with_cause(error)
            .with_recovery("check filesystem permissions and retry"),
    )
}

#[cfg(test)]
mod tests {
    use super::{
        GodotFlavor, GodotPlatform, editor_asset_name, parse_godot_version_output,
        parse_sha512_sums, stable_version_from_tag, template_asset_name,
    };
    use crate::semantic_version::SemanticVersion;

    #[test]
    fn invariant_official_asset_names_are_exact_for_supported_desktop_targets() {
        let version = SemanticVersion::parse("4.4.1").expect("version should parse");
        assert_eq!(
            editor_asset_name(&version, GodotFlavor::Standard, GodotPlatform::MacosUniversal),
            "Godot_v4.4.1-stable_macos.universal.zip"
        );
        assert_eq!(
            editor_asset_name(&version, GodotFlavor::Dotnet, GodotPlatform::LinuxX86_64),
            "Godot_v4.4.1-stable_mono_linux.x86_64.zip"
        );
        assert_eq!(
            editor_asset_name(&version, GodotFlavor::Standard, GodotPlatform::WindowsX86_64),
            "Godot_v4.4.1-stable_win64.exe.zip"
        );
        assert_eq!(
            template_asset_name(&version, GodotFlavor::Dotnet),
            "Godot_v4.4.1-stable_mono_export_templates.tpz"
        );
    }

    #[test]
    fn invariant_only_stable_godot_version_output_is_accepted() {
        assert_eq!(
            parse_godot_version_output("4.4.1.stable.official.abcdef\n"),
            Some(SemanticVersion::parse("4.4.1").expect("version should parse"))
        );
        assert!(parse_godot_version_output("4.5.beta1").is_none());
        assert!(stable_version_from_tag("4.4.1-stable").is_some());
        assert!(stable_version_from_tag("4.5-beta1").is_none());
    }

    #[test]
    fn invariant_checksum_parser_rejects_ambiguous_entries() {
        let hash = "a".repeat(128);
        let sums = parse_sha512_sums(&format!("{hash}  editor.zip\n")).expect("sums should parse");
        assert_eq!(sums.get("editor.zip"), Some(&hash));
        assert!(parse_sha512_sums(&format!("{hash}  editor.zip\n{hash}  editor.zip\n")).is_err());
    }
}
