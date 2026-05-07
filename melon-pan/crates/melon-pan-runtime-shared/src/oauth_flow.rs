//! OAuth orchestration: loopback callback, token exchange, refresh,
//! and persistence.
//!
//! Generic over any `TokenStore` implementor and takes a
//! browser-launcher closure so the macOS runtime can pass its URL
//! opener without coupling this crate to AppKit. `default_credentials_path`
//! and the actual browser launcher remain in `melon-pan-mac-runtime`.
//!
//! All token-touching functions take `store: &dyn TokenStore` as the
//! first parameter so they don't pull in compile-time type
//! parameters that would force every call site to spell out the
//! concrete impl. Cost: one virtual call per token op, dwarfed by
//! the network roundtrip.
//!
use crate::token_store::TokenStore;
use melon_pan_core::encoding::base64url_no_pad;
use melon_pan_core::{
    bind_loopback_server, bind_loopback_server_on, build_authorization_request,
    parse_installed_app_credentials, wait_for_oauth_callback, AuthError, AuthorizationRequest,
    LoopbackServer, OAuthCallbackError, OAuthConfig, StoredTokenSet,
};
use melon_pan_net::{OAuthClient, OAuthHttpError};
use std::fs;
use std::io;
use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const DEFAULT_CALLBACK_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Debug)]
pub enum OAuthFlowError {
    Io(io::Error),
    Auth(AuthError),
    Http(OAuthHttpError),
    Callback(OAuthCallbackError),
    Random(String),
    /// Underlying token store (Keychain or test fake)
    /// returned an error string. The variant is intentionally untyped so
    /// every platform's surface fits.
    TokenStore(String),
}

impl std::fmt::Display for OAuthFlowError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            OAuthFlowError::Io(error) => write!(f, "io: {error}"),
            OAuthFlowError::Auth(error) => write!(f, "{error}"),
            OAuthFlowError::Http(error) => write!(f, "{error}"),
            OAuthFlowError::Callback(error) => write!(f, "loopback callback failed: {error:?}"),
            OAuthFlowError::Random(message) => write!(f, "random generator: {message}"),
            OAuthFlowError::TokenStore(message) => write!(f, "token store: {message}"),
        }
    }
}

impl std::error::Error for OAuthFlowError {}

#[derive(Debug, Clone)]
pub struct LoginOutcome {
    pub account: String,
    pub email: String,
    pub display_name: String,
    pub scope: String,
    pub expires_at_unix: u64,
}

#[derive(Debug, Clone)]
pub struct OAuthClientCredentials {
    pub client_id: String,
    pub client_secret: Option<String>,
}

/// In-flight login state returned by [`begin_login`].
pub struct LoginInProgress {
    pub auth_url: String,
    pub config: OAuthConfig,
    pub state: String,
    pub code_verifier: String,
    pub server: LoopbackServer,
}

pub fn begin_login(
    credentials_path: &Path,
    narrow_scope: bool,
) -> Result<LoginInProgress, OAuthFlowError> {
    begin_login_on_port(credentials_path, narrow_scope, 0)
}

pub fn begin_login_on_port(
    credentials_path: &Path,
    narrow_scope: bool,
    port: u16,
) -> Result<LoginInProgress, OAuthFlowError> {
    let raw_creds = fs::read_to_string(credentials_path).map_err(OAuthFlowError::Io)?;
    let credentials = parse_installed_app_credentials(&raw_creds).map_err(OAuthFlowError::Auth)?;
    let server = if port == 0 {
        bind_loopback_server().map_err(OAuthFlowError::Io)?
    } else {
        bind_loopback_server_on(port).map_err(OAuthFlowError::Io)?
    };
    let mut config = OAuthConfig::loopback(credentials.client_id.clone(), server.port)
        .with_redirect_uri(server.redirect_uri.clone())
        .with_client_secret(credentials.client_secret.clone());
    if narrow_scope {
        config = config.with_scopes(
            melon_pan_core::narrow_scopes()
                .iter()
                .map(|s| s.to_string()),
        );
    }
    let state = generate_state()?;
    let verifier = generate_code_verifier()?;
    let auth_request: AuthorizationRequest =
        build_authorization_request(&config, state.clone(), verifier.clone())
            .map_err(OAuthFlowError::Auth)?;
    Ok(LoginInProgress {
        auth_url: auth_request.url,
        config,
        state,
        code_verifier: verifier,
        server,
    })
}

