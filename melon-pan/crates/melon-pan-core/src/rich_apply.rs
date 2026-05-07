//! Apply `RichOperation`s to a local `RichDocument`.
//!
//! Mutates the document in-place and returns an inverse operation when
//! one is computable; the caller stores the inverse for undo and for the
//! operation log so a crash mid-sync can be recovered without losing
//! intent.

use crate::json::JsonValue;
use crate::rich_index::{utf16_len, utf16_to_byte, Utf16Offset};
use crate::rich_model::{
    RichBlock, RichDocument, RichInline, RichInlineObject, RichInlineObjectKind,
    RichInlineObjectRef, RichListAnchor, RichNamedStyle, RichNodeId, RichNodeIdentity,
    RichParagraph, RichRawJson, RichSourceKind, RichStyle, RichTab, RichTable, RichTableCell,
    RichTableRow, RichTextRun,
};
use crate::rich_ops::{
    OperationError, RichNamedStyleDelta, RichOperation, RichParagraphStyleDelta, RichStyleDelta,
    RichTableBorderDashStyle, RichTableCellContentAlignment, RichTableCellStyleDelta,
};
use crate::sha256::stable_content_hash;
use std::collections::BTreeMap;

/// Apply `op` to `doc`, returning an inverse operation when one is
/// computable. The inverse is meant for undo and for tagging the
/// operation log entry; not all operations have a single-op inverse
/// (e.g. style toggles across mixed-style runs collapse), in which case
/// `None` is returned.
pub fn apply_operation(
    doc: &mut RichDocument,
    op: &RichOperation,
) -> Result<Option<RichOperation>, OperationError> {
    match op {
        RichOperation::InsertText {
            paragraph_id,
            utf16_offset,
            text,
        } => apply_insert_text(doc, paragraph_id, *utf16_offset, text),
        RichOperation::DeleteRange {
            paragraph_id,
            utf16_start,
            utf16_end,
        } => apply_delete_range(doc, paragraph_id, *utf16_start, *utf16_end),
        RichOperation::ReplaceRange {
            paragraph_id,
            utf16_start,
            utf16_end,
            text,
        } => apply_replace_range(doc, paragraph_id, *utf16_start, *utf16_end, text),
        RichOperation::SetTextStyle {
            paragraph_id,
            utf16_start,
            utf16_end,
            delta,
        } => apply_set_text_style(doc, paragraph_id, *utf16_start, *utf16_end, delta),
        RichOperation::ClearTextStyle {
            paragraph_id,
            utf16_start,
            utf16_end,
        } => apply_clear_text_style(doc, paragraph_id, *utf16_start, *utf16_end),
        RichOperation::SetParagraphNamedStyle {
            paragraph_id,
            named_style,
        } => apply_set_paragraph_named_style(doc, paragraph_id, *named_style),
        RichOperation::SetParagraphStyle {
            paragraph_id,
            delta,
        } => apply_set_paragraph_style(doc, paragraph_id, delta),
        RichOperation::SetNamedStyle { named_style, delta } => {
            apply_set_named_style(doc, *named_style, delta)
        }
        RichOperation::CreateLink {
            paragraph_id,
            utf16_start,
            utf16_end,
            url,
        } => apply_set_text_style(
            doc,
            paragraph_id,
            *utf16_start,
            *utf16_end,
            &RichStyleDelta::link(Some(url.clone())),
        ),
        RichOperation::DeleteLink {
            paragraph_id,
            utf16_start,
            utf16_end,
        } => apply_set_text_style(
            doc,
            paragraph_id,
            *utf16_start,
            *utf16_end,
            &RichStyleDelta::link(None),
        ),
        RichOperation::NoOpUnsupportedProtection { .. } => Ok(None),

        RichOperation::CreateList {
            paragraph_id,
            ordered,
        } => apply_create_list(doc, paragraph_id, *ordered),
        RichOperation::DeleteList { paragraph_id } => apply_delete_list(doc, paragraph_id),
        RichOperation::UpdateListNesting {
            paragraph_id,
            nesting_level,
        } => apply_update_list_nesting(doc, paragraph_id, *nesting_level),

        RichOperation::InsertTable {
            paragraph_id,
            rows,
            columns,
        } => apply_insert_table(doc, paragraph_id, *rows, *columns),
        RichOperation::DeleteTable { table_id } => apply_delete_table(doc, table_id),
        RichOperation::InsertTableRow {
            table_id,
            row_index,
            insert_below,
        } => apply_insert_table_row(doc, table_id, *row_index, *insert_below),
        RichOperation::DeleteTableRow {
            table_id,
            row_index,
        } => apply_delete_table_row(doc, table_id, *row_index),
        RichOperation::InsertTableColumn {
            table_id,
            column_index,
            insert_right,
        } => apply_insert_table_column(doc, table_id, *column_index, *insert_right),
        RichOperation::DeleteTableColumn {
            table_id,
            column_index,
        } => apply_delete_table_column(doc, table_id, *column_index),
        RichOperation::CancelOperation { .. } => Ok(None),
        RichOperation::SetTableCellStyle {
            table_id,
            row_index,
            column_index,
            row_span,
            column_span,
            delta,
        } => apply_set_table_cell_style(
            doc,
            table_id,
            *row_index,
            *column_index,
            *row_span,
            *column_span,
            delta,
        ),
        RichOperation::SetTableColumnWidth {
            table_id,
            column_index,
            width_pt,
        } => apply_set_table_column_width(doc, table_id, *column_index, *width_pt),
        RichOperation::SetTableRowMinHeight {
            table_id,
            row_index,
            min_height_pt,
        } => apply_set_table_row_min_height(doc, table_id, *row_index, *min_height_pt),
        RichOperation::MergeTableCells {
            table_id,
            row_index,
            column_index,
            row_span,
            column_span,
        } => apply_merge_table_cells(
            doc,
            table_id,
            *row_index,
            *column_index,
            *row_span,
            *column_span,
        ),
        RichOperation::UnmergeTableCells {
            table_id,
            row_index,
            column_index,
            row_span,
            column_span,
        } => apply_unmerge_table_cells(
            doc,
            table_id,
            *row_index,
            *column_index,
            *row_span,
            *column_span,
        ),
        RichOperation::InsertInlineImage {
            paragraph_id,
            utf16_offset,
            uri,
        } => apply_insert_inline_image(doc, paragraph_id, *utf16_offset, uri),
        RichOperation::DeleteInlineObject { object_id } => {
            apply_delete_inline_object(doc, object_id)
        }
        RichOperation::CreateHeader | RichOperation::CreateFooter => Ok(None),
        RichOperation::DeleteHeader { header_id } => {
            apply_delete_segment(doc, RichSourceKind::Header, header_id)
        }
        RichOperation::DeleteFooter { footer_id } => {
            apply_delete_segment(doc, RichSourceKind::Footer, footer_id)
        }
        RichOperation::CreateFootnote { .. } => Ok(None),
        RichOperation::DeleteFootnote { footnote_id } => apply_delete_footnote(doc, footnote_id),
    }
}

// ---- text mutations ----------------------------------------------------

fn apply_insert_text(
    doc: &mut RichDocument,
    paragraph_id: &RichNodeId,
    utf16_offset: Utf16Offset,
    text: &str,
) -> Result<Option<RichOperation>, OperationError> {
    let paragraph = find_paragraph_mut(doc, paragraph_id)?;
    let total = paragraph_utf16_len(paragraph);
    if utf16_offset.as_u32() > total {
        return Err(OperationError::OffsetOutOfRange {
            node_id: paragraph_id.as_str().to_string(),
            offset: utf16_offset.as_u32(),
            max: total,
        });
    }
    insert_into_paragraph(paragraph, utf16_offset, text)?;
    let insert_len = utf16_len(text);
    Ok(Some(RichOperation::DeleteRange {
        paragraph_id: paragraph_id.clone(),
        utf16_start: utf16_offset,
        utf16_end: Utf16Offset(utf16_offset.as_u32() + insert_len),
    }))
}

fn apply_delete_range(
    doc: &mut RichDocument,
    paragraph_id: &RichNodeId,
    utf16_start: Utf16Offset,
    utf16_end: Utf16Offset,
) -> Result<Option<RichOperation>, OperationError> {
    if utf16_end.as_u32() < utf16_start.as_u32() {
        return Err(OperationError::OffsetOutOfRange {
            node_id: paragraph_id.as_str().to_string(),
            offset: utf16_end.as_u32(),
            max: utf16_start.as_u32(),
        });
    }
    let paragraph = find_paragraph_mut(doc, paragraph_id)?;
    let total = paragraph_utf16_len(paragraph);
    if utf16_end.as_u32() > total {
        return Err(OperationError::OffsetOutOfRange {
            node_id: paragraph_id.as_str().to_string(),
            offset: utf16_end.as_u32(),
            max: total,
        });
    }
    let removed = delete_from_paragraph(paragraph, utf16_start, utf16_end)?;
    Ok(Some(RichOperation::InsertText {
        paragraph_id: paragraph_id.clone(),
        utf16_offset: utf16_start,
        text: removed,
    }))
}

fn apply_replace_range(
    doc: &mut RichDocument,
    paragraph_id: &RichNodeId,
    utf16_start: Utf16Offset,
    utf16_end: Utf16Offset,
    text: &str,
) -> Result<Option<RichOperation>, OperationError> {
    apply_delete_range(doc, paragraph_id, utf16_start, utf16_end)?;
    apply_insert_text(doc, paragraph_id, utf16_start, text)?;
    let new_end = Utf16Offset(utf16_start.as_u32() + utf16_len(text));
    Ok(Some(RichOperation::ReplaceRange {
        paragraph_id: paragraph_id.clone(),
        utf16_start,
        utf16_end: new_end,
        // Inverse text not preserved here — undo would need the original
        // range captured before apply. Editor stores its own undo entries.
        text: String::new(),
    }))
}

fn apply_set_text_style(
    doc: &mut RichDocument,
    paragraph_id: &RichNodeId,
    utf16_start: Utf16Offset,
    utf16_end: Utf16Offset,
    delta: &RichStyleDelta,
) -> Result<Option<RichOperation>, OperationError> {
    if delta.is_empty() {
        return Ok(None);
    }
    let paragraph = find_paragraph_mut(doc, paragraph_id)?;
    let total = paragraph_utf16_len(paragraph);
    if utf16_end.as_u32() > total || utf16_start.as_u32() > utf16_end.as_u32() {
        return Err(OperationError::OffsetOutOfRange {
            node_id: paragraph_id.as_str().to_string(),
            offset: utf16_end.as_u32(),
            max: total,
        });
    }
    style_paragraph_range(paragraph, utf16_start, utf16_end, delta)?;
    // Inverse style requires capturing the prior style values; left as
    // None for V1. Editor undo captures its own snapshots.
    Ok(None)
}

fn apply_clear_text_style(
    doc: &mut RichDocument,
    paragraph_id: &RichNodeId,
    utf16_start: Utf16Offset,
    utf16_end: Utf16Offset,
) -> Result<Option<RichOperation>, OperationError> {
    let paragraph = find_paragraph_mut(doc, paragraph_id)?;
    let total = paragraph_utf16_len(paragraph);
    if utf16_end.as_u32() > total || utf16_start.as_u32() > utf16_end.as_u32() {
        return Err(OperationError::OffsetOutOfRange {
            node_id: paragraph_id.as_str().to_string(),
            offset: utf16_end.as_u32(),
            max: total,
        });
    }
    clear_paragraph_range(paragraph, utf16_start, utf16_end)?;
    Ok(None)
}

