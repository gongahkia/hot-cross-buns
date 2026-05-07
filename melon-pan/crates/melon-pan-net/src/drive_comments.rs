use crate::transport::{HttpClient, HttpError};
use melon_pan_core::{
    build_drive_comments_list_request, parse_drive_comments_json, DriveCommentsJsonError,
    ParsedDriveComments, RichComment,
};

#[derive(Debug)]
pub enum DriveCommentsTransportError {
    Http(HttpError),
    Parse(DriveCommentsJsonError),
}

impl std::fmt::Display for DriveCommentsTransportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DriveCommentsTransportError::Http(error) => {
                write!(f, "drive comments HTTP error: {error}")
            }
            DriveCommentsTransportError::Parse(error) => {
                write!(f, "drive comments parse error: {error:?}")
            }
        }
    }
}

impl std::error::Error for DriveCommentsTransportError {}

pub struct DriveCommentsClient {
    http: HttpClient,
}

impl DriveCommentsClient {
    pub fn new(http: HttpClient) -> Self {
        Self { http }
    }

    pub fn list_page(
        &self,
        file_id: &str,
        page_token: Option<&str>,
    ) -> Result<(ParsedDriveComments, String), DriveCommentsTransportError> {
        let request = build_drive_comments_list_request(file_id, page_token);
        let raw = self
            .http
            .get_text(&request.url)
            .map_err(DriveCommentsTransportError::Http)?;
        let parsed = parse_drive_comments_json(&raw).map_err(DriveCommentsTransportError::Parse)?;
        Ok((parsed, raw))
    }

    pub fn list_all(&self, file_id: &str) -> Result<Vec<RichComment>, DriveCommentsTransportError> {
        let mut comments = Vec::new();
        let mut token: Option<String> = None;
        loop {
            let (page, _raw) = self.list_page(file_id, token.as_deref())?;
            comments.extend(page.comments);
            match page.next_page_token {
                Some(next) if !next.is_empty() => token = Some(next),
                _ => break,
            }
        }
        Ok(comments)
    }
}
