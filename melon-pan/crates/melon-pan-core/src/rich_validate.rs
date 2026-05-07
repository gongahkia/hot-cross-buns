//! Post-write validators.
//!
//! Per RICHTEXT-TODO §"Validation After Write". Runs after every
//! successful `documents.batchUpdate`:
//!
//! 1. Re-pull the doc.
//! 2. Verify revision advanced.
//! 3. Verify each operation's expected post-condition.
//! 4. Verify protected/unsupported nodes survived.
//! 5. Verify named ranges did not unexpectedly disappear.
//!
//! The validator covers post-conditions for the implemented rich op set:
//! text presence/absence, style deltas, paragraph/named style changes,
//! table shape changes, and basic inline-object insertion/deletion.
//! Deferred V2 ops are reported as `Unverified` rather than `Failed` so
//! callers can distinguish "did not check" from "checked and broken".

use crate::json::JsonValue;
use crate::rich_index::{utf16_to_byte, Utf16Offset};
use crate::rich_model::{
    RichBlock, RichDocument, RichInline, RichInlineObjectKind, RichNamedRange, RichNamedStyle,
    RichParagraph, RichRawJson, RichStyle, RichTab, RichTable,
};
use crate::rich_ops::{
    RichNamedStyleDelta, RichOperation, RichParagraphStyleDelta, RichStyleDelta,
    RichTableBorderDashStyle, RichTableCellContentAlignment, RichTableCellStyleDelta,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidationReport {
    /// Did the revision advance? Always required for a confident success.
    pub revision_advanced: bool,
    pub revision_before: String,
    pub revision_after: String,
    pub operations: Vec<OperationOutcome>,
    /// Named ranges present before-push but missing after-push. Surfaced
    /// as warnings, not failures, since named-range drift on a successful
    /// rich push is sometimes intentional.
    pub dropped_named_ranges: Vec<String>,
    /// True when every checked operation is Verified, the revision
    /// advanced, and no named ranges were unexpectedly dropped.
    pub all_clear: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OperationOutcome {
    /// Post-condition matched expectations.
    Verified { operation_id: String },
    /// Post-condition could not be checked (V2 op or insufficient state).
    Unverified {
        operation_id: String,
        reason: String,
    },
    /// Post-condition checked and failed.
    Failed {
        operation_id: String,
        reason: String,
    },
}

/// Validate a freshly-pulled document against the operations we believed
/// we sent. `before` is the document state we held before the push;
/// `after` is the freshly re-pulled document.
pub fn validate(
    before: &RichDocument,
    after: &RichDocument,
    operation_ids: &[(String, RichOperation)],
) -> ValidationReport {
    let revision_advanced = !after.revision.revision_id.is_empty()
        && after.revision.revision_id != before.revision.revision_id;
    let mut outcomes = Vec::with_capacity(operation_ids.len());
    for (op_id, op) in operation_ids {
        outcomes.push(check_one(before, after, op_id, op));
    }
    let dropped = dropped_named_ranges(&before.named_ranges, &after.named_ranges);
    let all_clear = revision_advanced
        && dropped.is_empty()
        && outcomes
            .iter()
            .all(|o| matches!(o, OperationOutcome::Verified { .. }));
    ValidationReport {
        revision_advanced,
        revision_before: before.revision.revision_id.clone(),
        revision_after: after.revision.revision_id.clone(),
        operations: outcomes,
        dropped_named_ranges: dropped,
        all_clear,
    }
}

fn check_one(
    before: &RichDocument,
    after: &RichDocument,
    operation_id: &str,
    op: &RichOperation,
) -> OperationOutcome {
    match op {
        RichOperation::InsertText {
            paragraph_id,
            utf16_offset,
            text,
        } => {
            if paragraph_has_text_at(after, paragraph_id, *utf16_offset, text) {
                OperationOutcome::Verified {
                    operation_id: operation_id.to_string(),
                }
            } else {
                OperationOutcome::Failed {
                    operation_id: operation_id.to_string(),
                    reason: format!("inserted text {text:?} not found in re-pulled doc"),
                }
            }
        }
        RichOperation::DeleteRange {
            paragraph_id,
            utf16_start,
            utf16_end,
        } => {
            let Some(removed) = paragraph_substring(before, paragraph_id, *utf16_start, *utf16_end)
            else {
                return OperationOutcome::Unverified {
                    operation_id: operation_id.to_string(),
                    reason: "could not recover deleted text from pre-push document".to_string(),
                };
            };
            if removed.is_empty()
                || paragraph_substring_by_len(
                    after,
                    paragraph_id,
                    *utf16_start,
                    removed.encode_utf16().count() as u32,
                )
                .as_deref()
                    != Some(removed.as_str())
            {
                OperationOutcome::Verified {
                    operation_id: operation_id.to_string(),
                }
            } else {
                OperationOutcome::Failed {
                    operation_id: operation_id.to_string(),
                    reason: format!("deleted text {removed:?} still present at original range"),
                }
            }
        }
        RichOperation::ReplaceRange {
            paragraph_id,
            utf16_start,
            text,
            ..
        } => {
            if paragraph_has_text_at(after, paragraph_id, *utf16_start, text) {
                OperationOutcome::Verified {
                    operation_id: operation_id.to_string(),
                }
            } else {
                OperationOutcome::Failed {
                    operation_id: operation_id.to_string(),
                    reason: format!("replacement text {text:?} not found"),
                }
            }
        }
        RichOperation::SetTextStyle {
            paragraph_id,
            utf16_start,
            utf16_end,
            delta,
        } => {
            if paragraph_range_has_style(after, paragraph_id, *utf16_start, *utf16_end, delta) {
                OperationOutcome::Verified {
                    operation_id: operation_id.to_string(),
                }
            } else {
                OperationOutcome::Failed {
                    operation_id: operation_id.to_string(),
                    reason: "style delta not present across requested paragraph range".to_string(),
                }
            }
        }
        RichOperation::ClearTextStyle {
            paragraph_id,
            utf16_start,
            utf16_end,
        } => {
            if paragraph_range_is_clear(after, paragraph_id, *utf16_start, *utf16_end) {
                OperationOutcome::Verified {
                    operation_id: operation_id.to_string(),
                }
            } else {
                OperationOutcome::Failed {
                    operation_id: operation_id.to_string(),
                    reason: "inline style still present across requested paragraph range"
                        .to_string(),
                }
            }
        }
        RichOperation::CreateLink {
            paragraph_id,
            utf16_start,
            utf16_end,
            url,
        } => {
            let delta = RichStyleDelta::link(Some(url.clone()));
            if paragraph_range_has_style(after, paragraph_id, *utf16_start, *utf16_end, &delta) {
                OperationOutcome::Verified {
                    operation_id: operation_id.to_string(),
                }
            } else {
                OperationOutcome::Failed {
                    operation_id: operation_id.to_string(),
                    reason: format!("link {url:?} not found in re-pulled doc"),
                }
            }
        }
        RichOperation::DeleteLink {
            paragraph_id,
            utf16_start,
            utf16_end,
        } => {
            let delta = RichStyleDelta::link(None);
            if paragraph_range_has_style(after, paragraph_id, *utf16_start, *utf16_end, &delta) {
                OperationOutcome::Verified {
                    operation_id: operation_id.to_string(),
                }
            } else {
                OperationOutcome::Failed {
                    operation_id: operation_id.to_string(),
                    reason: "link still present across requested paragraph range".to_string(),
                }
            }
        }
        RichOperation::SetParagraphNamedStyle {
            paragraph_id,
            named_style,
        } => match find_paragraph(after, paragraph_id) {
            Some(paragraph) if paragraph.style.named_style == *named_style => {
                OperationOutcome::Verified {
                    operation_id: operation_id.to_string(),
                }
            }
            Some(_) => OperationOutcome::Failed {
                operation_id: operation_id.to_string(),
                reason: "paragraph named style did not match requested style".to_string(),
            },
            None => OperationOutcome::Failed {
                operation_id: operation_id.to_string(),
                reason: "paragraph not found after push".to_string(),
            },
        },
        RichOperation::SetParagraphStyle {
            paragraph_id,
            delta,
        } => match find_paragraph(after, paragraph_id) {
            Some(paragraph) if paragraph_style_matches_delta(paragraph, delta) => {
                OperationOutcome::Verified {
                    operation_id: operation_id.to_string(),
                }
            }
            Some(_) => OperationOutcome::Failed {
                operation_id: operation_id.to_string(),
                reason: "paragraph style did not match requested delta".to_string(),
            },
            None => OperationOutcome::Failed {
                operation_id: operation_id.to_string(),
                reason: "paragraph not found after push".to_string(),
            },
        },
        RichOperation::SetNamedStyle { named_style, delta } => {
            if named_style_matches_delta(&after.named_styles, *named_style, delta) {
                OperationOutcome::Verified {
                    operation_id: operation_id.to_string(),
                }
            } else {
                OperationOutcome::Failed {
                    operation_id: operation_id.to_string(),
                    reason: "named style did not match requested delta".to_string(),
                }
            }
        }
        RichOperation::NoOpUnsupportedProtection { .. } => OperationOutcome::Verified {
            operation_id: operation_id.to_string(),
        },

        RichOperation::InsertTable { rows, columns, .. } => {
            if table_count(after) > table_count(before)
                && table_with_dimensions_count(after, *rows, *columns)
                    > table_with_dimensions_count(before, *rows, *columns)
            {
                OperationOutcome::Verified {
                    operation_id: operation_id.to_string(),
                }
            } else {
                OperationOutcome::Failed {
                    operation_id: operation_id.to_string(),
                    reason: "inserted table with requested dimensions not found".to_string(),
                }
            }
        }
        RichOperation::DeleteTable { table_id } => {
            if find_table(before, table_id).is_some() && find_table(after, table_id).is_none() {
                OperationOutcome::Verified {
                    operation_id: operation_id.to_string(),
                }
            } else {
                OperationOutcome::Failed {
                    operation_id: operation_id.to_string(),
                    reason: "table still present after delete".to_string(),
                }
            }
        }
        RichOperation::InsertTableRow { table_id, .. } => {
            match (find_table(before, table_id), find_table(after, table_id)) {
                (Some(before_table), Some(after_table))
                    if after_table.rows.len() == before_table.rows.len() + 1 =>
                {
                    OperationOutcome::Verified {
                        operation_id: operation_id.to_string(),
                    }
                }
                _ => OperationOutcome::Failed {
                    operation_id: operation_id.to_string(),
                    reason: "table row count did not increase by one".to_string(),
                },
            }
        }
        RichOperation::DeleteTableRow { table_id, .. } => {
            match (find_table(before, table_id), find_table(after, table_id)) {
                (Some(before_table), Some(after_table))
                    if before_table.rows.len() == after_table.rows.len() + 1 =>
                {
                    OperationOutcome::Verified {
                        operation_id: operation_id.to_string(),
                    }
                }
                (Some(before_table), None) if before_table.rows.len() == 1 => {
                    OperationOutcome::Verified {
                        operation_id: operation_id.to_string(),
                    }
                }
                _ => OperationOutcome::Failed {
                    operation_id: operation_id.to_string(),
                    reason: "table row count did not decrease by one".to_string(),
                },
            }
        }
        RichOperation::InsertTableColumn { table_id, .. } => {
            match (find_table(before, table_id), find_table(after, table_id)) {
                (Some(before_table), Some(after_table))
                    if after_table.columns == before_table.columns + 1 =>
                {
                    OperationOutcome::Verified {
                        operation_id: operation_id.to_string(),
                    }
                }
                _ => OperationOutcome::Failed {
                    operation_id: operation_id.to_string(),
                    reason: "table column count did not increase by one".to_string(),
                },
            }
        }
        RichOperation::DeleteTableColumn { table_id, .. } => {
            match (find_table(before, table_id), find_table(after, table_id)) {
                (Some(before_table), Some(after_table))
                    if before_table.columns == after_table.columns + 1 =>
                {
                    OperationOutcome::Verified {
                        operation_id: operation_id.to_string(),
                    }
                }
                (Some(before_table), None) if before_table.columns == 1 => {
                    OperationOutcome::Verified {
                        operation_id: operation_id.to_string(),
                    }
                }
                _ => OperationOutcome::Failed {
                    operation_id: operation_id.to_string(),
                    reason: "table column count did not decrease by one".to_string(),
                },
            }
        }
        RichOperation::SetTableCellStyle {
            table_id,
            row_index,
            column_index,
            delta,
            ..
        } => match find_table_cell(after, table_id, *row_index, *column_index) {
            Some(cell) if table_cell_style_matches_delta(&cell.raw_style, delta) => {
                OperationOutcome::Verified {
                    operation_id: operation_id.to_string(),
                }
            }
            Some(_) => OperationOutcome::Failed {
                operation_id: operation_id.to_string(),
                reason: "table cell style did not match requested delta".to_string(),
            },
            None => OperationOutcome::Failed {
                operation_id: operation_id.to_string(),
                reason: "table cell not found after push".to_string(),
            },
        },
        RichOperation::SetTableColumnWidth { table_id, .. } => {
            if find_table(after, table_id).is_some() {
                OperationOutcome::Unverified {
                    operation_id: operation_id.to_string(),
                    reason: "Docs API does not return table column properties in the Swift rich model yet".to_string(),
                }
            } else {
                OperationOutcome::Failed {
                    operation_id: operation_id.to_string(),
                    reason: "table not found after column resize".to_string(),
                }
            }
        }
        RichOperation::SetTableRowMinHeight {
            table_id,
            row_index,
            min_height_pt,
        } => {
            match find_table(after, table_id).and_then(|table| table.rows.get(*row_index as usize))
            {
                Some(row)
                    if row
                        .raw_style
                        .0
                        .as_ref()
                        .and_then(|style| style.path(&["minRowHeight", "magnitude"]))
                        .and_then(number_as_f32)
                        .is_some_and(|actual| (actual - *min_height_pt).abs() < 0.0001) =>
                {
                    OperationOutcome::Verified {
                        operation_id: operation_id.to_string(),
                    }
                }
                Some(_) => OperationOutcome::Failed {
                    operation_id: operation_id.to_string(),
                    reason: "table row min height did not match requested value".to_string(),
                },
                None => OperationOutcome::Failed {
                    operation_id: operation_id.to_string(),
                    reason: "table row not found after resize".to_string(),
                },
            }
        }
        RichOperation::MergeTableCells {
            table_id,
            row_index,
            column_index,
            row_span,
            column_span,
        } => match find_table_cell(after, table_id, *row_index, *column_index) {
            Some(cell) if cell.row_span == *row_span && cell.column_span == *column_span => {
                OperationOutcome::Verified {
                    operation_id: operation_id.to_string(),
                }
            }
            Some(_) => OperationOutcome::Failed {
                operation_id: operation_id.to_string(),
                reason: "merged table cell did not expose requested span".to_string(),
            },
            None => OperationOutcome::Failed {
                operation_id: operation_id.to_string(),
                reason: "merged table cell not found after push".to_string(),
            },
        },
        RichOperation::UnmergeTableCells {
            table_id,
            row_index,
            column_index,
            ..
        } => match find_table_cell(after, table_id, *row_index, *column_index) {
            Some(cell) if cell.row_span == 1 && cell.column_span == 1 => {
                OperationOutcome::Verified {
                    operation_id: operation_id.to_string(),
                }
            }
            Some(_) => OperationOutcome::Failed {
                operation_id: operation_id.to_string(),
                reason: "table cell still appears merged after unmerge".to_string(),
            },
            None => OperationOutcome::Failed {
                operation_id: operation_id.to_string(),
                reason: "table cell not found after unmerge".to_string(),
            },
        },

        RichOperation::InsertInlineImage { .. } => {
            let before_images = before
                .inline_objects
                .values()
                .filter(|object| object.kind == RichInlineObjectKind::Image)
                .count();
            let after_images = after
                .inline_objects
                .values()
                .filter(|object| object.kind == RichInlineObjectKind::Image)
                .count();
            if after_images > before_images {
                OperationOutcome::Verified {
                    operation_id: operation_id.to_string(),
                }
            } else {
                OperationOutcome::Failed {
                    operation_id: operation_id.to_string(),
                    reason: "inline image count did not increase".to_string(),
                }
            }
        }
        RichOperation::DeleteInlineObject { object_id } => {
            if !after.inline_objects.contains_key(object_id) {
                OperationOutcome::Verified {
                    operation_id: operation_id.to_string(),
                }
            } else {
                OperationOutcome::Failed {
                    operation_id: operation_id.to_string(),
                    reason: "inline object still present after delete".to_string(),
                }
            }
        }
        RichOperation::DeleteHeader { header_id } => {
            if !after
                .tabs
                .iter()
                .any(|tab| tab.headers.contains_key(header_id))
            {
                OperationOutcome::Verified {
                    operation_id: operation_id.to_string(),
                }
            } else {
                OperationOutcome::Failed {
                    operation_id: operation_id.to_string(),
                    reason: "header still present after delete".to_string(),
                }
            }
        }
        RichOperation::DeleteFooter { footer_id } => {
            if !after
                .tabs
                .iter()
                .any(|tab| tab.footers.contains_key(footer_id))
            {
                OperationOutcome::Verified {
                    operation_id: operation_id.to_string(),
                }
            } else {
                OperationOutcome::Failed {
                    operation_id: operation_id.to_string(),
                    reason: "footer still present after delete".to_string(),
                }
            }
        }
        RichOperation::DeleteFootnote { footnote_id } => {
            if !after
                .tabs
                .iter()
                .any(|tab| tab.footnotes.contains_key(footnote_id))
            {
                OperationOutcome::Verified {
                    operation_id: operation_id.to_string(),
                }
            } else {
                OperationOutcome::Failed {
                    operation_id: operation_id.to_string(),
                    reason: "footnote still present after delete".to_string(),
                }
            }
        }

        // Remaining V2 ops.
        RichOperation::CreateList { .. }
        | RichOperation::UpdateListNesting { .. }
        | RichOperation::DeleteList { .. }
        | RichOperation::CreateHeader
        | RichOperation::CreateFooter
        | RichOperation::CreateFootnote { .. } => OperationOutcome::Unverified {
            operation_id: operation_id.to_string(),
            reason: "V2 op validator not implemented".to_string(),
        },
        RichOperation::CancelOperation { .. } => OperationOutcome::Verified {
            operation_id: operation_id.to_string(),
        },
    }
}

fn paragraph_has_text_at(
    doc: &RichDocument,
    paragraph_id: &crate::rich_model::RichNodeId,
    utf16_offset: Utf16Offset,
    text: &str,
) -> bool {
    if text.is_empty() {
        return true;
    }
    paragraph_substring_by_len(
        doc,
        paragraph_id,
        utf16_offset,
        text.encode_utf16().count() as u32,
    )
    .as_deref()
        == Some(text)
}

fn paragraph_substring(
    doc: &RichDocument,
    paragraph_id: &crate::rich_model::RichNodeId,
    utf16_start: Utf16Offset,
    utf16_end: Utf16Offset,
) -> Option<String> {
    if utf16_end.as_u32() < utf16_start.as_u32() {
        return None;
    }
    paragraph_substring_by_len(
        doc,
        paragraph_id,
        utf16_start,
        utf16_end.as_u32() - utf16_start.as_u32(),
    )
}

fn paragraph_substring_by_len(
    doc: &RichDocument,
    paragraph_id: &crate::rich_model::RichNodeId,
    utf16_start: Utf16Offset,
    utf16_len: u32,
) -> Option<String> {
    let text = paragraph_text(find_paragraph(doc, paragraph_id)?);
    let end = Utf16Offset(utf16_start.as_u32().checked_add(utf16_len)?);
    let start_byte = utf16_to_byte(&text, utf16_start).ok()?.as_usize();
    let end_byte = utf16_to_byte(&text, end).ok()?.as_usize();
    Some(text[start_byte..end_byte].to_string())
}

fn paragraph_range_has_style(
    doc: &RichDocument,
    paragraph_id: &crate::rich_model::RichNodeId,
    utf16_start: Utf16Offset,
    utf16_end: Utf16Offset,
    delta: &RichStyleDelta,
) -> bool {
    if delta.is_empty() || utf16_end.as_u32() <= utf16_start.as_u32() {
        return true;
    }
    let Some(paragraph) = find_paragraph(doc, paragraph_id) else {
        return false;
    };
    let mut consumed = 0_u32;
    let mut covered = 0_u32;
    for inline in &paragraph.inlines {
        let RichInline::TextRun(run) = inline else {
            continue;
        };
        let run_text = run.text.trim_end_matches('\n');
        let run_len = run_text.encode_utf16().count() as u32;
        let run_start = consumed;
        let run_end = consumed + run_len;
        consumed = run_end;
        if utf16_end.as_u32() <= run_start || utf16_start.as_u32() >= run_end {
            continue;
        }
        let overlap_start = utf16_start.as_u32().max(run_start);
        let overlap_end = utf16_end.as_u32().min(run_end);
        if overlap_end > overlap_start {
            if !style_matches_delta(&run.style, delta) {
                return false;
            }
            covered += overlap_end - overlap_start;
        }
    }
    covered == utf16_end.as_u32() - utf16_start.as_u32()
}

fn style_matches_delta(style: &RichStyle, delta: &RichStyleDelta) -> bool {
    if let Some(value) = delta.bold {
        if style.bold != value {
            return false;
        }
    }
    if let Some(value) = delta.italic {
        if style.italic != value {
            return false;
        }
    }
    if let Some(value) = delta.underline {
        if style.underline != value {
            return false;
        }
    }
    if let Some(value) = delta.strikethrough {
        if style.strikethrough != value {
            return false;
        }
    }
    if let Some(value) = &delta.font_family {
        if style.font_family.as_ref() != value.as_ref() {
            return false;
        }
    }
    if let Some(value) = delta.font_size_pt {
        if style.font_size_pt != value {
            return false;
        }
    }
    if let Some(value) = delta.foreground_color {
        if style.foreground_color != value {
            return false;
        }
    }
    if let Some(value) = delta.background_color {
        if style.background_color != value {
            return false;
        }
    }
    if let Some(link) = &delta.link_url {
        if style.link_url.as_ref() != link.as_ref() {
            return false;
        }
    }
    true
}

fn paragraph_style_matches_delta(
    paragraph: &RichParagraph,
    delta: &RichParagraphStyleDelta,
) -> bool {
    if let Some(value) = delta.alignment {
        if paragraph.style.alignment != Some(value) {
            return false;
        }
    }
    if let Some(value) = delta.indent_start {
        if paragraph.style.indent_start != Some(value) {
            return false;
        }
    }
    if let Some(value) = delta.indent_end {
        if paragraph.style.indent_end != Some(value) {
            return false;
        }
    }
    if let Some(value) = delta.indent_first_line {
        if paragraph.style.indent_first_line != Some(value) {
            return false;
        }
    }
    if let Some(value) = delta.line_spacing {
        if paragraph.style.line_spacing != Some(value) {
            return false;
        }
    }
    if let Some(value) = delta.space_above {
        if paragraph.style.space_above != Some(value) {
            return false;
        }
    }
    if let Some(value) = delta.space_below {
        if paragraph.style.space_below != Some(value) {
            return false;
        }
    }
    true
}

fn named_style_matches_delta(
    named_styles: &RichRawJson,
    named_style: RichNamedStyle,
    delta: &RichNamedStyleDelta,
) -> bool {
    let Some(style) = find_named_style(named_styles, named_style) else {
        return false;
    };
    let text_ok = style
        .get("textStyle")
        .is_some_and(|style| text_style_json_matches_delta(style, &delta.text_style));
    let paragraph_ok = style
        .get("paragraphStyle")
        .is_some_and(|style| paragraph_style_json_matches_delta(style, &delta.paragraph_style));
    (delta.text_style.is_empty() || text_ok) && (delta.paragraph_style.is_empty() || paragraph_ok)
}

fn table_cell_style_matches_delta(
    raw_style: &RichRawJson,
    delta: &RichTableCellStyleDelta,
) -> bool {
    let style = raw_style.0.as_ref();
    if let Some(expected) = delta.background_color {
        match expected {
            Some(color) => {
                let value =
                    style.and_then(|style| style.path(&["backgroundColor", "color", "rgbColor"]));
                let Some(value) = value else {
                    return false;
                };
                if !(number_close(value.get("red").and_then(number_as_f32), color.red)
                    && number_close(value.get("green").and_then(number_as_f32), color.green)
                    && number_close(value.get("blue").and_then(number_as_f32), color.blue))
                {
                    return false;
                }
            }
            None => {
                if style
                    .and_then(|style| style.get("backgroundColor"))
                    .is_some()
                {
                    return false;
                }
            }
        }
    }
    if let Some(expected) = delta.border_width_pt {
        match expected {
            Some(width) => {
                let actual = style.and_then(|style| {
                    style
                        .path(&["borderTop", "width", "magnitude"])
                        .or_else(|| style.path(&["borderBottom", "width", "magnitude"]))
                        .or_else(|| style.path(&["borderLeft", "width", "magnitude"]))
                        .or_else(|| style.path(&["borderRight", "width", "magnitude"]))
                });
                if !number_close(actual.and_then(number_as_f32), width) {
                    return false;
                }
            }
            None => {
                if style.is_some_and(|style| {
                    style.get("borderTop").is_some()
                        || style.get("borderBottom").is_some()
                        || style.get("borderLeft").is_some()
                        || style.get("borderRight").is_some()
                }) {
                    return false;
                }
            }
        }
    }
    if let Some(expected) = delta.border_color {
        match expected {
            Some(color) => {
                let Some(value) = style.and_then(|style| {
                    style
                        .path(&["borderTop", "color", "rgbColor"])
                        .or_else(|| style.path(&["borderBottom", "color", "rgbColor"]))
                        .or_else(|| style.path(&["borderLeft", "color", "rgbColor"]))
                        .or_else(|| style.path(&["borderRight", "color", "rgbColor"]))
                }) else {
                    return false;
                };
                if !(number_close(value.get("red").and_then(number_as_f32), color.red)
                    && number_close(value.get("green").and_then(number_as_f32), color.green)
                    && number_close(value.get("blue").and_then(number_as_f32), color.blue))
                {
                    return false;
                }
            }
            None => {}
        }
    }
    if let Some(expected) = delta.border_dash_style {
        match expected {
            Some(style_expected) => {
                let actual = style.and_then(|style| {
                    style
                        .path(&["borderTop", "dashStyle"])
                        .or_else(|| style.path(&["borderBottom", "dashStyle"]))
                        .or_else(|| style.path(&["borderLeft", "dashStyle"]))
                        .or_else(|| style.path(&["borderRight", "dashStyle"]))
                        .and_then(crate::json::JsonValue::as_str)
                });
                if actual != Some(table_border_dash_style_label(style_expected)) {
                    return false;
                }
            }
            None => {}
        }
    }
    for (expected, key) in [
        (delta.border_top_width_pt, "borderTop"),
        (delta.border_right_width_pt, "borderRight"),
        (delta.border_bottom_width_pt, "borderBottom"),
        (delta.border_left_width_pt, "borderLeft"),
    ] {
        if let Some(expected) = expected {
            match expected {
                Some(width) => {
                    let actual = style.and_then(|style| style.path(&[key, "width", "magnitude"]));
                    if !number_close(actual.and_then(number_as_f32), width) {
                        return false;
                    }
                }
                None => {
                    if style.is_some_and(|style| style.get(key).is_some()) {
                        return false;
                    }
                }
            }
        }
    }
    if let Some(expected) = delta.content_alignment {
        match expected {
            Some(alignment) => {
                let actual = style
                    .and_then(|style| style.path(&["contentAlignment"]))
                    .and_then(crate::json::JsonValue::as_str);
                if actual != Some(table_content_alignment_label(alignment)) {
                    return false;
                }
            }
            None => {
                if style.is_some_and(|style| style.get("contentAlignment").is_some()) {
                    return false;
                }
            }
        }
    }
    if let Some(expected) = delta.padding_pt {
        match expected {
            Some(padding) => {
                let actual = style.and_then(|style| {
                    style
                        .path(&["paddingTop", "magnitude"])
                        .or_else(|| style.path(&["paddingBottom", "magnitude"]))
                        .or_else(|| style.path(&["paddingLeft", "magnitude"]))
                        .or_else(|| style.path(&["paddingRight", "magnitude"]))
                });
                if !number_close(actual.and_then(number_as_f32), padding) {
                    return false;
                }
            }
            None => {
                if style.is_some_and(|style| {
                    style.get("paddingTop").is_some()
                        || style.get("paddingBottom").is_some()
                        || style.get("paddingLeft").is_some()
                        || style.get("paddingRight").is_some()
                }) {
                    return false;
                }
            }
        }
    }
    true
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

fn number_close(actual: Option<f32>, expected: f32) -> bool {
    actual.is_some_and(|actual| (actual - expected).abs() < 0.0001)
}

fn find_named_style(named_styles: &RichRawJson, named_style: RichNamedStyle) -> Option<&JsonValue> {
    let styles = named_styles.0.as_ref()?.get("styles")?.as_array()?;
    let wanted = named_style_to_docs_string(named_style);
    styles.iter().find(|style| {
        style
            .get("namedStyleType")
            .and_then(JsonValue::as_str)
            .is_some_and(|value| value == wanted)
    })
}

fn text_style_json_matches_delta(value: &JsonValue, delta: &RichStyleDelta) -> bool {
    if let Some(expected) = delta.bold {
        if value.get("bold").and_then(JsonValue::as_bool) != Some(expected) {
            return false;
        }
    }
    if let Some(expected) = delta.italic {
        if value.get("italic").and_then(JsonValue::as_bool) != Some(expected) {
            return false;
        }
    }
    if let Some(expected) = delta.underline {
        if value.get("underline").and_then(JsonValue::as_bool) != Some(expected) {
            return false;
        }
    }
    if let Some(expected) = delta.strikethrough {
        if value.get("strikethrough").and_then(JsonValue::as_bool) != Some(expected) {
            return false;
        }
    }
    if let Some(expected) = &delta.font_family {
        match expected {
            Some(font_family) => {
                if value
                    .path(&["weightedFontFamily", "fontFamily"])
                    .and_then(JsonValue::as_str)
                    != Some(font_family.as_str())
                {
                    return false;
                }
            }
            None => {
                if value.get("weightedFontFamily").is_some() {
                    return false;
                }
            }
        }
    }
    if let Some(expected) = delta.font_size_pt {
        match expected {
            Some(font_size) => {
                if !number_close(
                    value
                        .get("fontSize")
                        .and_then(|dimension| dimension.get("magnitude"))
                        .and_then(number_as_f32),
                    font_size,
                ) {
                    return false;
                }
            }
            None => {
                if value.get("fontSize").is_some() {
                    return false;
                }
            }
        }
    }
    if let Some(expected) = delta.foreground_color {
        if !text_style_color_matches(value, "foregroundColor", expected) {
            return false;
        }
    }
    if let Some(expected) = delta.background_color {
        if !text_style_color_matches(value, "backgroundColor", expected) {
            return false;
        }
    }
    if let Some(expected) = &delta.link_url {
        match expected {
            Some(url) => {
                if value.path(&["link", "url"]).and_then(JsonValue::as_str) != Some(url.as_str()) {
                    return false;
                }
            }
            None => {
                if !matches!(value.get("link"), Some(JsonValue::Null) | None) {
                    return false;
                }
            }
        }
    }
    true
}

fn text_style_color_matches(
    value: &JsonValue,
    field: &str,
    expected: Option<crate::rich_model::RichColor>,
) -> bool {
    match expected {
        Some(color) => {
            let Some(rgb) = value.path(&[field, "color", "rgbColor"]) else {
                return false;
            };
            number_close(rgb.get("red").and_then(number_as_f32), color.red)
                && number_close(rgb.get("green").and_then(number_as_f32), color.green)
                && number_close(rgb.get("blue").and_then(number_as_f32), color.blue)
        }
        None => value.get(field).is_none(),
    }
}

fn paragraph_style_json_matches_delta(value: &JsonValue, delta: &RichParagraphStyleDelta) -> bool {
    if let Some(expected) = delta.alignment {
        if value.get("alignment").and_then(JsonValue::as_str)
            != Some(alignment_to_docs_string(expected))
        {
            return false;
        }
    }
    dimension_matches(value, "indentStart", delta.indent_start)
        && dimension_matches(value, "indentEnd", delta.indent_end)
        && dimension_matches(value, "indentFirstLine", delta.indent_first_line)
        && number_matches(value, "lineSpacing", delta.line_spacing)
        && dimension_matches(value, "spaceAbove", delta.space_above)
        && dimension_matches(value, "spaceBelow", delta.space_below)
}

fn dimension_matches(value: &JsonValue, key: &str, expected: Option<f32>) -> bool {
    expected.is_none_or(|expected| {
        value
            .get(key)
            .and_then(|dimension| dimension.get("magnitude"))
            .and_then(number_as_f32)
            == Some(expected)
    })
}

fn number_matches(value: &JsonValue, key: &str, expected: Option<f32>) -> bool {
    expected.is_none_or(|expected| value.get(key).and_then(number_as_f32) == Some(expected))
}

fn number_as_f32(value: &JsonValue) -> Option<f32> {
    match value {
        JsonValue::Number(raw) => raw.parse().ok(),
        _ => None,
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

fn alignment_to_docs_string(alignment: crate::rich_model::RichAlignment) -> &'static str {
    match alignment {
        crate::rich_model::RichAlignment::Start => "START",
        crate::rich_model::RichAlignment::Center => "CENTER",
        crate::rich_model::RichAlignment::End => "END",
        crate::rich_model::RichAlignment::Justified => "JUSTIFIED",
    }
}

fn paragraph_range_is_clear(
    doc: &RichDocument,
    paragraph_id: &crate::rich_model::RichNodeId,
    utf16_start: Utf16Offset,
    utf16_end: Utf16Offset,
) -> bool {
    if utf16_end.as_u32() <= utf16_start.as_u32() {
        return true;
    }
    let Some(paragraph) = find_paragraph(doc, paragraph_id) else {
        return false;
    };
    let mut consumed = 0_u32;
    let mut covered = 0_u32;
    for inline in &paragraph.inlines {
        let RichInline::TextRun(run) = inline else {
            continue;
        };
        let run_text = run.text.trim_end_matches('\n');
        let run_len = run_text.encode_utf16().count() as u32;
        let run_start = consumed;
        let run_end = consumed + run_len;
        consumed = run_end;
        if utf16_end.as_u32() <= run_start || utf16_start.as_u32() >= run_end {
            continue;
        }
        let overlap_start = utf16_start.as_u32().max(run_start);
        let overlap_end = utf16_end.as_u32().min(run_end);
        if overlap_end > overlap_start {
            if run.style != RichStyle::default() {
                return false;
            }
            covered += overlap_end - overlap_start;
        }
    }
    covered == utf16_end.as_u32() - utf16_start.as_u32()
}

fn paragraph_text(paragraph: &RichParagraph) -> String {
    let mut text = String::new();
    for inline in &paragraph.inlines {
        if let RichInline::TextRun(run) = inline {
            text.push_str(run.text.trim_end_matches('\n'));
        }
    }
    text
}

fn find_paragraph<'a>(
    doc: &'a RichDocument,
    paragraph_id: &crate::rich_model::RichNodeId,
) -> Option<&'a RichParagraph> {
    for tab in &doc.tabs {
        if let Some(paragraph) = find_paragraph_in_tab(tab, paragraph_id) {
            return Some(paragraph);
        }
    }
    None
}

fn find_paragraph_in_tab<'a>(
    tab: &'a RichTab,
    paragraph_id: &crate::rich_model::RichNodeId,
) -> Option<&'a RichParagraph> {
    for block in &tab.body.blocks {
        if let Some(paragraph) = find_paragraph_in_block(block, paragraph_id) {
            return Some(paragraph);
        }
    }
    for child in &tab.child_tabs {
        if let Some(paragraph) = find_paragraph_in_tab(child, paragraph_id) {
            return Some(paragraph);
        }
    }
    None
}

