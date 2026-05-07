use crate::encoding::{base64url_no_pad, percent_encode};
use crate::json::{parse_json, JsonError, JsonValue};
use crate::sha256::sha256;

pub const GOOGLE_AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
pub const GOOGLE_TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
pub const SCOPE_DRIVE_FILE: &str = "https://www.googleapis.com/auth/drive.file";
pub const SCOPE_DRIVE_READONLY: &str = "https://www.googleapis.com/auth/drive.readonly";
pub const SCOPE_DRIVE_METADATA_READONLY: &str =
    "https://www.googleapis.com/auth/drive.metadata.readonly";
pub const SCOPE_DOCUMENTS: &str = "https://www.googleapis.com/auth/documents";
pub const SCOPE_USERINFO_EMAIL: &str = "https://www.googleapis.com/auth/userinfo.email";
pub const SCOPE_OPENID: &str = "openid";
pub const GOOGLE_USERINFO_URL: &str = "https://www.googleapis.com/oauth2/v3/userinfo";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OAuthConfig {
    pub client_id: String,
    pub client_secret: Option<String>,
    pub redirect_uri: String,
    pub scopes: Vec<String>,
}

impl OAuthConfig {
    pub fn loopback(client_id: impl Into<String>, port: u16) -> Self {
        Self {
            client_id: client_id.into(),
            client_secret: None,
            redirect_uri: format!("http://127.0.0.1:{port}/oauth/callback"),
            scopes: default_scopes()
                .iter()
                .map(|scope| (*scope).to_string())
                .collect(),
        }
    }

    pub fn with_client_secret(mut self, client_secret: impl Into<String>) -> Self {
        self.client_secret = Some(client_secret.into());
        self
    }

    pub fn with_redirect_uri(mut self, redirect_uri: impl Into<String>) -> Self {
        self.redirect_uri = redirect_uri.into();
        self
    }

    pub fn with_scopes<I, S>(mut self, scopes: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        self.scopes = scopes.into_iter().map(Into::into).collect();
        self
    }
}

/// Parsed installed-app credentials JSON as Google distributes it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstalledAppCredentials {
    pub client_id: String,
    pub client_secret: String,
}