fn apply_create_list(
    doc: &mut RichDocument,
    paragraph_id: &RichNodeId,
    ordered: bool,
) -> Result<Option<RichOperation>, OperationError> {
    let paragraph = find_paragraph_mut(doc, paragraph_id)?;
    let prior = paragraph.list.clone();
    // The Docs API assigns the list_id server-side via
    // createParagraphBullets; locally we mark the paragraph as belonging
    // to a synthetic list whose id is just the paragraph's local_id.
    // The compiler maps that to a bulletPreset; on re-pull, the new
    // server-assigned list_id replaces this synthetic placeholder.
    let synthetic_list_id = format!(
        "local-{}-{}",
        if ordered { "ord" } else { "unord" },
        paragraph_id.as_str()
    );
    paragraph.list = Some(RichListAnchor {
        list_id: synthetic_list_id,
        nesting_level: 0,
    });
    // Stash the "ordered" hint where the compiler can find it. We
    // co-opt RichStyle.raw_markdown style flag — no, that's not present
    // anymore. Instead, rich_batch examines the list_id prefix
    // ("local-ord-" vs "local-unord-") to pick the bulletPreset.
    Ok(Some(match prior {
        Some(_) => RichOperation::DeleteList {
            paragraph_id: paragraph_id.clone(),
        },
        None => RichOperation::DeleteList {
            paragraph_id: paragraph_id.clone(),
        },
    }))
}

fn apply_delete_list(
    doc: &mut RichDocument,
    paragraph_id: &RichNodeId,
) -> Result<Option<RichOperation>, OperationError> {
    let paragraph = find_paragraph_mut(doc, paragraph_id)?;
    let prior = paragraph.list.take();
    if let Some(anchor) = prior {
        // Inverse: re-create the list. ordered/unordered hint comes
        // from the prior list_id prefix.
        let ordered = anchor.list_id.starts_with("local-ord-");
        Ok(Some(RichOperation::CreateList {
            paragraph_id: paragraph_id.clone(),
            ordered,
        }))
    } else {
        Ok(None)
    }
}

fn apply_update_list_nesting(
    doc: &mut RichDocument,
    paragraph_id: &RichNodeId,
    nesting_level: u8,
) -> Result<Option<RichOperation>, OperationError> {
    let paragraph = find_paragraph_mut(doc, paragraph_id)?;
    let Some(anchor) = paragraph.list.as_mut() else {
        return Err(OperationError::WrongNodeKind {
            node_id: paragraph_id.as_str().to_string(),
            expected: "paragraph with list anchor",
        });
    };
    let prior = anchor.nesting_level;
    anchor.nesting_level = nesting_level;
    Ok(Some(RichOperation::UpdateListNesting {
        paragraph_id: paragraph_id.clone(),
        nesting_level: prior,
    }))
}

fn apply_insert_inline_image(
    doc: &mut RichDocument,
    paragraph_id: &RichNodeId,
    utf16_offset: Utf16Offset,
    uri: &str,
) -> Result<Option<RichOperation>, OperationError> {
    let paragraph = find_paragraph_mut(doc, paragraph_id)?;
    let total = paragraph_utf16_len(paragraph);
    if utf16_offset.as_u32() > total {
        return Err(OperationError::OffsetOutOfRange {
            node_id: paragraph_id.as_str().to_string(),
            offset: utf16_offset.as_u32(),
            max: total,
        });
    }

    let object_id = synthetic_inline_object_id(paragraph_id, utf16_offset, uri);
    insert_inline_object_ref(paragraph, utf16_offset, &object_id)?;
    doc.inline_objects.insert(
        object_id.clone(),
        RichInlineObject {
            identity: RichNodeIdentity::local_only(
                RichNodeId::synthetic(object_id.clone()),
                RichSourceKind::InlineObject,
            ),
            object_id: object_id.clone(),
            kind: RichInlineObjectKind::Image,
            alt_title: String::new(),
            alt_description: String::new(),
            content_uri: Some(uri.to_string()),
            raw: RichRawJson::empty(),
        },
    );

    Ok(Some(RichOperation::DeleteInlineObject { object_id }))
}

fn apply_delete_inline_object(
    doc: &mut RichDocument,
    object_id: &str,
) -> Result<Option<RichOperation>, OperationError> {
    let removed = remove_inline_object_refs(doc, object_id);
    let removed_catalog = doc.inline_objects.remove(object_id);
    if !removed && removed_catalog.is_none() {
        return Err(OperationError::NodeNotFound(object_id.to_string()));
    }
    Ok(None)
}

fn apply_delete_segment(
    doc: &mut RichDocument,
    kind: RichSourceKind,
    segment_id: &str,
) -> Result<Option<RichOperation>, OperationError> {
    for tab in &mut doc.tabs {
        let removed = match kind {
            RichSourceKind::Header => tab.headers.remove(segment_id).is_some(),
            RichSourceKind::Footer => tab.footers.remove(segment_id).is_some(),
            _ => false,
        };
        if removed {
            return Ok(None);
        }
    }
    Err(OperationError::NodeNotFound(segment_id.to_string()))
}

fn apply_delete_footnote(
    doc: &mut RichDocument,
    footnote_id: &str,
) -> Result<Option<RichOperation>, OperationError> {
    let mut removed = false;
    for tab in &mut doc.tabs {
        removed |= tab.footnotes.remove(footnote_id).is_some();
        remove_footnote_refs_from_segment(&mut tab.body, footnote_id);
        for segment in tab.headers.values_mut() {
            remove_footnote_refs_from_segment(segment, footnote_id);
        }
        for segment in tab.footers.values_mut() {
            remove_footnote_refs_from_segment(segment, footnote_id);
        }
    }
    if removed {
        Ok(None)
    } else {
        Err(OperationError::NodeNotFound(footnote_id.to_string()))
    }
}

fn remove_footnote_refs_from_segment(
    segment: &mut crate::rich_model::RichSegment,
    footnote_id: &str,
) {
    for block in &mut segment.blocks {
        match block {
            RichBlock::Paragraph(paragraph) => {
                paragraph.inlines.retain(|inline| {
                    !matches!(inline, RichInline::FootnoteRef(reference) if reference.footnote_id == footnote_id)
                });
            }
            RichBlock::Table(table) => {
                for row in &mut table.rows {
                    for cell in &mut row.cells {
                        for cell_block in &mut cell.content {
                            if let RichBlock::Paragraph(paragraph) = cell_block {
                                paragraph.inlines.retain(|inline| {
                                    !matches!(inline, RichInline::FootnoteRef(reference) if reference.footnote_id == footnote_id)
                                });
                            }
                        }
                    }
                }
            }
            RichBlock::SectionBreak(_) | RichBlock::Unsupported(_) => {}
        }
    }
}

fn apply_set_paragraph_named_style(
    doc: &mut RichDocument,
    paragraph_id: &RichNodeId,
    named_style: RichNamedStyle,
) -> Result<Option<RichOperation>, OperationError> {
    let paragraph = find_paragraph_mut(doc, paragraph_id)?;
    let prior = paragraph.style.named_style;
    paragraph.style.named_style = named_style;
    Ok(Some(RichOperation::SetParagraphNamedStyle {
        paragraph_id: paragraph_id.clone(),
        named_style: prior,
    }))
}

fn apply_set_paragraph_style(
    doc: &mut RichDocument,
    paragraph_id: &RichNodeId,
    delta: &RichParagraphStyleDelta,
) -> Result<Option<RichOperation>, OperationError> {
    if delta.is_empty() {
        return Ok(None);
    }
    let paragraph = find_paragraph_mut(doc, paragraph_id)?;
    let inverse_delta = RichParagraphStyleDelta {
        alignment: if delta.alignment.is_some() {
            paragraph.style.alignment
        } else {
            None
        },
        indent_start: if delta.indent_start.is_some() {
            paragraph.style.indent_start
        } else {
            None
        },
        indent_end: if delta.indent_end.is_some() {
            paragraph.style.indent_end
        } else {
            None
        },
        indent_first_line: if delta.indent_first_line.is_some() {
            paragraph.style.indent_first_line
        } else {
            None
        },
        line_spacing: if delta.line_spacing.is_some() {
            paragraph.style.line_spacing
        } else {
            None
        },
        space_above: if delta.space_above.is_some() {
            paragraph.style.space_above
        } else {
            None
        },
        space_below: if delta.space_below.is_some() {
            paragraph.style.space_below
        } else {
            None
        },
    };
    apply_paragraph_style_delta(&mut paragraph.style, delta);
    if inverse_delta.is_empty() {
        Ok(None)
    } else {
        Ok(Some(RichOperation::SetParagraphStyle {
            paragraph_id: paragraph_id.clone(),
            delta: inverse_delta,
        }))
    }
}

fn apply_set_named_style(
    doc: &mut RichDocument,
    named_style: RichNamedStyle,
    delta: &RichNamedStyleDelta,
) -> Result<Option<RichOperation>, OperationError> {
    if delta.is_empty() {
        return Ok(None);
    }
    apply_named_style_delta(&mut doc.named_styles, named_style, delta);
    Ok(None)
}

fn apply_insert_table(
    doc: &mut RichDocument,
    paragraph_id: &RichNodeId,
    rows: u32,
    columns: u32,
) -> Result<Option<RichOperation>, OperationError> {
    if rows == 0 || columns == 0 {
        return Err(OperationError::WrongNodeKind {
            node_id: paragraph_id.as_str().to_string(),
            expected: "positive table dimensions",
        });
    }
    for tab in &mut doc.tabs {
        if insert_table_in_tab(tab, paragraph_id, rows, columns)? {
            return Ok(None);
        }
    }
    Err(OperationError::NodeNotFound(
        paragraph_id.as_str().to_string(),
    ))
}

fn apply_delete_table(
    doc: &mut RichDocument,
    table_id: &RichNodeId,
) -> Result<Option<RichOperation>, OperationError> {
    for tab in &mut doc.tabs {
        if delete_table_in_tab(tab, table_id)? {
            return Ok(None);
        }
    }
    Err(OperationError::NodeNotFound(table_id.as_str().to_string()))
}

fn apply_insert_table_row(
    doc: &mut RichDocument,
    table_id: &RichNodeId,
    row_index: u32,
    insert_below: bool,
) -> Result<Option<RichOperation>, OperationError> {
    let table = find_table_mut(doc, table_id)?;
    if row_index as usize >= table.rows.len() {
        return Err(OperationError::OffsetOutOfRange {
            node_id: table_id.as_str().to_string(),
            offset: row_index,
            max: table.rows.len().saturating_sub(1) as u32,
        });
    }
    let insert_at = if insert_below {
        row_index as usize + 1
    } else {
        row_index as usize
    };
    table.rows.insert(
        insert_at,
        make_table_row(table_id, insert_at as u32, table.columns),
    );
    Ok(Some(RichOperation::DeleteTableRow {
        table_id: table_id.clone(),
        row_index: insert_at as u32,
    }))
}

