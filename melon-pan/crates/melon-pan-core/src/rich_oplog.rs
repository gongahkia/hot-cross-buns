//! Append-only operation log persistence at `<doc>/operation-log.jsonl`.
//!
//! Per RICHTEXT-TODO §"Local Persistence" / §"Sync Semantics":
//!   - On each editor operation: append envelope, fsync.
//!   - On crash recovery: replay log against last `current.docs.json`.
//!   - On successful push: drain (clear) log only after the post-write
//!     validation passes.
//!
//! Each line is one envelope serialized as a small hand-rolled JSON. We
//! avoid bringing serde into core for one writer; readers use the
//! existing `crate::json` parser.

use crate::encoding::json_escape;
use crate::json::{parse_json, JsonError, JsonValue};
use crate::rich_index::Utf16Offset;
use crate::rich_model::{RichAlignment, RichColor, RichNamedStyle, RichNodeId};
use crate::rich_ops::{
    RichNamedStyleDelta, RichOperation, RichOperationEnvelope, RichParagraphStyleDelta,
    RichStyleDelta, RichTableBorderDashStyle, RichTableCellContentAlignment,
    RichTableCellStyleDelta,
};
use crate::storage::LocalCacheStore;
use std::collections::BTreeSet;
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::Path;

#[derive(Debug)]
pub enum OplogError {
    Io(io::Error),
    Parse(JsonError),
    UnknownOpKind(String),
    MissingField(&'static str),
}

impl std::fmt::Display for OplogError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            OplogError::Io(error) => write!(f, "operation log io: {error}"),
            OplogError::Parse(error) => write!(f, "operation log parse: {error:?}"),
            OplogError::UnknownOpKind(kind) => write!(f, "unknown op kind: {kind}"),
            OplogError::MissingField(name) => write!(f, "missing field: {name}"),
        }
    }
}

impl std::error::Error for OplogError {}

/// Append a single envelope. fsync's the file before returning so a
/// power-loss between append-and-ack does not lose the entry.
pub fn append_envelope(
    store: &LocalCacheStore,
    document_id: &str,
    envelope: &RichOperationEnvelope,
) -> Result<(), OplogError> {
    let paths = store.paths_for(document_id);
    fs::create_dir_all(&paths.doc_dir).map_err(OplogError::Io)?;
    let line = serialize_envelope(envelope);
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&paths.operation_log)
        .map_err(OplogError::Io)?;
    file.write_all(line.as_bytes()).map_err(OplogError::Io)?;
    file.write_all(b"\n").map_err(OplogError::Io)?;
    file.sync_all().map_err(OplogError::Io)?;
    Ok(())
}

/// Read every envelope from the log in order.
pub fn read_envelopes(
    store: &LocalCacheStore,
    document_id: &str,
) -> Result<Vec<RichOperationEnvelope>, OplogError> {
    let path = store.paths_for(document_id).operation_log;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = fs::read_to_string(&path).map_err(OplogError::Io)?;
    let mut out = Vec::new();
    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        out.push(deserialize_envelope(line)?);
    }
    Ok(out)
}

/// Return the operations that still matter after applying local
/// `CancelOperation` markers. Cancel markers themselves never compile;
/// they only remove the envelope whose operation id they target.
pub fn effective_envelopes(envelopes: &[RichOperationEnvelope]) -> Vec<RichOperationEnvelope> {
    let canceled: BTreeSet<&str> = envelopes
        .iter()
        .filter_map(|env| match &env.op {
            RichOperation::CancelOperation { operation_id } => Some(operation_id.as_str()),
            _ => None,
        })
        .collect();
    envelopes
        .iter()
        .filter(|env| {
            !canceled.contains(env.operation_id.as_str())
                && !matches!(env.op, RichOperation::CancelOperation { .. })
        })
        .cloned()
        .collect()
}

/// Atomically move the operation log into a timestamped backup so a
/// successful push can clear "what we sent" without losing the bytes.
/// Returns the backup path (None if the log was empty/missing).
pub fn archive_log(
    store: &LocalCacheStore,
    document_id: &str,
    suffix: &str,
) -> Result<Option<std::path::PathBuf>, OplogError> {
    let path = store.paths_for(document_id).operation_log;
    if !path.exists() {
        return Ok(None);
    }
    let archive = path.with_file_name(format!("operation-log.{suffix}.jsonl"));
    fs::rename(&path, &archive).map_err(OplogError::Io)?;
    Ok(Some(archive))
}

/// Erase the log (post a successful + validated push).
pub fn clear_log(store: &LocalCacheStore, document_id: &str) -> io::Result<()> {
    let path = store.paths_for(document_id).operation_log;
    if path.exists() {
        fs::remove_file(path)?;
    }
    Ok(())
}

/// Quick-check: is there anything in the log?
pub fn has_pending(store: &LocalCacheStore, document_id: &str) -> bool {
    let path = store.paths_for(document_id).operation_log;
    match read_envelopes(store, document_id) {
        Ok(envelopes) => !effective_envelopes(&envelopes).is_empty(),
        Err(_) => fs::metadata(&path)
            .map(|metadata| metadata.len() > 0)
            .unwrap_or(false),
    }
}

// ---- serialization -----------------------------------------------------

fn serialize_envelope(env: &RichOperationEnvelope) -> String {
    let mut out = String::new();
    out.push('{');
    field(&mut out, "operationId", &env.operation_id);
    out.push(',');
    field(&mut out, "documentId", &env.document_id);
    out.push(',');
    field(&mut out, "tabId", &env.tab_id);
    out.push(',');
    field(&mut out, "baseRevisionId", &env.base_revision_id);
    out.push(',');
    field(&mut out, "localTimestamp", &env.local_timestamp);
    out.push(',');
    field(&mut out, "actor", &env.actor);
    out.push(',');
    out.push_str("\"op\":");
    out.push_str(&serialize_op(&env.op));
    out.push('}');
    out
}

