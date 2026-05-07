use crate::encoding::{json_escape, percent_encode};

pub const DRIVE_FILES_ENDPOINT: &str = "https://www.googleapis.com/drive/v3/files";

/// Extracts a Google Doc/Drive document id from a URL or returns the input
/// trimmed if it already looks like a bare id.
///
/// Recognised URL patterns:
/// - `https://docs.google.com/document/d/<id>/edit?...`
/// - `https://drive.google.com/file/d/<id>/view?...`
/// - `https://docs.google.com/spreadsheets/d/<id>/...` (returned even though
///   Melon Pan only edits Docs; caller should reject by mime later)
///
/// Returns `None` when the input is empty.
pub fn extract_drive_doc_id(input: &str) -> Option<String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return None;
    }
    for marker in [
        "/document/d/",
        "/file/d/",
        "/spreadsheets/d/",
        "/presentation/d/",
    ] {
        if let Some(start) = trimmed.find(marker) {
            let after = &trimmed[start + marker.len()..];
            let end = after
                .find(|c: char| c == '/' || c == '?' || c == '#' || c.is_whitespace())
                .unwrap_or(after.len());
            let id = &after[..end];
            if !id.is_empty() {
                return Some(id.to_string());
            }
        }
    }
    // Bare id: take the input as-is once we've confirmed it isn't a URL we
    // didn't recognise.
    if trimmed.contains("://") {
        return None;
    }
    Some(trimmed.to_string())
}
pub const MIME_FOLDER: &str = "application/vnd.google-apps.folder";
pub const MIME_GOOGLE_DOC: &str = "application/vnd.google-apps.document";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DriveItem {
    pub id: String,
    pub name: String,
    pub mime_type: String,
    pub parents: Vec<String>,
    pub modified_time: Option<String>,
    pub trashed: bool,
}

impl DriveItem {
    pub fn is_folder(&self) -> bool {
        self.mime_type == MIME_FOLDER
    }

    pub fn is_google_doc(&self) -> bool {
        self.mime_type == MIME_GOOGLE_DOC
    }