fn apply_delete_table_row(
    doc: &mut RichDocument,
    table_id: &RichNodeId,
    row_index: u32,
) -> Result<Option<RichOperation>, OperationError> {
    let table = find_table_mut(doc, table_id)?;
    if row_index as usize >= table.rows.len() {
        return Err(OperationError::OffsetOutOfRange {
            node_id: table_id.as_str().to_string(),
            offset: row_index,
            max: table.rows.len().saturating_sub(1) as u32,
        });
    }
    table.rows.remove(row_index as usize);
    Ok(None)
}

fn apply_insert_table_column(
    doc: &mut RichDocument,
    table_id: &RichNodeId,
    column_index: u32,
    insert_right: bool,
) -> Result<Option<RichOperation>, OperationError> {
    let table = find_table_mut(doc, table_id)?;
    if column_index >= table.columns {
        return Err(OperationError::OffsetOutOfRange {
            node_id: table_id.as_str().to_string(),
            offset: column_index,
            max: table.columns.saturating_sub(1),
        });
    }
    let insert_at = if insert_right {
        column_index + 1
    } else {
        column_index
    };
    for (row_index, row) in table.rows.iter_mut().enumerate() {
        row.cells.insert(
            insert_at as usize,
            make_table_cell(table_id, row_index as u32, insert_at),
        );
    }
    table.columns = table.columns.saturating_add(1);
    Ok(Some(RichOperation::DeleteTableColumn {
        table_id: table_id.clone(),
        column_index: insert_at,
    }))
}

fn apply_delete_table_column(
    doc: &mut RichDocument,
    table_id: &RichNodeId,
    column_index: u32,
) -> Result<Option<RichOperation>, OperationError> {
    let table = find_table_mut(doc, table_id)?;
    if column_index >= table.columns {
        return Err(OperationError::OffsetOutOfRange {
            node_id: table_id.as_str().to_string(),
            offset: column_index,
            max: table.columns.saturating_sub(1),
        });
    }
    for row in &mut table.rows {
        if column_index as usize >= row.cells.len() {
            return Err(OperationError::OffsetOutOfRange {
                node_id: table_id.as_str().to_string(),
                offset: column_index,
                max: row.cells.len().saturating_sub(1) as u32,
            });
        }
        row.cells.remove(column_index as usize);
    }
    table.columns = table.columns.saturating_sub(1);
    Ok(None)
}

fn apply_set_table_cell_style(
    doc: &mut RichDocument,
    table_id: &RichNodeId,
    row_index: u32,
    column_index: u32,
    row_span: u32,
    column_span: u32,
    delta: &RichTableCellStyleDelta,
) -> Result<Option<RichOperation>, OperationError> {
    if delta.is_empty() {
        return Ok(None);
    }
    let table = find_table_mut(doc, table_id)?;
    validate_table_range(
        table,
        table_id,
        row_index,
        column_index,
        row_span,
        column_span,
    )?;
    for row in row_index..row_index + row_span {
        for column in column_index..column_index + column_span {
            let cell = table_cell_mut(table, table_id, row, column)?;
            apply_table_cell_style_delta(&mut cell.raw_style, delta);
        }
    }
    Ok(None)
}

fn apply_set_table_column_width(
    doc: &mut RichDocument,
    table_id: &RichNodeId,
    column_index: u32,
    width_pt: f32,
) -> Result<Option<RichOperation>, OperationError> {
    let table = find_table_mut(doc, table_id)?;
    if column_index >= table.columns {
        return Err(OperationError::OffsetOutOfRange {
            node_id: table_id.as_str().to_string(),
            offset: column_index,
            max: table.columns.saturating_sub(1),
        });
    }
    let root = raw_json_object(&mut table.raw_style);
    let widths = root
        .entry("melonPanColumnWidths".to_string())
        .or_insert_with(|| JsonValue::Object(BTreeMap::new()));
    let JsonValue::Object(widths) = widths else {
        *widths = JsonValue::Object(BTreeMap::new());
        let JsonValue::Object(widths) = widths else {
            return Ok(None);
        };
        widths.insert(column_index.to_string(), dimension_pt(width_pt));
        return Ok(None);
    };
    widths.insert(column_index.to_string(), dimension_pt(width_pt));
    Ok(None)
}

fn apply_set_table_row_min_height(
    doc: &mut RichDocument,
    table_id: &RichNodeId,
    row_index: u32,
    min_height_pt: f32,
) -> Result<Option<RichOperation>, OperationError> {
    let table = find_table_mut(doc, table_id)?;
    let Some(row) = table.rows.get_mut(row_index as usize) else {
        return Err(OperationError::OffsetOutOfRange {
            node_id: table_id.as_str().to_string(),
            offset: row_index,
            max: table.rows.len().saturating_sub(1) as u32,
        });
    };
    raw_json_object(&mut row.raw_style)
        .insert("minRowHeight".to_string(), dimension_pt(min_height_pt));
    Ok(None)
}

fn apply_merge_table_cells(
    doc: &mut RichDocument,
    table_id: &RichNodeId,
    row_index: u32,
    column_index: u32,
    row_span: u32,
    column_span: u32,
) -> Result<Option<RichOperation>, OperationError> {
    let table = find_table_mut(doc, table_id)?;
    validate_table_range(
        table,
        table_id,
        row_index,
        column_index,
        row_span,
        column_span,
    )?;
    let head = table_cell_mut(table, table_id, row_index, column_index)?;
    head.row_span = row_span.max(1);
    head.column_span = column_span.max(1);
    Ok(Some(RichOperation::UnmergeTableCells {
        table_id: table_id.clone(),
        row_index,
        column_index,
        row_span,
        column_span,
    }))
}

fn apply_unmerge_table_cells(
    doc: &mut RichDocument,
    table_id: &RichNodeId,
    row_index: u32,
    column_index: u32,
    row_span: u32,
    column_span: u32,
) -> Result<Option<RichOperation>, OperationError> {
    let table = find_table_mut(doc, table_id)?;
    validate_table_range(
        table,
        table_id,
        row_index,
        column_index,
        row_span,
        column_span,
    )?;
    for row in row_index..row_index + row_span {
        for column in column_index..column_index + column_span {
            let cell = table_cell_mut(table, table_id, row, column)?;
            cell.row_span = 1;
            cell.column_span = 1;
        }
    }
    Ok(None)
}

// ---- helpers -----------------------------------------------------------

fn validate_table_range(
    table: &RichTable,
    table_id: &RichNodeId,
    row_index: u32,
    column_index: u32,
    row_span: u32,
    column_span: u32,
) -> Result<(), OperationError> {
    if row_span == 0 || column_span == 0 {
        return Err(OperationError::WrongNodeKind {
            node_id: table_id.as_str().to_string(),
            expected: "positive table range",
        });
    }
    let row_end = row_index.saturating_add(row_span);
    if row_end as usize > table.rows.len() {
        return Err(OperationError::OffsetOutOfRange {
            node_id: table_id.as_str().to_string(),
            offset: row_end,
            max: table.rows.len() as u32,
        });
    }
    let column_end = column_index.saturating_add(column_span);
    if column_end > table.columns {
        return Err(OperationError::OffsetOutOfRange {
            node_id: table_id.as_str().to_string(),
            offset: column_end,
            max: table.columns,
        });
    }
    Ok(())
}

fn table_cell_mut<'a>(
    table: &'a mut RichTable,
    table_id: &RichNodeId,
    row_index: u32,
    column_index: u32,
) -> Result<&'a mut RichTableCell, OperationError> {
    let max = table.rows.len().max(table.columns as usize) as u32;
    let Some(row) = table.rows.get_mut(row_index as usize) else {
        return Err(OperationError::OffsetOutOfRange {
            node_id: table_id.as_str().to_string(),
            offset: row_index,
            max,
        });
    };
    row.cells
        .get_mut(column_index as usize)
        .ok_or_else(|| OperationError::OffsetOutOfRange {
            node_id: table_id.as_str().to_string(),
            offset: column_index,
            max,
        })
}

fn apply_table_cell_style_delta(raw_style: &mut RichRawJson, delta: &RichTableCellStyleDelta) {
    let root = raw_style
        .0
        .get_or_insert_with(|| JsonValue::Object(BTreeMap::new()));
    let JsonValue::Object(fields) = root else {
        *root = JsonValue::Object(BTreeMap::new());
        let JsonValue::Object(fields) = root else {
            return;
        };
        return apply_table_cell_style_fields(fields, delta);
    };
    apply_table_cell_style_fields(fields, delta);
}

fn apply_table_cell_style_fields(
    fields: &mut BTreeMap<String, JsonValue>,
    delta: &RichTableCellStyleDelta,
) {
    if let Some(color) = delta.background_color {
        match color {
            Some(color) => {
                let mut rgb = BTreeMap::new();
                rgb.insert("red".to_string(), JsonValue::Number(color.red.to_string()));
                rgb.insert(
                    "green".to_string(),
                    JsonValue::Number(color.green.to_string()),
                );
                rgb.insert(
                    "blue".to_string(),
                    JsonValue::Number(color.blue.to_string()),
                );
                let mut color_fields = BTreeMap::new();
                color_fields.insert("rgbColor".to_string(), JsonValue::Object(rgb));
                let mut optional_color = BTreeMap::new();
                optional_color.insert("color".to_string(), JsonValue::Object(color_fields));
                fields.insert(
                    "backgroundColor".to_string(),
                    JsonValue::Object(optional_color),
                );
            }
            None => {
                fields.remove("backgroundColor");
            }
        }
    }
    if let Some(width) = delta.border_width_pt {
        for key in ["borderTop", "borderBottom", "borderLeft", "borderRight"] {
            match width {
                Some(width) => {
                    fields.insert(
                        key.to_string(),
                        table_cell_border(
                            width,
                            delta.border_color.flatten(),
                            delta.border_dash_style.flatten(),
                        ),
                    );
                }
                None => {
                    fields.remove(key);
                }
            }
        }
    }
    for (value, key) in [
        (delta.border_top_width_pt, "borderTop"),
        (delta.border_right_width_pt, "borderRight"),
        (delta.border_bottom_width_pt, "borderBottom"),
        (delta.border_left_width_pt, "borderLeft"),
    ] {
        if let Some(width) = value {
            match width {
                Some(width) => {
                    fields.insert(
                        key.to_string(),
                        table_cell_border(
                            width,
                            delta.border_color.flatten(),
                            delta.border_dash_style.flatten(),
                        ),
                    );
                }
                None => {
                    fields.remove(key);
                }
            }
        }
    }
    if delta.border_color.is_some() || delta.border_dash_style.is_some() {
        let color = delta.border_color.flatten();
        let dash_style = delta.border_dash_style.flatten();
        let width = delta.border_width_pt.flatten().unwrap_or(1.0);
        for key in ["borderTop", "borderBottom", "borderLeft", "borderRight"] {
            fields.insert(key.to_string(), table_cell_border(width, color, dash_style));
        }
    }
    if let Some(padding) = delta.padding_pt {
        for key in ["paddingTop", "paddingBottom", "paddingLeft", "paddingRight"] {
            match padding {
                Some(padding) => {
                    fields.insert(key.to_string(), dimension_pt(padding));
                }
                None => {
                    fields.remove(key);
                }
            }
        }
    }
    if let Some(alignment) = delta.content_alignment {
        match alignment {
            Some(alignment) => {
                fields.insert(
                    "contentAlignment".to_string(),
                    JsonValue::String(table_content_alignment_label(alignment).to_string()),
                );
            }
            None => {
                fields.remove("contentAlignment");
            }
        }
    }
}