fn serialize_op(op: &RichOperation) -> String {
    match op {
        RichOperation::InsertText {
            paragraph_id,
            utf16_offset,
            text,
        } => format!(
            "{{\"kind\":\"InsertText\",\"paragraphId\":{},\"utf16Offset\":{},\"text\":\"{}\"}}",
            serialize_node_id(paragraph_id),
            utf16_offset.as_u32(),
            json_escape(text)
        ),
        RichOperation::DeleteRange {
            paragraph_id,
            utf16_start,
            utf16_end,
        } => format!(
            "{{\"kind\":\"DeleteRange\",\"paragraphId\":{},\"utf16Start\":{},\"utf16End\":{}}}",
            serialize_node_id(paragraph_id),
            utf16_start.as_u32(),
            utf16_end.as_u32()
        ),
        RichOperation::ReplaceRange {
            paragraph_id,
            utf16_start,
            utf16_end,
            text,
        } => format!(
            "{{\"kind\":\"ReplaceRange\",\"paragraphId\":{},\"utf16Start\":{},\"utf16End\":{},\"text\":\"{}\"}}",
            serialize_node_id(paragraph_id),
            utf16_start.as_u32(),
            utf16_end.as_u32(),
            json_escape(text)
        ),
        RichOperation::SetTextStyle {
            paragraph_id,
            utf16_start,
            utf16_end,
            delta,
        } => format!(
            "{{\"kind\":\"SetTextStyle\",\"paragraphId\":{},\"utf16Start\":{},\"utf16End\":{},\"delta\":{}}}",
            serialize_node_id(paragraph_id),
            utf16_start.as_u32(),
            utf16_end.as_u32(),
            serialize_delta(delta)
        ),
        RichOperation::ClearTextStyle {
            paragraph_id,
            utf16_start,
            utf16_end,
        } => format!(
            "{{\"kind\":\"ClearTextStyle\",\"paragraphId\":{},\"utf16Start\":{},\"utf16End\":{}}}",
            serialize_node_id(paragraph_id),
            utf16_start.as_u32(),
            utf16_end.as_u32()
        ),
        RichOperation::SetParagraphNamedStyle {
            paragraph_id,
            named_style,
        } => format!(
            "{{\"kind\":\"SetParagraphNamedStyle\",\"paragraphId\":{},\"namedStyle\":\"{}\"}}",
            serialize_node_id(paragraph_id),
            named_style_label(*named_style)
        ),
        RichOperation::SetParagraphStyle {
            paragraph_id,
            delta,
        } => format!(
            "{{\"kind\":\"SetParagraphStyle\",\"paragraphId\":{},\"delta\":{}}}",
            serialize_node_id(paragraph_id),
            serialize_paragraph_delta(delta)
        ),
        RichOperation::SetNamedStyle { named_style, delta } => format!(
            "{{\"kind\":\"SetNamedStyle\",\"namedStyle\":\"{}\",\"delta\":{}}}",
            named_style_label(*named_style),
            serialize_named_style_delta(delta)
        ),
        RichOperation::CreateLink {
            paragraph_id,
            utf16_start,
            utf16_end,
            url,
        } => format!(
            "{{\"kind\":\"CreateLink\",\"paragraphId\":{},\"utf16Start\":{},\"utf16End\":{},\"url\":\"{}\"}}",
            serialize_node_id(paragraph_id),
            utf16_start.as_u32(),
            utf16_end.as_u32(),
            json_escape(url)
        ),
        RichOperation::DeleteLink {
            paragraph_id,
            utf16_start,
            utf16_end,
        } => format!(
            "{{\"kind\":\"DeleteLink\",\"paragraphId\":{},\"utf16Start\":{},\"utf16End\":{}}}",
            serialize_node_id(paragraph_id),
            utf16_start.as_u32(),
            utf16_end.as_u32()
        ),
        RichOperation::NoOpUnsupportedProtection { node_id } => format!(
            "{{\"kind\":\"NoOpUnsupportedProtection\",\"nodeId\":{}}}",
            serialize_node_id(node_id)
        ),
        RichOperation::CreateList {
            paragraph_id,
            ordered,
        } => format!(
            "{{\"kind\":\"CreateList\",\"paragraphId\":{},\"ordered\":{}}}",
            serialize_node_id(paragraph_id),
            ordered
        ),
        RichOperation::DeleteList { paragraph_id } => format!(
            "{{\"kind\":\"DeleteList\",\"paragraphId\":{}}}",
            serialize_node_id(paragraph_id)
        ),
        RichOperation::UpdateListNesting {
            paragraph_id,
            nesting_level,
        } => format!(
            "{{\"kind\":\"UpdateListNesting\",\"paragraphId\":{},\"nestingLevel\":{}}}",
            serialize_node_id(paragraph_id),
            nesting_level
        ),
        RichOperation::InsertTable {
            paragraph_id,
            rows,
            columns,
        } => format!(
            "{{\"kind\":\"InsertTable\",\"paragraphId\":{},\"rows\":{},\"columns\":{}}}",
            serialize_node_id(paragraph_id),
            rows,
            columns
        ),
        RichOperation::DeleteTable { table_id } => format!(
            "{{\"kind\":\"DeleteTable\",\"tableId\":{}}}",
            serialize_node_id(table_id)
        ),
        RichOperation::InsertTableRow {
            table_id,
            row_index,
            insert_below,
        } => format!(
            "{{\"kind\":\"InsertTableRow\",\"tableId\":{},\"rowIndex\":{},\"insertBelow\":{}}}",
            serialize_node_id(table_id),
            row_index,
            insert_below
        ),
        RichOperation::DeleteTableRow {
            table_id,
            row_index,
        } => format!(
            "{{\"kind\":\"DeleteTableRow\",\"tableId\":{},\"rowIndex\":{}}}",
            serialize_node_id(table_id),
            row_index
        ),
        RichOperation::InsertTableColumn {
            table_id,
            column_index,
            insert_right,
        } => format!(
            "{{\"kind\":\"InsertTableColumn\",\"tableId\":{},\"columnIndex\":{},\"insertRight\":{}}}",
            serialize_node_id(table_id),
            column_index,
            insert_right
        ),
        RichOperation::DeleteTableColumn {
            table_id,
            column_index,
        } => format!(
            "{{\"kind\":\"DeleteTableColumn\",\"tableId\":{},\"columnIndex\":{}}}",
            serialize_node_id(table_id),
            column_index
        ),
        RichOperation::CancelOperation { operation_id } => format!(
            "{{\"kind\":\"CancelOperation\",\"operationId\":\"{}\"}}",
            json_escape(operation_id)
        ),
        RichOperation::SetTableCellStyle {
            table_id,
            row_index,
            column_index,
            row_span,
            column_span,
            delta,
        } => format!(
            "{{\"kind\":\"SetTableCellStyle\",\"tableId\":{},\"rowIndex\":{},\"columnIndex\":{},\"rowSpan\":{},\"columnSpan\":{},\"delta\":{}}}",
            serialize_node_id(table_id),
            row_index,
            column_index,
            row_span,
            column_span,
            serialize_table_cell_delta(delta)
        ),
        RichOperation::SetTableColumnWidth {
            table_id,
            column_index,
            width_pt,
        } => format!(
            "{{\"kind\":\"SetTableColumnWidth\",\"tableId\":{},\"columnIndex\":{},\"widthPt\":{}}}",
            serialize_node_id(table_id),
            column_index,
            width_pt
        ),
        RichOperation::SetTableRowMinHeight {
            table_id,
            row_index,
            min_height_pt,
        } => format!(
            "{{\"kind\":\"SetTableRowMinHeight\",\"tableId\":{},\"rowIndex\":{},\"minHeightPt\":{}}}",
            serialize_node_id(table_id),
            row_index,
            min_height_pt
        ),
        RichOperation::MergeTableCells {
            table_id,
            row_index,
            column_index,
            row_span,
            column_span,
        } => format!(
            "{{\"kind\":\"MergeTableCells\",\"tableId\":{},\"rowIndex\":{},\"columnIndex\":{},\"rowSpan\":{},\"columnSpan\":{}}}",
            serialize_node_id(table_id),
            row_index,
            column_index,
            row_span,
            column_span
        ),
        RichOperation::UnmergeTableCells {
            table_id,
            row_index,
            column_index,
            row_span,
            column_span,
        } => format!(
            "{{\"kind\":\"UnmergeTableCells\",\"tableId\":{},\"rowIndex\":{},\"columnIndex\":{},\"rowSpan\":{},\"columnSpan\":{}}}",
            serialize_node_id(table_id),
            row_index,
            column_index,
            row_span,
            column_span
        ),
        RichOperation::InsertInlineImage {
            paragraph_id,
            utf16_offset,
            uri,
        } => format!(
            "{{\"kind\":\"InsertInlineImage\",\"paragraphId\":{},\"utf16Offset\":{},\"uri\":\"{}\"}}",
            serialize_node_id(paragraph_id),
            utf16_offset.as_u32(),
            json_escape(uri)
        ),
        RichOperation::DeleteInlineObject { object_id } => format!(
            "{{\"kind\":\"DeleteInlineObject\",\"objectId\":\"{}\"}}",
            json_escape(object_id)
        ),
        RichOperation::CreateHeader => "{\"kind\":\"CreateHeader\"}".to_string(),
        RichOperation::DeleteHeader { header_id } => format!(
            "{{\"kind\":\"DeleteHeader\",\"headerId\":\"{}\"}}",
            json_escape(header_id)
        ),
        RichOperation::CreateFooter => "{\"kind\":\"CreateFooter\"}".to_string(),
        RichOperation::DeleteFooter { footer_id } => format!(
            "{{\"kind\":\"DeleteFooter\",\"footerId\":\"{}\"}}",
            json_escape(footer_id)
        ),
        RichOperation::CreateFootnote {
            paragraph_id,
            utf16_offset,
        } => format!(
            "{{\"kind\":\"CreateFootnote\",\"paragraphId\":{},\"utf16Offset\":{}}}",
            serialize_node_id(paragraph_id),
            utf16_offset.as_u32()
        ),
        RichOperation::DeleteFootnote { footnote_id } => format!(
            "{{\"kind\":\"DeleteFootnote\",\"footnoteId\":\"{}\"}}",
            json_escape(footnote_id)
        ),
    }
}

