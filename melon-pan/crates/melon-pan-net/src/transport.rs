use std::thread;
use std::time::Duration;

const MAX_RETRY_ATTEMPTS: u32 = 3;
const INITIAL_BACKOFF_MS: u64 = 250;

#[derive(Debug)]
pub enum HttpError {
    Build(reqwest::Error),
    Request(reqwest::Error),
    Status { status: u16, body: String },
    Body(reqwest::Error),
}

impl std::fmt::Display for HttpError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            HttpError::Build(error) => write!(f, "failed to build HTTP client: {error}"),
            HttpError::Request(error) => write!(f, "HTTP request failed: {error}"),
            HttpError::Status { status, body } => {
                write!(f, "HTTP {status}: {body}")
            }
            HttpError::Body(error) => write!(f, "failed to read HTTP body: {error}"),
        }
    }
}

impl std::error::Error for HttpError {}

#[derive(Clone)]
pub struct HttpClient {
    inner: reqwest::blocking::Client,
    bearer_token: String,
}

impl HttpClient {
    pub fn new(bearer_token: impl Into<String>) -> Result<Self, HttpError> {
        let inner = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(30))
            .user_agent("melon-pan/0.1 (+https://github.com/gongahkia/melon-pan)")
            .build()
            .map_err(HttpError::Build)?;
        Ok(Self {
            inner,
            bearer_token: bearer_token.into(),
        })
    }

    /// Issues an unauthenticated GET. Used for public endpoints (GitHub
    /// releases, version probes) where a bearer token would be wrong.
    pub fn public_get_text(url: &str) -> Result<String, HttpError> {
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(15))
            .user_agent("melon-pan/0.1 (+https://github.com/gongahkia/melon-pan)")
            .build()
            .map_err(HttpError::Build)?;
        let response = client
            .get(url)
            .header("Accept", "application/json")
            .send()
            .map_err(HttpError::Request)?;
        Self::body_or_error(response)
    }

    pub fn get_text(&self, url: &str) -> Result<String, HttpError> {
        self.run_with_retry(|| {
            self.inner
                .get(url)
                .bearer_auth(&self.bearer_token)
                .header("Accept", "application/json")
                .send()
        })
    }

    pub fn post_json(&self, url: &str, json_body: &str) -> Result<String, HttpError> {
        self.run_with_retry(|| {
            self.inner
                .post(url)
                .bearer_auth(&self.bearer_token)
                .header("Content-Type", "application/json; charset=utf-8")
                .header("Accept", "application/json")
                .body(json_body.to_string())
                .send()
        })
    }

    pub fn patch_json(&self, url: &str, json_body: &str) -> Result<String, HttpError> {
        self.run_with_retry(|| {
            self.inner
                .patch(url)
                .bearer_auth(&self.bearer_token)
                .header("Content-Type", "application/json; charset=utf-8")
                .header("Accept", "application/json")
                .body(json_body.to_string())
                .send()
        })
    }

    /// Issues a POST whose body is a pre-assembled byte slice with a
    /// caller-supplied Content-Type header. Used for Drive `files.create`
    /// `uploadType=multipart`, where the body is JSON metadata + binary
    /// glued together with a custom boundary — reqwest's `multipart::Form`
    /// can't express that exact shape because it forces text/binary parts
    /// to be `Content-Disposition: form-data` instead of plain `Content-Type`.
    pub fn post_bytes(
        &self,
        url: &str,
        content_type: &str,
        body: Vec<u8>,
    ) -> Result<String, HttpError> {
        self.run_with_retry(|| {
            self.inner
                .post(url)
                .bearer_auth(&self.bearer_token)
                .header("Content-Type", content_type)
                .header("Accept", "application/json")
                .body(body.clone())
                .send()
        })
    }

    /// DELETE returning empty body on 204; treats 204/200 as success.
    pub fn delete_empty(&self, url: &str) -> Result<(), HttpError> {
        let _ = self.run_with_retry(|| {
            self.inner
                .delete(url)
                .bearer_auth(&self.bearer_token)
                .send()
        })?;
        Ok(())
    }

    fn run_with_retry<F>(&self, mut send: F) -> Result<String, HttpError>
    where
        F: FnMut() -> reqwest::Result<reqwest::blocking::Response>,
    {
        let mut backoff_ms = INITIAL_BACKOFF_MS;
        let mut attempt = 0_u32;
        loop {
            attempt += 1;
            match send() {
                Ok(response) => match Self::body_or_error(response) {
                    Ok(body) => return Ok(body),
                    Err(error)
                        if Self::status_is_retryable(&error) && attempt < MAX_RETRY_ATTEMPTS =>
                    {
                        thread::sleep(Duration::from_millis(backoff_ms));
                        backoff_ms = backoff_ms.saturating_mul(2);
                    }
                    Err(error) => return Err(error),
                },
                Err(error) if attempt < MAX_RETRY_ATTEMPTS && Self::error_is_retryable(&error) => {
                    thread::sleep(Duration::from_millis(backoff_ms));
                    backoff_ms = backoff_ms.saturating_mul(2);
                }
                Err(error) => return Err(HttpError::Request(error)),
            }
        }
    }

    fn body_or_error(response: reqwest::blocking::Response) -> Result<String, HttpError> {
        let status = response.status();
        let body = response.text().map_err(HttpError::Body)?;
        if !status.is_success() {
            return Err(HttpError::Status {
                status: status.as_u16(),
                body,
            });
        }
        Ok(body)
    }

    fn status_is_retryable(error: &HttpError) -> bool {
        matches!(error, HttpError::Status { status, .. } if matches!(*status, 429 | 500 | 502 | 503 | 504))
    }

    fn error_is_retryable(error: &reqwest::Error) -> bool {
        error.is_timeout() || error.is_connect()
    }
}