pub fn parse_installed_app_credentials(raw: &str) -> Result<InstalledAppCredentials, AuthError> {
    let root = parse_json(raw).map_err(AuthError::InvalidCredentialsJson)?;
    let installed = root
        .get("installed")
        .or_else(|| root.get("web"))
        .unwrap_or(&root);
    let client_id = installed
        .get("client_id")
        .and_then(JsonValue::as_str)
        .filter(|value| !value.is_empty())
        .ok_or(AuthError::MissingClientId)?
        .to_string();
    let client_secret = installed
        .get("client_secret")
        .and_then(JsonValue::as_str)
        .filter(|value| !value.is_empty())
        .ok_or(AuthError::MissingClientSecret)?
        .to_string();
    Ok(InstalledAppCredentials {
        client_id,
        client_secret,
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthorizationRequest {
    pub url: String,
    pub state: String,
    pub code_verifier: String,
    pub code_challenge: String,
}

pub fn default_scopes() -> [&'static str; 6] {
    [
        SCOPE_DRIVE_FILE,
        SCOPE_DRIVE_READONLY,
        SCOPE_DRIVE_METADATA_READONLY,
        SCOPE_DOCUMENTS,
        SCOPE_USERINFO_EMAIL,
        SCOPE_OPENID,
    ]
}

/// Narrow scope set for users who only want Melon Pan to touch documents the
/// app creates or that they explicitly open via Drive. Drops the broad
/// `documents` scope; relies on `drive.file` for per-file access. Some
/// existing Docs may become unreadable until re-opened via the Drive picker.
pub fn narrow_scopes() -> [&'static str; 3] {
    [SCOPE_DRIVE_FILE, SCOPE_USERINFO_EMAIL, SCOPE_OPENID]
}

/// Parsed Google userinfo response.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct UserInfo {
    pub sub: String,
    pub email: String,
    pub name: String,
}

pub fn parse_userinfo_response(raw: &str) -> Result<UserInfo, AuthError> {
    let root = parse_json(raw).map_err(AuthError::InvalidTokenJson)?;
    let sub = root
        .get("sub")
        .and_then(JsonValue::as_str)
        .unwrap_or("")
        .to_string();
    let email = root
        .get("email")
        .and_then(JsonValue::as_str)
        .unwrap_or("")
        .to_string();
    let name = root
        .get("name")
        .and_then(JsonValue::as_str)
        .unwrap_or("")
        .to_string();
    Ok(UserInfo { sub, email, name })
}

pub fn pkce_challenge_s256(verifier: &str) -> String {
    base64url_no_pad(&sha256(verifier.as_bytes()))
}

pub fn build_authorization_request(
    config: &OAuthConfig,
    state: impl Into<String>,
    code_verifier: impl Into<String>,
) -> Result<AuthorizationRequest, AuthError> {
    let state = state.into();
    let code_verifier = code_verifier.into();
    validate_state(&state)?;
    validate_code_verifier(&code_verifier)?;
    if config.client_id.trim().is_empty() {
        return Err(AuthError::MissingClientId);
    }
    if config.redirect_uri.trim().is_empty() {
        return Err(AuthError::MissingRedirectUri);
    }
    if config.scopes.is_empty() {
        return Err(AuthError::MissingScopes);
    }

    let code_challenge = pkce_challenge_s256(&code_verifier);
    let scope = config.scopes.join(" ");
    let url = format!(
        "{GOOGLE_AUTH_URL}?client_id={}&redirect_uri={}&response_type=code&scope={}&state={}&code_challenge={}&code_challenge_method=S256&access_type=offline&prompt=consent",
        percent_encode(&config.client_id),
        percent_encode(&config.redirect_uri),
        percent_encode(&scope),
        percent_encode(&state),
        percent_encode(&code_challenge),
    );

    Ok(AuthorizationRequest {
        url,
        state,
        code_verifier,
        code_challenge,
    })
}

pub fn build_token_exchange_body(
    config: &OAuthConfig,
    code: &str,
    code_verifier: &str,
) -> Result<String, AuthError> {
    validate_code_verifier(code_verifier)?;
    if code.trim().is_empty() {
        return Err(AuthError::MissingAuthorizationCode);
    }

    let mut body = format!(
        "client_id={}&code={}&code_verifier={}&grant_type=authorization_code&redirect_uri={}",
        percent_encode(&config.client_id),
        percent_encode(code),
        percent_encode(code_verifier),
        percent_encode(&config.redirect_uri),
    );
    if let Some(secret) = &config.client_secret {
        body.push_str(&format!("&client_secret={}", percent_encode(secret)));
    }
    Ok(body)
}

pub fn build_refresh_token_body(
    config: &OAuthConfig,
    refresh_token: &str,
) -> Result<String, AuthError> {
    if refresh_token.trim().is_empty() {
        return Err(AuthError::MissingRefreshToken);
    }

    let mut body = format!(
        "client_id={}&grant_type=refresh_token&refresh_token={}",
        percent_encode(&config.client_id),
        percent_encode(refresh_token),
    );
    if let Some(secret) = &config.client_secret {
        body.push_str(&format!("&client_secret={}", percent_encode(secret)));
    }
    Ok(body)
}

/// Successful response from the Google OAuth2 token endpoint.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TokenResponse {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in_seconds: u64,
    pub scope: Option<String>,
    pub token_type: String,
}

pub fn parse_token_response(raw: &str) -> Result<TokenResponse, AuthError> {
    let root = parse_json(raw).map_err(AuthError::InvalidTokenJson)?;
    if let Some(error) = root.get("error").and_then(JsonValue::as_str) {
        let description = root
            .get("error_description")
            .and_then(JsonValue::as_str)
            .unwrap_or("");
        return Err(AuthError::ProviderError(format!("{error}: {description}")));
    }
    let access_token = root
        .get("access_token")
        .and_then(JsonValue::as_str)
        .filter(|value| !value.is_empty())
        .ok_or(AuthError::MissingAccessToken)?
        .to_string();
    let refresh_token = root
        .get("refresh_token")
        .and_then(JsonValue::as_str)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    let expires_in_seconds = root
        .get("expires_in")
        .and_then(|value| match value {
            JsonValue::Number(text) => text.parse::<u64>().ok(),
            _ => None,
        })
        .unwrap_or(3600);
    let scope = root
        .get("scope")
        .and_then(JsonValue::as_str)
        .map(ToString::to_string);
    let token_type = root
        .get("token_type")
        .and_then(JsonValue::as_str)
        .unwrap_or("Bearer")
        .to_string();
    Ok(TokenResponse {
        access_token,
        refresh_token,
        expires_in_seconds,
        scope,
        token_type,
    })
}

/// Stored token set as we persist it via secret-tool.
///
/// `expires_at_unix` is the absolute expiry instant; refreshing populates a new
/// `access_token` and `expires_at_unix` while preserving the original
/// `refresh_token` (Google omits `refresh_token` from refresh responses).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredTokenSet {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at_unix: u64,
    pub scope: String,
    pub token_type: String,
}