fn find_paragraph_in_block<'a>(
    block: &'a RichBlock,
    paragraph_id: &crate::rich_model::RichNodeId,
) -> Option<&'a RichParagraph> {
    match block {
        RichBlock::Paragraph(paragraph) if paragraph.identity.local_id == *paragraph_id => {
            Some(paragraph)
        }
        RichBlock::Paragraph(_) => None,
        RichBlock::Table(table) => table
            .rows
            .iter()
            .flat_map(|row| row.cells.iter())
            .flat_map(|cell| cell.content.iter())
            .find_map(|inner| find_paragraph_in_block(inner, paragraph_id)),
        RichBlock::SectionBreak(_) | RichBlock::Unsupported(_) => None,
    }
}

fn table_count(doc: &RichDocument) -> usize {
    doc.tabs.iter().map(table_count_in_tab).sum()
}

fn table_count_in_tab(tab: &RichTab) -> usize {
    tab.body
        .blocks
        .iter()
        .map(table_count_in_block)
        .sum::<usize>()
        + tab.child_tabs.iter().map(table_count_in_tab).sum::<usize>()
}

fn table_count_in_block(block: &RichBlock) -> usize {
    match block {
        RichBlock::Table(table) => {
            1 + table
                .rows
                .iter()
                .flat_map(|row| row.cells.iter())
                .flat_map(|cell| cell.content.iter())
                .map(table_count_in_block)
                .sum::<usize>()
        }
        RichBlock::Paragraph(_) | RichBlock::SectionBreak(_) | RichBlock::Unsupported(_) => 0,
    }
}