fn named_style_label(style: RichNamedStyle) -> String {
    match style {
        RichNamedStyle::NormalText => "NORMAL_TEXT".to_string(),
        RichNamedStyle::Title => "TITLE".to_string(),
        RichNamedStyle::Subtitle => "SUBTITLE".to_string(),
        RichNamedStyle::Heading(level) => format!("HEADING_{}", level.clamp(1, 6)),
    }
}

fn serialize_node_id(id: &RichNodeId) -> String {
    match id {
        RichNodeId::Stable(value) => format!(
            "{{\"kind\":\"stable\",\"value\":\"{}\"}}",
            json_escape(value)
        ),
        RichNodeId::Synthetic(value) => format!(
            "{{\"kind\":\"synthetic\",\"value\":\"{}\"}}",
            json_escape(value)
        ),
    }
}

fn serialize_delta(delta: &RichStyleDelta) -> String {
    let mut parts: Vec<String> = Vec::new();
    if let Some(value) = delta.bold {
        parts.push(format!("\"bold\":{value}"));
    }
    if let Some(value) = delta.italic {
        parts.push(format!("\"italic\":{value}"));
    }
    if let Some(value) = delta.underline {
        parts.push(format!("\"underline\":{value}"));
    }
    if let Some(value) = delta.strikethrough {
        parts.push(format!("\"strikethrough\":{value}"));
    }
    if let Some(value) = &delta.font_family {
        match value {
            Some(value) => parts.push(format!("\"fontFamily\":\"{}\"", json_escape(value))),
            None => parts.push("\"fontFamily\":null".to_string()),
        }
    }
    if let Some(value) = delta.font_size_pt {
        match value {
            Some(value) => parts.push(format!("\"fontSizePt\":{value}")),
            None => parts.push("\"fontSizePt\":null".to_string()),
        }
    }
    if let Some(color) = delta.foreground_color {
        match color {
            Some(color) => parts.push(format!(
                "\"foregroundColor\":{{\"red\":{},\"green\":{},\"blue\":{}}}",
                color.red, color.green, color.blue
            )),
            None => parts.push("\"foregroundColor\":null".to_string()),
        }
    }
    if let Some(color) = delta.background_color {
        match color {
            Some(color) => parts.push(format!(
                "\"backgroundColor\":{{\"red\":{},\"green\":{},\"blue\":{}}}",
                color.red, color.green, color.blue
            )),
            None => parts.push("\"backgroundColor\":null".to_string()),
        }
    }
    if let Some(link) = &delta.link_url {
        match link {
            Some(url) => parts.push(format!("\"linkUrl\":\"{}\"", json_escape(url))),
            None => parts.push("\"linkUrl\":null".to_string()),
        }
    }
    format!("{{{}}}", parts.join(","))
}

fn serialize_paragraph_delta(delta: &RichParagraphStyleDelta) -> String {
    let mut parts: Vec<String> = Vec::new();
    if let Some(value) = delta.alignment {
        parts.push(format!("\"alignment\":\"{}\"", alignment_label(value)));
    }
    if let Some(value) = delta.indent_start {
        parts.push(format!("\"indentStart\":{value}"));
    }
    if let Some(value) = delta.indent_end {
        parts.push(format!("\"indentEnd\":{value}"));
    }
    if let Some(value) = delta.indent_first_line {
        parts.push(format!("\"indentFirstLine\":{value}"));
    }
    if let Some(value) = delta.line_spacing {
        parts.push(format!("\"lineSpacing\":{value}"));
    }
    if let Some(value) = delta.space_above {
        parts.push(format!("\"spaceAbove\":{value}"));
    }
    if let Some(value) = delta.space_below {
        parts.push(format!("\"spaceBelow\":{value}"));
    }
    format!("{{{}}}", parts.join(","))
}

fn serialize_named_style_delta(delta: &RichNamedStyleDelta) -> String {
    format!(
        "{{\"textStyle\":{},\"paragraphStyle\":{}}}",
        serialize_delta(&delta.text_style),
        serialize_paragraph_delta(&delta.paragraph_style)
    )
}

fn serialize_table_cell_delta(delta: &RichTableCellStyleDelta) -> String {
    let mut parts = Vec::new();
    if let Some(color) = delta.background_color {
        match color {
            Some(color) => parts.push(format!(
                "\"backgroundColor\":{{\"red\":{},\"green\":{},\"blue\":{}}}",
                color.red, color.green, color.blue
            )),
            None => parts.push("\"backgroundColor\":null".to_string()),
        }
    }
    if let Some(width) = delta.border_width_pt {
        match width {
            Some(width) => parts.push(format!("\"borderWidthPt\":{width}")),
            None => parts.push("\"borderWidthPt\":null".to_string()),
        }
    }
    if let Some(color) = delta.border_color {
        match color {
            Some(color) => parts.push(format!(
                "\"borderColor\":{{\"red\":{},\"green\":{},\"blue\":{}}}",
                color.red, color.green, color.blue
            )),
            None => parts.push("\"borderColor\":null".to_string()),
        }
    }
    if let Some(style) = delta.border_dash_style {
        match style {
            Some(style) => parts.push(format!(
                "\"borderDashStyle\":\"{}\"",
                table_border_dash_style_label(style)
            )),
            None => parts.push("\"borderDashStyle\":null".to_string()),
        }
    }
    for (value, key) in [
        (delta.border_top_width_pt, "borderTopWidthPt"),
        (delta.border_right_width_pt, "borderRightWidthPt"),
        (delta.border_bottom_width_pt, "borderBottomWidthPt"),
        (delta.border_left_width_pt, "borderLeftWidthPt"),
    ] {
        if let Some(width) = value {
            match width {
                Some(width) => parts.push(format!("\"{key}\":{width}")),
                None => parts.push(format!("\"{key}\":null")),
            }
        }
    }
    if let Some(padding) = delta.padding_pt {
        match padding {
            Some(padding) => parts.push(format!("\"paddingPt\":{padding}")),
            None => parts.push("\"paddingPt\":null".to_string()),
        }
    }
    if let Some(alignment) = delta.content_alignment {
        match alignment {
            Some(alignment) => parts.push(format!(
                "\"contentAlignment\":\"{}\"",
                table_content_alignment_label(alignment)
            )),
            None => parts.push("\"contentAlignment\":null".to_string()),
        }
    }
    format!("{{{}}}", parts.join(","))
}

