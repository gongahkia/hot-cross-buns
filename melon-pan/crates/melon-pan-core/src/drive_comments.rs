use crate::encoding::{json_escape, percent_encode};
use crate::json::{parse_json, JsonError, JsonValue};
use crate::rich_model::{
    RichComment, RichCommentAuthor, RichCommentQuotedFileContent, RichCommentReply,
};

const DRIVE_FILES_ENDPOINT: &str = "https://www.googleapis.com/drive/v3/files";
const COMMENT_FIELDS: &str = concat!(
    "nextPageToken,",
    "comments(",
    "id,content,htmlContent,anchor,",
    "quotedFileContent(mimeType,value),",
    "author(displayName,emailAddress,photoLink,me),",
    "resolved,createdTime,modifiedTime,",
    "replies(id,content,htmlContent,author(displayName,emailAddress,photoLink,me),createdTime,modifiedTime,deleted)",
    ")"
);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DriveCommentsListRequest {
    pub url: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedDriveComments {
    pub comments: Vec<RichComment>,
    pub next_page_token: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DriveCommentsJsonError {
    InvalidJson(JsonError),
    MissingComments,
}

pub fn build_drive_comments_list_request(
    file_id: &str,
    page_token: Option<&str>,
) -> DriveCommentsListRequest {
    let mut params = vec![
        ("fields", COMMENT_FIELDS),
        ("pageSize", "100"),
        ("includeDeleted", "false"),
    ];
    if let Some(page_token) = page_token {
        params.push(("pageToken", page_token));
    }

    let encoded_params = params
        .iter()
        .map(|(key, value)| format!("{}={}", percent_encode(key), percent_encode(value)))
        .collect::<Vec<_>>()
        .join("&");

    DriveCommentsListRequest {
        url: format!(
            "{}/{}/comments?{}",
            DRIVE_FILES_ENDPOINT,
            percent_encode(file_id),
            encoded_params
        ),
    }
}

pub fn parse_drive_comments_json(raw: &str) -> Result<ParsedDriveComments, DriveCommentsJsonError> {
    let root = parse_json(raw).map_err(DriveCommentsJsonError::InvalidJson)?;
    let comments = root
        .get("comments")
        .and_then(JsonValue::as_array)
        .ok_or(DriveCommentsJsonError::MissingComments)?
        .iter()
        .map(parse_comment)
        .collect();
    let next_page_token = root
        .get("nextPageToken")
        .and_then(JsonValue::as_str)
        .map(ToString::to_string);
    Ok(ParsedDriveComments {
        comments,
        next_page_token,
    })
}

pub fn drive_comments_sidecar_json(
    document_id: &str,
    fetched_at: &str,
    comments: &[RichComment],
) -> String {
    let comments = comments
        .iter()
        .map(comment_json)
        .collect::<Vec<_>>()
        .join(",");
    format!(
        "{{\"documentId\":\"{}\",\"fetchedAt\":\"{}\",\"comments\":[{}]}}\n",
        json_escape(document_id),
        json_escape(fetched_at),
        comments
    )
}

fn parse_comment(value: &JsonValue) -> RichComment {
    RichComment {
        id: string_field(value, "id"),
        author: value.get("author").map(parse_author),
        content: string_field(value, "content"),
        html_content: string_field(value, "htmlContent"),
        anchor: value
            .get("anchor")
            .map(json_value_to_string)
            .filter(|value| !value.is_empty()),
        quoted_file_content: value
            .get("quotedFileContent")
            .map(parse_quoted_file_content),
        resolved: value
            .get("resolved")
            .and_then(JsonValue::as_bool)
            .unwrap_or(false),
        created_time: optional_string_field(value, "createdTime"),
        modified_time: optional_string_field(value, "modifiedTime"),
        replies: value
            .get("replies")
            .and_then(JsonValue::as_array)
            .unwrap_or(&[])
            .iter()
            .map(parse_reply)
            .collect(),
    }
}

fn parse_reply(value: &JsonValue) -> RichCommentReply {
    RichCommentReply {
        id: string_field(value, "id"),
        author: value.get("author").map(parse_author),
        content: string_field(value, "content"),
        html_content: string_field(value, "htmlContent"),
        created_time: optional_string_field(value, "createdTime"),
        modified_time: optional_string_field(value, "modifiedTime"),
        deleted: value
            .get("deleted")
            .and_then(JsonValue::as_bool)
            .unwrap_or(false),
    }
}

fn parse_author(value: &JsonValue) -> RichCommentAuthor {
    RichCommentAuthor {
        display_name: string_field(value, "displayName"),
        email_address: optional_string_field(value, "emailAddress"),
        photo_link: optional_string_field(value, "photoLink"),
        me: value
            .get("me")
            .and_then(JsonValue::as_bool)
            .unwrap_or(false),
    }
}

fn parse_quoted_file_content(value: &JsonValue) -> RichCommentQuotedFileContent {
    RichCommentQuotedFileContent {
        mime_type: string_field(value, "mimeType"),
        value: string_field(value, "value"),
    }
}

fn string_field(value: &JsonValue, key: &str) -> String {
    value
        .get(key)
        .and_then(JsonValue::as_str)
        .unwrap_or("")
        .to_string()
}

fn optional_string_field(value: &JsonValue, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(JsonValue::as_str)
        .map(ToString::to_string)
}

fn json_value_to_string(value: &JsonValue) -> String {
    match value {
        JsonValue::Null => String::new(),
        JsonValue::Bool(value) => value.to_string(),
        JsonValue::Number(value) => value.clone(),
        JsonValue::String(value) => value.clone(),
        JsonValue::Array(values) => format!(
            "[{}]",
            values
                .iter()
                .map(json_literal)
                .collect::<Vec<_>>()
                .join(",")
        ),
        JsonValue::Object(fields) => format!(
            "{{{}}}",
            fields
                .iter()
                .map(|(key, value)| format!("\"{}\":{}", json_escape(key), json_literal(value)))
                .collect::<Vec<_>>()
                .join(",")
        ),
    }
}

fn json_literal(value: &JsonValue) -> String {
    match value {
        JsonValue::Null => "null".to_string(),
        JsonValue::Bool(value) => value.to_string(),
        JsonValue::Number(value) => value.clone(),
        JsonValue::String(value) => format!("\"{}\"", json_escape(value)),
        JsonValue::Array(values) => format!(
            "[{}]",
            values
                .iter()
                .map(json_literal)
                .collect::<Vec<_>>()
                .join(",")
        ),
        JsonValue::Object(fields) => format!(
            "{{{}}}",
            fields
                .iter()
                .map(|(key, value)| format!("\"{}\":{}", json_escape(key), json_literal(value)))
                .collect::<Vec<_>>()
                .join(",")
        ),
    }
}

fn comment_json(comment: &RichComment) -> String {
    let author = option_author_json(comment.author.as_ref());
    let anchor = option_string_json(comment.anchor.as_deref());
    let quoted = option_quoted_json(comment.quoted_file_content.as_ref());
    let created_time = option_string_json(comment.created_time.as_deref());
    let modified_time = option_string_json(comment.modified_time.as_deref());
    let replies = comment
        .replies
        .iter()
        .map(reply_json)
        .collect::<Vec<_>>()
        .join(",");
    format!(
        "{{\"id\":\"{}\",\"author\":{},\"content\":\"{}\",\"htmlContent\":\"{}\",\"anchor\":{},\"quotedFileContent\":{},\"resolved\":{},\"createdTime\":{},\"modifiedTime\":{},\"replies\":[{}]}}",
        json_escape(&comment.id),
        author,
        json_escape(&comment.content),
        json_escape(&comment.html_content),
        anchor,
        quoted,
        comment.resolved,
        created_time,
        modified_time,
        replies
    )
}

fn reply_json(reply: &RichCommentReply) -> String {
    format!(
        "{{\"id\":\"{}\",\"author\":{},\"content\":\"{}\",\"htmlContent\":\"{}\",\"createdTime\":{},\"modifiedTime\":{},\"deleted\":{}}}",
        json_escape(&reply.id),
        option_author_json(reply.author.as_ref()),
        json_escape(&reply.content),
        json_escape(&reply.html_content),
        option_string_json(reply.created_time.as_deref()),
        option_string_json(reply.modified_time.as_deref()),
        reply.deleted
    )
}

fn option_author_json(author: Option<&RichCommentAuthor>) -> String {
    match author {
        Some(author) => format!(
            "{{\"displayName\":\"{}\",\"emailAddress\":{},\"photoLink\":{},\"me\":{}}}",
            json_escape(&author.display_name),
            option_string_json(author.email_address.as_deref()),
            option_string_json(author.photo_link.as_deref()),
            author.me
        ),
        None => "null".to_string(),
    }
}

fn option_quoted_json(quoted: Option<&RichCommentQuotedFileContent>) -> String {
    match quoted {
        Some(quoted) => format!(
            "{{\"mimeType\":\"{}\",\"value\":\"{}\"}}",
            json_escape(&quoted.mime_type),
            json_escape(&quoted.value)
        ),
        None => "null".to_string(),
    }
}

fn option_string_json(value: Option<&str>) -> String {
    value
        .map(|value| format!("\"{}\"", json_escape(value)))
        .unwrap_or_else(|| "null".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_comments_list_request_with_fields() {
        let request = build_drive_comments_list_request("doc id/1", Some("next token"));
        assert!(request.url.contains("/files/doc%20id%2F1/comments?"));
        assert!(request.url.contains("fields="));
        assert!(request.url.contains("pageToken=next%20token"));
    }

    #[test]
    fn parses_and_serializes_comments_sidecar() {
        let raw = r#"{
          "nextPageToken":"n",
          "comments":[{
            "id":"c1",
            "content":"Plain",
            "htmlContent":"<b>Plain</b>",
            "anchor":"kix.anchor",
            "quotedFileContent":{"mimeType":"text/plain","value":"Quote"},
            "author":{"displayName":"Ada","emailAddress":"ada@example.com","me":true},
            "resolved":false,
            "createdTime":"2026-05-06T00:00:00Z",
            "replies":[{"id":"r1","content":"Reply","deleted":false}]
          }]
        }"#;
        let parsed = parse_drive_comments_json(raw).unwrap();
        assert_eq!(parsed.next_page_token.as_deref(), Some("n"));
        assert_eq!(
            parsed.comments[0].author.as_ref().unwrap().display_name,
            "Ada"
        );
        assert_eq!(
            parsed.comments[0]
                .quoted_file_content
                .as_ref()
                .unwrap()
                .value,
            "Quote"
        );

        let sidecar = drive_comments_sidecar_json("doc", "now", &parsed.comments);
        assert!(sidecar.contains("\"documentId\":\"doc\""));
        assert!(sidecar.contains("\"comments\""));
        assert!(sidecar.contains("\"replies\""));
    }
}
