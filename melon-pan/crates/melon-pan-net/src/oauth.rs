use crate::transport::{HttpClient, HttpError};
use melon_pan_core::{
    build_refresh_token_body, build_token_exchange_body, parse_token_response,
    parse_userinfo_response, AuthError, OAuthConfig, TokenResponse, UserInfo, GOOGLE_TOKEN_URL,
    GOOGLE_USERINFO_URL,
};
use std::time::Duration;

#[derive(Debug)]
pub enum OAuthHttpError {
    Build(reqwest::Error),
    Request(reqwest::Error),
    Body(reqwest::Error),
    Auth(AuthError),
    Status { status: u16, body: String },
}

impl std::fmt::Display for OAuthHttpError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            OAuthHttpError::Build(error) => write!(f, "failed to build OAuth client: {error}"),
            OAuthHttpError::Request(error) => write!(f, "OAuth request failed: {error}"),
            OAuthHttpError::Body(error) => write!(f, "failed to read OAuth body: {error}"),
            OAuthHttpError::Auth(error) => write!(f, "{error}"),
            OAuthHttpError::Status { status, body } => write!(f, "OAuth HTTP {status}: {body}"),
        }
    }
}

impl std::error::Error for OAuthHttpError {}

impl From<HttpError> for OAuthHttpError {
    fn from(value: HttpError) -> Self {
        match value {
            HttpError::Build(error) => OAuthHttpError::Build(error),
            HttpError::Request(error) => OAuthHttpError::Request(error),
            HttpError::Status { status, body } => OAuthHttpError::Status { status, body },
            HttpError::Body(error) => OAuthHttpError::Body(error),
        }
    }
}

impl From<AuthError> for OAuthHttpError {
    fn from(value: AuthError) -> Self {
        OAuthHttpError::Auth(value)
    }
}

/// Client that talks to the Google OAuth2 token endpoint.
///
/// Token endpoint requests are unauthenticated (the bearer token is what we are
/// fetching), so this does not share `HttpClient`'s bearer-bound builder.
pub struct OAuthClient {
    inner: reqwest::blocking::Client,
    token_endpoint: String,
}

impl OAuthClient {
    pub fn new() -> Result<Self, OAuthHttpError> {
        let inner = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(20))
            .user_agent("melon-pan/0.1 (+https://github.com/gongahkia/melon-pan)")
            .build()
            .map_err(OAuthHttpError::Build)?;
        Ok(Self {
            inner,
            token_endpoint: GOOGLE_TOKEN_URL.to_string(),
        })
    }

    /// Override the token endpoint (for tests or self-hosted IdP).
    pub fn with_token_endpoint(mut self, endpoint: impl Into<String>) -> Self {
        self.token_endpoint = endpoint.into();
        self
    }

    pub fn exchange_code(
        &self,
        config: &OAuthConfig,
        code: &str,
        code_verifier: &str,
    ) -> Result<TokenResponse, OAuthHttpError> {
        let body = build_token_exchange_body(config, code, code_verifier)?;
        self.post_form(&body)
    }

    pub fn refresh(
        &self,
        config: &OAuthConfig,
        refresh_token: &str,
    ) -> Result<TokenResponse, OAuthHttpError> {
        let body = build_refresh_token_body(config, refresh_token)?;
        self.post_form(&body)
    }

    /// Fetches the signed-in user's email and display name with the given
    /// access token. Requires the userinfo.email scope on the token.
    pub fn fetch_userinfo(&self, access_token: &str) -> Result<UserInfo, OAuthHttpError> {
        let http = HttpClient::new(access_token.to_string())?;
        let raw = http.get_text(GOOGLE_USERINFO_URL)?;
        parse_userinfo_response(&raw).map_err(OAuthHttpError::Auth)
    }

    fn post_form(&self, body: &str) -> Result<TokenResponse, OAuthHttpError> {
        let response = self
            .inner
            .post(&self.token_endpoint)
            .header("Content-Type", "application/x-www-form-urlencoded")
            .header("Accept", "application/json")
            .body(body.to_string())
            .send()
            .map_err(OAuthHttpError::Request)?;
        let status = response.status();
        let raw = response.text().map_err(OAuthHttpError::Body)?;
        if !status.is_success() {
            // Token endpoint returns structured JSON on error; surface it via parse path
            // so callers see ProviderError("invalid_grant: ...").
            if let Ok(parsed) = parse_token_response(&raw) {
                // Successful 4xx is unusual; treat unexpected success body as success.
                return Ok(parsed);
            }
            // If parsing yields an AuthError::ProviderError, prefer that over raw status.
            if let Err(AuthError::ProviderError(message)) = parse_token_response(&raw) {
                return Err(OAuthHttpError::Auth(AuthError::ProviderError(message)));
            }
            return Err(OAuthHttpError::Status {
                status: status.as_u16(),
                body: raw,
            });
        }
        parse_token_response(&raw).map_err(OAuthHttpError::Auth)
    }
}