impl StoredTokenSet {
    pub fn from_initial_response(
        now_unix: u64,
        response: &TokenResponse,
    ) -> Result<Self, AuthError> {
        let refresh_token = response
            .refresh_token
            .clone()
            .ok_or(AuthError::MissingRefreshToken)?;
        Ok(Self {
            access_token: response.access_token.clone(),
            refresh_token,
            expires_at_unix: now_unix.saturating_add(response.expires_in_seconds),
            scope: response.scope.clone().unwrap_or_default(),
            token_type: response.token_type.clone(),
        })
    }

    pub fn refreshed(self, now_unix: u64, response: &TokenResponse) -> Self {
        Self {
            access_token: response.access_token.clone(),
            refresh_token: response.refresh_token.clone().unwrap_or(self.refresh_token),
            expires_at_unix: now_unix.saturating_add(response.expires_in_seconds),
            scope: response.scope.clone().unwrap_or(self.scope),
            token_type: response.token_type.clone(),
        }
    }

    pub fn is_expired_at(&self, now_unix: u64, leeway_seconds: u64) -> bool {
        now_unix.saturating_add(leeway_seconds) >= self.expires_at_unix
    }

    pub fn to_json(&self) -> String {
        format!(
            "{{\"access_token\":\"{}\",\"refresh_token\":\"{}\",\"expires_at_unix\":{},\"scope\":\"{}\",\"token_type\":\"{}\"}}",
            crate::encoding::json_escape(&self.access_token),
            crate::encoding::json_escape(&self.refresh_token),
            self.expires_at_unix,
            crate::encoding::json_escape(&self.scope),
            crate::encoding::json_escape(&self.token_type),
        )
    }

    pub fn from_json(raw: &str) -> Result<Self, AuthError> {
        let root = parse_json(raw).map_err(AuthError::InvalidTokenJson)?;
        let access_token = root
            .get("access_token")
            .and_then(JsonValue::as_str)
            .filter(|value| !value.is_empty())
            .ok_or(AuthError::MissingAccessToken)?
            .to_string();
        let refresh_token = root
            .get("refresh_token")
            .and_then(JsonValue::as_str)
            .filter(|value| !value.is_empty())
            .ok_or(AuthError::MissingRefreshToken)?
            .to_string();
        let expires_at_unix = root
            .get("expires_at_unix")
            .and_then(|value| match value {
                JsonValue::Number(text) => text.parse::<u64>().ok(),
                _ => None,
            })
            .unwrap_or(0);
        let scope = root
            .get("scope")
            .and_then(JsonValue::as_str)
            .unwrap_or("")
            .to_string();
        let token_type = root
            .get("token_type")
            .and_then(JsonValue::as_str)
            .unwrap_or("Bearer")
            .to_string();
        Ok(Self {
            access_token,
            refresh_token,
            expires_at_unix,
            scope,
            token_type,
        })
    }
}

fn validate_state(state: &str) -> Result<(), AuthError> {
    if state.len() < 16 {
        return Err(AuthError::WeakState);
    }
    Ok(())
}

fn validate_code_verifier(verifier: &str) -> Result<(), AuthError> {
    if !(43..=128).contains(&verifier.len()) {
        return Err(AuthError::InvalidCodeVerifierLength);
    }
    if !verifier
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~'))
    {
        return Err(AuthError::InvalidCodeVerifierCharacters);
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AuthError {
    MissingClientId,
    MissingClientSecret,
    MissingRedirectUri,
    MissingScopes,
    MissingAuthorizationCode,
    MissingRefreshToken,
    MissingAccessToken,
    WeakState,
    InvalidCodeVerifierLength,
    InvalidCodeVerifierCharacters,
    InvalidCredentialsJson(JsonError),
    InvalidTokenJson(JsonError),
    ProviderError(String),
}

impl std::fmt::Display for AuthError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AuthError::MissingClientId => f.write_str("missing OAuth client_id"),
            AuthError::MissingClientSecret => f.write_str("missing OAuth client_secret"),
            AuthError::MissingRedirectUri => f.write_str("missing OAuth redirect_uri"),
            AuthError::MissingScopes => f.write_str("missing OAuth scopes"),
            AuthError::MissingAuthorizationCode => f.write_str("missing OAuth authorization code"),
            AuthError::MissingRefreshToken => f.write_str("missing OAuth refresh_token"),
            AuthError::MissingAccessToken => f.write_str("missing OAuth access_token"),
            AuthError::WeakState => f.write_str("OAuth state must be at least 16 chars"),
            AuthError::InvalidCodeVerifierLength => {
                f.write_str("PKCE code verifier length must be 43-128 chars")
            }
            AuthError::InvalidCodeVerifierCharacters => {
                f.write_str("PKCE code verifier contains disallowed characters")
            }
            AuthError::InvalidCredentialsJson(error) => {
                write!(f, "credentials JSON parse error: {error:?}")
            }
            AuthError::InvalidTokenJson(error) => {
                write!(f, "token JSON parse error: {error:?}")
            }
            AuthError::ProviderError(message) => write!(f, "OAuth provider error: {message}"),
        }
    }
}