fn table_cell_border(
    width_pt: f32,
    color: Option<crate::rich_model::RichColor>,
    dash_style: Option<RichTableBorderDashStyle>,
) -> JsonValue {
    let mut border = BTreeMap::new();
    border.insert("width".to_string(), dimension_pt(width_pt));
    border.insert(
        "dashStyle".to_string(),
        JsonValue::String(
            table_border_dash_style_label(dash_style.unwrap_or(RichTableBorderDashStyle::Solid))
                .to_string(),
        ),
    );

    let color = color.unwrap_or(crate::rich_model::RichColor {
        red: 0.0,
        green: 0.0,
        blue: 0.0,
    });
    let mut rgb = BTreeMap::new();
    rgb.insert("red".to_string(), JsonValue::Number(color.red.to_string()));
    rgb.insert(
        "green".to_string(),
        JsonValue::Number(color.green.to_string()),
    );
    rgb.insert(
        "blue".to_string(),
        JsonValue::Number(color.blue.to_string()),
    );
    let mut color = BTreeMap::new();
    color.insert("rgbColor".to_string(), JsonValue::Object(rgb));
    border.insert("color".to_string(), JsonValue::Object(color));

    JsonValue::Object(border)
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

fn raw_json_object(raw: &mut RichRawJson) -> &mut BTreeMap<String, JsonValue> {
    let root = raw
        .0
        .get_or_insert_with(|| JsonValue::Object(BTreeMap::new()));
    if !matches!(root, JsonValue::Object(_)) {
        *root = JsonValue::Object(BTreeMap::new());
    }
    let JsonValue::Object(fields) = root else {
        unreachable!("raw JSON root was forced to an object")
    };
    fields
}

fn dimension_pt(value: f32) -> JsonValue {
    let mut dimension = BTreeMap::new();
    dimension.insert(
        "magnitude".to_string(),
        JsonValue::Number(value.to_string()),
    );
    dimension.insert("unit".to_string(), JsonValue::String("PT".to_string()));
    JsonValue::Object(dimension)
}

fn insert_table_in_tab(
    tab: &mut RichTab,
    paragraph_id: &RichNodeId,
    rows: u32,
    columns: u32,
) -> Result<bool, OperationError> {
    for index in 0..tab.body.blocks.len() {
        match &tab.body.blocks[index] {
            RichBlock::Paragraph(paragraph) if paragraph.identity.local_id == *paragraph_id => {
                let table = make_table(
                    paragraph_id,
                    rows,
                    columns,
                    tab.body.blocks.len().saturating_add(index),
                );
                tab.body.blocks.insert(index + 1, RichBlock::Table(table));
                return Ok(true);
            }
            RichBlock::Unsupported(unsupported)
                if unsupported.identity.local_id == *paragraph_id =>
            {
                return Err(OperationError::ProtectedNode(
                    paragraph_id.as_str().to_string(),
                ));
            }
            _ => {}
        }
    }
    for child in &mut tab.child_tabs {
        if insert_table_in_tab(child, paragraph_id, rows, columns)? {
            return Ok(true);
        }
    }
    Ok(false)
}

fn delete_table_in_tab(tab: &mut RichTab, table_id: &RichNodeId) -> Result<bool, OperationError> {
    if let Some(index) = tab.body.blocks.iter().position(
        |block| matches!(block, RichBlock::Table(table) if table.identity.local_id == *table_id),
    ) {
        tab.body.blocks.remove(index);
        return Ok(true);
    }
    for block in &mut tab.body.blocks {
        if delete_table_in_block(block, table_id)? {
            return Ok(true);
        }
    }
    for child in &mut tab.child_tabs {
        if delete_table_in_tab(child, table_id)? {
            return Ok(true);
        }
    }
    Ok(false)
}

fn delete_table_in_block(
    block: &mut RichBlock,
    table_id: &RichNodeId,
) -> Result<bool, OperationError> {
    let RichBlock::Table(table) = block else {
        return Ok(false);
    };
    for row in &mut table.rows {
        for cell in &mut row.cells {
            if let Some(index) = cell.content.iter().position(|inner| {
                matches!(inner, RichBlock::Table(table) if table.identity.local_id == *table_id)
            }) {
                cell.content.remove(index);
                return Ok(true);
            }
            for inner in &mut cell.content {
                if delete_table_in_block(inner, table_id)? {
                    return Ok(true);
                }
            }
        }
    }
    Ok(false)
}

fn find_table_mut<'a>(
    doc: &'a mut RichDocument,
    table_id: &RichNodeId,
) -> Result<&'a mut RichTable, OperationError> {
    for tab in &mut doc.tabs {
        if let Some(table) = find_table_in_tab(tab, table_id) {
            return Ok(table);
        }
    }
    Err(OperationError::NodeNotFound(table_id.as_str().to_string()))
}

fn find_table_in_tab<'a>(tab: &'a mut RichTab, table_id: &RichNodeId) -> Option<&'a mut RichTable> {
    for block in &mut tab.body.blocks {
        if let Some(table) = find_table_in_block(block, table_id) {
            return Some(table);
        }
    }
    for child in &mut tab.child_tabs {
        if let Some(table) = find_table_in_tab(child, table_id) {
            return Some(table);
        }
    }
    None
}

fn find_table_in_block<'a>(
    block: &'a mut RichBlock,
    table_id: &RichNodeId,
) -> Option<&'a mut RichTable> {
    let RichBlock::Table(table) = block else {
        return None;
    };
    if table.identity.local_id == *table_id {
        return Some(table);
    }
    for row in &mut table.rows {
        for cell in &mut row.cells {
            for inner in &mut cell.content {
                if let Some(table) = find_table_in_block(inner, table_id) {
                    return Some(table);
                }
            }
        }
    }
    None
}

fn make_table(anchor_id: &RichNodeId, rows: u32, columns: u32, ordinal: usize) -> RichTable {
    let table_id = RichNodeId::synthetic(format!(
        "local-table-{}-{ordinal}-{rows}x{columns}",
        anchor_id.as_str()
    ));
    RichTable {
        identity: RichNodeIdentity::local_only(table_id.clone(), RichSourceKind::TableCell),
        start_index: 0,
        rows: (0..rows)
            .map(|row_index| make_table_row(&table_id, row_index, columns))
            .collect(),
        columns,
        raw_style: RichRawJson::empty(),
    }
}

fn make_table_row(table_id: &RichNodeId, row_index: u32, columns: u32) -> RichTableRow {
    RichTableRow {
        identity: RichNodeIdentity::local_only(
            RichNodeId::synthetic(format!("{}-row-{row_index}", table_id.as_str())),
            RichSourceKind::TableCell,
        ),
        cells: (0..columns)
            .map(|column_index| make_table_cell(table_id, row_index, column_index))
            .collect(),
        raw_style: RichRawJson::empty(),
    }
}

fn make_table_cell(table_id: &RichNodeId, row_index: u32, column_index: u32) -> RichTableCell {
    let cell_id = RichNodeId::synthetic(format!(
        "{}-r{row_index}-c{column_index}",
        table_id.as_str()
    ));
    RichTableCell {
        identity: RichNodeIdentity::local_only(cell_id.clone(), RichSourceKind::TableCell),
        content: vec![RichBlock::Paragraph(RichParagraph {
            identity: RichNodeIdentity::local_only(
                RichNodeId::synthetic(format!("{}-paragraph", cell_id.as_str())),
                RichSourceKind::TableCell,
            ),
            style: crate::rich_model::RichParagraphStyle::default(),
            list: None,
            inlines: Vec::new(),
            raw_extras: RichRawJson::empty(),
        })],
        row_span: 1,
        column_span: 1,
        raw_style: RichRawJson::empty(),
    }
}

fn find_paragraph_mut<'a>(
    doc: &'a mut RichDocument,
    paragraph_id: &RichNodeId,
) -> Result<&'a mut RichParagraph, OperationError> {
    for tab in &mut doc.tabs {
        if let Some(p) = find_paragraph_in_tab(tab, paragraph_id)? {
            return Ok(p);
        }
    }
    Err(OperationError::NodeNotFound(
        paragraph_id.as_str().to_string(),
    ))
}

fn find_paragraph_in_tab<'a>(
    tab: &'a mut RichTab,
    paragraph_id: &RichNodeId,
) -> Result<Option<&'a mut RichParagraph>, OperationError> {
    for block in &mut tab.body.blocks {
        if let Some(p) = find_paragraph_in_block(block, paragraph_id)? {
            return Ok(Some(p));
        }
    }
    for segment in tab.headers.values_mut() {
        for block in &mut segment.blocks {
            if let Some(p) = find_paragraph_in_block(block, paragraph_id)? {
                return Ok(Some(p));
            }
        }
    }
    for segment in tab.footers.values_mut() {
        for block in &mut segment.blocks {
            if let Some(p) = find_paragraph_in_block(block, paragraph_id)? {
                return Ok(Some(p));
            }
        }
    }
    for segment in tab.footnotes.values_mut() {
        for block in &mut segment.blocks {
            if let Some(p) = find_paragraph_in_block(block, paragraph_id)? {
                return Ok(Some(p));
            }
        }
    }
    for child in &mut tab.child_tabs {
        if let Some(p) = find_paragraph_in_tab(child, paragraph_id)? {
            return Ok(Some(p));
        }
    }
    Ok(None)
}

fn find_paragraph_in_block<'a>(
    block: &'a mut RichBlock,
    paragraph_id: &RichNodeId,
) -> Result<Option<&'a mut RichParagraph>, OperationError> {
    match block {
        RichBlock::Paragraph(p) if p.identity.local_id == *paragraph_id => Ok(Some(p)),
        RichBlock::Paragraph(_) => Ok(None),
        RichBlock::Table(table) => {
            for row in &mut table.rows {
                for cell in &mut row.cells {
                    for inner in &mut cell.content {
                        if let Some(p) = find_paragraph_in_block(inner, paragraph_id)? {
                            return Ok(Some(p));
                        }
                    }
                }
            }
            Ok(None)
        }
        RichBlock::Unsupported(unsupported) if unsupported.identity.local_id == *paragraph_id => {
            Err(OperationError::ProtectedNode(
                paragraph_id.as_str().to_string(),
            ))
        }
        RichBlock::SectionBreak(_) | RichBlock::Unsupported(_) => Ok(None),
    }
}

fn paragraph_utf16_len(paragraph: &RichParagraph) -> u32 {
    let mut total = 0_u32;
    for inline in &paragraph.inlines {
        total = total.saturating_add(inline_utf16_len(inline));
    }
    total
}

fn inline_utf16_len(inline: &RichInline) -> u32 {
    match inline {
        RichInline::TextRun(run) => utf16_len(run.text.trim_end_matches('\n')),
        RichInline::InlineObjectRef(_) => 1,
        _ => 0,
    }
}

