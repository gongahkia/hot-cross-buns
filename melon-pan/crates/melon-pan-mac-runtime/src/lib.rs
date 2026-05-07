//! macOS-specific runtime layer for Melon Pan.
//!
//! Provides a `MacTokenStore` that satisfies the runtime `TokenStore`
//! trait, path resolvers for `~/Library/Application Support/MelonPan/`
//! and `~/Library/Caches/MelonPan/`, and browser launch hooks for the
//! Swift app.
//!
//! ## What works today
//!
//! - `default_credentials_path()` resolves to
//!   `~/Library/Application Support/MelonPan/credentials.json`.
//! - `default_cache_root()` resolves to
//!   `~/Library/Caches/MelonPan/`.
//! - `MacTokenStore::new()` constructs a stub that returns
//!   `Err("not yet implemented; pending Keychain integration")`
//!   for every call, plus a constructor `MacTokenStore::with_inner(
//!   InMemoryTokenStore)` that wraps the shared in-memory store
//!   for tests.
//! - `launch_browser_via_nsworkspace` is exposed but stubbed to
//!   return an `Err(NotFound)` until the AppKit FFI is in place.

use melon_pan_core::{LocalCacheStore, StoredTokenSet};
use melon_pan_runtime_shared::{
    pull_document, refresh_drive_tree, InMemoryTokenStore, OAuthClientCredentials, TokenStore,
};
use std::io;
use std::path::PathBuf;

/// Returns `$HOME` or, if unset, `/`. macOS always sets $HOME for
/// interactive sessions; the fallback is for headless launchctl
/// contexts where the runtime should still produce a path rather
/// than panic.
fn home_dir() -> PathBuf {
    std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/"))
}

/// macOS default search path for the OAuth credentials file.
///
/// Resolution order:
/// 1. `MELON_PAN_CREDENTIALS` env var for CI and power-user scripts.
/// 2. `~/Library/Application Support/MelonPan/credentials.json`.
pub fn default_credentials_path() -> PathBuf {
    if let Ok(value) = std::env::var("MELON_PAN_CREDENTIALS") {
        return PathBuf::from(value);
    }
    home_dir()
        .join("Library")
        .join("Application Support")
        .join("MelonPan")
        .join("credentials.json")
}

/// macOS default cache root.
pub fn default_cache_root() -> PathBuf {
    if let Ok(value) = std::env::var("MELON_PAN_CACHE_ROOT") {
        return PathBuf::from(value);
    }
    home_dir().join("Library").join("Caches").join("MelonPan")
}

/// Apple `kSecAttrService` value used by the Keychain backend. Items
/// stored under this service are visible in Keychain Access.app under
/// the "MelonPan" service name so users can audit / revoke them
/// through standard macOS UI.
pub const KEYCHAIN_SERVICE: &str = "com.gongahkia.MelonPan";
const OAUTH_CLIENT_CONFIG_ACCOUNT: &str = "oauth-client-config";

pub struct DiagnosticSnapshot {
    pub cache_root: String,
    pub total_snapshot_bytes: u64,
    pub doc_count: usize,
    pub snapshot_count: usize,
    pub drive_tree_mtime_unix: Option<u64>,
    pub runtime_shared_version: String,
    pub core_version: String,
}

pub struct RuntimeVersions {
    pub core_version: String,
    pub runtime_shared_version: String,
    pub commit_sha: String,
    pub build_timestamp: String,
}

pub struct KeychainProbe {
    pub state: String,
    pub item_count: u32,
    pub service: String,
}

