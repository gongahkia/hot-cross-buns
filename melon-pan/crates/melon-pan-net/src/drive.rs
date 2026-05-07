use crate::transport::{HttpClient, HttpError};
use melon_pan_core::{
    build_drive_delete_request, build_drive_list_request, build_drive_move_request,
    build_drive_rename_request, build_drive_trash_request, build_drive_untrash_request,
    parse_drive_list_json, DriveItem, DriveJsonError, ParsedDriveList,
};

#[derive(Debug)]
pub enum DriveTransportError {
    Http(HttpError),
    Parse(DriveJsonError),
}

impl std::fmt::Display for DriveTransportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DriveTransportError::Http(error) => write!(f, "drive HTTP error: {error}"),
            DriveTransportError::Parse(error) => write!(f, "drive parse error: {error:?}"),
        }
    }
}

impl std::error::Error for DriveTransportError {}

pub struct DriveClient {
    http: HttpClient,
}

impl DriveClient {
    pub fn new(http: HttpClient) -> Self {
        Self { http }
    }

    pub fn list_page(
        &self,
        parent_id: Option<&str>,
        page_token: Option<&str>,
    ) -> Result<(ParsedDriveList, String), DriveTransportError> {
        let request = build_drive_list_request(parent_id, page_token);
        let raw = self
            .http
            .get_text(&request.url)
            .map_err(DriveTransportError::Http)?;
        let parsed = parse_drive_list_json(&raw).map_err(DriveTransportError::Parse)?;
        Ok((parsed, raw))
    }

    pub fn rename(&self, file_id: &str, new_name: &str) -> Result<String, DriveTransportError> {
        let request = build_drive_rename_request(file_id, new_name);
        self.http
            .patch_json(&request.url, &request.body_json)
            .map_err(DriveTransportError::Http)
    }

    pub fn move_to(
        &self,
        file_id: &str,
        new_parent_id: &str,
        old_parent_id: &str,
    ) -> Result<String, DriveTransportError> {
        let request = build_drive_move_request(file_id, new_parent_id, old_parent_id);
        self.http
            .patch_json(&request.url, &request.body_json)
            .map_err(DriveTransportError::Http)
    }

    pub fn trash(&self, file_id: &str) -> Result<String, DriveTransportError> {
        let request = build_drive_trash_request(file_id);
        self.http
            .patch_json(&request.url, &request.body_json)
            .map_err(DriveTransportError::Http)
    }

    pub fn untrash(&self, file_id: &str) -> Result<String, DriveTransportError> {
        let request = build_drive_untrash_request(file_id);
        self.http
            .patch_json(&request.url, &request.body_json)
            .map_err(DriveTransportError::Http)
    }

    /// Uploads `bytes` as a new Drive file via the multipart endpoint and
    /// returns the assigned file id. Sets the file's MIME type to `mime`,
    /// the displayed name to `name`, and parents to `parent_id` when
    /// supplied. Used by the Obsidian importer to push image attachments
    /// alongside the Markdown body.
    pub fn upload_file(
        &self,
        name: &str,
        mime: &str,
        bytes: Vec<u8>,
        parent_id: Option<&str>,
    ) -> Result<String, DriveTransportError> {
        let boundary = "melonpan_boundary_b3b0c6f9_a72e_4d63_9af1_uploads";
        let metadata = build_upload_metadata_json(name, mime, parent_id);
        let mut body: Vec<u8> = Vec::with_capacity(bytes.len() + metadata.len() + 256);
        body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
        body.extend_from_slice(b"Content-Type: application/json; charset=UTF-8\r\n\r\n");
        body.extend_from_slice(metadata.as_bytes());
        body.extend_from_slice(b"\r\n");
        body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
        body.extend_from_slice(format!("Content-Type: {mime}\r\n\r\n").as_bytes());
        body.extend_from_slice(&bytes);
        body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());

        let url = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id";
        let raw = self
            .http
            .post_bytes(
                url,
                &format!("multipart/related; boundary={boundary}"),
                body,
            )
            .map_err(DriveTransportError::Http)?;
        // Cheap field grab so we don't depend on melon_pan_core::json here —
        // the response is `{"id":"..."}`.
        let id = extract_json_string_field(&raw, "id").ok_or_else(|| {
            DriveTransportError::Http(HttpError::Status {
                status: 0,
                body: format!("upload response missing id field: {raw}"),
            })
        })?;
        Ok(id)
    }

    /// Permanently deletes the file. Use sparingly; prefer trash() unless the
    /// caller has explicit intent to bypass the trash safety net.
    pub fn delete(&self, file_id: &str) -> Result<(), DriveTransportError> {
        let request = build_drive_delete_request(file_id);
        self.http
            .delete_empty(&request.url)
            .map_err(DriveTransportError::Http)
    }

    pub fn http(&self) -> &HttpClient {
        &self.http
    }

    /// Pages through Drive results until `nextPageToken` is empty.
    pub fn list_all(&self, parent_id: Option<&str>) -> Result<Vec<DriveItem>, DriveTransportError> {
        let mut items = Vec::new();
        let mut token: Option<String> = None;
        loop {
            let (page, _raw) = self.list_page(parent_id, token.as_deref())?;
            items.extend(page.files);
            match page.next_page_token {
                Some(next) if !next.is_empty() => token = Some(next),
                _ => break,
            }
        }
        Ok(items)
    }
}

fn build_upload_metadata_json(name: &str, mime: &str, parent_id: Option<&str>) -> String {
    let mut metadata = String::with_capacity(128);
    metadata.push('{');
    metadata.push_str(&format!("\"name\":\"{}\"", json_escape_basic(name)));
    metadata.push_str(&format!(",\"mimeType\":\"{}\"", json_escape_basic(mime)));
    if let Some(parent) = parent_id {
        metadata.push_str(&format!(",\"parents\":[\"{}\"]", json_escape_basic(parent)));
    }
    metadata.push('}');
    metadata
}

fn json_escape_basic(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            ch if (ch as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", ch as u32)),
            ch => out.push(ch),
        }
    }
    out
}

fn extract_json_string_field(raw: &str, field: &str) -> Option<String> {
    // Targeted lookup: find `"field"` followed by `:` and a string literal.
    let needle = format!("\"{field}\"");
    let start = raw.find(&needle)?;
    let after = &raw[start + needle.len()..];
    let colon_relative = after.find(':')?;
    let mut idx = colon_relative + 1;
    let bytes = after.as_bytes();
    while idx < bytes.len()
        && (bytes[idx] == b' ' || bytes[idx] == b'\t' || bytes[idx] == b'\n' || bytes[idx] == b'\r')
    {
        idx += 1;
    }
    if idx >= bytes.len() || bytes[idx] != b'"' {
        return None;
    }
    idx += 1;
    let mut value = String::new();
    while idx < bytes.len() && bytes[idx] != b'"' {
        if bytes[idx] == b'\\' && idx + 1 < bytes.len() {
            let escaped = bytes[idx + 1] as char;
            value.push(match escaped {
                'n' => '\n',
                'r' => '\r',
                't' => '\t',
                '"' => '"',
                '\\' => '\\',
                other => other,
            });
            idx += 2;
        } else {
            value.push(bytes[idx] as char);
            idx += 1;
        }
    }
    Some(value)
}
