//! Compile `RichOperationEnvelope[]` into a `documents.batchUpdate` request.
//!
//! Per RICHTEXT-TODO §"BatchUpdate Compiler". The compiler covers the
//! implemented rich-operation surface in `rich_apply.rs`: text
//! insert/delete/replace, text style, paragraph/named style, link,
//! list, and table shape ops. Deferred ops return
//! `BatchCompileError::NotYetImplemented` so callers see a precise
//! reason rather than a silent no-op.
//!
//! Index strategy:
//!
//! Operations carry UTF-16 offsets relative to a paragraph node. To turn
//! those into Docs body indexes we resolve the paragraph's
//! `source_start_index` (captured at parse time) and add the local
//! offset. This is correct for unsynced ops on a freshly-pulled
//! document; once edits accumulate locally, an editing session needs to
//! re-compute indexes against the latest applied state — that bookkeeping
//! is `rich_apply.rs`'s responsibility (out of scope for this module).
//!
//! Request ordering: we sort operations from end of document to start so
//! earlier requests don't invalidate later requests' indexes. This is
//! the standard Docs-API idiom.

use crate::encoding::{json_escape, percent_encode};
use crate::google_docs::DOCS_DOCUMENTS_ENDPOINT;
use crate::rich_index::{utf16_len, Utf16Offset};
use crate::rich_model::{
    RichAlignment, RichBlock, RichColor, RichDocument, RichListGlyph, RichNamedStyle, RichNodeId,
    RichParagraph, RichTab, RichTable,
};
use crate::rich_ops::{
    RichNamedStyleDelta, RichOperation, RichOperationEnvelope, RichParagraphStyleDelta,
    RichStyleDelta, RichTableBorderDashStyle, RichTableCellContentAlignment,
    RichTableCellStyleDelta,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BatchUpdateRequest {
    pub url: String,
    pub body_json: String,
    /// Number of operations folded into this batch. Useful for the sync
    /// journal so post-push validation knows how many ops to verify.
    pub operation_count: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub enum BatchCompileError {
    NotYetImplemented(&'static str),
    /// Paragraph addressed by an operation could not be found in the
    /// document. Means the document was re-pulled since the op was
    /// emitted; caller should re-emit against the new model.
    NodeNotFound(String),
    /// The paragraph carries no `source_start_index`. Happens for
    /// locally-created paragraphs that haven't been synced yet — the
    /// operation log holds the parent insert that creates the paragraph;
    /// drain the log in order.
    UnresolvedDocsIndex(String),
    /// Multiple operations target the same range — the compiler does not
    /// merge yet; caller should pre-collapse.
    AmbiguousRange,
    /// Empty batch produced. Caller should treat as no-op.
    EmptyBatch,
}

impl std::fmt::Display for BatchCompileError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BatchCompileError::NotYetImplemented(name) => {
                write!(f, "operation not yet implemented in batch compiler: {name}")
            }
            BatchCompileError::NodeNotFound(id) => write!(f, "node not found: {id}"),
            BatchCompileError::UnresolvedDocsIndex(id) => {
                write!(f, "no source_start_index for {id}")
            }
            BatchCompileError::AmbiguousRange => f.write_str("ambiguous overlapping ranges"),
            BatchCompileError::EmptyBatch => f.write_str("no compilable operations"),
        }
    }
}

impl std::error::Error for BatchCompileError {}

/// Compile a sequence of envelopes against the cached `RichDocument`.
///
/// `required_revision_id` becomes the `requiredRevisionId` write control
/// — Google rejects the batch if the doc moved since this revision.
pub fn compile_batch(
    document: &RichDocument,
    document_id: &str,
    required_revision_id: &str,
    envelopes: &[RichOperationEnvelope],
) -> Result<BatchUpdateRequest, BatchCompileError> {
    let effective = crate::rich_oplog::effective_envelopes(envelopes);
    let coalesced = coalesce_adjacent_insert_envelopes(&effective);
    let mut requests: Vec<(u32, String)> = Vec::new();
    for env in &coalesced {
        let request = compile_one(document, &env.op)?;
        if let Some((primary_index, json)) = request {
            requests.push((primary_index, json));
        }
    }
    if requests.is_empty() {
        return Err(BatchCompileError::EmptyBatch);
    }
    // Sort by primary index descending so earlier requests don't shift
    // later requests' indexes.
    requests.sort_by(|a, b| b.0.cmp(&a.0));
    let body_json = format!(
        "{{\"writeControl\":{{\"requiredRevisionId\":\"{}\"}},\"requests\":[{}]}}",
        json_escape(required_revision_id),
        requests
            .iter()
            .map(|(_, json)| json.as_str())
            .collect::<Vec<_>>()
            .join(",")
    );
    Ok(BatchUpdateRequest {
        url: format!(
            "{DOCS_DOCUMENTS_ENDPOINT}/{}:batchUpdate",
            percent_encode(document_id)
        ),
        body_json,
        operation_count: effective.len() as u32,
    })
}

fn coalesce_adjacent_insert_envelopes(
    envelopes: &[RichOperationEnvelope],
) -> Vec<RichOperationEnvelope> {
    let mut coalesced: Vec<RichOperationEnvelope> = Vec::with_capacity(envelopes.len());
    for env in envelopes {
        if let Some(last) = coalesced.last_mut() {
            if let (
                RichOperation::InsertText {
                    paragraph_id: last_paragraph,
                    utf16_offset: last_offset,
                    text: last_text,
                },
                RichOperation::InsertText {
                    paragraph_id,
                    utf16_offset,
                    text,
                },
            ) = (&mut last.op, &env.op)
            {
                let last_end = last_offset.as_u32().saturating_add(utf16_len(last_text));
                if last_paragraph == paragraph_id && last_end == utf16_offset.as_u32() {
                    last_text.push_str(text);
                    continue;
                }
            }
        }
        coalesced.push(env.clone());
    }
    coalesced
}