    pub fn selectable_for_editing(&self) -> bool {
        self.is_google_doc() && !self.trashed
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DriveListRequest {
    pub url: String,
    pub query: String,
}

pub fn build_drive_list_request(
    parent_id: Option<&str>,
    page_token: Option<&str>,
) -> DriveListRequest {
    let query = build_drive_query(parent_id);
    let mut params = vec![
        ("q", query.as_str()),
        (
            "fields",
            "nextPageToken,files(id,name,mimeType,parents,modifiedTime,trashed)",
        ),
        ("pageSize", "1000"),
        ("orderBy", "folder,name_natural"),
        ("supportsAllDrives", "true"),
        ("includeItemsFromAllDrives", "true"),
    ];
    if let Some(page_token) = page_token {
        params.push(("pageToken", page_token));
    }

    let encoded_params = params
        .iter()
        .map(|(key, value)| format!("{}={}", percent_encode(key), percent_encode(value)))
        .collect::<Vec<_>>()
        .join("&");

    DriveListRequest {
        url: format!("{DRIVE_FILES_ENDPOINT}?{encoded_params}"),
        query,
    }
}

pub fn build_drive_query(parent_id: Option<&str>) -> String {
    let mut parts = vec!["trashed = false".to_string()];
    if let Some(parent_id) = parent_id {
        parts.push(format!("'{}' in parents", escape_drive_query(parent_id)));
    }
    parts.join(" and ")
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DrivePatchRequest {
    pub url: String,
    pub body_json: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DriveDeleteRequest {
    pub url: String,
}

/// Builds a PATCH /files/{id} request that renames the file.
pub fn build_drive_rename_request(file_id: &str, new_name: &str) -> DrivePatchRequest {
    DrivePatchRequest {
        url: format!("{DRIVE_FILES_ENDPOINT}/{}", percent_encode(file_id)),
        body_json: format!("{{\"name\":\"{}\"}}", json_escape(new_name)),
    }
}

/// Builds a PATCH /files/{id} request that re-parents the file. The query
/// parameters move it from `old_parent_id` to `new_parent_id`.
pub fn build_drive_move_request(
    file_id: &str,
    new_parent_id: &str,
    old_parent_id: &str,
) -> DrivePatchRequest {
    DrivePatchRequest {
        url: format!(
            "{DRIVE_FILES_ENDPOINT}/{}?addParents={}&removeParents={}&supportsAllDrives=false",
            percent_encode(file_id),
            percent_encode(new_parent_id),
            percent_encode(old_parent_id),
        ),
        body_json: "{}".to_string(),
    }
}

/// Builds a PATCH /files/{id} request that sets trashed=true (soft delete).
pub fn build_drive_trash_request(file_id: &str) -> DrivePatchRequest {
    DrivePatchRequest {
        url: format!("{DRIVE_FILES_ENDPOINT}/{}", percent_encode(file_id)),
        body_json: "{\"trashed\":true}".to_string(),
    }
}

/// Builds a PATCH /files/{id} request that sets trashed=false (restore).
pub fn build_drive_untrash_request(file_id: &str) -> DrivePatchRequest {
    DrivePatchRequest {
        url: format!("{DRIVE_FILES_ENDPOINT}/{}", percent_encode(file_id)),
        body_json: "{\"trashed\":false}".to_string(),
    }
}

/// Builds a DELETE /files/{id} request (permanent delete; bypasses trash).
pub fn build_drive_delete_request(file_id: &str) -> DriveDeleteRequest {
    DriveDeleteRequest {
        url: format!("{DRIVE_FILES_ENDPOINT}/{}", percent_encode(file_id)),
    }
}

pub fn drive_tree_cache_json(items: &[DriveItem]) -> String {
    let files = items
        .iter()
        .map(|item| {
            let parents = item
                .parents
                .iter()
                .map(|parent| format!("\"{}\"", json_escape(parent)))
                .collect::<Vec<_>>()
                .join(",");
            let modified_time = item
                .modified_time
                .as_ref()
                .map(|value| format!("\"{}\"", json_escape(value)))
                .unwrap_or_else(|| "null".to_string());
            format!(
                "{{\"id\":\"{}\",\"name\":\"{}\",\"mimeType\":\"{}\",\"parents\":[{}],\"modifiedTime\":{},\"trashed\":{},\"editable\":{}}}",
                json_escape(&item.id),
                json_escape(&item.name),
                json_escape(&item.mime_type),
                parents,
                modified_time,
                item.trashed,
                item.selectable_for_editing(),
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    format!("{{\"files\":[{files}]}}\n")
}

fn escape_drive_query(input: &str) -> String {
    input.replace('\\', "\\\\").replace('\'', "\\'")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_doc_id_from_canonical_urls() {
        assert_eq!(
            extract_drive_doc_id("https://docs.google.com/document/d/ABC123/edit").as_deref(),
            Some("ABC123")
        );
        assert_eq!(
            extract_drive_doc_id("https://drive.google.com/file/d/Xyz_789/view?usp=sharing")
                .as_deref(),
            Some("Xyz_789")
        );
        assert_eq!(
            extract_drive_doc_id("https://docs.google.com/document/d/ABC123/edit#heading=h.foo")
                .as_deref(),
            Some("ABC123")
        );
        assert_eq!(
            extract_drive_doc_id("ABC123_bare").as_deref(),
            Some("ABC123_bare")
        );
        assert_eq!(extract_drive_doc_id("   "), None);
        assert_eq!(extract_drive_doc_id("https://example.com/notadrive"), None);
    }

    #[test]
    fn drive_query_lists_visible_drive_items() {
        let request = build_drive_list_request(Some("root'id"), None);
        assert!(!request.query.contains("mimeType ="));
        assert!(request.query.contains("trashed = false"));
        assert!(request.query.contains("'root\\'id' in parents"));
        assert!(request.url.contains("files%28id%2Cname%2CmimeType"));
        assert!(request.url.contains("supportsAllDrives=true"));
        assert!(request.url.contains("includeItemsFromAllDrives=true"));
    }

    #[test]
    fn non_docs_are_not_editable() {
        let item = DriveItem {
            id: "1".to_string(),
            name: "Sheet".to_string(),
            mime_type: "application/vnd.google-apps.spreadsheet".to_string(),
            parents: Vec::new(),
            modified_time: None,
            trashed: false,
        };
        assert!(!item.selectable_for_editing());
    }
}