pub fn begin_login_with_client_on_port(
    credentials: &OAuthClientCredentials,
    narrow_scope: bool,
    port: u16,
) -> Result<LoginInProgress, OAuthFlowError> {
    let server = if port == 0 {
        bind_loopback_server().map_err(OAuthFlowError::Io)?
    } else {
        bind_loopback_server_on(port).map_err(OAuthFlowError::Io)?
    };
    let mut config = OAuthConfig::loopback(credentials.client_id.clone(), server.port)
        .with_redirect_uri(server.redirect_uri.clone());
    if let Some(secret) = credentials
        .client_secret
        .as_ref()
        .filter(|value| !value.is_empty())
    {
        config = config.with_client_secret(secret.clone());
    }
    if narrow_scope {
        config = config.with_scopes(
            melon_pan_core::narrow_scopes()
                .iter()
                .map(|s| s.to_string()),
        );
    }
    let state = generate_state()?;
    let verifier = generate_code_verifier()?;
    let auth_request: AuthorizationRequest =
        build_authorization_request(&config, state.clone(), verifier.clone())
            .map_err(OAuthFlowError::Auth)?;
    Ok(LoginInProgress {
        auth_url: auth_request.url,
        config,
        state,
        code_verifier: verifier,
        server,
    })
}

pub fn complete_login(
    store: &dyn TokenStore,
    pending: LoginInProgress,
    account_override: Option<&str>,
) -> Result<LoginOutcome, OAuthFlowError> {
    let LoginInProgress {
        config,
        state,
        code_verifier,
        server,
        ..
    } = pending;

    let callback = wait_for_oauth_callback(&server.listener, &state, DEFAULT_CALLBACK_TIMEOUT)
        .map_err(OAuthFlowError::Callback)?;

    let oauth = OAuthClient::new().map_err(OAuthFlowError::Http)?;
    let token_response = oauth
        .exchange_code(&config, &callback.code, &code_verifier)
        .map_err(OAuthFlowError::Http)?;

    let now = current_unix_seconds();
    let token_set = StoredTokenSet::from_initial_response(now, &token_response)
        .map_err(OAuthFlowError::Auth)?;

    let userinfo = oauth
        .fetch_userinfo(&token_set.access_token)
        .unwrap_or_default();
    let resolved_account = resolve_account_name(account_override, &userinfo.email);

    store
        .store(&resolved_account, &token_set.to_json())
        .map_err(OAuthFlowError::TokenStore)?;

    Ok(LoginOutcome {
        account: resolved_account,
        email: userinfo.email,
        display_name: userinfo.name,
        scope: token_set.scope.clone(),
        expires_at_unix: token_set.expires_at_unix,
    })
}

/// Boxed browser launcher. The macOS runtime supplies the concrete
/// launcher that knows how to open a URL. Boxing keeps the closure shape
/// stable across the FFI surface the Swift shell consumes.
pub type BrowserLauncher = Box<dyn Fn(&str) -> io::Result<()> + Send + Sync + 'static>;

#[allow(clippy::too_many_arguments)]
pub fn run_login(
    store: &dyn TokenStore,
    launcher: &BrowserLauncher,
    credentials_path: &Path,
    account_override: Option<&str>,
    open_browser: bool,
    narrow_scope: bool,
    port: u16,
    print_url_only: bool,
) -> Result<LoginOutcome, OAuthFlowError> {
    let pending = begin_login_on_port(credentials_path, narrow_scope, port)?;
    if print_url_only {
        println!("{}", pending.auth_url);
    } else {
        eprintln!("Open this URL in your browser if it does not open automatically:");
        eprintln!("  {}", pending.auth_url);
    }
    if open_browser {
        let _ = launcher(&pending.auth_url);
    }
    complete_login(store, pending, account_override)
}