fn table_border_dash_style_label(style: RichTableBorderDashStyle) -> &'static str {
    match style {
        RichTableBorderDashStyle::Solid => "SOLID",
        RichTableBorderDashStyle::Dot => "DOT",
        RichTableBorderDashStyle::Dash => "DASH",
    }
}

fn table_content_alignment_label(alignment: RichTableCellContentAlignment) -> &'static str {
    match alignment {
        RichTableCellContentAlignment::Top => "TOP",
        RichTableCellContentAlignment::Middle => "MIDDLE",
        RichTableCellContentAlignment::Bottom => "BOTTOM",
    }
}

fn alignment_label(alignment: RichAlignment) -> &'static str {
    match alignment {
        RichAlignment::Start => "START",
        RichAlignment::Center => "CENTER",
        RichAlignment::End => "END",
        RichAlignment::Justified => "JUSTIFIED",
    }
}

fn field(out: &mut String, key: &str, value: &str) {
    out.push('"');
    out.push_str(key);
    out.push_str("\":\"");
    out.push_str(&json_escape(value));
    out.push('"');
}

// ---- deserialization ---------------------------------------------------

/// Parse a single envelope JSON line. Same wire format as `append_envelope`
/// emits. Used by Swift/FFI and by the reader path.
pub fn parse_envelope_json(line: &str) -> Result<RichOperationEnvelope, OplogError> {
    deserialize_envelope(line)
}

fn deserialize_envelope(line: &str) -> Result<RichOperationEnvelope, OplogError> {
    let root = parse_json(line).map_err(OplogError::Parse)?;
    let op = deserialize_op(root.get("op").ok_or(OplogError::MissingField("op"))?)?;
    Ok(RichOperationEnvelope::new(
        require_str(&root, "operationId")?,
        require_str(&root, "documentId")?,
        require_str(&root, "tabId").unwrap_or_default(),
        require_str(&root, "baseRevisionId")?,
        require_str(&root, "localTimestamp")?,
        require_str(&root, "actor")?,
        op,
    ))
}