impl std::error::Error for AuthError {}

#[cfg(test)]
mod tests {
    use super::*;

    const VERIFIER: &str = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";

    #[test]
    fn pkce_challenge_matches_rfc7636_vector() {
        assert_eq!(
            pkce_challenge_s256(VERIFIER),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn auth_url_uses_least_privilege_default_scopes() {
        let config = OAuthConfig::loopback("client id", 49152);
        let request = build_authorization_request(
            &config,
            "state-state-state",
            "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ",
        )
        .unwrap();

        assert!(request.url.starts_with(GOOGLE_AUTH_URL));
        assert!(request.url.contains("drive.file"));
        assert!(request.url.contains("drive.metadata.readonly"));
        assert!(request.url.contains("documents"));
        assert!(!request.url.contains("auth%2Fdrive%20"));
        assert!(request.url.contains("access_type=offline"));
    }

    #[test]
    fn token_exchange_is_form_encoded() {
        let config = OAuthConfig::loopback("client", 3333);
        let body = build_token_exchange_body(&config, "a/b", VERIFIER).unwrap();
        assert!(body.contains("code=a%2Fb"));
        assert!(body.contains("grant_type=authorization_code"));
        assert!(!body.contains("client_secret"));
    }

    #[test]
    fn token_exchange_includes_client_secret_when_set() {
        let config = OAuthConfig::loopback("client", 3333).with_client_secret("S/3+");
        let body = build_token_exchange_body(&config, "code", VERIFIER).unwrap();
        assert!(body.contains("client_secret=S%2F3%2B"));
    }

    #[test]
    fn refresh_body_includes_client_secret_when_set() {
        let config = OAuthConfig::loopback("client", 3333).with_client_secret("S/3+");
        let body = build_refresh_token_body(&config, "rt").unwrap();
        assert!(body.contains("grant_type=refresh_token"));
        assert!(body.contains("refresh_token=rt"));
        assert!(body.contains("client_secret=S%2F3%2B"));
    }

    #[test]
    fn parse_installed_credentials_extracts_id_and_secret() {
        let raw = r#"{"installed":{"client_id":"abc.apps.googleusercontent.com","client_secret":"GOCSPX-secret","redirect_uris":["http://localhost"]}}"#;
        let creds = parse_installed_app_credentials(raw).unwrap();
        assert_eq!(creds.client_id, "abc.apps.googleusercontent.com");
        assert_eq!(creds.client_secret, "GOCSPX-secret");
    }

    #[test]
    fn parse_token_response_extracts_fields_and_provider_errors() {
        let raw = r#"{"access_token":"at","refresh_token":"rt","expires_in":3599,"scope":"https://x https://y","token_type":"Bearer"}"#;
        let parsed = parse_token_response(raw).unwrap();
        assert_eq!(parsed.access_token, "at");
        assert_eq!(parsed.refresh_token.as_deref(), Some("rt"));
        assert_eq!(parsed.expires_in_seconds, 3599);
        assert_eq!(parsed.token_type, "Bearer");

        let error =
            parse_token_response(r#"{"error":"invalid_grant","error_description":"bad code"}"#)
                .unwrap_err();
        assert!(matches!(error, AuthError::ProviderError(_)));
    }

    #[test]
    fn stored_token_set_round_trips_through_json() {
        let response = TokenResponse {
            access_token: "at".to_string(),
            refresh_token: Some("rt".to_string()),
            expires_in_seconds: 3600,
            scope: Some("scope".to_string()),
            token_type: "Bearer".to_string(),
        };
        let stored = StoredTokenSet::from_initial_response(1_000, &response).unwrap();
        let round = StoredTokenSet::from_json(&stored.to_json()).unwrap();
        assert_eq!(round, stored);
        assert_eq!(stored.expires_at_unix, 4_600);
        assert!(stored.is_expired_at(4_590, 30));
        assert!(!stored.is_expired_at(4_500, 30));
    }
}