pub fn refresh_stored_token(
    store: &dyn TokenStore,
    credentials_path: &Path,
    account: &str,
) -> Result<LoginOutcome, OAuthFlowError> {
    let raw_creds = fs::read_to_string(credentials_path).map_err(OAuthFlowError::Io)?;
    let credentials = parse_installed_app_credentials(&raw_creds).map_err(OAuthFlowError::Auth)?;
    let stored_raw = store.lookup(account).map_err(OAuthFlowError::TokenStore)?;
    let stored = StoredTokenSet::from_json(&stored_raw).map_err(OAuthFlowError::Auth)?;

    let config = OAuthConfig::loopback(credentials.client_id.clone(), 0)
        .with_redirect_uri("http://127.0.0.1:0/oauth/callback")
        .with_client_secret(credentials.client_secret.clone());

    let oauth = OAuthClient::new().map_err(OAuthFlowError::Http)?;
    let response = oauth
        .refresh(&config, &stored.refresh_token)
        .map_err(OAuthFlowError::Http)?;

    let refreshed = stored.refreshed(current_unix_seconds(), &response);
    store
        .store(account, &refreshed.to_json())
        .map_err(OAuthFlowError::TokenStore)?;

    Ok(LoginOutcome {
        account: account.to_string(),
        email: String::new(),
        display_name: String::new(),
        scope: refreshed.scope.clone(),
        expires_at_unix: refreshed.expires_at_unix,
    })
}

pub fn refresh_stored_token_with_client(
    store: &dyn TokenStore,
    credentials: &OAuthClientCredentials,
    account: &str,
) -> Result<LoginOutcome, OAuthFlowError> {
    let stored_raw = store.lookup(account).map_err(OAuthFlowError::TokenStore)?;
    let stored = StoredTokenSet::from_json(&stored_raw).map_err(OAuthFlowError::Auth)?;

    let mut config = OAuthConfig::loopback(credentials.client_id.clone(), 0)
        .with_redirect_uri("http://127.0.0.1:0/oauth/callback");
    if let Some(secret) = credentials
        .client_secret
        .as_ref()
        .filter(|value| !value.is_empty())
    {
        config = config.with_client_secret(secret.clone());
    }

    let oauth = OAuthClient::new().map_err(OAuthFlowError::Http)?;
    let response = oauth
        .refresh(&config, &stored.refresh_token)
        .map_err(OAuthFlowError::Http)?;

    let refreshed = stored.refreshed(current_unix_seconds(), &response);
    store
        .store(account, &refreshed.to_json())
        .map_err(OAuthFlowError::TokenStore)?;

    Ok(LoginOutcome {
        account: account.to_string(),
        email: String::new(),
        display_name: String::new(),
        scope: refreshed.scope.clone(),
        expires_at_unix: refreshed.expires_at_unix,
    })
}

pub fn load_stored(
    store: &dyn TokenStore,
    account: &str,
) -> Result<StoredTokenSet, OAuthFlowError> {
    let raw = store.lookup(account).map_err(OAuthFlowError::TokenStore)?;
    StoredTokenSet::from_json(&raw).map_err(OAuthFlowError::Auth)
}

pub fn ensure_fresh_access_token(
    store: &dyn TokenStore,
    credentials_path: &Path,
    account: &str,
    leeway_seconds: u64,
) -> Result<StoredTokenSet, OAuthFlowError> {
    let stored = load_stored(store, account)?;
    let now = current_unix_seconds();
    if !stored.is_expired_at(now, leeway_seconds) {
        return Ok(stored);
    }
    refresh_stored_token(store, credentials_path, account)?;
    load_stored(store, account)
}

pub fn ensure_fresh_access_token_with_client(
    store: &dyn TokenStore,
    credentials: &OAuthClientCredentials,
    account: &str,
    leeway_seconds: u64,
) -> Result<StoredTokenSet, OAuthFlowError> {
    let stored = load_stored(store, account)?;
    let now = current_unix_seconds();
    if !stored.is_expired_at(now, leeway_seconds) {
        return Ok(stored);
    }
    refresh_stored_token_with_client(store, credentials, account)?;
    load_stored(store, account)
}