pub struct TokenMetadata {
    pub scope: String,
    pub expires_at_unix: u64,
    pub has_refresh_token: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OAuthClientConfig {
    pub client_id: String,
    pub client_secret: Option<String>,
}

impl OAuthClientConfig {
    pub fn as_credentials(&self) -> OAuthClientCredentials {
        OAuthClientCredentials {
            client_id: self.client_id.clone(),
            client_secret: self.client_secret.clone(),
        }
    }
}

/// Cross-platform [`TokenStore`] for macOS. On macOS routes through
/// Apple's Security.framework Keychain via the `security-framework`
/// crate; on non-mac targets falls back to a clear "not on macOS"
/// error so the workspace stays cross-buildable.
pub struct MacTokenStore {
    inner: MacTokenStoreInner,
}

enum MacTokenStoreInner {
    /// Live Keychain calls. Production path on macOS.
    #[cfg(target_os = "macos")]
    Keychain,
    /// Returned from `MacTokenStore::new()` when built off-macOS.
    /// Every call surfaces a clear error so callers can detect the
    /// platform mismatch without panicking.
    #[cfg(not(target_os = "macos"))]
    KeychainStub,
    /// In-memory store for tests / non-mac builds. Wraps the shared
    /// `InMemoryTokenStore` so behaviour matches the real impl in
    /// every observable way except persistence.
    InMemory(InMemoryTokenStore),
}

impl MacTokenStore {
    /// Returns a Keychain-backed token store. On macOS this is the
    /// real impl; on other platforms every call surfaces a clear
    /// "not on macOS" error so off-platform development noticed
    /// immediately rather than silently no-oping.
    pub fn new() -> Self {
        #[cfg(target_os = "macos")]
        {
            Self {
                inner: MacTokenStoreInner::Keychain,
            }
        }
        #[cfg(not(target_os = "macos"))]
        {
            Self {
                inner: MacTokenStoreInner::KeychainStub,
            }
        }
    }

    /// Returns an in-memory token store. Used by FFI integration
    /// tests and any caller that wants to exercise the OAuth flow
    /// without touching Keychain.
    pub fn with_inner(inner: InMemoryTokenStore) -> Self {
        Self {
            inner: MacTokenStoreInner::InMemory(inner),
        }
    }
}

impl Default for MacTokenStore {
    fn default() -> Self {
        Self::new()
    }
}

impl TokenStore for MacTokenStore {
    fn lookup(&self, account: &str) -> Result<String, String> {
        match &self.inner {
            #[cfg(target_os = "macos")]
            MacTokenStoreInner::Keychain => keychain_lookup(account),
            #[cfg(not(target_os = "macos"))]
            MacTokenStoreInner::KeychainStub => Err(format!(
                "MacTokenStore::lookup({account}) requires target_os = \"macos\"; \
                 this build does not include the Keychain backend"
            )),
            MacTokenStoreInner::InMemory(store) => store.lookup(account),
        }
    }

    fn store(&self, account: &str, token_json: &str) -> Result<(), String> {
        match &self.inner {
            #[cfg(target_os = "macos")]
            MacTokenStoreInner::Keychain => keychain_store(account, token_json),
            #[cfg(not(target_os = "macos"))]
            MacTokenStoreInner::KeychainStub => Err(format!(
                "MacTokenStore::store({account}) requires target_os = \"macos\"; \
                 this build does not include the Keychain backend"
            )),
            MacTokenStoreInner::InMemory(store) => store.store(account, token_json),
        }
    }

    fn clear(&self, account: &str) -> Result<(), String> {
        match &self.inner {
            #[cfg(target_os = "macos")]
            MacTokenStoreInner::Keychain => keychain_clear(account),
            #[cfg(not(target_os = "macos"))]
            MacTokenStoreInner::KeychainStub => Err(format!(
                "MacTokenStore::clear({account}) requires target_os = \"macos\"; \
                 this build does not include the Keychain backend"
            )),
            MacTokenStoreInner::InMemory(store) => store.clear(account),
        }
    }

    fn list_accounts(&self) -> Vec<String> {
        match &self.inner {
            #[cfg(target_os = "macos")]
            MacTokenStoreInner::Keychain => Vec::new(),
            #[cfg(not(target_os = "macos"))]
            MacTokenStoreInner::KeychainStub => Vec::new(),
            MacTokenStoreInner::InMemory(store) => store.list_accounts(),
        }
    }
}

pub fn diagnostic_snapshot(cache_root: PathBuf) -> io::Result<DiagnosticSnapshot> {
    let store = LocalCacheStore::new(&cache_root);
    let ids = store.list_cached_document_ids()?;
    let mut snapshot_count = 0usize;
    for id in &ids {
        snapshot_count = snapshot_count.saturating_add(store.list_revision_snapshots(id)?.len());
        snapshot_count = snapshot_count.saturating_add(store.list_pre_push_snapshots(id)?.len());
    }
    let drive_tree_mtime_unix = std::fs::metadata(cache_root.join("drive-tree.json"))
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|modified| modified.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs());
    Ok(DiagnosticSnapshot {
        cache_root: cache_root.to_string_lossy().into_owned(),
        total_snapshot_bytes: store.total_snapshot_disk_usage_bytes()?,
        doc_count: ids.len(),
        snapshot_count,
        drive_tree_mtime_unix,
        runtime_shared_version: env!("CARGO_PKG_VERSION").to_string(),
        core_version: env!("CARGO_PKG_VERSION").to_string(),
    })
}

