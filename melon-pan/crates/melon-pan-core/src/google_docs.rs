//! Google Docs HTTP request builders for the rich-docs path.
//!
//! `batchUpdate` request building was removed when the markdown subsystem
//! was excised. The rich-batch compiler (per RICHTEXT-TODO `rich_batch.rs`
//! work item) will reintroduce a `RichOperation`-aware builder when
//! editing lands. Until then the runtime is intentionally pull-only.

use crate::encoding::{json_escape, percent_encode};

pub const DOCS_DOCUMENTS_ENDPOINT: &str = "https://docs.googleapis.com/v1/documents";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocsGetRequest {
    pub url: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocsCreateRequest {
    pub url: String,
    pub body_json: String,
}

const DOCS_LEGACY_GET_FIELDS: &str = "documentId,title,revisionId,body,headers,footers,footnotes,documentStyle,namedStyles,lists,namedRanges,inlineObjects,positionedObjects";

pub fn build_docs_get_request(document_id: &str) -> DocsGetRequest {
    DocsGetRequest {
        url: format!(
            "{DOCS_DOCUMENTS_ENDPOINT}/{}?includeTabsContent=true",
            percent_encode(document_id)
        ),
    }
}

pub fn build_docs_get_legacy_request(document_id: &str) -> DocsGetRequest {
    DocsGetRequest {
        url: format!(
            "{DOCS_DOCUMENTS_ENDPOINT}/{}?fields={}",
            percent_encode(document_id),
            percent_encode(DOCS_LEGACY_GET_FIELDS)
        ),
    }
}

pub fn build_docs_create_request(title: &str) -> DocsCreateRequest {
    DocsCreateRequest {
        url: DOCS_DOCUMENTS_ENDPOINT.to_string(),
        body_json: format!("{{\"title\":\"{}\"}}", json_escape(title)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn docs_get_request_uses_full_tabbed_response() {
        let request = build_docs_get_request("doc/id");
        assert!(request.url.contains("doc%2Fid"));
        assert!(request.url.contains("includeTabsContent=true"));
        assert!(!request.url.contains("fields="));
    }

    #[test]
    fn legacy_docs_get_request_avoids_tabs() {
        let request = build_docs_get_legacy_request("doc/id");
        assert!(request.url.contains("doc%2Fid"));
        assert!(request.url.contains("fields="));
        assert!(request.url.contains("revisionId"));
        assert!(request.url.contains("body"));
        assert!(request.url.contains("headers"));
        assert!(!request.url.contains("includeTabsContent=true"));
        assert!(!request.url.contains("tabs"));
        assert!(!request.url.contains("bookmarks"));
    }

    #[test]
    fn docs_create_request_escapes_title() {
        let request = build_docs_create_request("A \"Doc\"");
        assert_eq!(request.body_json, "{\"title\":\"A \\\"Doc\\\"\"}");
    }
}