/// Compile one operation. Returns Some((primary_docs_index, request_json))
/// when the op produces output. Returns None for V1 no-ops
/// (`NoOpUnsupportedProtection`, empty style deltas).
fn compile_one(
    document: &RichDocument,
    op: &RichOperation,
) -> Result<Option<(u32, String)>, BatchCompileError> {
    match op {
        RichOperation::InsertText {
            paragraph_id,
            utf16_offset,
            text,
        } => {
            let paragraph = paragraph_address(document, paragraph_id)?;
            let docs_index = paragraph.start_index + utf16_offset.as_u32();
            Ok(Some((
                docs_index,
                format!(
                    "{{\"insertText\":{{\"location\":{},\"text\":\"{}\"}}}}",
                    location_json(docs_index, &paragraph.segment_id, &paragraph.tab_id),
                    json_escape(text)
                ),
            )))
        }
        RichOperation::DeleteRange {
            paragraph_id,
            utf16_start,
            utf16_end,
        } => {
            let paragraph = paragraph_address(document, paragraph_id)?;
            let base = paragraph.start_index;
            let start = base + utf16_start.as_u32();
            let end = base + utf16_end.as_u32();
            Ok(Some((
                start,
                format!(
                    "{{\"deleteContentRange\":{{\"range\":{}}}}}",
                    range_json(start, end, &paragraph.segment_id, &paragraph.tab_id)
                ),
            )))
        }
        RichOperation::ReplaceRange {
            paragraph_id,
            utf16_start,
            utf16_end,
            text,
        } => {
            // Compose as a single delete+insert pair. The compiler emits
            // two requests joined here so they share a sort key.
            let paragraph = paragraph_address(document, paragraph_id)?;
            let base = paragraph.start_index;
            let start = base + utf16_start.as_u32();
            let end = base + utf16_end.as_u32();
            let combined = format!(
                "{{\"deleteContentRange\":{{\"range\":{}}}}},{{\"insertText\":{{\"location\":{},\"text\":\"{}\"}}}}",
                range_json(start, end, &paragraph.segment_id, &paragraph.tab_id),
                location_json(start, &paragraph.segment_id, &paragraph.tab_id),
                json_escape(text)
            );
            Ok(Some((start, combined)))
        }
        RichOperation::SetTextStyle {
            paragraph_id,
            utf16_start,
            utf16_end,
            delta,
        } => Ok(compile_text_style(
            document,
            paragraph_id,
            *utf16_start,
            *utf16_end,
            delta,
        )?),
        RichOperation::ClearTextStyle {
            paragraph_id,
            utf16_start,
            utf16_end,
        } => Ok(compile_clear_text_style(
            document,
            paragraph_id,
            *utf16_start,
            *utf16_end,
        )?),
        RichOperation::CreateLink {
            paragraph_id,
            utf16_start,
            utf16_end,
            url,
        } => Ok(compile_text_style(
            document,
            paragraph_id,
            *utf16_start,
            *utf16_end,
            &RichStyleDelta::link(Some(url.clone())),
        )?),
        RichOperation::DeleteLink {
            paragraph_id,
            utf16_start,
            utf16_end,
        } => Ok(compile_text_style(
            document,
            paragraph_id,
            *utf16_start,
            *utf16_end,
            &RichStyleDelta::link(None),
        )?),
        RichOperation::SetParagraphNamedStyle {
            paragraph_id,
            named_style,
        } => {
            let paragraph = paragraph_address(document, paragraph_id)?;
            let base = paragraph.start_index;
            let len = paragraph_utf16_len_by_id(document, paragraph_id).unwrap_or(0);
            let end = base + len + 1; // include paragraph terminator
            let style_value = named_style_to_docs_string(*named_style);
            Ok(Some((
                base,
                format!(
                    "{{\"updateParagraphStyle\":{{\"range\":{},\"paragraphStyle\":{{\"namedStyleType\":\"{style_value}\"}},\"fields\":\"namedStyleType\"}}}}",
                    range_json(base, end, &paragraph.segment_id, &paragraph.tab_id)
                ),
            )))
        }
        RichOperation::SetParagraphStyle {
            paragraph_id,
            delta,
        } => Ok(compile_paragraph_style(document, paragraph_id, delta)?),
        RichOperation::SetNamedStyle { named_style, delta } => {
            Ok(compile_named_style(*named_style, delta))
        }
        RichOperation::NoOpUnsupportedProtection { .. } => Ok(None),

        RichOperation::CreateList {
            paragraph_id,
            ordered,
        } => {
            let paragraph = paragraph_address(document, paragraph_id)?;
            let base = paragraph.start_index;
            let len = paragraph_utf16_len_by_id(document, paragraph_id).unwrap_or(0);
            let end = base + len + 1; // include paragraph terminator
            let preset = if *ordered {
                "NUMBERED_DECIMAL_ALPHA_ROMAN"
            } else {
                "BULLET_DISC_CIRCLE_SQUARE"
            };
            Ok(Some((
                base,
                format!(
                    "{{\"createParagraphBullets\":{{\"range\":{},\"bulletPreset\":\"{preset}\"}}}}",
                    range_json(base, end, &paragraph.segment_id, &paragraph.tab_id)
                ),
            )))
        }
        RichOperation::DeleteList { paragraph_id } => {
            let paragraph = paragraph_address(document, paragraph_id)?;
            let base = paragraph.start_index;
            let len = paragraph_utf16_len_by_id(document, paragraph_id).unwrap_or(0);
            let end = base + len + 1;
            Ok(Some((
                base,
                format!(
                    "{{\"deleteParagraphBullets\":{{\"range\":{}}}}}",
                    range_json(base, end, &paragraph.segment_id, &paragraph.tab_id)
                ),
            )))
        }
        RichOperation::UpdateListNesting {
            paragraph_id,
            nesting_level,
        } => {
            let paragraph = find_paragraph(document, paragraph_id).ok_or_else(|| {
                BatchCompileError::NodeNotFound(paragraph_id.as_str().to_string())
            })?;
            let base = paragraph.identity.source_start_index.ok_or_else(|| {
                BatchCompileError::UnresolvedDocsIndex(paragraph_id.as_str().to_string())
            })?;
            let tab_id = paragraph.identity.source_tab_id.as_str();
            let segment_id = docs_segment_id(&paragraph.identity.source_segment_id);
            let len = paragraph_utf16_len(paragraph);
            let tabs = "\t".repeat(usize::from(*nesting_level));
            let create_end = base + len + *nesting_level as u32 + 1;
            let preset = bullet_preset_for_paragraph(document, paragraph);
            let mut parts = vec![format!(
                "{{\"deleteParagraphBullets\":{{\"range\":{}}}}}",
                range_json(base, base + len + 1, segment_id, tab_id)
            )];
            if !tabs.is_empty() {
                parts.push(format!(
                    "{{\"insertText\":{{\"location\":{},\"text\":\"{}\"}}}}",
                    location_json(base, segment_id, tab_id),
                    json_escape(&tabs)
                ));
            }
            parts.push(format!(
                "{{\"createParagraphBullets\":{{\"range\":{},\"bulletPreset\":\"{preset}\"}}}}",
                range_json(base, create_end, segment_id, tab_id)
            ));
            Ok(Some((base, parts.join(","))))
        }

        RichOperation::InsertTable {
            paragraph_id,
            rows,
            columns,
        } => {
            let paragraph = paragraph_address(document, paragraph_id)?;
            let base = paragraph.start_index;
            let len = paragraph_utf16_len_by_id(document, paragraph_id).unwrap_or(0);
            let index = base + len;
            Ok(Some((
                index,
                format!(
                    "{{\"insertTable\":{{\"rows\":{rows},\"columns\":{columns},\"location\":{}}}}}",
                    location_json(index, &paragraph.segment_id, &paragraph.tab_id)
                ),
            )))
        }
        RichOperation::DeleteTable { table_id } => {
            let table = find_table(document, table_id)
                .ok_or_else(|| BatchCompileError::NodeNotFound(table_id.as_str().to_string()))?;
            let start = table.identity.source_start_index.ok_or_else(|| {
                BatchCompileError::UnresolvedDocsIndex(table_id.as_str().to_string())
            })?;
            let end = table.identity.source_end_index.ok_or_else(|| {
                BatchCompileError::UnresolvedDocsIndex(table_id.as_str().to_string())
            })?;
            Ok(Some((
                start,
                format!(
                    "{{\"deleteContentRange\":{{\"range\":{{\"startIndex\":{start},\"endIndex\":{end}}}}}}}"
                ),
            )))
        }
        RichOperation::InsertTableRow {
            table_id,
            row_index,
            insert_below,
        } => {
            let table_index = table_index(document, table_id)?;
            Ok(Some((
                table_index,
                format!(
                    "{{\"insertTableRow\":{{\"tableCellLocation\":{},\"insertBelow\":{insert_below}}}}}",
                    table_cell_location(table_index, *row_index, 0)
                ),
            )))
        }
        RichOperation::DeleteTableRow {
            table_id,
            row_index,
        } => {
            let table_index = table_index(document, table_id)?;
            Ok(Some((
                table_index,
                format!(
                    "{{\"deleteTableRow\":{{\"tableCellLocation\":{}}}}}",
                    table_cell_location(table_index, *row_index, 0)
                ),
            )))
        }
        RichOperation::InsertTableColumn {
            table_id,
            column_index,
            insert_right,
        } => {
            let table_index = table_index(document, table_id)?;
            Ok(Some((
                table_index,
                format!(
                    "{{\"insertTableColumn\":{{\"tableCellLocation\":{},\"insertRight\":{insert_right}}}}}",
                    table_cell_location(table_index, 0, *column_index)
                ),
            )))
        }
        RichOperation::DeleteTableColumn {
            table_id,
            column_index,
        } => {
            let table_index = table_index(document, table_id)?;
            Ok(Some((
                table_index,
                format!(
                    "{{\"deleteTableColumn\":{{\"tableCellLocation\":{}}}}}",
                    table_cell_location(table_index, 0, *column_index)
                ),
            )))
        }
        RichOperation::CancelOperation { .. } => Ok(None),
        RichOperation::SetTableCellStyle {
            table_id,
            row_index,
            column_index,
            row_span,
            column_span,
            delta,
        } => Ok(compile_table_cell_style(
            document,
            table_id,
            *row_index,
            *column_index,
            *row_span,
            *column_span,
            delta,
        )?),
        RichOperation::SetTableColumnWidth {
            table_id,
            column_index,
            width_pt,
        } => {
            let table_index = table_index(document, table_id)?;
            Ok(Some((
                table_index,
                format!(
                    "{{\"updateTableColumnProperties\":{{\"tableStartLocation\":{},\"columnIndices\":[{}],\"tableColumnProperties\":{{\"widthType\":\"FIXED_WIDTH\",\"width\":{{\"magnitude\":{},\"unit\":\"PT\"}}}},\"fields\":\"width,widthType\"}}}}",
                    location_json(table_index, "", ""),
                    column_index,
                    width_pt
                ),
            )))
        }
        RichOperation::SetTableRowMinHeight {
            table_id,
            row_index,
            min_height_pt,
        } => {
            let table_index = table_index(document, table_id)?;
            Ok(Some((
                table_index,
                format!(
                    "{{\"updateTableRowStyle\":{{\"tableStartLocation\":{},\"rowIndices\":[{}],\"tableRowStyle\":{{\"minRowHeight\":{{\"magnitude\":{},\"unit\":\"PT\"}}}},\"fields\":\"minRowHeight\"}}}}",
                    location_json(table_index, "", ""),
                    row_index,
                    min_height_pt
                ),
            )))
        }
        RichOperation::MergeTableCells {
            table_id,
            row_index,
            column_index,
            row_span,
            column_span,
        } => {
            let table_index = table_index(document, table_id)?;
            Ok(Some((
                table_index,
                format!(
                    "{{\"mergeTableCells\":{{\"tableRange\":{}}}}}",
                    table_range(
                        table_index,
                        *row_index,
                        *column_index,
                        *row_span,
                        *column_span
                    )
                ),
            )))
        }
        RichOperation::UnmergeTableCells {
            table_id,
            row_index,
            column_index,
            row_span,
            column_span,
        } => {
            let table_index = table_index(document, table_id)?;
            Ok(Some((
                table_index,
                format!(
                    "{{\"unmergeTableCells\":{{\"tableRange\":{}}}}}",
                    table_range(
                        table_index,
                        *row_index,
                        *column_index,
                        *row_span,
                        *column_span
                    )
                ),
            )))
        }
        RichOperation::InsertInlineImage { .. } => {
            let RichOperation::InsertInlineImage {
                paragraph_id,
                utf16_offset,
                uri,
            } = op
            else {
                unreachable!();
            };
            let paragraph = paragraph_address(document, paragraph_id)?;
            let docs_index = paragraph.start_index + utf16_offset.as_u32();
            Ok(Some((
                docs_index,
                format!(
                    "{{\"insertInlineImage\":{{\"location\":{},\"uri\":\"{}\"}}}}",
                    location_json(docs_index, &paragraph.segment_id, &paragraph.tab_id),
                    json_escape(uri)
                ),
            )))
        }
        RichOperation::DeleteInlineObject { object_id } => {
            let (start, end) = inline_object_range(document, object_id)
                .ok_or_else(|| BatchCompileError::NodeNotFound(object_id.clone()))?;
            Ok(Some((
                start,
                format!(
                    "{{\"deleteContentRange\":{{\"range\":{{\"startIndex\":{start},\"endIndex\":{end}}}}}}}"
                ),
            )))
        }
        RichOperation::CreateHeader => Ok(Some((
            0,
            "{\"createHeader\":{\"type\":\"DEFAULT\"}}".to_string(),
        ))),
        RichOperation::DeleteHeader { header_id } => Ok(Some((
            0,
            format!(
                "{{\"deleteHeader\":{{\"headerId\":\"{}\"}}}}",
                json_escape(header_id)
            ),
        ))),
        RichOperation::CreateFooter => Ok(Some((
            0,
            "{\"createFooter\":{\"type\":\"DEFAULT\"}}".to_string(),
        ))),
        RichOperation::DeleteFooter { footer_id } => Ok(Some((
            0,
            format!(
                "{{\"deleteFooter\":{{\"footerId\":\"{}\"}}}}",
                json_escape(footer_id)
            ),
        ))),
        RichOperation::CreateFootnote {
            paragraph_id,
            utf16_offset,
        } => {
            let paragraph = paragraph_address(document, paragraph_id)?;
            if !paragraph.segment_id.is_empty() {
                return Err(BatchCompileError::NotYetImplemented(
                    "CreateFootnote outside body segment",
                ));
            }
            let docs_index = paragraph.start_index + utf16_offset.as_u32();
            Ok(Some((
                docs_index,
                format!(
                    "{{\"createFootnote\":{{\"location\":{}}}}}",
                    location_json(docs_index, &paragraph.segment_id, &paragraph.tab_id)
                ),
            )))
        }
        RichOperation::DeleteFootnote { footnote_id } => {
            let (start, end) = footnote_ref_range(document, footnote_id)
                .ok_or_else(|| BatchCompileError::NodeNotFound(footnote_id.clone()))?;
            Ok(Some((
                start,
                format!(
                    "{{\"deleteContentRange\":{{\"range\":{{\"startIndex\":{start},\"endIndex\":{end}}}}}}}"
                ),
            )))
        }
    }
}