pub fn runtime_versions() -> RuntimeVersions {
    RuntimeVersions {
        core_version: env!("CARGO_PKG_VERSION").to_string(),
        runtime_shared_version: env!("CARGO_PKG_VERSION").to_string(),
        commit_sha: option_env!("MELON_PAN_COMMIT_SHA")
            .unwrap_or("unknown")
            .to_string(),
        build_timestamp: option_env!("MELON_PAN_BUILD_TIMESTAMP")
            .unwrap_or("unknown")
            .to_string(),
    }
}

pub fn token_metadata(account: &str) -> Result<TokenMetadata, String> {
    let raw = MacTokenStore::new().lookup(account)?;
    let token = StoredTokenSet::from_json(&raw).map_err(|error| error.to_string())?;
    Ok(TokenMetadata {
        scope: token.scope,
        expires_at_unix: token.expires_at_unix,
        has_refresh_token: !token.refresh_token.is_empty(),
    })
}

pub fn save_oauth_client_config(
    client_id: &str,
    client_secret: Option<&str>,
) -> Result<(), String> {
    let trimmed_id = client_id.trim();
    if trimmed_id.is_empty() || trimmed_id.contains('\n') {
        return Err("OAuth client ID is empty or invalid".to_string());
    }
    let trimmed_secret = client_secret
        .map(str::trim)
        .filter(|secret| !secret.is_empty())
        .unwrap_or("");
    if trimmed_secret.contains('\n') {
        return Err("OAuth client secret cannot contain newlines".to_string());
    }
    let payload = format!("{trimmed_id}\n{trimmed_secret}");
    MacTokenStore::new().store(OAUTH_CLIENT_CONFIG_ACCOUNT, &payload)
}

pub fn load_oauth_client_config() -> Result<OAuthClientConfig, String> {
    let raw = MacTokenStore::new().lookup(OAUTH_CLIENT_CONFIG_ACCOUNT)?;
    let mut lines = raw.lines();
    let client_id = lines.next().unwrap_or("").trim().to_string();
    if client_id.is_empty() {
        return Err("saved OAuth client ID is empty".to_string());
    }
    let secret = lines
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    Ok(OAuthClientConfig {
        client_id,
        client_secret: secret.map(ToString::to_string),
    })
}

pub fn clear_oauth_client_config() -> Result<(), String> {
    MacTokenStore::new().clear(OAUTH_CLIENT_CONFIG_ACCOUNT)
}

pub fn clear_cached_drive_data(cache_root: PathBuf) -> io::Result<()> {
    let docs = cache_root.join("docs");
    let snapshots = cache_root.join("snapshots");
    let drive_tree = cache_root.join("drive-tree.json");
    if docs.exists() {
        std::fs::remove_dir_all(&docs)?;
    }
    if snapshots.exists() {
        std::fs::remove_dir_all(&snapshots)?;
    }
    if drive_tree.exists() {
        std::fs::remove_file(drive_tree)?;
    }
    std::fs::create_dir_all(docs)?;
    std::fs::create_dir_all(snapshots)?;
    Ok(())
}

pub fn force_full_resync(cache_root: PathBuf, access_token: &str) -> Result<(), String> {
    if access_token.trim().is_empty() {
        return Err("no access token".to_string());
    }
    let store = LocalCacheStore::new(&cache_root);
    let ids = store
        .list_cached_document_ids()
        .map_err(|error| format!("list cached docs failed: {error}"))?;
    for id in ids {
        pull_document(access_token, &id, &cache_root)
            .map_err(|error| format!("pull {id} failed: {error}"))?;
    }
    refresh_drive_tree(access_token, None, &cache_root)
        .map_err(|error| format!("refresh drive tree failed: {error}"))?;
    Ok(())
}