/// Insert `text` at `utf16_offset` inside the paragraph, splitting the
/// affected text run if the offset is mid-run. Inline object refs count
/// as one UTF-16 position so NSTextAttachment caret math stays aligned
/// with Docs indexes.
fn insert_into_paragraph(
    paragraph: &mut RichParagraph,
    utf16_offset: Utf16Offset,
    text: &str,
) -> Result<(), OperationError> {
    let target = utf16_offset.as_u32();
    let mut consumed = 0_u32;
    for index in 0..paragraph.inlines.len() {
        if let RichInline::TextRun(run) = &paragraph.inlines[index] {
            let run_len = utf16_len(run.text.trim_end_matches('\n'));
            if target <= consumed + run_len {
                let local = target - consumed;
                let byte = utf16_to_byte(run.text.trim_end_matches('\n'), Utf16Offset(local))
                    .map_err(|e| OperationError::Index(format!("{:?}", e)))?;
                let trailing_newline = run.text.ends_with('\n');
                let RichInline::TextRun(run_mut) = &mut paragraph.inlines[index] else {
                    unreachable!();
                };
                let stripped: String = if trailing_newline {
                    run_mut.text[..run_mut.text.len() - 1].to_string()
                } else {
                    run_mut.text.clone()
                };
                let mut combined = String::with_capacity(stripped.len() + text.len() + 1);
                combined.push_str(&stripped[..byte.as_usize()]);
                combined.push_str(text);
                combined.push_str(&stripped[byte.as_usize()..]);
                if trailing_newline {
                    combined.push('\n');
                }
                run_mut.text = combined;
                return Ok(());
            }
            consumed += run_len;
        } else if matches!(paragraph.inlines[index], RichInline::InlineObjectRef(_)) {
            if target == consumed {
                paragraph.inlines.insert(
                    index,
                    RichInline::TextRun(RichTextRun {
                        identity: paragraph.identity.clone(),
                        text: text.to_string(),
                        style: RichStyle::default(),
                    }),
                );
                return Ok(());
            }
            consumed = consumed.saturating_add(1);
            if target == consumed {
                paragraph.inlines.insert(
                    index + 1,
                    RichInline::TextRun(RichTextRun {
                        identity: paragraph.identity.clone(),
                        text: text.to_string(),
                        style: RichStyle::default(),
                    }),
                );
                return Ok(());
            }
        }
    }
    if target == consumed {
        // Paragraph empty or insertion at end past last text run — append
        // a new run carrying the text.
        let identity = paragraph.identity.clone();
        paragraph.inlines.push(RichInline::TextRun(RichTextRun {
            identity,
            text: text.to_string(),
            style: RichStyle::default(),
        }));
        return Ok(());
    }
    Err(OperationError::OffsetOutOfRange {
        node_id: paragraph.identity.local_id.as_str().to_string(),
        offset: target,
        max: consumed,
    })
}

fn insert_inline_object_ref(
    paragraph: &mut RichParagraph,
    utf16_offset: Utf16Offset,
    object_id: &str,
) -> Result<(), OperationError> {
    let target = utf16_offset.as_u32();
    let mut consumed = 0_u32;
    let inline = RichInline::InlineObjectRef(RichInlineObjectRef {
        identity: RichNodeIdentity::local_only(
            RichNodeId::synthetic(format!("local-inline-ref-{object_id}")),
            RichSourceKind::InlineObject,
        ),
        object_id: object_id.to_string(),
    });

    for index in 0..paragraph.inlines.len() {
        match &paragraph.inlines[index] {
            RichInline::TextRun(run) => {
                let run_len = utf16_len(run.text.trim_end_matches('\n'));
                if target <= consumed + run_len {
                    let local = target - consumed;
                    let byte = utf16_to_byte(run.text.trim_end_matches('\n'), Utf16Offset(local))
                        .map_err(|e| OperationError::Index(format!("{:?}", e)))?;
                    let trailing_newline = run.text.ends_with('\n');
                    let stripped = if trailing_newline {
                        run.text[..run.text.len() - 1].to_string()
                    } else {
                        run.text.clone()
                    };
                    let prefix = stripped[..byte.as_usize()].to_string();
                    let suffix = stripped[byte.as_usize()..].to_string();
                    let style = run.style.clone();
                    let identity = run.identity.clone();
                    paragraph.inlines.remove(index);
                    let mut inserts = Vec::new();
                    if !prefix.is_empty() {
                        inserts.push(RichInline::TextRun(RichTextRun {
                            identity: identity.clone(),
                            text: prefix,
                            style: style.clone(),
                        }));
                    }
                    inserts.push(inline.clone());
                    if !suffix.is_empty() || trailing_newline {
                        let mut suffix_text = suffix;
                        if trailing_newline {
                            suffix_text.push('\n');
                        }
                        inserts.push(RichInline::TextRun(RichTextRun {
                            identity,
                            text: suffix_text,
                            style,
                        }));
                    }
                    for (offset, item) in inserts.into_iter().enumerate() {
                        paragraph.inlines.insert(index + offset, item);
                    }
                    return Ok(());
                }
                consumed += run_len;
            }
            RichInline::InlineObjectRef(_) => {
                if target == consumed {
                    paragraph.inlines.insert(index, inline.clone());
                    return Ok(());
                }
                consumed = consumed.saturating_add(1);
                if target == consumed {
                    paragraph.inlines.insert(index + 1, inline.clone());
                    return Ok(());
                }
            }
            _ => {}
        }
    }

    if target == consumed {
        paragraph.inlines.push(inline);
        return Ok(());
    }
    Err(OperationError::OffsetOutOfRange {
        node_id: paragraph.identity.local_id.as_str().to_string(),
        offset: target,
        max: consumed,
    })
}

/// Delete `[start, end)` inside the paragraph and return the removed text.
/// Spans across multiple text runs in the same paragraph.
fn delete_from_paragraph(
    paragraph: &mut RichParagraph,
    utf16_start: Utf16Offset,
    utf16_end: Utf16Offset,
) -> Result<String, OperationError> {
    let target_start = utf16_start.as_u32();
    let target_end = utf16_end.as_u32();
    let mut removed = String::new();
    let mut consumed = 0_u32;
    let mut index = 0;
    while index < paragraph.inlines.len() {
        let RichInline::TextRun(run) = &paragraph.inlines[index] else {
            if let RichInline::InlineObjectRef(_) = &paragraph.inlines[index] {
                let run_start = consumed;
                let run_end = consumed + 1;
                if target_start <= run_start && target_end >= run_end {
                    removed.push('\u{fffc}');
                    paragraph.inlines.remove(index);
                    consumed = run_end;
                    continue;
                }
                consumed = run_end;
            }
            index += 1;
            continue;
        };
        let trailing_newline = run.text.ends_with('\n');
        let stripped: String = if trailing_newline {
            run.text[..run.text.len() - 1].to_string()
        } else {
            run.text.clone()
        };
        let run_len = utf16_len(&stripped);
        let run_start = consumed;
        let run_end = consumed + run_len;
        if target_end <= run_start || target_start >= run_end {
            consumed = run_end;
            index += 1;
            continue;
        }
        // Overlap range inside this run: [local_start, local_end).
        let local_start = target_start.saturating_sub(run_start).min(run_len);
        let local_end = target_end.saturating_sub(run_start).min(run_len);
        let byte_start = utf16_to_byte(&stripped, Utf16Offset(local_start))
            .map_err(|e| OperationError::Index(format!("{:?}", e)))?;
        let byte_end = utf16_to_byte(&stripped, Utf16Offset(local_end))
            .map_err(|e| OperationError::Index(format!("{:?}", e)))?;
        removed.push_str(&stripped[byte_start.as_usize()..byte_end.as_usize()]);
        let mut new_text =
            String::with_capacity(stripped.len() - (byte_end.as_usize() - byte_start.as_usize()));
        new_text.push_str(&stripped[..byte_start.as_usize()]);
        new_text.push_str(&stripped[byte_end.as_usize()..]);
        if trailing_newline {
            new_text.push('\n');
        }
        if new_text.is_empty() || new_text == "\n" {
            // If the run is fully consumed (only newline left or empty),
            // drop it from the paragraph — empty text runs would otherwise
            // confuse the editor's caret math.
            paragraph.inlines.remove(index);
            consumed = run_end;
            // Don't increment index — next inline shifted into this slot.
            continue;
        }
        let RichInline::TextRun(run_mut) = &mut paragraph.inlines[index] else {
            unreachable!();
        };
        run_mut.text = new_text;
        consumed = run_end;
        index += 1;
    }
    Ok(removed)
}

fn remove_inline_object_refs(doc: &mut RichDocument, object_id: &str) -> bool {
    let mut removed = false;
    for tab in &mut doc.tabs {
        removed |= remove_inline_object_refs_from_tab(tab, object_id);
    }
    removed
}

fn remove_inline_object_refs_from_tab(tab: &mut RichTab, object_id: &str) -> bool {
    let mut removed = false;
    for block in &mut tab.body.blocks {
        removed |= remove_inline_object_refs_from_block(block, object_id);
    }
    for child in &mut tab.child_tabs {
        removed |= remove_inline_object_refs_from_tab(child, object_id);
    }
    removed
}

fn remove_inline_object_refs_from_block(block: &mut RichBlock, object_id: &str) -> bool {
    match block {
        RichBlock::Paragraph(paragraph) => {
            let before = paragraph.inlines.len();
            paragraph.inlines.retain(|inline| {
                !matches!(inline, RichInline::InlineObjectRef(obj) if obj.object_id == object_id)
            });
            before != paragraph.inlines.len()
        }
        RichBlock::Table(table) => {
            let mut removed = false;
            for row in &mut table.rows {
                for cell in &mut row.cells {
                    for inner in &mut cell.content {
                        removed |= remove_inline_object_refs_from_block(inner, object_id);
                    }
                }
            }
            removed
        }
        RichBlock::SectionBreak(_) | RichBlock::Unsupported(_) => false,
    }
}

fn synthetic_inline_object_id(
    paragraph_id: &RichNodeId,
    utf16_offset: Utf16Offset,
    uri: &str,
) -> String {
    let hash = stable_content_hash(&format!(
        "{}:{}:{}",
        paragraph_id.as_str(),
        utf16_offset.as_u32(),
        uri
    ));
    format!("local-image-{}", &hash[..16])
}