fn compile_text_style(
    document: &RichDocument,
    paragraph_id: &RichNodeId,
    utf16_start: Utf16Offset,
    utf16_end: Utf16Offset,
    delta: &RichStyleDelta,
) -> Result<Option<(u32, String)>, BatchCompileError> {
    if delta.is_empty() || utf16_end.as_u32() <= utf16_start.as_u32() {
        return Ok(None);
    }
    let paragraph = paragraph_address(document, paragraph_id)?;
    let base = paragraph.start_index;
    let start = base + utf16_start.as_u32();
    let end = base + utf16_end.as_u32();
    let (style_parts, fields) = text_style_parts(delta);
    Ok(Some((
        start,
        format!(
            "{{\"updateTextStyle\":{{\"range\":{},\"textStyle\":{{{}}},\"fields\":\"{}\"}}}}",
            range_json(start, end, &paragraph.segment_id, &paragraph.tab_id),
            style_parts.join(","),
            fields.join(",")
        ),
    )))
}

fn compile_clear_text_style(
    document: &RichDocument,
    paragraph_id: &RichNodeId,
    utf16_start: Utf16Offset,
    utf16_end: Utf16Offset,
) -> Result<Option<(u32, String)>, BatchCompileError> {
    if utf16_end.as_u32() <= utf16_start.as_u32() {
        return Ok(None);
    }
    let paragraph = paragraph_address(document, paragraph_id)?;
    let base = paragraph.start_index;
    let start = base + utf16_start.as_u32();
    let end = base + utf16_end.as_u32();
    Ok(Some((
        start,
        format!(
            "{{\"updateTextStyle\":{{\"range\":{},\"textStyle\":{{}},\"fields\":\"{}\"}}}}",
            range_json(start, end, &paragraph.segment_id, &paragraph.tab_id),
            CLEAR_TEXT_STYLE_FIELDS
        ),
    )))
}

const CLEAR_TEXT_STYLE_FIELDS: &str = "bold,italic,underline,strikethrough,smallCaps,baselineOffset,weightedFontFamily,fontSize,foregroundColor,backgroundColor,link";

fn compile_paragraph_style(
    document: &RichDocument,
    paragraph_id: &RichNodeId,
    delta: &RichParagraphStyleDelta,
) -> Result<Option<(u32, String)>, BatchCompileError> {
    if delta.is_empty() {
        return Ok(None);
    }
    let paragraph = paragraph_address(document, paragraph_id)?;
    let base = paragraph.start_index;
    let len = paragraph_utf16_len_by_id(document, paragraph_id).unwrap_or(0);
    let end = base + len + 1; // include paragraph terminator
    let (style_parts, fields) = paragraph_style_parts(delta);
    Ok(Some((
        base,
        format!(
            "{{\"updateParagraphStyle\":{{\"range\":{},\"paragraphStyle\":{{{}}},\"fields\":\"{}\"}}}}",
            range_json(base, end, &paragraph.segment_id, &paragraph.tab_id),
            style_parts.join(","),
            fields.join(",")
        ),
    )))
}

fn compile_named_style(
    named_style: RichNamedStyle,
    delta: &RichNamedStyleDelta,
) -> Option<(u32, String)> {
    if delta.is_empty() {
        return None;
    }
    let style_value = named_style_to_docs_string(named_style);
    let mut style_parts = vec![format!("\"namedStyleType\":\"{style_value}\"")];
    let mut fields = vec!["namedStyleType".to_string()];
    if !delta.text_style.is_empty() {
        let (text_parts, text_fields) = text_style_parts(&delta.text_style);
        style_parts.push(format!("\"textStyle\":{{{}}}", text_parts.join(",")));
        fields.push("textStyle".to_string());
        fields.extend(
            text_fields
                .into_iter()
                .map(|field| format!("textStyle.{field}")),
        );
    }
    if !delta.paragraph_style.is_empty() {
        let (paragraph_parts, paragraph_fields) = paragraph_style_parts(&delta.paragraph_style);
        style_parts.push(format!(
            "\"paragraphStyle\":{{{}}}",
            paragraph_parts.join(",")
        ));
        fields.push("paragraphStyle".to_string());
        fields.extend(
            paragraph_fields
                .into_iter()
                .map(|field| format!("paragraphStyle.{field}")),
        );
    }
    Some((
        0,
        format!(
            "{{\"updateNamedStyle\":{{\"namedStyle\":{{{}}},\"fields\":\"{}\"}}}}",
            style_parts.join(","),
            fields.join(",")
        ),
    ))
}

fn compile_table_cell_style(
    document: &RichDocument,
    table_id: &RichNodeId,
    row_index: u32,
    column_index: u32,
    row_span: u32,
    column_span: u32,
    delta: &RichTableCellStyleDelta,
) -> Result<Option<(u32, String)>, BatchCompileError> {
    if delta.is_empty() {
        return Ok(None);
    }
    let table_index = table_index(document, table_id)?;
    let (style_parts, fields) = table_cell_style_parts(delta);
    Ok(Some((
        table_index,
        format!(
            "{{\"updateTableCellStyle\":{{\"tableCellStyle\":{{{}}},\"fields\":\"{}\",\"tableRange\":{}}}}}",
            style_parts.join(","),
            fields.join(","),
            table_range(table_index, row_index, column_index, row_span, column_span)
        ),
    )))
}

fn table_cell_style_parts(delta: &RichTableCellStyleDelta) -> (Vec<String>, Vec<&'static str>) {
    let mut style_parts = Vec::new();
    let mut fields = Vec::new();
    if let Some(color) = delta.background_color {
        if let Some(color) = color {
            style_parts.push(format!(
                "\"backgroundColor\":{{\"color\":{{\"rgbColor\":{{\"red\":{},\"green\":{},\"blue\":{}}}}}}}",
                color.red, color.green, color.blue
            ));
        }
        fields.push("backgroundColor");
    }
    if let Some(width) = delta.border_width_pt {
        if let Some(width) = width {
            let border = table_cell_border_json(
                width,
                delta.border_color.flatten(),
                delta.border_dash_style.flatten(),
            );
            for name in ["borderTop", "borderBottom", "borderLeft", "borderRight"] {
                style_parts.push(format!("\"{name}\":{border}"));
                fields.push(name);
            }
        } else {
            fields.extend(["borderTop", "borderBottom", "borderLeft", "borderRight"]);
        }
    }
    for (value, name) in [
        (delta.border_top_width_pt, "borderTop"),
        (delta.border_right_width_pt, "borderRight"),
        (delta.border_bottom_width_pt, "borderBottom"),
        (delta.border_left_width_pt, "borderLeft"),
    ] {
        if let Some(width) = value {
            if let Some(width) = width {
                style_parts.push(format!(
                    "\"{name}\":{}",
                    table_cell_border_json(
                        width,
                        delta.border_color.flatten(),
                        delta.border_dash_style.flatten()
                    )
                ));
            }
            fields.push(name);
        }
    }
    if delta.border_color.is_some() || delta.border_dash_style.is_some() {
        let color = delta.border_color.flatten();
        let dash_style = delta.border_dash_style.flatten();
        let width = delta.border_width_pt.flatten().unwrap_or(1.0);
        let border = table_cell_border_json(width, color, dash_style);
        for name in ["borderTop", "borderBottom", "borderLeft", "borderRight"] {
            if !fields.contains(&name) {
                style_parts.push(format!("\"{name}\":{border}"));
                fields.push(name);
            }
        }
    }
    if let Some(padding) = delta.padding_pt {
        if let Some(padding) = padding {
            for name in ["paddingTop", "paddingBottom", "paddingLeft", "paddingRight"] {
                style_parts.push(format!(
                    "\"{name}\":{{\"magnitude\":{padding},\"unit\":\"PT\"}}"
                ));
                fields.push(name);
            }
        } else {
            fields.extend(["paddingTop", "paddingBottom", "paddingLeft", "paddingRight"]);
        }
    }
    if let Some(alignment) = delta.content_alignment {
        if let Some(alignment) = alignment {
            style_parts.push(format!(
                "\"contentAlignment\":\"{}\"",
                table_content_alignment_label(alignment)
            ));
        }
        fields.push("contentAlignment");
    }
    (style_parts, fields)
}