pub fn keychain_probe() -> KeychainProbe {
    #[cfg(target_os = "macos")]
    {
        use security_framework::item::{ItemClass, ItemSearchOptions, Limit};
        let mut search = ItemSearchOptions::new();
        search
            .class(ItemClass::generic_password())
            .service(KEYCHAIN_SERVICE)
            .load_attributes(true)
            .limit(Limit::All);
        match search.search() {
            Ok(items) if items.is_empty() => KeychainProbe {
                state: "missing".to_string(),
                item_count: 0,
                service: KEYCHAIN_SERVICE.to_string(),
            },
            Ok(items) => KeychainProbe {
                state: "ok".to_string(),
                item_count: items.len() as u32,
                service: KEYCHAIN_SERVICE.to_string(),
            },
            Err(error) => {
                let code = error.code();
                let state = match code {
                    -25300 => "missing",
                    -25308 => "locked",
                    -25293 => "denied",
                    _ => "error",
                };
                KeychainProbe {
                    state: state.to_string(),
                    item_count: 0,
                    service: KEYCHAIN_SERVICE.to_string(),
                }
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        KeychainProbe {
            state: "error".to_string(),
            item_count: 0,
            service: KEYCHAIN_SERVICE.to_string(),
        }
    }
}

#[cfg(target_os = "macos")]
fn keychain_lookup(account: &str) -> Result<String, String> {
    use security_framework::passwords::get_generic_password;
    match get_generic_password(KEYCHAIN_SERVICE, account) {
        Ok(bytes) => String::from_utf8(bytes)
            .map_err(|error| format!("Keychain item for '{account}' is not valid UTF-8: {error}")),
        Err(error) => Err(format!("Keychain lookup for '{account}' failed: {error}")),
    }
}

#[cfg(target_os = "macos")]
fn keychain_store(account: &str, token_json: &str) -> Result<(), String> {
    use security_framework::passwords::set_generic_password;
    set_generic_password(KEYCHAIN_SERVICE, account, token_json.as_bytes())
        .map_err(|error| format!("Keychain store for '{account}' failed: {error}"))
}

#[cfg(target_os = "macos")]
fn keychain_clear(account: &str) -> Result<(), String> {
    use security_framework::passwords::delete_generic_password;
    match delete_generic_password(KEYCHAIN_SERVICE, account) {
        Ok(()) => Ok(()),
        Err(error) => {
            // Apple's errSecItemNotFound (-25300) is a no-op success
            // for our semantics: the trait permits clear() on a
            // missing entry to return Ok. Match on any phrasing
            // Apple's message could take ("not found", "could not be
            // found", "cannot be found", etc.) by lowercasing and
            // checking for the "be found" / "not found" variants.
            let message = error.to_string();
            let lower = message.to_ascii_lowercase();
            if message.contains("-25300")
                || lower.contains("not found")
                || lower.contains("be found")
                || lower.contains("could not be found")
            {
                return Ok(());
            }
            Err(format!("Keychain clear for '{account}' failed: {message}"))
        }
    }
}

/// Opens `url` in the user's default browser via `/usr/bin/open`.
///
/// Implementation choice: spawning `open <url>` rather than calling
/// `NSWorkspace.shared.open(_:)` through objc2 / cocoa-foundation
/// because (a) `open(1)` ships in every macOS install and routes
/// through Launch Services exactly the same way NSWorkspace does;
/// (b) avoiding the AppKit bridge keeps this crate dependency-free
/// for the FFI surface that uniffi-rs will wrap. The Swift shell
/// bypasses this and uses NSWorkspace directly when needed —
/// it's already linked against AppKit.
///
/// On non-mac builds returns `Err(NotFound)` so callers detect the
/// platform mismatch immediately.
pub fn launch_browser_via_nsworkspace(url: &str) -> io::Result<()> {
    #[cfg(target_os = "macos")]
    {
        use std::process::{Command, Stdio};
        Command::new("/usr/bin/open")
            .arg(url)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map(|_| ())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = url;
        Err(io::Error::new(
            io::ErrorKind::NotFound,
            "launch_browser_via_nsworkspace requires target_os = \"macos\"",
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use melon_pan_runtime_shared::TokenStore;

    // Path-resolution tests share a process env so they must not run
    // in parallel. A single mutex serialises all env-touching tests.
    static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    #[test]
    fn default_credentials_path_targets_application_support() {
        let _guard = ENV_LOCK.lock().unwrap();
        std::env::remove_var("MELON_PAN_CREDENTIALS");
        let path = default_credentials_path();
        let path_str = path.to_string_lossy();
        assert!(path_str.ends_with("Library/Application Support/MelonPan/credentials.json"));
    }

    #[test]
    fn default_credentials_path_honours_env_override() {
        let _guard = ENV_LOCK.lock().unwrap();
        std::env::set_var("MELON_PAN_CREDENTIALS", "/tmp/override.json");
        let path = default_credentials_path();
        assert_eq!(path, PathBuf::from("/tmp/override.json"));
        std::env::remove_var("MELON_PAN_CREDENTIALS");
    }

    #[test]
    fn default_cache_root_targets_library_caches() {
        let _guard = ENV_LOCK.lock().unwrap();
        std::env::remove_var("MELON_PAN_CACHE_ROOT");
        let path = default_cache_root();
        assert!(path.to_string_lossy().ends_with("Library/Caches/MelonPan"));
    }

    #[test]
    #[cfg(not(target_os = "macos"))]
    fn keychain_stub_errors_clearly_off_macos() {
        let store = MacTokenStore::new();
        let err = store.lookup("alice").unwrap_err();
        assert!(err.contains("alice"));
        assert!(err.contains("requires target_os = \"macos\""));
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn keychain_round_trips_an_isolated_account_on_macos() {
        // Use a high-entropy account name so this test never collides
        // with a real Keychain entry. Cleans up after itself; if the
        // delete fails (rare ACL edge cases), subsequent runs still
        // pass because set_generic_password overwrites.
        let store = MacTokenStore::new();
        let account = format!(
            "melon-pan-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let payload = "{\"access_token\":\"keychain-roundtrip\"}";
        if let Err(error) = store.store(&account, payload) {
            // Some CI environments lack a usable login keychain;
            // skip rather than fail in that case so workflows on
            // sandboxed runners don't break.
            eprintln!("skipping keychain round-trip: {error}");
            return;
        }
        let recovered = store.lookup(&account).unwrap();
        assert_eq!(recovered, payload);
        store.clear(&account).unwrap();
        // Second clear must be a no-op success per the trait contract.
        store.clear(&account).unwrap();
    }

    #[test]
    fn with_inner_routes_to_in_memory_store() {
        let inner = InMemoryTokenStore::with_entry("alice", "{\"x\":1}");
        let store = MacTokenStore::with_inner(inner);
        assert_eq!(store.lookup("alice").unwrap(), "{\"x\":1}");
        store.store("bob", "{\"y\":2}").unwrap();
        let mut accounts = store.list_accounts();
        accounts.sort();
        assert_eq!(accounts, vec!["alice", "bob"]);
    }

    #[test]
    fn oauth_client_config_maps_to_shared_credentials() {
        let config = OAuthClientConfig {
            client_id: "123-client.apps.googleusercontent.com".to_string(),
            client_secret: Some("secret".to_string()),
        };
        let credentials = config.as_credentials();
        assert_eq!(credentials.client_id, config.client_id);
        assert_eq!(credentials.client_secret, config.client_secret);
    }

    #[test]
    #[cfg(not(target_os = "macos"))]
    fn nsworkspace_launcher_stub_returns_not_found_off_macos() {
        let err = launch_browser_via_nsworkspace("https://example.com").unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::NotFound);
    }

    // No happy-path test for /usr/bin/open on macOS — running it would
    // pop the user's browser. Smoke-test by spawning with a bogus URL
    // that `open` rejects synchronously, so we still confirm the spawn
    // path runs without panicking.
    #[test]
    #[cfg(target_os = "macos")]
    fn nsworkspace_launcher_spawns_open_on_macos() {
        // `open` returns an error on bad input but the spawn itself
        // succeeds — that's all we're checking here. We deliberately
        // pass a non-routable URI to avoid actually opening anything.
        let outcome = launch_browser_via_nsworkspace("x-melon-pan-nonexistent-scheme://test");
        // Either Ok(()) or an Err whose kind isn't NotFound — anything
        // other than "binary missing" passes.
        match outcome {
            Ok(()) => {}
            Err(error) => assert_ne!(error.kind(), io::ErrorKind::NotFound),
        }
    }
}