/// Apply a style delta to text runs overlapping `[start, end)`. Splits
/// runs at boundaries so the styled span ends up as its own run.
fn style_paragraph_range(
    paragraph: &mut RichParagraph,
    utf16_start: Utf16Offset,
    utf16_end: Utf16Offset,
    delta: &RichStyleDelta,
) -> Result<(), OperationError> {
    let target_start = utf16_start.as_u32();
    let target_end = utf16_end.as_u32();
    if target_end <= target_start {
        return Ok(());
    }
    let mut consumed = 0_u32;
    let mut new_inlines: Vec<RichInline> = Vec::with_capacity(paragraph.inlines.len() + 2);
    for inline in paragraph.inlines.drain(..) {
        let RichInline::TextRun(run) = inline else {
            if matches!(inline, RichInline::InlineObjectRef(_)) {
                consumed = consumed.saturating_add(1);
            }
            new_inlines.push(inline);
            continue;
        };
        let trailing_newline = run.text.ends_with('\n');
        let stripped = if trailing_newline {
            run.text[..run.text.len() - 1].to_string()
        } else {
            run.text.clone()
        };
        let run_len = utf16_len(&stripped);
        let run_start = consumed;
        let run_end = consumed + run_len;
        consumed = run_end;
        if target_end <= run_start || target_start >= run_end {
            new_inlines.push(RichInline::TextRun(run));
            continue;
        }
        let local_start = target_start.saturating_sub(run_start).min(run_len);
        let local_end = target_end.saturating_sub(run_start).min(run_len);
        let byte_start = utf16_to_byte(&stripped, Utf16Offset(local_start))
            .map_err(|e| OperationError::Index(format!("{:?}", e)))?;
        let byte_end = utf16_to_byte(&stripped, Utf16Offset(local_end))
            .map_err(|e| OperationError::Index(format!("{:?}", e)))?;
        let prefix_text = &stripped[..byte_start.as_usize()];
        let middle_text = &stripped[byte_start.as_usize()..byte_end.as_usize()];
        let suffix_text = &stripped[byte_end.as_usize()..];
        if !prefix_text.is_empty() {
            new_inlines.push(RichInline::TextRun(RichTextRun {
                identity: run.identity.clone(),
                text: prefix_text.to_string(),
                style: run.style.clone(),
            }));
        }
        let mut new_style = run.style.clone();
        apply_delta_to_style(&mut new_style, delta);
        let middle_with_newline = if suffix_text.is_empty() && trailing_newline {
            format!("{middle_text}\n")
        } else {
            middle_text.to_string()
        };
        if !middle_text.is_empty() {
            new_inlines.push(RichInline::TextRun(RichTextRun {
                identity: run.identity.clone(),
                text: middle_with_newline,
                style: new_style,
            }));
        }
        if !suffix_text.is_empty() {
            let suffix_with_newline = if trailing_newline {
                format!("{suffix_text}\n")
            } else {
                suffix_text.to_string()
            };
            new_inlines.push(RichInline::TextRun(RichTextRun {
                identity: run.identity.clone(),
                text: suffix_with_newline,
                style: run.style.clone(),
            }));
        }
    }
    paragraph.inlines = new_inlines;
    Ok(())
}

fn clear_paragraph_range(
    paragraph: &mut RichParagraph,
    utf16_start: Utf16Offset,
    utf16_end: Utf16Offset,
) -> Result<(), OperationError> {
    let target_start = utf16_start.as_u32();
    let target_end = utf16_end.as_u32();
    if target_end <= target_start {
        return Ok(());
    }
    let mut consumed = 0_u32;
    let mut new_inlines: Vec<RichInline> = Vec::with_capacity(paragraph.inlines.len() + 2);
    for inline in paragraph.inlines.drain(..) {
        let RichInline::TextRun(run) = inline else {
            new_inlines.push(inline);
            continue;
        };
        let trailing_newline = run.text.ends_with('\n');
        let stripped = if trailing_newline {
            run.text[..run.text.len() - 1].to_string()
        } else {
            run.text.clone()
        };
        let run_len = utf16_len(&stripped);
        let run_start = consumed;
        let run_end = consumed + run_len;
        consumed = run_end;
        if target_end <= run_start || target_start >= run_end {
            new_inlines.push(RichInline::TextRun(run));
            continue;
        }
        let local_start = target_start.saturating_sub(run_start).min(run_len);
        let local_end = target_end.saturating_sub(run_start).min(run_len);
        let byte_start = utf16_to_byte(&stripped, Utf16Offset(local_start))
            .map_err(|e| OperationError::Index(format!("{:?}", e)))?;
        let byte_end = utf16_to_byte(&stripped, Utf16Offset(local_end))
            .map_err(|e| OperationError::Index(format!("{:?}", e)))?;
        let prefix_text = &stripped[..byte_start.as_usize()];
        let middle_text = &stripped[byte_start.as_usize()..byte_end.as_usize()];
        let suffix_text = &stripped[byte_end.as_usize()..];
        if !prefix_text.is_empty() {
            new_inlines.push(RichInline::TextRun(RichTextRun {
                identity: run.identity.clone(),
                text: prefix_text.to_string(),
                style: run.style.clone(),
            }));
        }
        let middle_with_newline = if suffix_text.is_empty() && trailing_newline {
            format!("{middle_text}\n")
        } else {
            middle_text.to_string()
        };
        if !middle_text.is_empty() {
            new_inlines.push(RichInline::TextRun(RichTextRun {
                identity: run.identity.clone(),
                text: middle_with_newline,
                style: RichStyle::default(),
            }));
        }
        if !suffix_text.is_empty() {
            let suffix_with_newline = if trailing_newline {
                format!("{suffix_text}\n")
            } else {
                suffix_text.to_string()
            };
            new_inlines.push(RichInline::TextRun(RichTextRun {
                identity: run.identity.clone(),
                text: suffix_with_newline,
                style: run.style.clone(),
            }));
        }
    }
    paragraph.inlines = new_inlines;
    Ok(())
}

fn apply_delta_to_style(style: &mut RichStyle, delta: &RichStyleDelta) {
    if let Some(value) = delta.bold {
        style.bold = value;
    }
    if let Some(value) = delta.italic {
        style.italic = value;
    }
    if let Some(value) = delta.underline {
        style.underline = value;
    }
    if let Some(value) = delta.strikethrough {
        style.strikethrough = value;
    }
    if let Some(value) = &delta.font_family {
        style.font_family = value.clone();
    }
    if let Some(value) = delta.font_size_pt {
        style.font_size_pt = value;
    }
    if let Some(value) = delta.foreground_color {
        style.foreground_color = value;
    }
    if let Some(value) = delta.background_color {
        style.background_color = value;
    }
    if let Some(link) = &delta.link_url {
        style.link_url = link.clone();
    }
}

fn apply_paragraph_style_delta(
    style: &mut crate::rich_model::RichParagraphStyle,
    delta: &RichParagraphStyleDelta,
) {
    if let Some(value) = delta.alignment {
        style.alignment = Some(value);
    }
    if let Some(value) = delta.indent_start {
        style.indent_start = Some(value);
    }
    if let Some(value) = delta.indent_end {
        style.indent_end = Some(value);
    }
    if let Some(value) = delta.indent_first_line {
        style.indent_first_line = Some(value);
    }
    if let Some(value) = delta.line_spacing {
        style.line_spacing = Some(value);
    }
    if let Some(value) = delta.space_above {
        style.space_above = Some(value);
    }
    if let Some(value) = delta.space_below {
        style.space_below = Some(value);
    }
}

fn apply_named_style_delta(
    named_styles: &mut RichRawJson,
    named_style: RichNamedStyle,
    delta: &RichNamedStyleDelta,
) {
    let root = named_styles
        .0
        .get_or_insert_with(|| JsonValue::Object(BTreeMap::new()));
    let JsonValue::Object(root_fields) = root else {
        *root = JsonValue::Object(BTreeMap::new());
        let JsonValue::Object(root_fields) = root else {
            return;
        };
        return apply_named_style_delta_to_fields(root_fields, named_style, delta);
    };
    apply_named_style_delta_to_fields(root_fields, named_style, delta);
}

fn apply_named_style_delta_to_fields(
    root_fields: &mut BTreeMap<String, JsonValue>,
    named_style: RichNamedStyle,
    delta: &RichNamedStyleDelta,
) {
    let styles = root_fields
        .entry("styles".to_string())
        .or_insert_with(|| JsonValue::Array(Vec::new()));
    let JsonValue::Array(styles) = styles else {
        *styles = JsonValue::Array(Vec::new());
        let JsonValue::Array(styles) = styles else {
            return;
        };
        return apply_named_style_delta_to_array(styles, named_style, delta);
    };
    apply_named_style_delta_to_array(styles, named_style, delta);
}

fn apply_named_style_delta_to_array(
    styles: &mut Vec<JsonValue>,
    named_style: RichNamedStyle,
    delta: &RichNamedStyleDelta,
) {
    let style_type = named_style_to_docs_string(named_style);
    let index = styles.iter().position(|style| {
        style
            .get("namedStyleType")
            .and_then(JsonValue::as_str)
            .is_some_and(|value| value == style_type)
    });
    let index = match index {
        Some(index) => index,
        None => {
            let mut fields = BTreeMap::new();
            fields.insert(
                "namedStyleType".to_string(),
                JsonValue::String(style_type.clone()),
            );
            styles.push(JsonValue::Object(fields));
            styles.len() - 1
        }
    };
    let JsonValue::Object(style_fields) = &mut styles[index] else {
        let mut fields = BTreeMap::new();
        fields.insert(
            "namedStyleType".to_string(),
            JsonValue::String(style_type.clone()),
        );
        styles[index] = JsonValue::Object(fields);
        let JsonValue::Object(style_fields) = &mut styles[index] else {
            return;
        };
        return apply_named_style_fields(style_fields, delta);
    };
    style_fields.insert("namedStyleType".to_string(), JsonValue::String(style_type));
    apply_named_style_fields(style_fields, delta);
}

fn apply_named_style_fields(
    style_fields: &mut BTreeMap<String, JsonValue>,
    delta: &RichNamedStyleDelta,
) {
    if !delta.text_style.is_empty() {
        let text_style = style_fields
            .entry("textStyle".to_string())
            .or_insert_with(|| JsonValue::Object(BTreeMap::new()));
        apply_text_style_delta_to_json(text_style, &delta.text_style);
    }
    if !delta.paragraph_style.is_empty() {
        let paragraph_style = style_fields
            .entry("paragraphStyle".to_string())
            .or_insert_with(|| JsonValue::Object(BTreeMap::new()));
        apply_paragraph_style_delta_to_json(paragraph_style, &delta.paragraph_style);
    }
}

fn apply_text_style_delta_to_json(value: &mut JsonValue, delta: &RichStyleDelta) {
    let JsonValue::Object(fields) = value else {
        *value = JsonValue::Object(BTreeMap::new());
        let JsonValue::Object(fields) = value else {
            return;
        };
        return apply_text_style_delta_to_fields(fields, delta);
    };
    apply_text_style_delta_to_fields(fields, delta);
}

fn apply_text_style_delta_to_fields(
    fields: &mut BTreeMap<String, JsonValue>,
    delta: &RichStyleDelta,
) {
    if let Some(value) = delta.bold {
        fields.insert("bold".to_string(), JsonValue::Bool(value));
    }
    if let Some(value) = delta.italic {
        fields.insert("italic".to_string(), JsonValue::Bool(value));
    }
    if let Some(value) = delta.underline {
        fields.insert("underline".to_string(), JsonValue::Bool(value));
    }
    if let Some(value) = delta.strikethrough {
        fields.insert("strikethrough".to_string(), JsonValue::Bool(value));
    }
    if let Some(font_family) = &delta.font_family {
        match font_family {
            Some(font_family) => {
                let mut weighted = BTreeMap::new();
                weighted.insert(
                    "fontFamily".to_string(),
                    JsonValue::String(font_family.clone()),
                );
                fields.insert(
                    "weightedFontFamily".to_string(),
                    JsonValue::Object(weighted),
                );
            }
            None => {
                fields.remove("weightedFontFamily");
            }
        }
    }
    if let Some(font_size) = delta.font_size_pt {
        match font_size {
            Some(font_size) => {
                let mut dimension = BTreeMap::new();
                dimension.insert(
                    "magnitude".to_string(),
                    JsonValue::Number(font_size.to_string()),
                );
                dimension.insert("unit".to_string(), JsonValue::String("PT".to_string()));
                fields.insert("fontSize".to_string(), JsonValue::Object(dimension));
            }
            None => {
                fields.remove("fontSize");
            }
        }
    }
    if let Some(color) = delta.foreground_color {
        match color {
            Some(color) => {
                fields.insert("foregroundColor".to_string(), color_to_optional_json(color));
            }
            None => {
                fields.remove("foregroundColor");
            }
        }
    }
    if let Some(color) = delta.background_color {
        match color {
            Some(color) => {
                fields.insert("backgroundColor".to_string(), color_to_optional_json(color));
            }
            None => {
                fields.remove("backgroundColor");
            }
        }
    }
    if let Some(link) = &delta.link_url {
        match link {
            Some(url) => {
                let mut link_fields = BTreeMap::new();
                link_fields.insert("url".to_string(), JsonValue::String(url.clone()));
                fields.insert("link".to_string(), JsonValue::Object(link_fields));
            }
            None => {
                fields.insert("link".to_string(), JsonValue::Null);
            }
        }
    }
}