fn deserialize_op(value: &JsonValue) -> Result<RichOperation, OplogError> {
    let kind = value
        .get("kind")
        .and_then(JsonValue::as_str)
        .ok_or(OplogError::MissingField("op.kind"))?;
    match kind {
        "InsertText" => Ok(RichOperation::InsertText {
            paragraph_id: deserialize_node_id(
                value
                    .get("paragraphId")
                    .ok_or(OplogError::MissingField("paragraphId"))?,
            )?,
            utf16_offset: Utf16Offset(require_u32(value, "utf16Offset")?),
            text: require_str(value, "text")?,
        }),
        "DeleteRange" => Ok(RichOperation::DeleteRange {
            paragraph_id: deserialize_node_id(
                value
                    .get("paragraphId")
                    .ok_or(OplogError::MissingField("paragraphId"))?,
            )?,
            utf16_start: Utf16Offset(require_u32(value, "utf16Start")?),
            utf16_end: Utf16Offset(require_u32(value, "utf16End")?),
        }),
        "ReplaceRange" => Ok(RichOperation::ReplaceRange {
            paragraph_id: deserialize_node_id(
                value
                    .get("paragraphId")
                    .ok_or(OplogError::MissingField("paragraphId"))?,
            )?,
            utf16_start: Utf16Offset(require_u32(value, "utf16Start")?),
            utf16_end: Utf16Offset(require_u32(value, "utf16End")?),
            text: require_str(value, "text")?,
        }),
        "SetTextStyle" => Ok(RichOperation::SetTextStyle {
            paragraph_id: deserialize_node_id(
                value
                    .get("paragraphId")
                    .ok_or(OplogError::MissingField("paragraphId"))?,
            )?,
            utf16_start: Utf16Offset(require_u32(value, "utf16Start")?),
            utf16_end: Utf16Offset(require_u32(value, "utf16End")?),
            delta: deserialize_delta(value.get("delta").unwrap_or(&JsonValue::Null)),
        }),
        "ClearTextStyle" => Ok(RichOperation::ClearTextStyle {
            paragraph_id: deserialize_node_id(
                value
                    .get("paragraphId")
                    .ok_or(OplogError::MissingField("paragraphId"))?,
            )?,
            utf16_start: Utf16Offset(require_u32(value, "utf16Start")?),
            utf16_end: Utf16Offset(require_u32(value, "utf16End")?),
        }),
        "SetParagraphNamedStyle" => Ok(RichOperation::SetParagraphNamedStyle {
            paragraph_id: deserialize_node_id(
                value
                    .get("paragraphId")
                    .ok_or(OplogError::MissingField("paragraphId"))?,
            )?,
            named_style: parse_named_style(
                value
                    .get("namedStyle")
                    .and_then(JsonValue::as_str)
                    .ok_or(OplogError::MissingField("namedStyle"))?,
            ),
        }),
        "SetParagraphStyle" => Ok(RichOperation::SetParagraphStyle {
            paragraph_id: deserialize_node_id(
                value
                    .get("paragraphId")
                    .ok_or(OplogError::MissingField("paragraphId"))?,
            )?,
            delta: deserialize_paragraph_delta(value.get("delta").unwrap_or(&JsonValue::Null)),
        }),
        "SetNamedStyle" => Ok(RichOperation::SetNamedStyle {
            named_style: parse_named_style(
                value
                    .get("namedStyle")
                    .and_then(JsonValue::as_str)
                    .ok_or(OplogError::MissingField("namedStyle"))?,
            ),
            delta: deserialize_named_style_delta(value.get("delta").unwrap_or(&JsonValue::Null)),
        }),
        "CreateLink" => Ok(RichOperation::CreateLink {
            paragraph_id: deserialize_node_id(
                value
                    .get("paragraphId")
                    .ok_or(OplogError::MissingField("paragraphId"))?,
            )?,
            utf16_start: Utf16Offset(require_u32(value, "utf16Start")?),
            utf16_end: Utf16Offset(require_u32(value, "utf16End")?),
            url: require_str(value, "url")?,
        }),
        "DeleteLink" => Ok(RichOperation::DeleteLink {
            paragraph_id: deserialize_node_id(
                value
                    .get("paragraphId")
                    .ok_or(OplogError::MissingField("paragraphId"))?,
            )?,
            utf16_start: Utf16Offset(require_u32(value, "utf16Start")?),
            utf16_end: Utf16Offset(require_u32(value, "utf16End")?),
        }),
        "NoOpUnsupportedProtection" => Ok(RichOperation::NoOpUnsupportedProtection {
            node_id: deserialize_node_id(
                value
                    .get("nodeId")
                    .ok_or(OplogError::MissingField("nodeId"))?,
            )?,
        }),
        "CreateList" => Ok(RichOperation::CreateList {
            paragraph_id: deserialize_node_id(
                value
                    .get("paragraphId")
                    .ok_or(OplogError::MissingField("paragraphId"))?,
            )?,
            ordered: value
                .get("ordered")
                .and_then(JsonValue::as_bool)
                .unwrap_or(false),
        }),
        "DeleteList" => Ok(RichOperation::DeleteList {
            paragraph_id: deserialize_node_id(
                value
                    .get("paragraphId")
                    .ok_or(OplogError::MissingField("paragraphId"))?,
            )?,
        }),
        "UpdateListNesting" => Ok(RichOperation::UpdateListNesting {
            paragraph_id: deserialize_node_id(
                value
                    .get("paragraphId")
                    .ok_or(OplogError::MissingField("paragraphId"))?,
            )?,
            nesting_level: require_u32(value, "nestingLevel")?.min(255) as u8,
        }),
        "InsertTable" => Ok(RichOperation::InsertTable {
            paragraph_id: deserialize_node_id(
                value
                    .get("paragraphId")
                    .ok_or(OplogError::MissingField("paragraphId"))?,
            )?,
            rows: require_u32(value, "rows")?,
            columns: require_u32(value, "columns")?,
        }),
        "DeleteTable" => Ok(RichOperation::DeleteTable {
            table_id: deserialize_node_id(
                value
                    .get("tableId")
                    .ok_or(OplogError::MissingField("tableId"))?,
            )?,
        }),
        "InsertTableRow" => Ok(RichOperation::InsertTableRow {
            table_id: deserialize_node_id(
                value
                    .get("tableId")
                    .ok_or(OplogError::MissingField("tableId"))?,
            )?,
            row_index: require_u32(value, "rowIndex")?,
            insert_below: value
                .get("insertBelow")
                .and_then(JsonValue::as_bool)
                .unwrap_or(true),
        }),
        "DeleteTableRow" => Ok(RichOperation::DeleteTableRow {
            table_id: deserialize_node_id(
                value
                    .get("tableId")
                    .ok_or(OplogError::MissingField("tableId"))?,
            )?,
            row_index: require_u32(value, "rowIndex")?,
        }),
        "InsertTableColumn" => Ok(RichOperation::InsertTableColumn {
            table_id: deserialize_node_id(
                value
                    .get("tableId")
                    .ok_or(OplogError::MissingField("tableId"))?,
            )?,
            column_index: require_u32(value, "columnIndex")?,
            insert_right: value
                .get("insertRight")
                .and_then(JsonValue::as_bool)
                .unwrap_or(true),
        }),
        "DeleteTableColumn" => Ok(RichOperation::DeleteTableColumn {
            table_id: deserialize_node_id(
                value
                    .get("tableId")
                    .ok_or(OplogError::MissingField("tableId"))?,
            )?,
            column_index: require_u32(value, "columnIndex")?,
        }),
        "CancelOperation" => Ok(RichOperation::CancelOperation {
            operation_id: require_str(value, "operationId")?,
        }),
        "SetTableCellStyle" => Ok(RichOperation::SetTableCellStyle {
            table_id: deserialize_node_id(
                value
                    .get("tableId")
                    .ok_or(OplogError::MissingField("tableId"))?,
            )?,
            row_index: require_u32(value, "rowIndex")?,
            column_index: require_u32(value, "columnIndex")?,
            row_span: require_u32(value, "rowSpan")?,
            column_span: require_u32(value, "columnSpan")?,
            delta: deserialize_table_cell_delta(value.get("delta").unwrap_or(&JsonValue::Null)),
        }),
        "SetTableColumnWidth" => Ok(RichOperation::SetTableColumnWidth {
            table_id: deserialize_node_id(
                value
                    .get("tableId")
                    .ok_or(OplogError::MissingField("tableId"))?,
            )?,
            column_index: require_u32(value, "columnIndex")?,
            width_pt: require_f32(value, "widthPt")?,
        }),
        "SetTableRowMinHeight" => Ok(RichOperation::SetTableRowMinHeight {
            table_id: deserialize_node_id(
                value
                    .get("tableId")
                    .ok_or(OplogError::MissingField("tableId"))?,
            )?,
            row_index: require_u32(value, "rowIndex")?,
            min_height_pt: require_f32(value, "minHeightPt")?,
        }),
        "MergeTableCells" => Ok(RichOperation::MergeTableCells {
            table_id: deserialize_node_id(
                value
                    .get("tableId")
                    .ok_or(OplogError::MissingField("tableId"))?,
            )?,
            row_index: require_u32(value, "rowIndex")?,
            column_index: require_u32(value, "columnIndex")?,
            row_span: require_u32(value, "rowSpan")?,
            column_span: require_u32(value, "columnSpan")?,
        }),
        "UnmergeTableCells" => Ok(RichOperation::UnmergeTableCells {
            table_id: deserialize_node_id(
                value
                    .get("tableId")
                    .ok_or(OplogError::MissingField("tableId"))?,
            )?,
            row_index: require_u32(value, "rowIndex")?,
            column_index: require_u32(value, "columnIndex")?,
            row_span: require_u32(value, "rowSpan")?,
            column_span: require_u32(value, "columnSpan")?,
        }),
        "InsertInlineImage" => Ok(RichOperation::InsertInlineImage {
            paragraph_id: deserialize_node_id(
                value
                    .get("paragraphId")
                    .ok_or(OplogError::MissingField("paragraphId"))?,
            )?,
            utf16_offset: Utf16Offset(require_u32(value, "utf16Offset")?),
            uri: require_str(value, "uri")?,
        }),
        "DeleteInlineObject" => Ok(RichOperation::DeleteInlineObject {
            object_id: require_str(value, "objectId")?,
        }),
        "CreateHeader" => Ok(RichOperation::CreateHeader),
        "DeleteHeader" => Ok(RichOperation::DeleteHeader {
            header_id: require_str(value, "headerId")?,
        }),
        "CreateFooter" => Ok(RichOperation::CreateFooter),
        "DeleteFooter" => Ok(RichOperation::DeleteFooter {
            footer_id: require_str(value, "footerId")?,
        }),
        "CreateFootnote" => Ok(RichOperation::CreateFootnote {
            paragraph_id: deserialize_node_id(
                value
                    .get("paragraphId")
                    .ok_or(OplogError::MissingField("paragraphId"))?,
            )?,
            utf16_offset: Utf16Offset(require_u32(value, "utf16Offset")?),
        }),
        "DeleteFootnote" => Ok(RichOperation::DeleteFootnote {
            footnote_id: require_str(value, "footnoteId")?,
        }),
        other => Err(OplogError::UnknownOpKind(other.to_string())),
    }
}

fn deserialize_node_id(value: &JsonValue) -> Result<RichNodeId, OplogError> {
    let kind = value
        .get("kind")
        .and_then(JsonValue::as_str)
        .ok_or(OplogError::MissingField("nodeId.kind"))?;
    let inner = value
        .get("value")
        .and_then(JsonValue::as_str)
        .ok_or(OplogError::MissingField("nodeId.value"))?;
    Ok(match kind {
        "stable" => RichNodeId::Stable(inner.to_string()),
        "synthetic" => RichNodeId::Synthetic(inner.to_string()),
        other => return Err(OplogError::UnknownOpKind(format!("nodeId/{other}"))),
    })
}

fn deserialize_delta(value: &JsonValue) -> RichStyleDelta {
    let mut delta = RichStyleDelta::default();
    if let Some(b) = value.get("bold").and_then(JsonValue::as_bool) {
        delta.bold = Some(b);
    }
    if let Some(i) = value.get("italic").and_then(JsonValue::as_bool) {
        delta.italic = Some(i);
    }
    if let Some(u) = value.get("underline").and_then(JsonValue::as_bool) {
        delta.underline = Some(u);
    }
    if let Some(s) = value.get("strikethrough").and_then(JsonValue::as_bool) {
        delta.strikethrough = Some(s);
    }
    if let Some(font_family) = value.get("fontFamily") {
        delta.font_family = Some(match font_family {
            JsonValue::Null => None,
            JsonValue::String(value) => Some(value.clone()),
            _ => None,
        });
    }
    if let Some(font_size) = value.get("fontSizePt") {
        delta.font_size_pt = Some(match font_size {
            JsonValue::Null => None,
            JsonValue::Number(_) => number_as_f32(font_size),
            _ => None,
        });
    }
    if let Some(color) = value.get("foregroundColor") {
        delta.foreground_color = Some(deserialize_color(color));
    }
    if let Some(color) = value.get("backgroundColor") {
        delta.background_color = Some(deserialize_color(color));
    }
    if let Some(link) = value.get("linkUrl") {
        delta.link_url = Some(match link {
            JsonValue::Null => None,
            JsonValue::String(url) => Some(url.clone()),
            _ => None,
        });
    }
    delta
}