fn table_with_dimensions_count(doc: &RichDocument, rows: u32, columns: u32) -> usize {
    doc.tabs
        .iter()
        .map(|tab| table_with_dimensions_count_in_tab(tab, rows, columns))
        .sum()
}

fn table_with_dimensions_count_in_tab(tab: &RichTab, rows: u32, columns: u32) -> usize {
    tab.body
        .blocks
        .iter()
        .map(|block| table_with_dimensions_count_in_block(block, rows, columns))
        .sum::<usize>()
        + tab
            .child_tabs
            .iter()
            .map(|child| table_with_dimensions_count_in_tab(child, rows, columns))
            .sum::<usize>()
}

fn table_with_dimensions_count_in_block(block: &RichBlock, rows: u32, columns: u32) -> usize {
    match block {
        RichBlock::Table(table) => {
            let here = usize::from(table.rows.len() as u32 == rows && table.columns == columns);
            here + table
                .rows
                .iter()
                .flat_map(|row| row.cells.iter())
                .flat_map(|cell| cell.content.iter())
                .map(|inner| table_with_dimensions_count_in_block(inner, rows, columns))
                .sum::<usize>()
        }
        RichBlock::Paragraph(_) | RichBlock::SectionBreak(_) | RichBlock::Unsupported(_) => 0,
    }
}

