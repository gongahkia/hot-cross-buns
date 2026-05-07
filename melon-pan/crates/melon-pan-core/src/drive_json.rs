use crate::drive::DriveItem;
use crate::json::{parse_json, JsonError, JsonValue};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedDriveList {
    pub files: Vec<DriveItem>,
    pub next_page_token: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DriveJsonError {
    InvalidJson(JsonError),
    MissingFiles,
}

pub fn parse_drive_list_json(raw: &str) -> Result<ParsedDriveList, DriveJsonError> {
    let root = parse_json(raw).map_err(DriveJsonError::InvalidJson)?;
    let files = root
        .get("files")
        .and_then(JsonValue::as_array)
        .ok_or(DriveJsonError::MissingFiles)?
        .iter()
        .map(parse_drive_item)
        .collect::<Vec<_>>();
    let next_page_token = root
        .get("nextPageToken")
        .and_then(JsonValue::as_str)
        .map(ToString::to_string);

    Ok(ParsedDriveList {
        files,
        next_page_token,
    })
}

fn parse_drive_item(value: &JsonValue) -> DriveItem {
    DriveItem {
        id: value
            .get("id")
            .and_then(JsonValue::as_str)
            .unwrap_or("")
            .to_string(),
        name: value
            .get("name")
            .and_then(JsonValue::as_str)
            .unwrap_or("Untitled")
            .to_string(),
        mime_type: value
            .get("mimeType")
            .and_then(JsonValue::as_str)
            .unwrap_or("")
            .to_string(),
        parents: value
            .get("parents")
            .and_then(JsonValue::as_array)
            .unwrap_or(&[])
            .iter()
            .filter_map(JsonValue::as_str)
            .map(ToString::to_string)
            .collect(),
        modified_time: value
            .get("modifiedTime")
            .and_then(JsonValue::as_str)
            .map(ToString::to_string),
        trashed: value
            .get("trashed")
            .and_then(JsonValue::as_bool)
            .unwrap_or(false),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::drive::{MIME_FOLDER, MIME_GOOGLE_DOC};

    #[test]
    fn parses_drive_list_response() {
        let raw = format!(
            r#"{{"nextPageToken":"next","files":[{{"id":"folder","name":"Folder","mimeType":"{MIME_FOLDER}","parents":["root"],"trashed":false}},{{"id":"doc","name":"Doc","mimeType":"{MIME_GOOGLE_DOC}","modifiedTime":"2026-05-01T00:00:00Z","trashed":false}}]}}"#
        );
        let parsed = parse_drive_list_json(&raw).unwrap();
        assert_eq!(parsed.next_page_token.as_deref(), Some("next"));
        assert!(parsed.files[0].is_folder());
        assert!(parsed.files[1].selectable_for_editing());
    }
}