fn deserialize_color(value: &JsonValue) -> Option<RichColor> {
    match value {
        JsonValue::Null => None,
        JsonValue::Object(_) => Some(RichColor {
            red: value.get("red").and_then(number_as_f32).unwrap_or(0.0),
            green: value.get("green").and_then(number_as_f32).unwrap_or(0.0),
            blue: value.get("blue").and_then(number_as_f32).unwrap_or(0.0),
        }),
        _ => None,
    }
}

fn deserialize_paragraph_delta(value: &JsonValue) -> RichParagraphStyleDelta {
    let mut delta = RichParagraphStyleDelta::default();
    if let Some(value) = value
        .get("alignment")
        .and_then(JsonValue::as_str)
        .and_then(parse_alignment)
    {
        delta.alignment = Some(value);
    }
    if let Some(value) = value.get("indentStart").and_then(number_as_f32) {
        delta.indent_start = Some(value);
    }
    if let Some(value) = value.get("indentEnd").and_then(number_as_f32) {
        delta.indent_end = Some(value);
    }
    if let Some(value) = value.get("indentFirstLine").and_then(number_as_f32) {
        delta.indent_first_line = Some(value);
    }
    if let Some(value) = value.get("lineSpacing").and_then(number_as_f32) {
        delta.line_spacing = Some(value);
    }
    if let Some(value) = value.get("spaceAbove").and_then(number_as_f32) {
        delta.space_above = Some(value);
    }
    if let Some(value) = value.get("spaceBelow").and_then(number_as_f32) {
        delta.space_below = Some(value);
    }
    delta
}

fn deserialize_named_style_delta(value: &JsonValue) -> RichNamedStyleDelta {
    RichNamedStyleDelta {
        text_style: deserialize_delta(value.get("textStyle").unwrap_or(&JsonValue::Null)),
        paragraph_style: deserialize_paragraph_delta(
            value.get("paragraphStyle").unwrap_or(&JsonValue::Null),
        ),
    }
}

fn deserialize_table_cell_delta(value: &JsonValue) -> RichTableCellStyleDelta {
    let mut delta = RichTableCellStyleDelta::default();
    if let Some(color) = value.get("backgroundColor") {
        delta.background_color = Some(match color {
            JsonValue::Null => None,
            JsonValue::Object(_) => Some(RichColor {
                red: color.get("red").and_then(number_as_f32).unwrap_or(0.0),
                green: color.get("green").and_then(number_as_f32).unwrap_or(0.0),
                blue: color.get("blue").and_then(number_as_f32).unwrap_or(0.0),
            }),
            _ => None,
        });
    }
    if let Some(width) = value.get("borderWidthPt") {
        delta.border_width_pt = Some(match width {
            JsonValue::Null => None,
            _ => number_as_f32(width),
        });
    }
    if let Some(color) = value.get("borderColor") {
        delta.border_color = Some(match color {
            JsonValue::Null => None,
            JsonValue::Object(_) => Some(RichColor {
                red: color.get("red").and_then(number_as_f32).unwrap_or(0.0),
                green: color.get("green").and_then(number_as_f32).unwrap_or(0.0),
                blue: color.get("blue").and_then(number_as_f32).unwrap_or(0.0),
            }),
            _ => None,
        });
    }
    if let Some(style) = value.get("borderDashStyle") {
        delta.border_dash_style = Some(match style {
            JsonValue::Null => None,
            JsonValue::String(raw) => parse_table_border_dash_style(raw),
            _ => None,
        });
    }
    for (key, slot) in [
        ("borderTopWidthPt", &mut delta.border_top_width_pt),
        ("borderRightWidthPt", &mut delta.border_right_width_pt),
        ("borderBottomWidthPt", &mut delta.border_bottom_width_pt),
        ("borderLeftWidthPt", &mut delta.border_left_width_pt),
    ] {
        if let Some(width) = value.get(key) {
            *slot = Some(match width {
                JsonValue::Null => None,
                _ => number_as_f32(width),
            });
        }
    }
    if let Some(padding) = value.get("paddingPt") {
        delta.padding_pt = Some(match padding {
            JsonValue::Null => None,
            _ => number_as_f32(padding),
        });
    }
    if let Some(alignment) = value.get("contentAlignment") {
        delta.content_alignment = Some(match alignment {
            JsonValue::Null => None,
            JsonValue::String(raw) => parse_table_content_alignment(raw),
            _ => None,
        });
    }
    delta
}

fn parse_table_border_dash_style(value: &str) -> Option<RichTableBorderDashStyle> {
    match value {
        "SOLID" => Some(RichTableBorderDashStyle::Solid),
        "DOT" => Some(RichTableBorderDashStyle::Dot),
        "DASH" => Some(RichTableBorderDashStyle::Dash),
        _ => None,
    }
}

fn parse_table_content_alignment(value: &str) -> Option<RichTableCellContentAlignment> {
    match value {
        "TOP" => Some(RichTableCellContentAlignment::Top),
        "MIDDLE" => Some(RichTableCellContentAlignment::Middle),
        "BOTTOM" => Some(RichTableCellContentAlignment::Bottom),
        _ => None,
    }
}

fn number_as_f32(value: &JsonValue) -> Option<f32> {
    match value {
        JsonValue::Number(raw) => raw.parse().ok(),
        _ => None,
    }
}

fn parse_alignment(value: &str) -> Option<RichAlignment> {
    match value {
        "START" => Some(RichAlignment::Start),
        "CENTER" => Some(RichAlignment::Center),
        "END" => Some(RichAlignment::End),
        "JUSTIFIED" => Some(RichAlignment::Justified),
        _ => None,
    }
}

fn parse_named_style(value: &str) -> RichNamedStyle {
    match value {
        "TITLE" => RichNamedStyle::Title,
        "SUBTITLE" => RichNamedStyle::Subtitle,
        "NORMAL_TEXT" => RichNamedStyle::NormalText,
        other => match other
            .strip_prefix("HEADING_")
            .and_then(|n| n.parse::<u8>().ok())
        {
            Some(level) => RichNamedStyle::Heading(level.clamp(1, 6)),
            None => RichNamedStyle::NormalText,
        },
    }
}

fn require_str(value: &JsonValue, key: &str) -> Result<String, OplogError> {
    value
        .get(key)
        .and_then(JsonValue::as_str)
        .map(ToString::to_string)
        .ok_or(match key {
            "operationId" => OplogError::MissingField("operationId"),
            "documentId" => OplogError::MissingField("documentId"),
            "baseRevisionId" => OplogError::MissingField("baseRevisionId"),
            "localTimestamp" => OplogError::MissingField("localTimestamp"),
            "actor" => OplogError::MissingField("actor"),
            "text" => OplogError::MissingField("text"),
            "url" => OplogError::MissingField("url"),
            "uri" => OplogError::MissingField("uri"),
            "objectId" => OplogError::MissingField("objectId"),
            _ => OplogError::MissingField("string"),
        })
}