fn find_table<'a>(
    doc: &'a RichDocument,
    table_id: &crate::rich_model::RichNodeId,
) -> Option<&'a RichTable> {
    for tab in &doc.tabs {
        if let Some(table) = find_table_in_tab(tab, table_id) {
            return Some(table);
        }
    }
    None
}

fn find_table_in_tab<'a>(
    tab: &'a RichTab,
    table_id: &crate::rich_model::RichNodeId,
) -> Option<&'a RichTable> {
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

fn find_table_in_block<'a>(
    block: &'a RichBlock,
    table_id: &crate::rich_model::RichNodeId,
) -> Option<&'a RichTable> {
    let RichBlock::Table(table) = block else {
        return None;
    };
    if table.identity.local_id == *table_id {
        return Some(table);
    }
    table
        .rows
        .iter()
        .flat_map(|row| row.cells.iter())
        .flat_map(|cell| cell.content.iter())
        .find_map(|inner| find_table_in_block(inner, table_id))
}

fn find_table_cell<'a>(
    doc: &'a RichDocument,
    table_id: &crate::rich_model::RichNodeId,
    row_index: u32,
    column_index: u32,
) -> Option<&'a crate::rich_model::RichTableCell> {
    find_table(doc, table_id)?
        .rows
        .get(row_index as usize)?
        .cells
        .get(column_index as usize)
}