fn table_cell_border_json(
    width: f32,
    color: Option<RichColor>,
    dash_style: Option<RichTableBorderDashStyle>,
) -> String {
    let color = color.unwrap_or(RichColor {
        red: 0.0,
        green: 0.0,
        blue: 0.0,
    });
    format!(
        "{{\"width\":{{\"magnitude\":{width},\"unit\":\"PT\"}},\"dashStyle\":\"{}\",\"color\":{{\"rgbColor\":{{\"red\":{},\"green\":{},\"blue\":{}}}}}}}",
        table_border_dash_style_label(dash_style.unwrap_or(RichTableBorderDashStyle::Solid)),
        color.red,
        color.green,
        color.blue
    )
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

fn text_style_parts(delta: &RichStyleDelta) -> (Vec<String>, Vec<&'static str>) {
    let mut style_parts: Vec<String> = Vec::new();
    let mut fields: Vec<&'static str> = Vec::new();
    if let Some(value) = delta.bold {
        style_parts.push(format!("\"bold\":{value}"));
        fields.push("bold");
    }
    if let Some(value) = delta.italic {
        style_parts.push(format!("\"italic\":{value}"));
        fields.push("italic");
    }
    if let Some(value) = delta.underline {
        style_parts.push(format!("\"underline\":{value}"));
        fields.push("underline");
    }
    if let Some(value) = delta.strikethrough {
        style_parts.push(format!("\"strikethrough\":{value}"));
        fields.push("strikethrough");
    }
    if let Some(font_family) = &delta.font_family {
        if let Some(font_family) = font_family {
            style_parts.push(format!(
                "\"weightedFontFamily\":{{\"fontFamily\":\"{}\"}}",
                json_escape(font_family)
            ));
        }
        fields.push("weightedFontFamily");
    }
    if let Some(font_size) = delta.font_size_pt {
        if let Some(font_size) = font_size {
            style_parts.push(format!(
                "\"fontSize\":{{\"magnitude\":{font_size},\"unit\":\"PT\"}}"
            ));
        }
        fields.push("fontSize");
    }
    if let Some(color) = delta.foreground_color {
        if let Some(color) = color {
            style_parts.push(format!(
                "\"foregroundColor\":{}",
                optional_color_json(color)
            ));
        }
        fields.push("foregroundColor");
    }
    if let Some(color) = delta.background_color {
        if let Some(color) = color {
            style_parts.push(format!(
                "\"backgroundColor\":{}",
                optional_color_json(color)
            ));
        }
        fields.push("backgroundColor");
    }
    if let Some(link) = &delta.link_url {
        match link {
            Some(url) => style_parts.push(format!("\"link\":{{\"url\":\"{}\"}}", json_escape(url))),
            None => style_parts.push("\"link\":null".to_string()),
        }
        fields.push("link");
    }
    (style_parts, fields)
}

fn optional_color_json(color: crate::rich_model::RichColor) -> String {
    format!(
        "{{\"color\":{{\"rgbColor\":{{\"red\":{},\"green\":{},\"blue\":{}}}}}}}",
        color.red, color.green, color.blue
    )
}

fn paragraph_style_parts(delta: &RichParagraphStyleDelta) -> (Vec<String>, Vec<&'static str>) {
    let mut style_parts = Vec::new();
    let mut fields = Vec::new();
    if let Some(value) = delta.alignment {
        style_parts.push(format!(
            "\"alignment\":\"{}\"",
            alignment_to_docs_string(value)
        ));
        fields.push("alignment");
    }
    push_dimension_style(
        &mut style_parts,
        &mut fields,
        "indentStart",
        "indentStart",
        delta.indent_start,
    );
    push_dimension_style(
        &mut style_parts,
        &mut fields,
        "indentEnd",
        "indentEnd",
        delta.indent_end,
    );
    push_dimension_style(
        &mut style_parts,
        &mut fields,
        "indentFirstLine",
        "indentFirstLine",
        delta.indent_first_line,
    );
    if let Some(value) = delta.line_spacing {
        style_parts.push(format!("\"lineSpacing\":{value}"));
        fields.push("lineSpacing");
    }
    push_dimension_style(
        &mut style_parts,
        &mut fields,
        "spaceAbove",
        "spaceAbove",
        delta.space_above,
    );
    push_dimension_style(
        &mut style_parts,
        &mut fields,
        "spaceBelow",
        "spaceBelow",
        delta.space_below,
    );
    (style_parts, fields)
}

fn push_dimension_style(
    style_parts: &mut Vec<String>,
    fields: &mut Vec<&'static str>,
    json_name: &'static str,
    field_name: &'static str,
    value: Option<f32>,
) {
    if let Some(value) = value {
        style_parts.push(format!(
            "\"{json_name}\":{{\"magnitude\":{value},\"unit\":\"PT\"}}"
        ));
        fields.push(field_name);
    }
}

fn alignment_to_docs_string(alignment: RichAlignment) -> &'static str {
    match alignment {
        RichAlignment::Start => "START",
        RichAlignment::Center => "CENTER",
        RichAlignment::End => "END",
        RichAlignment::Justified => "JUSTIFIED",
    }
}

struct ParagraphAddress {
    start_index: u32,
    segment_id: String,
    tab_id: String,
}

fn paragraph_address(
    document: &RichDocument,
    paragraph_id: &RichNodeId,
) -> Result<ParagraphAddress, BatchCompileError> {
    let para = find_paragraph(document, paragraph_id)
        .ok_or_else(|| BatchCompileError::NodeNotFound(paragraph_id.as_str().to_string()))?;
    let start_index = para
        .identity
        .source_start_index
        .ok_or_else(|| BatchCompileError::UnresolvedDocsIndex(paragraph_id.as_str().to_string()))?;
    Ok(ParagraphAddress {
        start_index,
        segment_id: docs_segment_id(&para.identity.source_segment_id).to_string(),
        tab_id: para.identity.source_tab_id.clone(),
    })
}

fn docs_segment_id(source_segment_id: &str) -> &str {
    if source_segment_id.is_empty() || source_segment_id == "body" {
        ""
    } else {
        source_segment_id
    }
}

fn location_json(index: u32, segment_id: &str, tab_id: &str) -> String {
    let mut fields = vec![format!("\"index\":{index}")];
    if !segment_id.is_empty() {
        fields.push(format!("\"segmentId\":\"{}\"", json_escape(segment_id)));
    }
    if !tab_id.is_empty() {
        fields.push(format!("\"tabId\":\"{}\"", json_escape(tab_id)));
    }
    format!("{{{}}}", fields.join(","))
}

fn range_json(start: u32, end: u32, segment_id: &str, tab_id: &str) -> String {
    let mut fields = vec![format!("\"startIndex\":{start}"), format!("\"endIndex\":{end}")];
    if !segment_id.is_empty() {
        fields.push(format!("\"segmentId\":\"{}\"", json_escape(segment_id)));
    }
    if !tab_id.is_empty() {
        fields.push(format!("\"tabId\":\"{}\"", json_escape(tab_id)));
    }
    format!("{{{}}}", fields.join(","))
}

fn table_index(document: &RichDocument, table_id: &RichNodeId) -> Result<u32, BatchCompileError> {
    let table = find_table(document, table_id)
        .ok_or_else(|| BatchCompileError::NodeNotFound(table_id.as_str().to_string()))?;
    table
        .identity
        .source_start_index
        .ok_or_else(|| BatchCompileError::UnresolvedDocsIndex(table_id.as_str().to_string()))
}

fn table_cell_location(table_index: u32, row_index: u32, column_index: u32) -> String {
    format!(
        "{{\"tableStartLocation\":{{\"index\":{table_index}}},\"rowIndex\":{row_index},\"columnIndex\":{column_index}}}"
    )
}

fn table_range(
    table_index: u32,
    row_index: u32,
    column_index: u32,
    row_span: u32,
    column_span: u32,
) -> String {
    format!(
        "{{\"tableCellLocation\":{},\"rowSpan\":{row_span},\"columnSpan\":{column_span}}}",
        table_cell_location(table_index, row_index, column_index)
    )
}

fn paragraph_utf16_len_by_id(document: &RichDocument, paragraph_id: &RichNodeId) -> Option<u32> {
    let para = find_paragraph(document, paragraph_id)?;
    Some(paragraph_utf16_len(para))
}

fn paragraph_utf16_len(para: &RichParagraph) -> u32 {
    let mut total = 0_u32;
    for inline in &para.inlines {
        total = total.saturating_add(match inline {
            crate::rich_model::RichInline::TextRun(run) => {
                crate::rich_index::utf16_len(run.text.trim_end_matches('\n'))
            }
            crate::rich_model::RichInline::InlineObjectRef(_) => 1,
            _ => 0,
        });
    }
    total
}

