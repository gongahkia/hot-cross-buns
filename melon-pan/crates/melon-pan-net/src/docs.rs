use crate::transport::{HttpClient, HttpError};
use melon_pan_core::{
    build_docs_create_request, build_docs_get_legacy_request, build_docs_get_request,
    parse_rich_document, BatchUpdateRequest, DocsGetRequest, RichDocument, RichParseError,
};

#[derive(Debug)]
pub enum DocsTransportError {
    Http {
        request_url: String,
        source: HttpError,
    },
    Parse(RichParseError),
}

impl std::fmt::Display for DocsTransportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DocsTransportError::Http {
                request_url,
                source,
            } => write!(f, "docs HTTP error for GET/POST {request_url}: {source}"),
            DocsTransportError::Parse(error) => write!(f, "docs parse error: {error:?}"),
        }
    }
}

impl std::error::Error for DocsTransportError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            DocsTransportError::Http { source, .. } => Some(source),
            DocsTransportError::Parse(_) => None,
        }
    }
}

pub struct DocsClient {
    http: HttpClient,
}

impl DocsClient {
    pub fn new(http: HttpClient) -> Self {
        Self { http }
    }

    /// Fetch a document and return both the parsed RichDocument and the raw JSON.
    pub fn get(&self, document_id: &str) -> Result<(RichDocument, String), DocsTransportError> {
        let request = build_docs_get_request(document_id);
        match self.fetch_and_parse(&request) {
            Ok(value) => Ok(value),
            Err(DocsTransportError::Http {
                source: HttpError::Status { status: 400, body },
                ..
            }) if should_retry_with_legacy_get(&body) => {
                let legacy_request = build_docs_get_legacy_request(document_id);
                self.fetch_and_parse(&legacy_request)
            }
            Err(error) => Err(error),
        }
    }

    fn fetch_and_parse(
        &self,
        request: &DocsGetRequest,
    ) -> Result<(RichDocument, String), DocsTransportError> {
        let raw = self
            .http
            .get_text(&request.url)
            .map_err(|source| DocsTransportError::Http {
                request_url: request.url.clone(),
                source,
            })?;
        let parsed = parse_rich_document(&raw).map_err(DocsTransportError::Parse)?;
        Ok((parsed, raw))
    }

    /// Returns the raw create-response JSON; callers can re-fetch for full body if needed.
    pub fn create(&self, title: &str) -> Result<String, DocsTransportError> {
        let request = build_docs_create_request(title);
        self.http
            .post_json(&request.url, &request.body_json)
            .map_err(|source| DocsTransportError::Http {
                request_url: request.url.clone(),
                source,
            })
    }

    /// POST a compiled batchUpdate request (from `rich_batch::compile_batch`)
    /// and return the raw response body. The caller is responsible for
    /// re-pulling and validating with `rich_validate::validate`.
    pub fn batch_update(&self, request: &BatchUpdateRequest) -> Result<String, DocsTransportError> {
        self.http
            .post_json(&request.url, &request.body_json)
            .map_err(|source| DocsTransportError::Http {
                request_url: request.url.clone(),
                source,
            })
    }
}

fn should_retry_with_legacy_get(body: &str) -> bool {
    let lower = body.to_ascii_lowercase();
    lower.contains("document.tabs") && lower.contains("legacy text-level fields")
}