fn require_u32(value: &JsonValue, key: &str) -> Result<u32, OplogError> {
    match value.get(key) {
        Some(JsonValue::Number(n)) => n.parse().map_err(|_| OplogError::MissingField("u32")),
        _ => Err(OplogError::MissingField("u32")),
    }
}

fn require_f32(value: &JsonValue, key: &str) -> Result<f32, OplogError> {
    match value.get(key) {
        Some(JsonValue::Number(n)) => n.parse().map_err(|_| OplogError::MissingField("f32")),
        _ => Err(OplogError::MissingField("f32")),
    }
}

// silence unused warning when we keep the helper for symmetry.
#[allow(dead_code)]
fn _unused_ref(_: &Path) {}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn temp_store() -> (LocalCacheStore, std::path::PathBuf) {
        let counter = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!(
            "melon-pan-oplog-test-{}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            counter
        ));
        let store = LocalCacheStore::new(&root);
        store.initialize().unwrap();
        (store, root)
    }

    #[test]
    fn append_then_read_round_trips_envelope() {
        let (store, root) = temp_store();
        let env = RichOperationEnvelope::new(
            "op-1",
            "doc-1",
            "",
            "rev-1",
            "ts",
            "user",
            RichOperation::InsertText {
                paragraph_id: RichNodeId::synthetic("p"),
                utf16_offset: Utf16Offset(3),
                text: "hi".to_string(),
            },
        );
        append_envelope(&store, "doc-1", &env).unwrap();
        let read = read_envelopes(&store, "doc-1").unwrap();
        assert_eq!(read.len(), 1);
        assert_eq!(read[0].operation_id, "op-1");
        match &read[0].op {
            RichOperation::InsertText {
                utf16_offset, text, ..
            } => {
                assert_eq!(*utf16_offset, Utf16Offset(3));
                assert_eq!(text, "hi");
            }
            _ => panic!("wrong op kind"),
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn multiple_envelopes_preserve_order() {
        let (store, root) = temp_store();
        for n in 0..5 {
            let env = RichOperationEnvelope::new(
                format!("op-{n}"),
                "doc",
                "",
                "rev",
                "ts",
                "u",
                RichOperation::InsertText {
                    paragraph_id: RichNodeId::synthetic("p"),
                    utf16_offset: Utf16Offset(n as u32),
                    text: n.to_string(),
                },
            );
            append_envelope(&store, "doc", &env).unwrap();
        }
        let read = read_envelopes(&store, "doc").unwrap();
        assert_eq!(read.len(), 5);
        for (i, env) in read.iter().enumerate() {
            assert_eq!(env.operation_id, format!("op-{i}"));
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn clear_log_empties_the_file() {
        let (store, root) = temp_store();
        let env = RichOperationEnvelope::new(
            "op",
            "doc",
            "",
            "rev",
            "ts",
            "u",
            RichOperation::DeleteRange {
                paragraph_id: RichNodeId::synthetic("p"),
                utf16_start: Utf16Offset(0),
                utf16_end: Utf16Offset(1),
            },
        );
        append_envelope(&store, "doc", &env).unwrap();
        assert!(has_pending(&store, "doc"));
        clear_log(&store, "doc").unwrap();
        assert!(!has_pending(&store, "doc"));
        assert!(read_envelopes(&store, "doc").unwrap().is_empty());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn archive_log_renames_atomically() {
        let (store, root) = temp_store();
        let env = RichOperationEnvelope::new(
            "op",
            "doc",
            "",
            "rev",
            "ts",
            "u",
            RichOperation::CreateLink {
                paragraph_id: RichNodeId::synthetic("p"),
                utf16_start: Utf16Offset(0),
                utf16_end: Utf16Offset(2),
                url: "https://example.com".to_string(),
            },
        );
        append_envelope(&store, "doc", &env).unwrap();
        let archive = archive_log(&store, "doc", "20260504T000000Z")
            .unwrap()
            .unwrap();
        assert!(archive.exists());
        assert!(!has_pending(&store, "doc"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn clear_text_style_round_trips_through_log() {
        let (store, root) = temp_store();
        let env = RichOperationEnvelope::new(
            "op",
            "doc",
            "",
            "rev",
            "ts",
            "u",
            RichOperation::ClearTextStyle {
                paragraph_id: RichNodeId::synthetic("p"),
                utf16_start: Utf16Offset(1),
                utf16_end: Utf16Offset(3),
            },
        );
        append_envelope(&store, "doc", &env).unwrap();
        let read = read_envelopes(&store, "doc").unwrap();
        assert_eq!(read.len(), 1);
        match &read[0].op {
            RichOperation::ClearTextStyle {
                utf16_start,
                utf16_end,
                ..
            } => {
                assert_eq!(*utf16_start, Utf16Offset(1));
                assert_eq!(*utf16_end, Utf16Offset(3));
            }
            _ => panic!("wrong op kind"),
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rich_text_font_and_color_delta_round_trips_through_log() {
        let (store, root) = temp_store();
        let env = RichOperationEnvelope::new(
            "op",
            "doc",
            "",
            "rev",
            "ts",
            "u",
            RichOperation::SetTextStyle {
                paragraph_id: RichNodeId::synthetic("p"),
                utf16_start: Utf16Offset(0),
                utf16_end: Utf16Offset(5),
                delta: RichStyleDelta {
                    font_family: Some(Some("Times New Roman".to_string())),
                    font_size_pt: Some(Some(16.0)),
                    foreground_color: Some(Some(RichColor {
                        red: 0.8,
                        green: 0.1,
                        blue: 0.1,
                    })),
                    background_color: Some(None),
                    ..RichStyleDelta::default()
                },
            },
        );
        append_envelope(&store, "doc", &env).unwrap();
        let read = read_envelopes(&store, "doc").unwrap();
        match &read[0].op {
            RichOperation::SetTextStyle { delta, .. } => {
                assert_eq!(delta.font_family, Some(Some("Times New Roman".to_string())));
                assert_eq!(delta.font_size_pt, Some(Some(16.0)));
                assert_eq!(
                    delta.foreground_color,
                    Some(Some(RichColor {
                        red: 0.8,
                        green: 0.1,
                        blue: 0.1,
                    }))
                );
                assert_eq!(delta.background_color, Some(None));
            }
            _ => panic!("wrong op kind"),
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn paragraph_style_round_trips_through_log() {
        let (store, root) = temp_store();
        let env = RichOperationEnvelope::new(
            "op",
            "doc",
            "",
            "rev",
            "ts",
            "u",
            RichOperation::SetParagraphStyle {
                paragraph_id: RichNodeId::synthetic("p"),
                delta: RichParagraphStyleDelta::alignment(RichAlignment::End),
            },
        );
        append_envelope(&store, "doc", &env).unwrap();
        let read = read_envelopes(&store, "doc").unwrap();
        assert_eq!(read.len(), 1);
        match &read[0].op {
            RichOperation::SetParagraphStyle { delta, .. } => {
                assert_eq!(delta.alignment, Some(RichAlignment::End));
            }
            _ => panic!("wrong op kind"),
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn named_style_round_trips_through_log() {
        let (store, root) = temp_store();
        let env = RichOperationEnvelope::new(
            "op",
            "doc",
            "",
            "rev",
            "ts",
            "u",
            RichOperation::SetNamedStyle {
                named_style: RichNamedStyle::Heading(1),
                delta: RichNamedStyleDelta {
                    text_style: RichStyleDelta::bold(true),
                    paragraph_style: RichParagraphStyleDelta::alignment(RichAlignment::Center),
                },
            },
        );
        append_envelope(&store, "doc", &env).unwrap();
        let read = read_envelopes(&store, "doc").unwrap();
        assert_eq!(read.len(), 1);
        match &read[0].op {
            RichOperation::SetNamedStyle { named_style, delta } => {
                assert_eq!(*named_style, RichNamedStyle::Heading(1));
                assert_eq!(delta.text_style.bold, Some(true));
                assert_eq!(delta.paragraph_style.alignment, Some(RichAlignment::Center));
            }
            _ => panic!("wrong op kind"),
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn table_ops_round_trip_through_log() {
        let (store, root) = temp_store();
        let table_id = RichNodeId::synthetic("table-1");
        let envs = vec![
            RichOperationEnvelope::new(
                "insert-table",
                "doc",
                "",
                "rev",
                "ts",
                "u",
                RichOperation::InsertTable {
                    paragraph_id: RichNodeId::synthetic("p"),
                    rows: 2,
                    columns: 3,
                },
            ),
            RichOperationEnvelope::new(
                "insert-row",
                "doc",
                "",
                "rev",
                "ts",
                "u",
                RichOperation::InsertTableRow {
                    table_id: table_id.clone(),
                    row_index: 1,
                    insert_below: true,
                },
            ),
            RichOperationEnvelope::new(
                "delete-column",
                "doc",
                "",
                "rev",
                "ts",
                "u",
                RichOperation::DeleteTableColumn {
                    table_id: table_id.clone(),
                    column_index: 2,
                },
            ),
            RichOperationEnvelope::new(
                "cell-style",
                "doc",
                "",
                "rev",
                "ts",
                "u",
                RichOperation::SetTableCellStyle {
                    table_id: table_id.clone(),
                    row_index: 0,
                    column_index: 1,
                    row_span: 1,
                    column_span: 1,
                    delta: {
                        let mut delta =
                            RichTableCellStyleDelta::background_color(Some(RichColor {
                                red: 1.0,
                                green: 0.9,
                                blue: 0.2,
                            }));
                        delta.border_width_pt = Some(Some(1.0));
                        delta.padding_pt = Some(Some(12.0));
                        delta
                    },
                },
            ),
            RichOperationEnvelope::new(
                "merge",
                "doc",
                "",
                "rev",
                "ts",
                "u",
                RichOperation::MergeTableCells {
                    table_id: table_id.clone(),
                    row_index: 0,
                    column_index: 0,
                    row_span: 2,
                    column_span: 2,
                },
            ),
            RichOperationEnvelope::new(
                "unmerge",
                "doc",
                "",
                "rev",
                "ts",
                "u",
                RichOperation::UnmergeTableCells {
                    table_id,
                    row_index: 0,
                    column_index: 0,
                    row_span: 2,
                    column_span: 2,
                },
            ),
        ];
        for env in &envs {
            append_envelope(&store, "doc", env).unwrap();
        }
        let read = read_envelopes(&store, "doc").unwrap();
        assert_eq!(read.len(), 6);
        match &read[0].op {
            RichOperation::InsertTable { rows, columns, .. } => {
                assert_eq!((*rows, *columns), (2, 3));
            }
            _ => panic!("wrong op kind"),
        }
        match &read[1].op {
            RichOperation::InsertTableRow { row_index, .. } => {
                assert_eq!(*row_index, 1);
            }
            _ => panic!("wrong op kind"),
        }
        match &read[2].op {
            RichOperation::DeleteTableColumn { column_index, .. } => {
                assert_eq!(*column_index, 2);
            }
            _ => panic!("wrong op kind"),
        }
        match &read[3].op {
            RichOperation::SetTableCellStyle { delta, .. } => {
                assert_eq!(
                    delta.background_color,
                    Some(Some(RichColor {
                        red: 1.0,
                        green: 0.9,
                        blue: 0.2,
                    }))
                );
                assert_eq!(delta.border_width_pt, Some(Some(1.0)));
                assert_eq!(delta.padding_pt, Some(Some(12.0)));
            }
            _ => panic!("wrong op kind"),
        }
        match &read[4].op {
            RichOperation::MergeTableCells {
                row_span,
                column_span,
                ..
            } => {
                assert_eq!((*row_span, *column_span), (2, 2));
            }
            _ => panic!("wrong op kind"),
        }
        match &read[5].op {
            RichOperation::UnmergeTableCells {
                row_span,
                column_span,
                ..
            } => {
                assert_eq!((*row_span, *column_span), (2, 2));
            }
            _ => panic!("wrong op kind"),
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cancel_operation_round_trips_and_removes_target_from_effective_log() {
        let (store, root) = temp_store();
        let table_id = RichNodeId::synthetic("table-1");
        let delete = RichOperationEnvelope::new(
            "delete-row",
            "doc",
            "",
            "rev",
            "ts",
            "u",
            RichOperation::DeleteTableRow {
                table_id,
                row_index: 2,
            },
        );
        let cancel = RichOperationEnvelope::new(
            "cancel-delete-row",
            "doc",
            "",
            "rev",
            "ts",
            "u",
            RichOperation::CancelOperation {
                operation_id: "delete-row".to_string(),
            },
        );

        append_envelope(&store, "doc", &delete).unwrap();
        append_envelope(&store, "doc", &cancel).unwrap();

        let read = read_envelopes(&store, "doc").unwrap();
        assert_eq!(read.len(), 2);
        match &read[1].op {
            RichOperation::CancelOperation { operation_id } => {
                assert_eq!(operation_id, "delete-row");
            }
            _ => panic!("wrong op kind"),
        }
        assert!(effective_envelopes(&read).is_empty());
        assert!(!has_pending(&store, "doc"));

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cancel_operation_allows_redo_with_new_operation_id() {
        let table_id = RichNodeId::synthetic("table-1");
        let first_delete = RichOperationEnvelope::new(
            "delete-row",
            "doc",
            "",
            "rev",
            "ts",
            "u",
            RichOperation::DeleteTableRow {
                table_id: table_id.clone(),
                row_index: 2,
            },
        );
        let cancel = RichOperationEnvelope::new(
            "cancel-delete-row",
            "doc",
            "",
            "rev",
            "ts",
            "u",
            RichOperation::CancelOperation {
                operation_id: "delete-row".to_string(),
            },
        );
        let redo_delete = RichOperationEnvelope::new(
            "delete-row-redo",
            "doc",
            "",
            "rev",
            "ts",
            "u",
            RichOperation::DeleteTableRow {
                table_id,
                row_index: 2,
            },
        );

        let effective = effective_envelopes(&[first_delete, cancel, redo_delete]);
        assert_eq!(effective.len(), 1);
        assert_eq!(effective[0].operation_id, "delete-row-redo");
        assert!(matches!(
            effective[0].op,
            RichOperation::DeleteTableRow { .. }
        ));
    }

    #[test]
    fn unknown_op_kind_returns_unknown_op_kind() {
        let (store, root) = temp_store();
        let path = store.paths_for("doc").operation_log;
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(
            &path,
            "{\"operationId\":\"x\",\"documentId\":\"d\",\"tabId\":\"\",\"baseRevisionId\":\"r\",\"localTimestamp\":\"t\",\"actor\":\"a\",\"op\":{\"kind\":\"WeirdOp\"}}\n",
        )
        .unwrap();
        let err = read_envelopes(&store, "doc").unwrap_err();
        assert!(matches!(err, OplogError::UnknownOpKind(_)));
        std::fs::remove_dir_all(root).unwrap();
    }
}