fn color_to_optional_json(color: crate::rich_model::RichColor) -> JsonValue {
    let mut rgb = BTreeMap::new();
    rgb.insert("red".to_string(), JsonValue::Number(color.red.to_string()));
    rgb.insert(
        "green".to_string(),
        JsonValue::Number(color.green.to_string()),
    );
    rgb.insert(
        "blue".to_string(),
        JsonValue::Number(color.blue.to_string()),
    );
    let mut color_fields = BTreeMap::new();
    color_fields.insert("rgbColor".to_string(), JsonValue::Object(rgb));
    let mut optional = BTreeMap::new();
    optional.insert("color".to_string(), JsonValue::Object(color_fields));
    JsonValue::Object(optional)
}

fn apply_paragraph_style_delta_to_json(value: &mut JsonValue, delta: &RichParagraphStyleDelta) {
    let JsonValue::Object(fields) = value else {
        *value = JsonValue::Object(BTreeMap::new());
        let JsonValue::Object(fields) = value else {
            return;
        };
        return apply_paragraph_style_delta_to_fields(fields, delta);
    };
    apply_paragraph_style_delta_to_fields(fields, delta);
}

fn apply_paragraph_style_delta_to_fields(
    fields: &mut BTreeMap<String, JsonValue>,
    delta: &RichParagraphStyleDelta,
) {
    if let Some(value) = delta.alignment {
        fields.insert(
            "alignment".to_string(),
            JsonValue::String(alignment_to_docs_string(value).to_string()),
        );
    }
    insert_dimension(fields, "indentStart", delta.indent_start);
    insert_dimension(fields, "indentEnd", delta.indent_end);
    insert_dimension(fields, "indentFirstLine", delta.indent_first_line);
    if let Some(value) = delta.line_spacing {
        fields.insert(
            "lineSpacing".to_string(),
            JsonValue::Number(value.to_string()),
        );
    }
    insert_dimension(fields, "spaceAbove", delta.space_above);
    insert_dimension(fields, "spaceBelow", delta.space_below);
}