/// Picks the token-store account label for a freshly signed-in token
/// set. Precedence: explicit override > signed-in email > "default".
/// Lowercased so the same Google account always resolves to the same
/// store key regardless of casing.
pub fn resolve_account_name(account_override: Option<&str>, email: &str) -> String {
    match account_override {
        Some(name) if !name.trim().is_empty() => name.to_string(),
        _ if !email.is_empty() => email.to_ascii_lowercase(),
        _ => "default".to_string(),
    }
}

fn generate_state() -> Result<String, OAuthFlowError> {
    Ok(base64url_no_pad(&random_bytes(24)?))
}

fn generate_code_verifier() -> Result<String, OAuthFlowError> {
    Ok(base64url_no_pad(&random_bytes(48)?))
}

fn random_bytes(n: usize) -> Result<Vec<u8>, OAuthFlowError> {
    let mut buf = vec![0_u8; n];
    getrandom::fill(&mut buf).map_err(|error| OAuthFlowError::Random(error.to_string()))?;
    Ok(buf)
}

fn current_unix_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::token_store::InMemoryTokenStore;

    #[test]
    fn resolve_account_name_precedence() {
        assert_eq!(resolve_account_name(Some("work"), "u@e.com"), "work");
        assert_eq!(resolve_account_name(Some("   "), "u@e.com"), "u@e.com");
        assert_eq!(
            resolve_account_name(None, "User@Example.Com"),
            "user@example.com"
        );
        assert_eq!(resolve_account_name(None, ""), "default");
    }

    #[test]
    fn load_stored_routes_through_supplied_store() {
        let store = InMemoryTokenStore::new();
        let now = 1_000_000_u64;
        let token = StoredTokenSet {
            access_token: "atok".to_string(),
            refresh_token: "rtok".to_string(),
            expires_at_unix: now + 3600,
            scope: "drive.file".to_string(),
            token_type: "Bearer".to_string(),
        };
        store.store("alice", &token.to_json()).unwrap();
        let recovered = load_stored(&store, "alice").unwrap();
        assert_eq!(recovered.access_token, "atok");
        assert_eq!(recovered.refresh_token, "rtok");
    }

    #[test]
    fn pkce_random_values_are_generated_without_device_file_access() {
        let state = generate_state().unwrap();
        let verifier = generate_code_verifier().unwrap();
        assert!(!state.is_empty());
        assert!(!verifier.is_empty());
        assert_ne!(state, verifier);
    }

    #[test]
    fn saved_client_login_can_begin_without_credentials_file() {
        let credentials = OAuthClientCredentials {
            client_id: "1234567890-test.apps.googleusercontent.com".to_string(),
            client_secret: None,
        };
        let pending = begin_login_with_client_on_port(&credentials, false, 0).unwrap();
        assert!(pending
            .auth_url
            .contains("1234567890-test.apps.googleusercontent.com"));
        assert!(pending.auth_url.contains("code_challenge="));
        assert!(pending.server.port > 0);
    }

    #[test]
    fn ensure_fresh_returns_stored_when_not_near_expiry() {
        let store = InMemoryTokenStore::new();
        let now = current_unix_seconds();
        let token = StoredTokenSet {
            access_token: "still-good".to_string(),
            refresh_token: "rtok".to_string(),
            expires_at_unix: now + 3600,
            scope: "drive.file".to_string(),
            token_type: "Bearer".to_string(),
        };
        store.store("bob", &token.to_json()).unwrap();
        // creds path doesn't matter — we won't refresh because not
        // expired. Pass a deliberately-unreadable path.
        let path = std::path::Path::new("/this/does/not/exist.json");
        let recovered = ensure_fresh_access_token(&store, path, "bob", 30).unwrap();
        assert_eq!(recovered.access_token, "still-good");
    }
}