fn bullet_preset_for_paragraph(document: &RichDocument, paragraph: &RichParagraph) -> &'static str {
    let Some(anchor) = &paragraph.list else {
        return "BULLET_DISC_CIRCLE_SQUARE";
    };
    if anchor.list_id.starts_with("local-ord-") {
        return "NUMBERED_DECIMAL_ALPHA_ROMAN";
    }
    if anchor.list_id.starts_with("local-unord-") {
        return "BULLET_DISC_CIRCLE_SQUARE";
    }
    let Some(list) = document.lists.get(&anchor.list_id) else {
        return "BULLET_DISC_CIRCLE_SQUARE";
    };
    match list
        .nesting_levels
        .get(anchor.nesting_level as usize)
        .or_else(|| list.nesting_levels.first())
        .map(|level| &level.glyph_type)
    {
        Some(RichListGlyph::Decimal)
        | Some(RichListGlyph::AlphaUpper)
        | Some(RichListGlyph::AlphaLower)
        | Some(RichListGlyph::RomanUpper)
        | Some(RichListGlyph::RomanLower) => "NUMBERED_DECIMAL_ALPHA_ROMAN",
        _ => "BULLET_DISC_CIRCLE_SQUARE",
    }
}

fn find_paragraph<'a>(
    document: &'a RichDocument,
    paragraph_id: &RichNodeId,
) -> Option<&'a RichParagraph> {
    for tab in &document.tabs {
        if let Some(p) = find_paragraph_in_tab(tab, paragraph_id) {
            return Some(p);
        }
    }
    None
}

fn find_paragraph_in_tab<'a>(
    tab: &'a RichTab,
    paragraph_id: &RichNodeId,
) -> Option<&'a RichParagraph> {
    for block in &tab.body.blocks {
        if let Some(p) = find_paragraph_in_block(block, paragraph_id) {
            return Some(p);
        }
    }
    for segment in tab.headers.values() {
        for block in &segment.blocks {
            if let Some(p) = find_paragraph_in_block(block, paragraph_id) {
                return Some(p);
            }
        }
    }
    for segment in tab.footers.values() {
        for block in &segment.blocks {
            if let Some(p) = find_paragraph_in_block(block, paragraph_id) {
                return Some(p);
            }
        }
    }
    for segment in tab.footnotes.values() {
        for block in &segment.blocks {
            if let Some(p) = find_paragraph_in_block(block, paragraph_id) {
                return Some(p);
            }
        }
    }
    for child in &tab.child_tabs {
        if let Some(p) = find_paragraph_in_tab(child, paragraph_id) {
            return Some(p);
        }
    }
    None
}

fn find_paragraph_in_block<'a>(
    block: &'a RichBlock,
    paragraph_id: &RichNodeId,
) -> Option<&'a RichParagraph> {
    match block {
        RichBlock::Paragraph(p) if p.identity.local_id == *paragraph_id => Some(p),
        RichBlock::Paragraph(_) => None,
        RichBlock::Table(table) => {
            for row in &table.rows {
                for cell in &row.cells {
                    for inner in &cell.content {
                        if let Some(p) = find_paragraph_in_block(inner, paragraph_id) {
                            return Some(p);
                        }
                    }
                }
            }
            None
        }
        RichBlock::SectionBreak(_) | RichBlock::Unsupported(_) => None,
    }
}

fn find_table<'a>(document: &'a RichDocument, table_id: &RichNodeId) -> Option<&'a RichTable> {
    for tab in &document.tabs {
        if let Some(table) = find_table_in_tab(tab, table_id) {
            return Some(table);
        }
    }
    None
}

fn find_table_in_tab<'a>(tab: &'a RichTab, table_id: &RichNodeId) -> Option<&'a RichTable> {
    for block in &tab.body.blocks {
        if let Some(table) = find_table_in_block(block, table_id) {
            return Some(table);
        }
    }
    for child in &tab.child_tabs {
        if let Some(table) = find_table_in_tab(child, table_id) {
            return Some(table);
        }
    }
    None
}

fn find_table_in_block<'a>(block: &'a RichBlock, table_id: &RichNodeId) -> Option<&'a RichTable> {
    let RichBlock::Table(table) = block else {
        return None;
    };
    if table.identity.local_id == *table_id {
        return Some(table);
    }
    for row in &table.rows {
        for cell in &row.cells {
            for inner in &cell.content {
                if let Some(table) = find_table_in_block(inner, table_id) {
                    return Some(table);
                }
            }
        }
    }
    None
}

fn inline_object_range(document: &RichDocument, object_id: &str) -> Option<(u32, u32)> {
    for tab in &document.tabs {
        if let Some(range) = inline_object_range_in_tab(tab, object_id) {
            return Some(range);
        }
    }
    None
}

fn inline_object_range_in_tab(tab: &RichTab, object_id: &str) -> Option<(u32, u32)> {
    for block in &tab.body.blocks {
        if let Some(range) = inline_object_range_in_block(block, object_id) {
            return Some(range);
        }
    }
    for child in &tab.child_tabs {
        if let Some(range) = inline_object_range_in_tab(child, object_id) {
            return Some(range);
        }
    }
    None
}

fn inline_object_range_in_block(block: &RichBlock, object_id: &str) -> Option<(u32, u32)> {
    match block {
        RichBlock::Paragraph(paragraph) => paragraph.inlines.iter().find_map(|inline| {
            let crate::rich_model::RichInline::InlineObjectRef(object) = inline else {
                return None;
            };
            if object.object_id != object_id {
                return None;
            }
            let start = object.identity.source_start_index?;
            let end = object.identity.source_end_index.unwrap_or(start + 1);
            Some((start, end))
        }),
        RichBlock::Table(table) => {
            for row in &table.rows {
                for cell in &row.cells {
                    for inner in &cell.content {
                        if let Some(range) = inline_object_range_in_block(inner, object_id) {
                            return Some(range);
                        }
                    }
                }
            }
            None
        }
        RichBlock::SectionBreak(_) | RichBlock::Unsupported(_) => None,
    }
}

fn footnote_ref_range(document: &RichDocument, footnote_id: &str) -> Option<(u32, u32)> {
    for tab in &document.tabs {
        if let Some(range) = footnote_ref_range_in_tab(tab, footnote_id) {
            return Some(range);
        }
    }
    None
}

fn footnote_ref_range_in_tab(tab: &RichTab, footnote_id: &str) -> Option<(u32, u32)> {
    for block in &tab.body.blocks {
        if let Some(range) = footnote_ref_range_in_block(block, footnote_id) {
            return Some(range);
        }
    }
    for child in &tab.child_tabs {
        if let Some(range) = footnote_ref_range_in_tab(child, footnote_id) {
            return Some(range);
        }
    }
    None
}

fn footnote_ref_range_in_block(block: &RichBlock, footnote_id: &str) -> Option<(u32, u32)> {
    match block {
        RichBlock::Paragraph(paragraph) => paragraph.inlines.iter().find_map(|inline| {
            let crate::rich_model::RichInline::FootnoteRef(reference) = inline else {
                return None;
            };
            if reference.footnote_id != footnote_id {
                return None;
            }
            let start = reference.identity.source_start_index?;
            let end = reference.identity.source_end_index.unwrap_or(start + 1);
            Some((start, end))
        }),
        RichBlock::Table(table) => {
            for row in &table.rows {
                for cell in &row.cells {
                    for inner in &cell.content {
                        if let Some(range) = footnote_ref_range_in_block(inner, footnote_id) {
                            return Some(range);
                        }
                    }
                }
            }
            None
        }
        RichBlock::SectionBreak(_) | RichBlock::Unsupported(_) => None,
    }
}