fn insert_dimension(fields: &mut BTreeMap<String, JsonValue>, key: &str, value: Option<f32>) {
    if let Some(value) = value {
        let mut dimension = BTreeMap::new();
        dimension.insert(
            "magnitude".to_string(),
            JsonValue::Number(value.to_string()),
        );
        dimension.insert("unit".to_string(), JsonValue::String("PT".to_string()));
        fields.insert(key.to_string(), JsonValue::Object(dimension));
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::json::JsonValue;
    use crate::rich_model::{
        RichAlignment, RichBlock, RichColor, RichInline, RichNamedStyle, RichNodeId,
        RichNodeIdentity, RichParagraphStyle, RichRawJson, RichSegment, RichSourceKind, RichStyle,
        RichTab, RichTextRun, RichUnsupported,
    };
    use std::collections::BTreeMap;

    fn ident(seed: &str) -> RichNodeIdentity {
        RichNodeIdentity::local_only(
            RichNodeId::synthetic(seed.to_string()),
            RichSourceKind::Body,
        )
    }

    fn make_doc_with_paragraph(text: &str) -> (RichDocument, RichNodeId) {
        let para_id = RichNodeId::synthetic("para-1");
        let para = RichParagraph {
            identity: RichNodeIdentity::local_only(para_id.clone(), RichSourceKind::Body),
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
        (doc, para_id)
    }

    fn paragraph_text(doc: &RichDocument) -> String {
        let RichBlock::Paragraph(p) = &doc.tabs[0].body.blocks[0] else {
            panic!()
        };
        let mut out = String::new();
        for inline in &p.inlines {
            if let RichInline::TextRun(run) = inline {
                out.push_str(&run.text);
            }
        }
        out
    }

    #[test]
    fn insert_text_at_start_prepends() {
        let (mut doc, id) = make_doc_with_paragraph("world");
        let inverse = apply_operation(
            &mut doc,
            &RichOperation::InsertText {
                paragraph_id: id.clone(),
                utf16_offset: Utf16Offset(0),
                text: "hello ".to_string(),
            },
        )
        .unwrap();
        assert_eq!(paragraph_text(&doc), "hello world");
        assert!(matches!(
            inverse.unwrap(),
            RichOperation::DeleteRange {
                utf16_start: Utf16Offset(0),
                utf16_end: Utf16Offset(6),
                ..
            }
        ));
    }

    #[test]
    fn insert_text_in_middle_splits_run() {
        let (mut doc, id) = make_doc_with_paragraph("helloworld");
        apply_operation(
            &mut doc,
            &RichOperation::InsertText {
                paragraph_id: id,
                utf16_offset: Utf16Offset(5),
                text: " ".to_string(),
            },
        )
        .unwrap();
        assert_eq!(paragraph_text(&doc), "hello world");
    }

    #[test]
    fn delete_range_removes_substring_and_returns_inverse_insert() {
        let (mut doc, id) = make_doc_with_paragraph("hello world");
        let inverse = apply_operation(
            &mut doc,
            &RichOperation::DeleteRange {
                paragraph_id: id.clone(),
                utf16_start: Utf16Offset(5),
                utf16_end: Utf16Offset(11),
            },
        )
        .unwrap();
        assert_eq!(paragraph_text(&doc), "hello");
        match inverse.unwrap() {
            RichOperation::InsertText {
                utf16_offset, text, ..
            } => {
                assert_eq!(utf16_offset, Utf16Offset(5));
                assert_eq!(text, " world");
            }
            _ => panic!(),
        }
    }

    #[test]
    fn set_text_style_splits_run_with_bold_middle() {
        let (mut doc, id) = make_doc_with_paragraph("hello world");
        apply_operation(
            &mut doc,
            &RichOperation::SetTextStyle {
                paragraph_id: id,
                utf16_start: Utf16Offset(0),
                utf16_end: Utf16Offset(5),
                delta: RichStyleDelta::bold(true),
            },
        )
        .unwrap();
        let RichBlock::Paragraph(p) = &doc.tabs[0].body.blocks[0] else {
            panic!()
        };
        assert_eq!(p.inlines.len(), 2);
        let RichInline::TextRun(first) = &p.inlines[0] else {
            panic!()
        };
        let RichInline::TextRun(second) = &p.inlines[1] else {
            panic!()
        };
        assert_eq!(first.text, "hello");
        assert!(first.style.bold);
        assert_eq!(second.text, " world");
        assert!(!second.style.bold);
    }

    #[test]
    fn set_text_style_updates_font_and_colors() {
        let (mut doc, id) = make_doc_with_paragraph("hello");
        apply_operation(
            &mut doc,
            &RichOperation::SetTextStyle {
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
        )
        .unwrap();
        let RichBlock::Paragraph(p) = &doc.tabs[0].body.blocks[0] else {
            panic!()
        };
        let RichInline::TextRun(run) = &p.inlines[0] else {
            panic!()
        };
        assert_eq!(run.style.font_family.as_deref(), Some("Times New Roman"));
        assert_eq!(run.style.font_size_pt, Some(16.0));
        assert_eq!(
            run.style.foreground_color,
            Some(RichColor {
                red: 0.8,
                green: 0.1,
                blue: 0.1,
            })
        );
        assert_eq!(
            run.style.background_color,
            Some(RichColor {
                red: 1.0,
                green: 0.9,
                blue: 0.2,
            })
        );
    }

    #[test]
    fn clear_text_style_resets_target_range_only() {
        let (mut doc, id) = make_doc_with_paragraph("hello world");
        apply_operation(
            &mut doc,
            &RichOperation::SetTextStyle {
                paragraph_id: id.clone(),
                utf16_start: Utf16Offset(0),
                utf16_end: Utf16Offset(11),
                delta: RichStyleDelta {
                    bold: Some(true),
                    italic: Some(true),
                    underline: Some(true),
                    strikethrough: None,
                    link_url: Some(Some("https://example.com".to_string())),
                    ..RichStyleDelta::default()
                },
            },
        )
        .unwrap();
        apply_operation(
            &mut doc,
            &RichOperation::ClearTextStyle {
                paragraph_id: id,
                utf16_start: Utf16Offset(0),
                utf16_end: Utf16Offset(5),
            },
        )
        .unwrap();
        let RichBlock::Paragraph(p) = &doc.tabs[0].body.blocks[0] else {
            panic!()
        };
        assert_eq!(p.inlines.len(), 2);
        let RichInline::TextRun(first) = &p.inlines[0] else {
            panic!()
        };
        let RichInline::TextRun(second) = &p.inlines[1] else {
            panic!()
        };
        assert_eq!(first.text, "hello");
        assert_eq!(first.style, RichStyle::default());
        assert_eq!(second.text, " world");
        assert!(second.style.bold);
        assert!(second.style.italic);
        assert_eq!(
            second.style.link_url.as_deref(),
            Some("https://example.com")
        );
    }

    #[test]
    fn set_paragraph_named_style_returns_inverse_with_prior_style() {
        let (mut doc, id) = make_doc_with_paragraph("title");
        let inverse = apply_operation(
            &mut doc,
            &RichOperation::SetParagraphNamedStyle {
                paragraph_id: id,
                named_style: RichNamedStyle::Heading(1),
            },
        )
        .unwrap();
        let RichBlock::Paragraph(p) = &doc.tabs[0].body.blocks[0] else {
            panic!()
        };
        assert_eq!(p.style.named_style, RichNamedStyle::Heading(1));
        match inverse.unwrap() {
            RichOperation::SetParagraphNamedStyle { named_style, .. } => {
                assert_eq!(named_style, RichNamedStyle::NormalText);
            }
            _ => panic!(),
        }
    }

    #[test]
    fn create_link_round_trips_via_delete_link() {
        let (mut doc, id) = make_doc_with_paragraph("click me");
        apply_operation(
            &mut doc,
            &RichOperation::CreateLink {
                paragraph_id: id.clone(),
                utf16_start: Utf16Offset(0),
                utf16_end: Utf16Offset(5),
                url: "https://example.com".to_string(),
            },
        )
        .unwrap();
        let RichBlock::Paragraph(p) = &doc.tabs[0].body.blocks[0] else {
            panic!()
        };
        let RichInline::TextRun(first) = &p.inlines[0] else {
            panic!()
        };
        assert_eq!(first.style.link_url.as_deref(), Some("https://example.com"));
        apply_operation(
            &mut doc,
            &RichOperation::DeleteLink {
                paragraph_id: id,
                utf16_start: Utf16Offset(0),
                utf16_end: Utf16Offset(5),
            },
        )
        .unwrap();
        let RichBlock::Paragraph(p) = &doc.tabs[0].body.blocks[0] else {
            panic!()
        };
        let RichInline::TextRun(first) = &p.inlines[0] else {
            panic!()
        };
        assert!(first.style.link_url.is_none());
    }

    #[test]
    fn unsupported_block_address_returns_protected_node() {
        let protected_id = RichNodeId::synthetic("unsupported");
        let mut doc = RichDocument::skeleton("doc1", "T");
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
                blocks: vec![RichBlock::Unsupported(RichUnsupported {
                    identity: RichNodeIdentity::local_only(
                        protected_id.clone(),
                        RichSourceKind::Unknown,
                    ),
                    stable_anchor: "unsupported".to_string(),
                    description: "unsupported".to_string(),
                    raw: RichRawJson::empty(),
                })],
                style: RichRawJson::empty(),
            },
            headers: BTreeMap::new(),
            footers: BTreeMap::new(),
            footnotes: BTreeMap::new(),
            child_tabs: Vec::new(),
        });
        let err = apply_operation(
            &mut doc,
            &RichOperation::InsertText {
                paragraph_id: protected_id,
                utf16_offset: Utf16Offset(0),
                text: "x".to_string(),
            },
        )
        .unwrap_err();
        assert!(matches!(err, OperationError::ProtectedNode(_)));
    }

    #[test]
    fn missing_paragraph_id_returns_node_not_found() {
        let (mut doc, _) = make_doc_with_paragraph("x");
        let bogus = RichNodeId::synthetic("missing");
        let err = apply_operation(
            &mut doc,
            &RichOperation::InsertText {
                paragraph_id: bogus,
                utf16_offset: Utf16Offset(0),
                text: "y".to_string(),
            },
        )
        .unwrap_err();
        assert!(matches!(err, OperationError::NodeNotFound(_)));
    }

    #[test]
    fn create_list_attaches_anchor_with_ordered_prefix() {
        let (mut doc, id) = make_doc_with_paragraph("first item");
        apply_operation(
            &mut doc,
            &RichOperation::CreateList {
                paragraph_id: id.clone(),
                ordered: true,
            },
        )
        .unwrap();
        let RichBlock::Paragraph(p) = &doc.tabs[0].body.blocks[0] else {
            panic!()
        };
        let anchor = p.list.as_ref().expect("list anchor missing");
        assert!(anchor.list_id.starts_with("local-ord-"));

        apply_operation(&mut doc, &RichOperation::DeleteList { paragraph_id: id }).unwrap();
        let RichBlock::Paragraph(p) = &doc.tabs[0].body.blocks[0] else {
            panic!()
        };
        assert!(p.list.is_none());
    }

    #[test]
    fn set_paragraph_style_updates_alignment_only() {
        let (mut doc, id) = make_doc_with_paragraph("hello");
        apply_operation(
            &mut doc,
            &RichOperation::SetParagraphStyle {
                paragraph_id: id,
                delta: RichParagraphStyleDelta::alignment(RichAlignment::Center),
            },
        )
        .unwrap();
        let RichBlock::Paragraph(p) = &doc.tabs[0].body.blocks[0] else {
            panic!()
        };
        assert_eq!(p.style.alignment, Some(RichAlignment::Center));
        assert_eq!(p.style.named_style, RichNamedStyle::NormalText);
    }

    #[test]
    fn set_named_style_updates_raw_named_styles() {
        let (mut doc, _) = make_doc_with_paragraph("hello");
        apply_operation(
            &mut doc,
            &RichOperation::SetNamedStyle {
                named_style: RichNamedStyle::Heading(1),
                delta: RichNamedStyleDelta {
                    text_style: RichStyleDelta::bold(true),
                    paragraph_style: RichParagraphStyleDelta::alignment(RichAlignment::Center),
                },
            },
        )
        .unwrap();
        let styles = doc
            .named_styles
            .0
            .as_ref()
            .and_then(|value| value.get("styles"))
            .and_then(JsonValue::as_array)
            .expect("styles array");
        let heading = styles
            .iter()
            .find(|style| {
                style.get("namedStyleType").and_then(JsonValue::as_str) == Some("HEADING_1")
            })
            .expect("heading style");
        assert_eq!(
            heading
                .path(&["textStyle", "bold"])
                .and_then(JsonValue::as_bool),
            Some(true)
        );
        assert_eq!(
            heading
                .path(&["paragraphStyle", "alignment"])
                .and_then(JsonValue::as_str),
            Some("CENTER")
        );
    }

    #[test]
    fn insert_table_adds_empty_table_after_paragraph() {
        let (mut doc, id) = make_doc_with_paragraph("x");
        apply_operation(
            &mut doc,
            &RichOperation::InsertTable {
                paragraph_id: id,
                rows: 2,
                columns: 3,
            },
        )
        .unwrap();
        assert_eq!(doc.tabs[0].body.blocks.len(), 2);
        let RichBlock::Table(table) = &doc.tabs[0].body.blocks[1] else {
            panic!()
        };
        assert_eq!(table.rows.len(), 2);
        assert_eq!(table.columns, 3);
        assert_eq!(table.rows[0].cells.len(), 3);
        assert!(matches!(
            table.rows[0].cells[0].content.first(),
            Some(RichBlock::Paragraph(_))
        ));
    }

    #[test]
    fn table_row_and_column_ops_mutate_shape() {
        let (mut doc, id) = make_doc_with_paragraph("x");
        apply_operation(
            &mut doc,
            &RichOperation::InsertTable {
                paragraph_id: id,
                rows: 2,
                columns: 2,
            },
        )
        .unwrap();
        let table_id = match &doc.tabs[0].body.blocks[1] {
            RichBlock::Table(table) => table.identity.local_id.clone(),
            _ => panic!(),
        };
        apply_operation(
            &mut doc,
            &RichOperation::InsertTableRow {
                table_id: table_id.clone(),
                row_index: 0,
                insert_below: true,
            },
        )
        .unwrap();
        apply_operation(
            &mut doc,
            &RichOperation::InsertTableColumn {
                table_id: table_id.clone(),
                column_index: 0,
                insert_right: true,
            },
        )
        .unwrap();
        let RichBlock::Table(table) = &doc.tabs[0].body.blocks[1] else {
            panic!()
        };
        assert_eq!(table.rows.len(), 3);
        assert_eq!(table.columns, 3);
        assert_eq!(table.rows[0].cells.len(), 3);
        apply_operation(
            &mut doc,
            &RichOperation::DeleteTableRow {
                table_id: table_id.clone(),
                row_index: 1,
            },
        )
        .unwrap();
        apply_operation(
            &mut doc,
            &RichOperation::DeleteTableColumn {
                table_id,
                column_index: 1,
            },
        )
        .unwrap();
        let RichBlock::Table(table) = &doc.tabs[0].body.blocks[1] else {
            panic!()
        };
        assert_eq!(table.rows.len(), 2);
        assert_eq!(table.columns, 2);
    }

    #[test]
    fn delete_table_removes_table_block() {
        let (mut doc, id) = make_doc_with_paragraph("x");
        apply_operation(
            &mut doc,
            &RichOperation::InsertTable {
                paragraph_id: id,
                rows: 1,
                columns: 1,
            },
        )
        .unwrap();
        let table_id = match &doc.tabs[0].body.blocks[1] {
            RichBlock::Table(table) => table.identity.local_id.clone(),
            _ => panic!(),
        };
        apply_operation(&mut doc, &RichOperation::DeleteTable { table_id }).unwrap();
        assert_eq!(doc.tabs[0].body.blocks.len(), 1);
    }

    #[test]
    fn set_table_cell_style_updates_cell_raw_style() {
        let (mut doc, id) = make_doc_with_paragraph("x");
        apply_operation(
            &mut doc,
            &RichOperation::InsertTable {
                paragraph_id: id,
                rows: 1,
                columns: 1,
            },
        )
        .unwrap();
        let table_id = match &doc.tabs[0].body.blocks[1] {
            RichBlock::Table(table) => table.identity.local_id.clone(),
            _ => panic!(),
        };
        apply_operation(
            &mut doc,
            &RichOperation::SetTableCellStyle {
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
        )
        .unwrap();
        let RichBlock::Table(table) = &doc.tabs[0].body.blocks[1] else {
            panic!()
        };
        assert_eq!(
            table.rows[0].cells[0]
                .raw_style
                .0
                .as_ref()
                .and_then(|value| value.path(&["backgroundColor", "color", "rgbColor", "red"]))
                .and_then(|value| match value {
                    JsonValue::Number(raw) => raw.parse::<f32>().ok(),
                    _ => None,
                }),
            Some(1.0)
        );
    }

    #[test]
    fn merge_and_unmerge_table_cells_update_spans() {
        let (mut doc, id) = make_doc_with_paragraph("x");
        apply_operation(
            &mut doc,
            &RichOperation::InsertTable {
                paragraph_id: id,
                rows: 2,
                columns: 2,
            },
        )
        .unwrap();
        let table_id = match &doc.tabs[0].body.blocks[1] {
            RichBlock::Table(table) => table.identity.local_id.clone(),
            _ => panic!(),
        };
        apply_operation(
            &mut doc,
            &RichOperation::MergeTableCells {
                table_id: table_id.clone(),
                row_index: 0,
                column_index: 0,
                row_span: 2,
                column_span: 2,
            },
        )
        .unwrap();
        let RichBlock::Table(table) = &doc.tabs[0].body.blocks[1] else {
            panic!()
        };
        assert_eq!(table.rows[0].cells[0].row_span, 2);
        assert_eq!(table.rows[0].cells[0].column_span, 2);
        apply_operation(
            &mut doc,
            &RichOperation::UnmergeTableCells {
                table_id,
                row_index: 0,
                column_index: 0,
                row_span: 2,
                column_span: 2,
            },
        )
        .unwrap();
        let RichBlock::Table(table) = &doc.tabs[0].body.blocks[1] else {
            panic!()
        };
        assert_eq!(table.rows[0].cells[0].row_span, 1);
        assert_eq!(table.rows[0].cells[0].column_span, 1);
    }

    #[test]
    fn insert_inline_image_adds_ref_and_catalog_entry() {
        let (mut doc, paragraph_id) = make_doc_with_paragraph("hello");
        let inverse = apply_operation(
            &mut doc,
            &RichOperation::InsertInlineImage {
                paragraph_id,
                utf16_offset: Utf16Offset(5),
                uri: "https://img".to_string(),
            },
        )
        .unwrap();
        let RichOperation::DeleteInlineObject { object_id } = inverse.unwrap() else {
            panic!()
        };
        assert!(doc.inline_objects.contains_key(&object_id));
        let RichBlock::Paragraph(paragraph) = &doc.tabs[0].body.blocks[0] else {
            panic!()
        };
        assert!(paragraph
            .inlines
            .iter()
            .any(|inline| matches!(inline, RichInline::InlineObjectRef(obj) if obj.object_id == object_id)));
    }
}