fn dropped_named_ranges(before: &[RichNamedRange], after: &[RichNamedRange]) -> Vec<String> {
    let after_ids: std::collections::HashSet<&str> =
        after.iter().map(|r| r.range_id.as_str()).collect();
    before
        .iter()
        .filter(|r| !after_ids.contains(r.range_id.as_str()))
        .map(|r| r.range_id.clone())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::json::parse_json;
    use crate::rich_model::{
        RichAlignment, RichBlock, RichColor, RichInline, RichNamedStyle, RichNodeId,
        RichNodeIdentity, RichParagraph, RichParagraphStyle, RichRawJson, RichSegment,
        RichSourceKind, RichStyle, RichTab, RichTable, RichTableCell, RichTableRow, RichTextRun,
    };
    use std::collections::BTreeMap;

    fn ident(seed: &str) -> RichNodeIdentity {
        RichNodeIdentity::local_only(
            RichNodeId::synthetic(seed.to_string()),
            RichSourceKind::Body,
        )
    }

    fn make_doc_with(text: &str, revision: &str) -> RichDocument {
        let para = RichParagraph {
            identity: ident("p"),
            style: RichParagraphStyle::default(),
            list: None,
            inlines: vec![RichInline::TextRun(RichTextRun {
                identity: ident("r"),
                text: text.to_string(),
                style: RichStyle::default(),
            })],
            raw_extras: RichRawJson::empty(),
        };
        let mut doc = RichDocument::skeleton("d", "t");
        doc.revision.revision_id = revision.to_string();
        doc.tabs.push(RichTab {
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
        doc
    }

    fn append_table(doc: &mut RichDocument, table_id: RichNodeId, rows: u32, columns: u32) {
        doc.tabs[0].body.blocks.push(RichBlock::Table(RichTable {
            identity: RichNodeIdentity::local_only(table_id, RichSourceKind::TableCell),
            start_index: 10,
            rows: (0..rows)
                .map(|row| RichTableRow {
                    identity: ident(&format!("row-{row}")),
                    cells: (0..columns)
                        .map(|column| RichTableCell {
                            identity: ident(&format!("cell-{row}-{column}")),
                            content: Vec::new(),
                            row_span: 1,
                            column_span: 1,
                            raw_style: RichRawJson::empty(),
                        })
                        .collect(),
                    raw_style: RichRawJson::empty(),
                })
                .collect(),
            columns,
            raw_style: RichRawJson::empty(),
        }));
    }

    #[test]
    fn insert_text_verified_when_after_doc_contains_text() {
        let before = make_doc_with("hello", "rev1");
        let after = make_doc_with("hello world", "rev2");
        let report = validate(
            &before,
            &after,
            &[(
                "op-1".to_string(),
                RichOperation::InsertText {
                    paragraph_id: RichNodeId::synthetic("p"),
                    utf16_offset: Utf16Offset(5),
                    text: " world".to_string(),
                },
            )],
        );
        assert!(report.revision_advanced);
        assert!(matches!(
            report.operations[0],
            OperationOutcome::Verified { .. }
        ));
        assert!(report.all_clear);
    }

    #[test]
    fn insert_text_failed_when_text_missing() {
        let before = make_doc_with("hello", "rev1");
        let after = make_doc_with("hello", "rev2");
        let report = validate(
            &before,
            &after,
            &[(
                "op-1".to_string(),
                RichOperation::InsertText {
                    paragraph_id: RichNodeId::synthetic("p"),
                    utf16_offset: Utf16Offset(5),
                    text: "world".to_string(),
                },
            )],
        );
        assert!(matches!(
            report.operations[0],
            OperationOutcome::Failed { .. }
        ));
        assert!(!report.all_clear);
    }

    #[test]
    fn revision_unchanged_blocks_all_clear() {
        let before = make_doc_with("x", "rev1");
        let after = make_doc_with("x", "rev1");
        let report = validate(&before, &after, &[]);
        assert!(!report.revision_advanced);
        assert!(!report.all_clear);
    }

    #[test]
    fn dropped_named_range_surfaces_in_report() {
        let mut before = make_doc_with("x", "rev1");
        before.named_ranges.push(crate::rich_model::RichNamedRange {
            identity: ident("nr"),
            name: "comment".to_string(),
            range_id: "kix.abc".to_string(),
            anchor_text: "x".to_string(),
            start_index: 1,
            end_index: 2,
            source_tab_id: String::new(),
        });
        let after = make_doc_with("x", "rev2");
        let report = validate(&before, &after, &[]);
        assert_eq!(report.dropped_named_ranges, vec!["kix.abc".to_string()]);
        assert!(!report.all_clear);
    }

    #[test]
    fn remaining_v2_op_reports_unverified() {
        let before = make_doc_with("x", "rev1");
        let after = make_doc_with("x", "rev2");
        let report = validate(
            &before,
            &after,
            &[(
                "op-1".to_string(),
                RichOperation::CreateList {
                    paragraph_id: RichNodeId::synthetic("p"),
                    ordered: false,
                },
            )],
        );
        assert!(matches!(
            report.operations[0],
            OperationOutcome::Unverified { .. }
        ));
    }

    #[test]
    fn insert_table_checks_new_table_dimensions() {
        let before = make_doc_with("x", "rev1");
        let mut after = make_doc_with("x", "rev2");
        append_table(&mut after, RichNodeId::synthetic("table-1"), 2, 3);
        let report = validate(
            &before,
            &after,
            &[(
                "op-1".to_string(),
                RichOperation::InsertTable {
                    paragraph_id: RichNodeId::synthetic("p"),
                    rows: 2,
                    columns: 3,
                },
            )],
        );
        assert!(matches!(
            report.operations[0],
            OperationOutcome::Verified { .. }
        ));
    }

    #[test]
    fn delete_table_checks_table_absence() {
        let mut before = make_doc_with("x", "rev1");
        let after = make_doc_with("x", "rev2");
        let table_id = RichNodeId::synthetic("table-1");
        append_table(&mut before, table_id.clone(), 1, 1);
        let report = validate(
            &before,
            &after,
            &[("op-1".to_string(), RichOperation::DeleteTable { table_id })],
        );
        assert!(matches!(
            report.operations[0],
            OperationOutcome::Verified { .. }
        ));
    }

    #[test]
    fn table_shape_ops_check_row_and_column_counts() {
        let table_id = RichNodeId::synthetic("table-1");
        let mut before = make_doc_with("x", "rev1");
        append_table(&mut before, table_id.clone(), 2, 2);
        let mut after_row = make_doc_with("x", "rev2");
        append_table(&mut after_row, table_id.clone(), 3, 2);
        let report = validate(
            &before,
            &after_row,
            &[(
                "row".to_string(),
                RichOperation::InsertTableRow {
                    table_id: table_id.clone(),
                    row_index: 0,
                    insert_below: true,
                },
            )],
        );
        assert!(matches!(
            report.operations[0],
            OperationOutcome::Verified { .. }
        ));

        let mut after_column = make_doc_with("x", "rev3");
        append_table(&mut after_column, table_id.clone(), 2, 3);
        let report = validate(
            &before,
            &after_column,
            &[(
                "column".to_string(),
                RichOperation::InsertTableColumn {
                    table_id,
                    column_index: 0,
                    insert_right: true,
                },
            )],
        );
        assert!(matches!(
            report.operations[0],
            OperationOutcome::Verified { .. }
        ));
    }

    #[test]
    fn table_cell_style_checks_target_cell_raw_style() {
        let table_id = RichNodeId::synthetic("table-1");
        let mut before = make_doc_with("x", "rev1");
        append_table(&mut before, table_id.clone(), 1, 1);
        let mut after = make_doc_with("x", "rev2");
        append_table(&mut after, table_id.clone(), 1, 1);
        let RichBlock::Table(table) = after.tabs[0].body.blocks.last_mut().unwrap() else {
            panic!()
        };
        table.rows[0].cells[0].raw_style = RichRawJson::from_value(
            parse_json(
                r#"{"backgroundColor":{"color":{"rgbColor":{"red":1.0,"green":0.9,"blue":0.2}}}}"#,
            )
            .unwrap(),
        );
        let report = validate(
            &before,
            &after,
            &[(
                "cell-style".to_string(),
                RichOperation::SetTableCellStyle {
                    table_id,
                    row_index: 0,
                    column_index: 0,
                    row_span: 1,
                    column_span: 1,
                    delta: RichTableCellStyleDelta::background_color(Some(RichColor {
                        red: 1.0,
                        green: 0.9,
                        blue: 0.2,
                    })),
                },
            )],
        );
        assert!(matches!(
            report.operations[0],
            OperationOutcome::Verified { .. }
        ));
    }

    #[test]
    fn table_merge_and_unmerge_check_spans() {
        let table_id = RichNodeId::synthetic("table-1");
        let mut before = make_doc_with("x", "rev1");
        append_table(&mut before, table_id.clone(), 2, 2);

        let mut merged_after = make_doc_with("x", "rev2");
        append_table(&mut merged_after, table_id.clone(), 2, 2);
        let RichBlock::Table(table) = merged_after.tabs[0].body.blocks.last_mut().unwrap() else {
            panic!()
        };
        table.rows[0].cells[0].row_span = 2;
        table.rows[0].cells[0].column_span = 2;
        let report = validate(
            &before,
            &merged_after,
            &[(
                "merge".to_string(),
                RichOperation::MergeTableCells {
                    table_id: table_id.clone(),
                    row_index: 0,
                    column_index: 0,
                    row_span: 2,
                    column_span: 2,
                },
            )],
        );
        assert!(matches!(
            report.operations[0],
            OperationOutcome::Verified { .. }
        ));

        let mut unmerged_after = make_doc_with("x", "rev3");
        append_table(&mut unmerged_after, table_id.clone(), 2, 2);
        let report = validate(
            &before,
            &unmerged_after,
            &[(
                "unmerge".to_string(),
                RichOperation::UnmergeTableCells {
                    table_id,
                    row_index: 0,
                    column_index: 0,
                    row_span: 2,
                    column_span: 2,
                },
            )],
        );
        assert!(matches!(
            report.operations[0],
            OperationOutcome::Verified { .. }
        ));
    }

    #[test]
    fn delete_range_verified_when_original_text_is_gone_at_range() {
        let before = make_doc_with("hello world", "rev1");
        let after = make_doc_with("hello", "rev2");
        let report = validate(
            &before,
            &after,
            &[(
                "op-1".to_string(),
                RichOperation::DeleteRange {
                    paragraph_id: RichNodeId::synthetic("p"),
                    utf16_start: Utf16Offset(5),
                    utf16_end: Utf16Offset(11),
                },
            )],
        );
        assert!(matches!(
            report.operations[0],
            OperationOutcome::Verified { .. }
        ));
    }

    #[test]
    fn set_text_style_checks_exact_range() {
        let before = make_doc_with("hello world", "rev1");
        let mut after = make_doc_with("hello world", "rev2");
        let RichBlock::Paragraph(paragraph) = &mut after.tabs[0].body.blocks[0] else {
            panic!()
        };
        paragraph.inlines = vec![
            RichInline::TextRun(RichTextRun {
                identity: ident("r1"),
                text: "hello".to_string(),
                style: RichStyle {
                    bold: true,
                    ..RichStyle::default()
                },
            }),
            RichInline::TextRun(RichTextRun {
                identity: ident("r2"),
                text: " world".to_string(),
                style: RichStyle::default(),
            }),
        ];
        let report = validate(
            &before,
            &after,
            &[(
                "op-1".to_string(),
                RichOperation::SetTextStyle {
                    paragraph_id: RichNodeId::synthetic("p"),
                    utf16_start: Utf16Offset(0),
                    utf16_end: Utf16Offset(5),
                    delta: crate::rich_ops::RichStyleDelta::bold(true),
                },
            )],
        );
        assert!(matches!(
            report.operations[0],
            OperationOutcome::Verified { .. }
        ));
    }

    #[test]
    fn set_text_style_checks_font_and_colors() {
        let before = make_doc_with("hello", "rev1");
        let mut after = make_doc_with("hello", "rev2");
        let RichBlock::Paragraph(paragraph) = &mut after.tabs[0].body.blocks[0] else {
            panic!()
        };
        let RichInline::TextRun(run) = &mut paragraph.inlines[0] else {
            panic!()
        };
        run.style.font_family = Some("Times New Roman".to_string());
        run.style.font_size_pt = Some(16.0);
        run.style.foreground_color = Some(RichColor {
            red: 0.8,
            green: 0.1,
            blue: 0.1,
        });
        run.style.background_color = Some(RichColor {
            red: 1.0,
            green: 0.9,
            blue: 0.2,
        });
        let report = validate(
            &before,
            &after,
            &[(
                "op-1".to_string(),
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
                        background_color: Some(Some(RichColor {
                            red: 1.0,
                            green: 0.9,
                            blue: 0.2,
                        })),
                        ..RichStyleDelta::default()
                    },
                },
            )],
        );
        assert!(matches!(
            report.operations[0],
            OperationOutcome::Verified { .. }
        ));
    }

    #[test]
    fn clear_text_style_checks_exact_range() {
        let before = make_doc_with("hello world", "rev1");
        let mut after = make_doc_with("hello world", "rev2");
        let RichBlock::Paragraph(paragraph) = &mut after.tabs[0].body.blocks[0] else {
            panic!()
        };
        paragraph.inlines = vec![
            RichInline::TextRun(RichTextRun {
                identity: ident("r1"),
                text: "hello".to_string(),
                style: RichStyle::default(),
            }),
            RichInline::TextRun(RichTextRun {
                identity: ident("r2"),
                text: " world".to_string(),
                style: RichStyle {
                    bold: true,
                    ..RichStyle::default()
                },
            }),
        ];
        let report = validate(
            &before,
            &after,
            &[(
                "op-1".to_string(),
                RichOperation::ClearTextStyle {
                    paragraph_id: RichNodeId::synthetic("p"),
                    utf16_start: Utf16Offset(0),
                    utf16_end: Utf16Offset(5),
                },
            )],
        );
        assert!(matches!(
            report.operations[0],
            OperationOutcome::Verified { .. }
        ));
    }

    #[test]
    fn set_paragraph_named_style_checks_target_paragraph() {
        let before = make_doc_with("heading", "rev1");
        let mut after = make_doc_with("heading", "rev2");
        let RichBlock::Paragraph(paragraph) = &mut after.tabs[0].body.blocks[0] else {
            panic!()
        };
        paragraph.style.named_style = RichNamedStyle::Heading(2);
        let report = validate(
            &before,
            &after,
            &[(
                "op-1".to_string(),
                RichOperation::SetParagraphNamedStyle {
                    paragraph_id: RichNodeId::synthetic("p"),
                    named_style: RichNamedStyle::Heading(2),
                },
            )],
        );
        assert!(matches!(
            report.operations[0],
            OperationOutcome::Verified { .. }
        ));
    }

    #[test]
    fn set_paragraph_style_checks_target_paragraph() {
        let before = make_doc_with("heading", "rev1");
        let mut after = make_doc_with("heading", "rev2");
        let RichBlock::Paragraph(paragraph) = &mut after.tabs[0].body.blocks[0] else {
            panic!()
        };
        paragraph.style.alignment = Some(RichAlignment::Center);
        let report = validate(
            &before,
            &after,
            &[(
                "op-1".to_string(),
                RichOperation::SetParagraphStyle {
                    paragraph_id: RichNodeId::synthetic("p"),
                    delta: RichParagraphStyleDelta::alignment(RichAlignment::Center),
                },
            )],
        );
        assert!(matches!(
            report.operations[0],
            OperationOutcome::Verified { .. }
        ));
    }

    #[test]
    fn set_named_style_checks_named_styles() {
        let before = make_doc_with("heading", "rev1");
        let mut after = make_doc_with("heading", "rev2");
        after.named_styles = RichRawJson::from_value(
            parse_json(
                r#"{"styles":[{"namedStyleType":"HEADING_1","textStyle":{"bold":true},"paragraphStyle":{"alignment":"CENTER"}}]}"#,
            )
            .unwrap(),
        );
        let report = validate(
            &before,
            &after,
            &[(
                "op-1".to_string(),
                RichOperation::SetNamedStyle {
                    named_style: RichNamedStyle::Heading(1),
                    delta: RichNamedStyleDelta {
                        text_style: RichStyleDelta::bold(true),
                        paragraph_style: RichParagraphStyleDelta::alignment(RichAlignment::Center),
                    },
                },
            )],
        );
        assert!(matches!(
            report.operations[0],
            OperationOutcome::Verified { .. }
        ));
    }

    use crate::rich_index::Utf16Offset;
}