fn named_style_to_docs_string(style: RichNamedStyle) -> String {
    match style {
        RichNamedStyle::NormalText => "NORMAL_TEXT".to_string(),
        RichNamedStyle::Title => "TITLE".to_string(),
        RichNamedStyle::Subtitle => "SUBTITLE".to_string(),
        RichNamedStyle::Heading(level) => format!("HEADING_{}", level.clamp(1, 6)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rich_model::{
        RichAlignment, RichBlock, RichColor, RichInline, RichListAnchor, RichNodeIdentity,
        RichParagraphStyle, RichRawJson, RichSegment, RichSourceKind, RichStyle, RichTable,
        RichTableCell, RichTableRow, RichTextRun,
    };
    use std::collections::BTreeMap;

    fn ident(seed: &str) -> RichNodeIdentity {
        RichNodeIdentity::local_only(
            RichNodeId::synthetic(seed.to_string()),
            RichSourceKind::Body,
        )
    }

    fn make_doc(text: &str, source_start_index: u32) -> (RichDocument, RichNodeId) {
        let para_id = RichNodeId::synthetic("para-1");
        let mut id = RichNodeIdentity::local_only(para_id.clone(), RichSourceKind::Body);
        id.source_start_index = Some(source_start_index);
        let para = RichParagraph {
            identity: id,
            style: RichParagraphStyle::default(),
            list: None,
            inlines: vec![RichInline::TextRun(RichTextRun {
                identity: ident("run"),
                text: text.to_string(),
                style: RichStyle::default(),
            })],
            raw_extras: RichRawJson::empty(),
        };
        let mut doc = RichDocument::skeleton("doc1", "T");
        doc.tabs.push(crate::rich_model::RichTab {
            identity: ident("tab"),
            tab_id: String::new(),
            title: String::new(),
            index: 0,
            parent_tab_id: None,
            body: RichSegment {
                identity: ident("seg"),
                segment_id: String::new(),
                kind: RichSourceKind::Body,
                blocks: vec![RichBlock::Paragraph(para)],
                style: RichRawJson::empty(),
            },
            headers: BTreeMap::new(),
            footers: BTreeMap::new(),
            footnotes: BTreeMap::new(),
            child_tabs: Vec::new(),
        });
        (doc, para_id)
    }

    fn make_doc_with_header(text: &str, source_start_index: u32) -> (RichDocument, RichNodeId) {
        let (mut doc, _) = make_doc("body", 1);
        let para_id = RichNodeId::stable("", "h1", &["p"], text);
        let mut id = RichNodeIdentity::local_only(para_id.clone(), RichSourceKind::Header);
        id.source_start_index = Some(source_start_index);
        id.source_segment_id = "h1".to_string();
        doc.tabs[0].headers.insert(
            "h1".to_string(),
            RichSegment {
                identity: ident("header-seg"),
                segment_id: "h1".to_string(),
                kind: RichSourceKind::Header,
                blocks: vec![RichBlock::Paragraph(RichParagraph {
                    identity: id,
                    style: RichParagraphStyle::default(),
                    list: None,
                    inlines: vec![RichInline::TextRun(RichTextRun {
                        identity: ident("header-run"),
                        text: text.to_string(),
                        style: RichStyle::default(),
                    })],
                    raw_extras: RichRawJson::empty(),
                })],
                style: RichRawJson::empty(),
            },
        );
        (doc, para_id)
    }

    fn append_table(
        doc: &mut RichDocument,
        source_start_index: u32,
        source_end_index: u32,
    ) -> RichNodeId {
        let table_id = RichNodeId::synthetic("table-1");
        let mut table_identity =
            RichNodeIdentity::local_only(table_id.clone(), RichSourceKind::TableCell);
        table_identity.source_start_index = Some(source_start_index);
        table_identity.source_end_index = Some(source_end_index);
        doc.tabs[0].body.blocks.push(RichBlock::Table(RichTable {
            identity: table_identity,
            start_index: source_start_index,
            rows: vec![RichTableRow {
                identity: ident("row-1"),
                cells: vec![RichTableCell {
                    identity: ident("cell-1"),
                    content: Vec::new(),
                    row_span: 1,
                    column_span: 1,
                    raw_style: RichRawJson::empty(),
                }],
                raw_style: RichRawJson::empty(),
            }],
            columns: 1,
            raw_style: RichRawJson::empty(),
        }));
        table_id
    }

    #[test]
    fn insert_text_compiles_to_insert_request() {
        let (doc, id) = make_doc("hello", 1);
        let env = RichOperationEnvelope::new(
            "op-1",
            "doc1",
            "",
            "rev-1",
            "ts",
            "actor",
            RichOperation::InsertText {
                paragraph_id: id,
                utf16_offset: Utf16Offset(5),
                text: " world".to_string(),
            },
        );
        let request = compile_batch(&doc, "doc1", "rev-1", &[env]).unwrap();
        assert!(request.url.ends_with("/doc1:batchUpdate"));
        assert!(request
            .body_json
            .contains("\"requiredRevisionId\":\"rev-1\""));
        assert!(request
            .body_json
            .contains("\"insertText\":{\"location\":{\"index\":6}"));
        assert!(
            request
                .body_json
                .contains("\\\" world\\\"".replace("\\\"", "\"").as_str())
                || request.body_json.contains("\" world\"")
        );
        assert_eq!(request.operation_count, 1);
    }

    #[test]
    fn header_text_ops_compile_with_segment_id() {
        let (doc, id) = make_doc_with_header("head", 3);
        let env = RichOperationEnvelope::new(
            "op-header",
            "doc1",
            "",
            "rev-1",
            "ts",
            "actor",
            RichOperation::InsertText {
                paragraph_id: id,
                utf16_offset: Utf16Offset(4),
                text: "!".to_string(),
            },
        );
        let request = compile_batch(&doc, "doc1", "rev-1", &[env]).unwrap();
        assert!(request
            .body_json
            .contains("\"location\":{\"index\":7,\"segmentId\":\"h1\"}"));
    }

    #[test]
    fn adjacent_insert_text_ops_coalesce_before_compiling() {
        let (doc, id) = make_doc("hello", 1);
        let first = RichOperationEnvelope::new(
            "op-1",
            "doc1",
            "",
            "rev-1",
            "ts",
            "actor",
            RichOperation::InsertText {
                paragraph_id: id.clone(),
                utf16_offset: Utf16Offset(5),
                text: " ".to_string(),
            },
        );
        let second = RichOperationEnvelope::new(
            "op-2",
            "doc1",
            "",
            "rev-1",
            "ts",
            "actor",
            RichOperation::InsertText {
                paragraph_id: id.clone(),
                utf16_offset: Utf16Offset(6),
                text: "world".to_string(),
            },
        );
        let third = RichOperationEnvelope::new(
            "op-3",
            "doc1",
            "",
            "rev-1",
            "ts",
            "actor",
            RichOperation::InsertText {
                paragraph_id: id,
                utf16_offset: Utf16Offset(11),
                text: "!".to_string(),
            },
        );

        let request = compile_batch(&doc, "doc1", "rev-1", &[first, second, third]).unwrap();
        assert_eq!(request.body_json.matches("\"insertText\"").count(), 1);
        assert!(request
            .body_json
            .contains("\"insertText\":{\"location\":{\"index\":6},\"text\":\" world!\""));
        assert_eq!(request.operation_count, 3);
    }

    #[test]
    fn delete_range_compiles_to_delete_request() {
        let (doc, id) = make_doc("hello world", 1);
        let env = RichOperationEnvelope::new(
            "op",
            "doc1",
            "",
            "r",
            "ts",
            "a",
            RichOperation::DeleteRange {
                paragraph_id: id,
                utf16_start: Utf16Offset(5),
                utf16_end: Utf16Offset(11),
            },
        );
        let request = compile_batch(&doc, "doc1", "r", &[env]).unwrap();
        assert!(request
            .body_json
            .contains("\"deleteContentRange\":{\"range\":{\"startIndex\":6,\"endIndex\":12}}"));
    }

    #[test]
    fn tabbed_body_ops_use_tab_id_without_body_segment_id() {
        let (mut doc, id) = make_doc("hello world", 1);
        doc.tabs[0].tab_id = "tab-1".to_string();
        let RichBlock::Paragraph(paragraph) = &mut doc.tabs[0].body.blocks[0] else {
            panic!("expected paragraph");
        };
        paragraph.identity.source_tab_id = "tab-1".to_string();
        paragraph.identity.source_segment_id = "body".to_string();

        let env = RichOperationEnvelope::new(
            "op",
            "doc1",
            "tab-1",
            "r",
            "ts",
            "a",
            RichOperation::DeleteRange {
                paragraph_id: id,
                utf16_start: Utf16Offset(5),
                utf16_end: Utf16Offset(11),
            },
        );
        let request = compile_batch(&doc, "doc1", "r", &[env]).unwrap();
        assert!(request.body_json.contains(
            "\"deleteContentRange\":{\"range\":{\"startIndex\":6,\"endIndex\":12,\"tabId\":\"tab-1\"}}"
        ));
        assert!(!request.body_json.contains("\"segmentId\":\"tab-1\""));
    }

    #[test]
    fn tabbed_table_cell_text_ops_treat_body_marker_as_empty_segment() {
        let (mut doc, id) = make_doc("cell text", 20);
        doc.tabs[0].tab_id = "tab-1".to_string();
        let RichBlock::Paragraph(paragraph) = &mut doc.tabs[0].body.blocks[0] else {
            panic!("expected paragraph");
        };
        paragraph.identity.source_kind = RichSourceKind::TableCell;
        paragraph.identity.source_tab_id = "tab-1".to_string();
        paragraph.identity.source_segment_id = "body".to_string();

        let env = RichOperationEnvelope::new(
            "op",
            "doc1",
            "tab-1",
            "r",
            "ts",
            "a",
            RichOperation::InsertText {
                paragraph_id: id,
                utf16_offset: Utf16Offset(4),
                text: "!".to_string(),
            },
        );
        let request = compile_batch(&doc, "doc1", "r", &[env]).unwrap();
        assert!(request
            .body_json
            .contains("\"insertText\":{\"location\":{\"index\":24,\"tabId\":\"tab-1\"}"));
        assert!(!request.body_json.contains("\"segmentId\":\"body\""));
    }

    #[test]
    fn replace_range_emits_two_complete_requests() {
        let (doc, id) = make_doc("hello world", 1);
        let env = RichOperationEnvelope::new(
            "op",
            "doc1",
            "",
            "r",
            "ts",
            "a",
            RichOperation::ReplaceRange {
                paragraph_id: id,
                utf16_start: Utf16Offset(6),
                utf16_end: Utf16Offset(11),
                text: "there".to_string(),
            },
        );
        let request = compile_batch(&doc, "doc1", "r", &[env]).unwrap();
        assert_eq!(request.body_json.matches("\"deleteContentRange\"").count(), 1);
        assert_eq!(request.body_json.matches("\"insertText\"").count(), 1);
        assert!(request
            .body_json
            .contains("{\"insertText\":{\"location\":{\"index\":7},\"text\":\"there\"}}"));
    }

    #[test]
    fn set_text_style_emits_update_text_style() {
        let (doc, id) = make_doc("hello", 1);
        let env = RichOperationEnvelope::new(
            "op",
            "doc1",
            "",
            "r",
            "ts",
            "a",
            RichOperation::SetTextStyle {
                paragraph_id: id,
                utf16_start: Utf16Offset(0),
                utf16_end: Utf16Offset(5),
                delta: RichStyleDelta::bold(true),
            },
        );
        let request = compile_batch(&doc, "doc1", "r", &[env]).unwrap();
        assert!(request.body_json.contains("\"updateTextStyle\""));
        assert!(request.body_json.contains("\"bold\":true"));
        assert!(request.body_json.contains("\"fields\":\"bold\""));
    }

    #[test]
    fn set_text_style_emits_font_and_color_fields() {
        let (doc, id) = make_doc("hello", 1);
        let env = RichOperationEnvelope::new(
            "op",
            "doc1",
            "",
            "r",
            "ts",
            "a",
            RichOperation::SetTextStyle {
                paragraph_id: id,
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
                    background_color: Some(Some(RichColor {
                        red: 1.0,
                        green: 0.9,
                        blue: 0.2,
                    })),
                    ..RichStyleDelta::default()
                },
            },
        );
        let request = compile_batch(&doc, "doc1", "r", &[env]).unwrap();
        assert!(request
            .body_json
            .contains("\"weightedFontFamily\":{\"fontFamily\":\"Times New Roman\"}"));
        assert!(request.body_json.contains("\"fontSize\":{\"magnitude\":16"));
        assert!(request
            .body_json
            .contains("\"foregroundColor\":{\"color\":{\"rgbColor\":{\"red\":0.8"));
        assert!(request
            .body_json
            .contains("\"backgroundColor\":{\"color\":{\"rgbColor\":{\"red\":1"));
        assert!(request.body_json.contains(
            "\"fields\":\"weightedFontFamily,fontSize,foregroundColor,backgroundColor\""
        ));
    }

    #[test]
    fn clear_text_style_emits_empty_text_style_with_reset_fields() {
        let (doc, id) = make_doc("hello", 1);
        let env = RichOperationEnvelope::new(
            "op",
            "doc1",
            "",
            "r",
            "ts",
            "a",
            RichOperation::ClearTextStyle {
                paragraph_id: id,
                utf16_start: Utf16Offset(1),
                utf16_end: Utf16Offset(4),
            },
        );
        let request = compile_batch(&doc, "doc1", "r", &[env]).unwrap();
        assert!(request.body_json.contains("\"updateTextStyle\""));
        assert!(request
            .body_json
            .contains("\"range\":{\"startIndex\":2,\"endIndex\":5}"));
        assert!(request.body_json.contains("\"textStyle\":{}"));
        assert!(request.body_json.contains(CLEAR_TEXT_STYLE_FIELDS));
    }

    #[test]
    fn paragraph_named_style_emits_update_paragraph_style() {
        let (doc, id) = make_doc("hello", 1);
        let env = RichOperationEnvelope::new(
            "op",
            "doc1",
            "",
            "r",
            "ts",
            "a",
            RichOperation::SetParagraphNamedStyle {
                paragraph_id: id,
                named_style: RichNamedStyle::Heading(2),
            },
        );
        let request = compile_batch(&doc, "doc1", "r", &[env]).unwrap();
        assert!(request.body_json.contains("\"updateParagraphStyle\""));
        assert!(request
            .body_json
            .contains("\"namedStyleType\":\"HEADING_2\""));
    }

    #[test]
    fn paragraph_style_alignment_emits_update_paragraph_style() {
        let (doc, id) = make_doc("hello", 1);
        let env = RichOperationEnvelope::new(
            "op",
            "doc1",
            "",
            "r",
            "ts",
            "a",
            RichOperation::SetParagraphStyle {
                paragraph_id: id,
                delta: RichParagraphStyleDelta::alignment(RichAlignment::Center),
            },
        );
        let request = compile_batch(&doc, "doc1", "r", &[env]).unwrap();
        assert!(request.body_json.contains("\"updateParagraphStyle\""));
        assert!(request.body_json.contains("\"alignment\":\"CENTER\""));
        assert!(request.body_json.contains("\"fields\":\"alignment\""));
    }

    #[test]
    fn named_style_emits_update_named_style() {
        let (doc, _) = make_doc("hello", 1);
        let env = RichOperationEnvelope::new(
            "op",
            "doc1",
            "",
            "r",
            "ts",
            "a",
            RichOperation::SetNamedStyle {
                named_style: RichNamedStyle::Heading(1),
                delta: RichNamedStyleDelta {
                    text_style: RichStyleDelta::bold(true),
                    paragraph_style: RichParagraphStyleDelta::alignment(RichAlignment::Center),
                },
            },
        );
        let request = compile_batch(&doc, "doc1", "r", &[env]).unwrap();
        assert!(request.body_json.contains("\"updateNamedStyle\""));
        assert!(request
            .body_json
            .contains("\"namedStyleType\":\"HEADING_1\""));
        assert!(request.body_json.contains("\"textStyle\":{\"bold\":true}"));
        assert!(request
            .body_json
            .contains("\"paragraphStyle\":{\"alignment\":\"CENTER\"}"));
        assert!(request.body_json.contains(
            "\"fields\":\"namedStyleType,textStyle,textStyle.bold,paragraphStyle,paragraphStyle.alignment\""
        ));
    }

    #[test]
    fn insert_table_emits_insert_table_request_at_paragraph_end() {
        let (doc, id) = make_doc("hello", 10);
        let env = RichOperationEnvelope::new(
            "op",
            "doc1",
            "",
            "r",
            "ts",
            "a",
            RichOperation::InsertTable {
                paragraph_id: id,
                rows: 2,
                columns: 3,
            },
        );
        let request = compile_batch(&doc, "doc1", "r", &[env]).unwrap();
        assert!(request.body_json.contains("\"insertTable\""));
        assert!(request.body_json.contains("\"rows\":2"));
        assert!(request.body_json.contains("\"columns\":3"));
        assert!(request.body_json.contains("\"location\":{\"index\":15}"));
    }

    #[test]
    fn table_row_and_column_ops_emit_table_cell_location_requests() {
        let (mut doc, _) = make_doc("hello", 1);
        let table_id = append_table(&mut doc, 20, 40);
        let envs = vec![
            RichOperationEnvelope::new(
                "row",
                "doc1",
                "",
                "r",
                "ts",
                "a",
                RichOperation::InsertTableRow {
                    table_id: table_id.clone(),
                    row_index: 0,
                    insert_below: true,
                },
            ),
            RichOperationEnvelope::new(
                "col",
                "doc1",
                "",
                "r",
                "ts",
                "a",
                RichOperation::DeleteTableColumn {
                    table_id,
                    column_index: 0,
                },
            ),
        ];
        let request = compile_batch(&doc, "doc1", "r", &envs).unwrap();
        assert!(request.body_json.contains("\"insertTableRow\""));
        assert!(request.body_json.contains("\"insertBelow\":true"));
        assert!(request.body_json.contains("\"deleteTableColumn\""));
        assert!(request
            .body_json
            .contains("\"tableStartLocation\":{\"index\":20}"));
        assert!(request.body_json.contains("\"rowIndex\":0"));
        assert!(request.body_json.contains("\"columnIndex\":0"));
    }

    #[test]
    fn table_row_and_column_insert_direction_is_compiled() {
        let (mut doc, _) = make_doc("hello", 1);
        let table_id = append_table(&mut doc, 20, 40);
        let envs = vec![
            RichOperationEnvelope::new(
                "row-above",
                "doc1",
                "",
                "r",
                "ts",
                "a",
                RichOperation::InsertTableRow {
                    table_id: table_id.clone(),
                    row_index: 0,
                    insert_below: false,
                },
            ),
            RichOperationEnvelope::new(
                "col-left",
                "doc1",
                "",
                "r",
                "ts",
                "a",
                RichOperation::InsertTableColumn {
                    table_id,
                    column_index: 0,
                    insert_right: false,
                },
            ),
        ];
        let request = compile_batch(&doc, "doc1", "r", &envs).unwrap();
        assert!(request.body_json.contains("\"insertBelow\":false"));
        assert!(request.body_json.contains("\"insertRight\":false"));
    }

    #[test]
    fn delete_table_emits_delete_content_range_for_table_bounds() {
        let (mut doc, _) = make_doc("hello", 1);
        let table_id = append_table(&mut doc, 20, 44);
        let env = RichOperationEnvelope::new(
            "delete",
            "doc1",
            "",
            "r",
            "ts",
            "a",
            RichOperation::DeleteTable { table_id },
        );
        let request = compile_batch(&doc, "doc1", "r", &[env]).unwrap();
        assert!(request
            .body_json
            .contains("\"deleteContentRange\":{\"range\":{\"startIndex\":20,\"endIndex\":44}}"));
    }

    #[test]
    fn canceled_table_delete_is_ignored_by_batch_compiler() {
        let (mut doc, _) = make_doc("hello", 1);
        let table_id = append_table(&mut doc, 20, 44);
        let delete = RichOperationEnvelope::new(
            "delete",
            "doc1",
            "",
            "r",
            "ts",
            "a",
            RichOperation::DeleteTable { table_id },
        );
        let cancel = RichOperationEnvelope::new(
            "cancel-delete",
            "doc1",
            "",
            "r",
            "ts",
            "a",
            RichOperation::CancelOperation {
                operation_id: "delete".to_string(),
            },
        );

        let err = compile_batch(&doc, "doc1", "r", &[delete, cancel]).unwrap_err();
        assert!(matches!(err, BatchCompileError::EmptyBatch));
    }

    #[test]
    fn canceled_table_delete_can_be_redone_with_new_operation_id() {
        let (mut doc, _) = make_doc("hello", 1);
        let table_id = append_table(&mut doc, 20, 44);
        let first_delete = RichOperationEnvelope::new(
            "delete",
            "doc1",
            "",
            "r",
            "ts",
            "a",
            RichOperation::DeleteTable {
                table_id: table_id.clone(),
            },
        );
        let cancel = RichOperationEnvelope::new(
            "cancel-delete",
            "doc1",
            "",
            "r",
            "ts",
            "a",
            RichOperation::CancelOperation {
                operation_id: "delete".to_string(),
            },
        );
        let redo_delete = RichOperationEnvelope::new(
            "delete-redo",
            "doc1",
            "",
            "r",
            "ts",
            "a",
            RichOperation::DeleteTable { table_id },
        );

        let request =
            compile_batch(&doc, "doc1", "r", &[first_delete, cancel, redo_delete]).unwrap();
        assert_eq!(request.operation_count, 1);
        assert!(request
            .body_json
            .contains("\"deleteContentRange\":{\"range\":{\"startIndex\":20,\"endIndex\":44}}"));
    }

    #[test]
    fn table_cell_style_emits_update_table_cell_style_request() {
        let (mut doc, _) = make_doc("hello", 1);
        let table_id = append_table(&mut doc, 20, 44);
        let mut delta = RichTableCellStyleDelta::background_color(Some(RichColor {
            red: 1.0,
            green: 0.9,
            blue: 0.2,
        }));
        delta.border_width_pt = Some(Some(1.0));
        delta.padding_pt = Some(Some(12.0));
        let env = RichOperationEnvelope::new(
            "cell-style",
            "doc1",
            "",
            "r",
            "ts",
            "a",
            RichOperation::SetTableCellStyle {
                table_id,
                row_index: 0,
                column_index: 0,
                row_span: 1,
                column_span: 1,
                delta,
            },
        );
        let request = compile_batch(&doc, "doc1", "r", &[env]).unwrap();
        assert!(request.body_json.contains("\"updateTableCellStyle\""));
        assert!(request.body_json.contains("\"backgroundColor\""));
        assert!(request.body_json.contains("\"borderTop\""));
        assert!(request.body_json.contains("\"paddingTop\""));
        assert!(request
            .body_json
            .contains("\"fields\":\"backgroundColor,borderTop,borderBottom,borderLeft,borderRight,paddingTop,paddingBottom,paddingLeft,paddingRight\""));
        assert!(request.body_json.contains("\"rowSpan\":1"));
        assert!(request.body_json.contains("\"columnSpan\":1"));
    }

    #[test]
    fn segment_create_delete_ops_emit_docs_requests() {
        let (doc, para_id) = make_doc("hello", 1);
        let envs = vec![
            RichOperationEnvelope::new(
                "h",
                "doc1",
                "",
                "r",
                "ts",
                "a",
                RichOperation::CreateHeader,
            ),
            RichOperationEnvelope::new(
                "dh",
                "doc1",
                "",
                "r",
                "ts",
                "a",
                RichOperation::DeleteHeader {
                    header_id: "h1".to_string(),
                },
            ),
            RichOperationEnvelope::new(
                "f",
                "doc1",
                "",
                "r",
                "ts",
                "a",
                RichOperation::CreateFooter,
            ),
            RichOperationEnvelope::new(
                "df",
                "doc1",
                "",
                "r",
                "ts",
                "a",
                RichOperation::DeleteFooter {
                    footer_id: "f1".to_string(),
                },
            ),
            RichOperationEnvelope::new(
                "fn",
                "doc1",
                "",
                "r",
                "ts",
                "a",
                RichOperation::CreateFootnote {
                    paragraph_id: para_id,
                    utf16_offset: Utf16Offset(2),
                },
            ),
        ];
        let request = compile_batch(&doc, "doc1", "r", &envs).unwrap();
        assert!(request.body_json.contains("\"createHeader\""));
        assert!(request
            .body_json
            .contains("\"deleteHeader\":{\"headerId\":\"h1\"}"));
        assert!(request.body_json.contains("\"createFooter\""));
        assert!(request
            .body_json
            .contains("\"deleteFooter\":{\"footerId\":\"f1\"}"));
        assert!(request
            .body_json
            .contains("\"createFootnote\":{\"location\":{\"index\":3}}"));
    }

    #[test]
    fn merge_and_unmerge_table_cells_emit_table_range_requests() {
        let (mut doc, _) = make_doc("hello", 1);
        let table_id = append_table(&mut doc, 20, 44);
        let envs = vec![
            RichOperationEnvelope::new(
                "merge",
                "doc1",
                "",
                "r",
                "ts",
                "a",
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
                "doc1",
                "",
                "r",
                "ts",
                "a",
                RichOperation::UnmergeTableCells {
                    table_id,
                    row_index: 0,
                    column_index: 0,
                    row_span: 2,
                    column_span: 2,
                },
            ),
        ];
        let request = compile_batch(&doc, "doc1", "r", &envs).unwrap();
        assert!(request.body_json.contains("\"mergeTableCells\""));
        assert!(request.body_json.contains("\"unmergeTableCells\""));
        assert!(request.body_json.contains("\"rowSpan\":2"));
        assert!(request.body_json.contains("\"columnSpan\":2"));
    }

    #[test]
    fn unresolved_paragraph_returns_node_not_found() {
        let (doc, _id) = make_doc("hello", 1);
        let bogus = RichNodeId::synthetic("missing");
        let env = RichOperationEnvelope::new(
            "op",
            "doc1",
            "",
            "r",
            "ts",
            "a",
            RichOperation::InsertText {
                paragraph_id: bogus,
                utf16_offset: Utf16Offset(0),
                text: "x".to_string(),
            },
        );
        let err = compile_batch(&doc, "doc1", "r", &[env]).unwrap_err();
        assert!(matches!(err, BatchCompileError::NodeNotFound(_)));
    }

    #[test]
    fn paragraph_without_source_index_errors_unresolved() {
        let para_id = RichNodeId::synthetic("p");
        let para = RichParagraph {
            identity: RichNodeIdentity::local_only(para_id.clone(), RichSourceKind::Body),
            style: RichParagraphStyle::default(),
            list: None,
            inlines: vec![RichInline::TextRun(RichTextRun {
                identity: ident("r"),
                text: "x".to_string(),
                style: RichStyle::default(),
            })],
            raw_extras: RichRawJson::empty(),
        };
        let mut doc = RichDocument::skeleton("d", "t");
        doc.tabs.push(crate::rich_model::RichTab {
            identity: ident("tab"),
            tab_id: String::new(),
            title: String::new(),
            index: 0,
            parent_tab_id: None,
            body: RichSegment {
                identity: ident("seg"),
                segment_id: String::new(),
                kind: RichSourceKind::Body,
                blocks: vec![RichBlock::Paragraph(para)],
                style: RichRawJson::empty(),
            },
            headers: BTreeMap::new(),
            footers: BTreeMap::new(),
            footnotes: BTreeMap::new(),
            child_tabs: Vec::new(),
        });
        let env = RichOperationEnvelope::new(
            "op",
            "d",
            "",
            "r",
            "ts",
            "a",
            RichOperation::InsertText {
                paragraph_id: para_id,
                utf16_offset: Utf16Offset(0),
                text: "y".to_string(),
            },
        );
        let err = compile_batch(&doc, "d", "r", &[env]).unwrap_err();
        assert!(matches!(err, BatchCompileError::UnresolvedDocsIndex(_)));
    }

    #[test]
    fn ops_sorted_so_late_indexes_come_first_in_batch() {
        let (doc, id) = make_doc("hello world hello", 1);
        let early = RichOperationEnvelope::new(
            "op-early",
            "doc1",
            "",
            "r",
            "ts",
            "a",
            RichOperation::InsertText {
                paragraph_id: id.clone(),
                utf16_offset: Utf16Offset(0),
                text: "A".to_string(),
            },
        );
        let late = RichOperationEnvelope::new(
            "op-late",
            "doc1",
            "",
            "r",
            "ts",
            "a",
            RichOperation::InsertText {
                paragraph_id: id,
                utf16_offset: Utf16Offset(11),
                text: "B".to_string(),
            },
        );
        let request = compile_batch(&doc, "doc1", "r", &[early, late]).unwrap();
        let body = &request.body_json;
        let pos_b = body.find("\"text\":\"B\"").expect("B request missing");
        let pos_a = body.find("\"text\":\"A\"").expect("A request missing");
        assert!(
            pos_b < pos_a,
            "later index must appear before earlier index in batch"
        );
    }

    #[test]
    fn empty_envelope_list_is_an_error() {
        let (doc, _) = make_doc("hi", 1);
        let err = compile_batch(&doc, "doc1", "r", &[]).unwrap_err();
        assert!(matches!(err, BatchCompileError::EmptyBatch));
    }

    #[test]
    fn update_list_nesting_reissues_bullets_with_leading_tabs() {
        let (mut doc, id) = make_doc("item", 10);
        let RichBlock::Paragraph(paragraph) = &mut doc.tabs[0].body.blocks[0] else {
            panic!()
        };
        paragraph.list = Some(RichListAnchor {
            list_id: "local-unord-para-1".to_string(),
            nesting_level: 0,
        });
        let env = RichOperationEnvelope::new(
            "op",
            "doc1",
            "",
            "r",
            "ts",
            "a",
            RichOperation::UpdateListNesting {
                paragraph_id: id,
                nesting_level: 2,
            },
        );
        let request = compile_batch(&doc, "doc1", "r", &[env]).unwrap();
        assert!(request.body_json.contains("\"deleteParagraphBullets\""));
        assert!(request
            .body_json
            .contains("\"insertText\":{\"location\":{\"index\":10},\"text\":\"\\t\\t\"}"));
        assert!(request.body_json.contains("\"createParagraphBullets\""));
        assert!(request
            .body_json
            .contains("\"bulletPreset\":\"BULLET_DISC_CIRCLE_SQUARE\""));
    }
}
