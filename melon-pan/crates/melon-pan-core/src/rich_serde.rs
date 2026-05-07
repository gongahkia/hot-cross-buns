//! Hand-rolled JSON serialization for `RichDocument`.
//!
//! The Swift shell consumes this when populating its NSAttributedString
//! so it can stamp each paragraph with the stable `RichNodeId` that
//! `rich_batch` will later resolve back to a Docs body index. Without
//! this round-trip, edit ops would carry IDs Swift made up locally,
//! and `compile_batch` would reject them with `NodeNotFound`.
//!
//! Covers paragraphs, text runs, inline object refs, basic style flags,
//! links, named style, list anchors, source_start_index, and table
//! structure. Footnotes and chips are still projected as text
//! placeholders the Swift renderer can show.

use crate::encoding::json_escape;
use crate::json::JsonValue;
use crate::rich_model::{
    RichBlock, RichColor, RichDocument, RichInline, RichInlineObject, RichNamedStyle, RichNodeId,
    RichParagraph, RichStyle, RichTab, RichTable, RichTableCell, RichTableRow,
};

/// Serialize a `RichDocument` to a compact JSON string that the Swift
/// shell can deserialize via `JSONSerialization`. Stable; Swift will read
/// `paragraphs[].id` to stamp custom attributes on its attributed string.
pub fn serialize_rich_document_for_swift(document: &RichDocument) -> String {
    let mut out = String::new();
    out.push('{');
    out.push_str("\"schemaVersion\":");
    out.push_str(&document.schema_version.to_string());
    out.push(',');
    field(&mut out, "documentId", &document.document_id);
    out.push(',');
    field(&mut out, "title", &document.title);
    out.push(',');
    field(&mut out, "revisionId", &document.revision.revision_id);
    out.push(',');
    out.push_str("\"inlineObjects\":[");
    for (index, object) in document.inline_objects.values().enumerate() {
        if index > 0 {
            out.push(',');
        }
        serialize_inline_object(object, &mut out);
    }
    out.push_str("],");
    out.push_str("\"tabs\":[");
    for (index, tab) in document.tabs.iter().enumerate() {
        if index > 0 {
            out.push(',');
        }
        serialize_tab(tab, &mut out);
    }
    out.push_str("]}");
    out
}

fn serialize_tab(tab: &RichTab, out: &mut String) {
    out.push('{');
    field(out, "tabId", &tab.tab_id);
    out.push(',');
    field(out, "title", &tab.title);
    out.push(',');
    out.push_str("\"blocks\":[");
    serialize_blocks(&tab.body.blocks, out);
    out.push_str("],");
    out.push_str("\"tables\":[");
    serialize_top_level_tables(&tab.body.blocks, out);
    out.push_str("],");
    out.push_str("\"paragraphs\":[");
    let mut first = true;
    serialize_top_level_paragraphs(&tab.body.blocks, out, &mut first);
    out.push_str("],\"headers\":[");
    for (index, (segment_id, segment)) in tab.headers.iter().enumerate() {
        if index > 0 {
            out.push(',');
        }
        serialize_segment(segment_id, segment, out);
    }
    out.push_str("],\"footers\":[");
    for (index, (segment_id, segment)) in tab.footers.iter().enumerate() {
        if index > 0 {
            out.push(',');
        }
        serialize_segment(segment_id, segment, out);
    }
    out.push_str("],\"footnotes\":[");
    for (index, (segment_id, segment)) in tab.footnotes.iter().enumerate() {
        if index > 0 {
            out.push(',');
        }
        serialize_segment(segment_id, segment, out);
    }
    out.push_str("],\"childTabs\":[");
    for (index, child) in tab.child_tabs.iter().enumerate() {
        if index > 0 {
            out.push(',');
        }
        serialize_tab(child, out);
    }
    out.push_str("]}");
}

fn serialize_segment(segment_id: &str, segment: &crate::rich_model::RichSegment, out: &mut String) {
    out.push('{');
    field(out, "segmentId", segment_id);
    out.push(',');
    field(out, "kind", source_kind_label(segment.kind));
    out.push(',');
    out.push_str("\"blocks\":[");
    serialize_blocks(&segment.blocks, out);
    out.push_str("]}");
}

fn serialize_blocks(blocks: &[RichBlock], out: &mut String) {
    let mut first = true;
    for block in blocks {
        match block {
            RichBlock::Paragraph(paragraph) => {
                if !first {
                    out.push(',');
                }
                first = false;
                out.push_str("{\"kind\":\"paragraph\",\"paragraph\":");
                serialize_paragraph(paragraph, out);
                out.push('}');
            }
            RichBlock::Table(table) => {
                if !first {
                    out.push(',');
                }
                first = false;
                out.push_str("{\"kind\":\"table\",\"table\":");
                serialize_table(table, out);
                out.push('}');
            }
            RichBlock::SectionBreak(_) | RichBlock::Unsupported(_) => {}
        }
    }
}

fn serialize_top_level_paragraphs(blocks: &[RichBlock], out: &mut String, first: &mut bool) {
    for block in blocks {
        if let RichBlock::Paragraph(paragraph) = block {
            if !*first {
                out.push(',');
            }
            *first = false;
            serialize_paragraph(paragraph, out);
        }
    }
}

fn serialize_top_level_tables(blocks: &[RichBlock], out: &mut String) {
    let mut first = true;
    for block in blocks {
        if let RichBlock::Table(table) = block {
            if !first {
                out.push(',');
            }
            first = false;
            serialize_table(table, out);
        }
    }
}

fn serialize_table(table: &RichTable, out: &mut String) {
    out.push('{');
    out.push_str("\"id\":");
    out.push_str(&serialize_node_id(&table.identity.local_id));
    out.push(',');
    out.push_str("\"startIndex\":");
    out.push_str(&table.start_index.to_string());
    out.push(',');
    out.push_str("\"columns\":");
    out.push_str(&table.columns.to_string());
    out.push(',');
    out.push_str("\"rows\":[");
    for (index, row) in table.rows.iter().enumerate() {
        if index > 0 {
            out.push(',');
        }
        serialize_table_row(row, out);
    }
    out.push_str("]}");
}

fn serialize_table_row(row: &RichTableRow, out: &mut String) {
    out.push('{');
    out.push_str("\"id\":");
    out.push_str(&serialize_node_id(&row.identity.local_id));
    out.push_str(",\"cells\":[");
    for (index, cell) in row.cells.iter().enumerate() {
        if index > 0 {
            out.push(',');
        }
        serialize_table_cell(cell, out);
    }
    out.push_str("]}");
}

fn serialize_table_cell(cell: &RichTableCell, out: &mut String) {
    out.push('{');
    out.push_str("\"id\":");
    out.push_str(&serialize_node_id(&cell.identity.local_id));
    out.push(',');
    out.push_str("\"rowSpan\":");
    out.push_str(&cell.row_span.to_string());
    out.push(',');
    out.push_str("\"columnSpan\":");
    out.push_str(&cell.column_span.to_string());
    out.push(',');
    out.push_str("\"backgroundColor\":");
    serialize_color(table_cell_background_color(cell), out);
    out.push(',');
    number_field(out, "borderWidthPt", table_cell_border_width_pt(cell));
    out.push(',');
    out.push_str("\"borderColor\":");
    serialize_color(table_cell_border_color(cell), out);
    out.push(',');
    string_or_null_field(out, "borderDashStyle", table_cell_border_dash_style(cell));
    out.push(',');
    string_or_null_field(out, "contentAlignment", table_cell_content_alignment(cell));
    out.push(',');
    number_field(out, "paddingPt", table_cell_padding_pt(cell));
    out.push(',');
    out.push_str("\"blocks\":[");
    serialize_blocks(&cell.content, out);
    out.push_str("]}");
}

fn serialize_paragraph(paragraph: &RichParagraph, out: &mut String) {
    out.push('{');
    out.push_str("\"id\":");
    out.push_str(&serialize_node_id(&paragraph.identity.local_id));
    out.push(',');
    out.push_str("\"sourceStartIndex\":");
    match paragraph.identity.source_start_index {
        Some(index) => out.push_str(&index.to_string()),
        None => out.push_str("null"),
    }
    out.push(',');
    out.push_str("\"namedStyle\":\"");
    out.push_str(named_style_label(paragraph.style.named_style));
    out.push_str("\",");
    out.push_str("\"alignment\":");
    match paragraph.style.alignment {
        Some(alignment) => {
            out.push('"');
            out.push_str(alignment_label(alignment));
            out.push('"');
        }
        None => out.push_str("null"),
    }
    out.push(',');
    number_field(out, "indentStart", paragraph.style.indent_start);
    out.push(',');
    number_field(out, "indentEnd", paragraph.style.indent_end);
    out.push(',');
    number_field(out, "indentFirstLine", paragraph.style.indent_first_line);
    out.push(',');
    number_field(out, "lineSpacing", paragraph.style.line_spacing);
    out.push(',');
    number_field(out, "spaceAbove", paragraph.style.space_above);
    out.push(',');
    number_field(out, "spaceBelow", paragraph.style.space_below);
    out.push(',');
    out.push_str("\"inList\":");
    out.push_str(if paragraph.list.is_some() {
        "true"
    } else {
        "false"
    });
    out.push(',');
    out.push_str("\"listNestingLevel\":");
    match &paragraph.list {
        Some(anchor) => out.push_str(&anchor.nesting_level.to_string()),
        None => out.push('0'),
    }
    out.push(',');
    out.push_str("\"protected\":false,");
    out.push_str("\"runs\":[");
    let mut first_run = true;
    for inline in &paragraph.inlines {
        match inline {
            RichInline::TextRun(run) => {
                if !first_run {
                    out.push(',');
                }
                first_run = false;
                serialize_text_run(run.text.as_str(), &run.style, out);
            }
            RichInline::InlineObjectRef(object) => {
                if !first_run {
                    out.push(',');
                }
                first_run = false;
                serialize_inline_object_ref(object.object_id.as_str(), out);
            }
            RichInline::FootnoteRef(_) => {
                if !first_run {
                    out.push(',');
                }
                first_run = false;
                serialize_placeholder_run("[footnote]", "footnote", out);
            }
            RichInline::Equation(_) => {
                if !first_run {
                    out.push(',');
                }
                first_run = false;
                serialize_placeholder_run("[equation]", "equation", out);
            }
            RichInline::PersonChip(chip) => {
                if !first_run {
                    out.push(',');
                }
                first_run = false;
                let text = if chip.display_text.is_empty() {
                    "[person]".to_string()
                } else {
                    format!("@{}", chip.display_text)
                };
                serialize_placeholder_run(&text, "personChip", out);
            }
            RichInline::RichLinkChip(chip) => {
                if !first_run {
                    out.push(',');
                }
                first_run = false;
                let text = if chip.title.is_empty() {
                    "[link]".to_string()
                } else {
                    chip.title.clone()
                };
                serialize_placeholder_run(&text, "linkChip", out);
            }
            RichInline::PageBreak(_)
            | RichInline::ColumnBreak(_)
            | RichInline::HorizontalRule(_)
            | RichInline::AutoText(_)
            | RichInline::Unsupported(_) => {}
        }
    }
    out.push(']');
    out.push('}');
}

fn serialize_placeholder_run(text: &str, inline_kind: &str, out: &mut String) {
    out.push('{');
    serialize_text_run_fields(text, &RichStyle::default(), out);
    out.push_str(",\"inlineKind\":\"");
    out.push_str(inline_kind);
    out.push_str("\"}");
}

fn serialize_text_run(text: &str, style: &RichStyle, out: &mut String) {
    out.push('{');
    serialize_text_run_fields(text, style, out);
    out.push('}');
}

fn serialize_text_run_fields(text: &str, style: &RichStyle, out: &mut String) {
    out.push_str("\"text\":\"");
    out.push_str(&json_escape(text));
    out.push_str("\",\"bold\":");
    out.push_str(if style.bold { "true" } else { "false" });
    out.push_str(",\"italic\":");
    out.push_str(if style.italic { "true" } else { "false" });
    out.push_str(",\"underline\":");
    out.push_str(if style.underline { "true" } else { "false" });
    out.push_str(",\"strikethrough\":");
    out.push_str(if style.strikethrough { "true" } else { "false" });
    out.push_str(",\"fontFamily\":");
    match &style.font_family {
        Some(font_family) => {
            out.push('"');
            out.push_str(&json_escape(font_family));
            out.push('"');
        }
        None => out.push_str("null"),
    }
    out.push_str(",\"fontSizePt\":");
    match style.font_size_pt {
        Some(size) => out.push_str(&size.to_string()),
        None => out.push_str("null"),
    }
    out.push_str(",\"fontWeight\":");
    match style.weighted_font_weight {
        Some(weight) => out.push_str(&weight.to_string()),
        None => out.push_str("null"),
    }
    out.push_str(",\"foregroundColor\":");
    serialize_color(style.foreground_color, out);
    out.push_str(",\"backgroundColor\":");
    serialize_color(style.background_color, out);
    out.push_str(",\"linkUrl\":");
    match &style.link_url {
        Some(url) => {
            out.push('"');
            out.push_str(&json_escape(url));
            out.push('"');
        }
        None => out.push_str("null"),
    }
}

fn serialize_inline_object(object: &RichInlineObject, out: &mut String) {
    out.push('{');
    field(out, "objectId", &object.object_id);
    out.push(',');
    field(out, "kind", inline_object_kind_label(object.kind));
    out.push(',');
    field(out, "altTitle", &object.alt_title);
    out.push(',');
    field(out, "altDescription", &object.alt_description);
    out.push_str(",\"contentUri\":");
    match &object.content_uri {
        Some(uri) => {
            out.push('"');
            out.push_str(&json_escape(uri));
            out.push('"');
        }
        None => out.push_str("null"),
    }
    out.push('}');
}

fn serialize_inline_object_ref(object_id: &str, out: &mut String) {
    out.push_str("{\"text\":\"\\ufffc\",\"bold\":false,\"italic\":false,\"underline\":false,\"strikethrough\":false,\"fontFamily\":null,\"fontSizePt\":null,\"fontWeight\":null,\"foregroundColor\":null,\"backgroundColor\":null,\"linkUrl\":null,\"inlineObjectRef\":{\"objectId\":\"");
    out.push_str(&json_escape(object_id));
    out.push_str("\"}}");
}

fn inline_object_kind_label(kind: crate::rich_model::RichInlineObjectKind) -> &'static str {
    match kind {
        crate::rich_model::RichInlineObjectKind::Image => "image",
        crate::rich_model::RichInlineObjectKind::Drawing => "drawing",
        crate::rich_model::RichInlineObjectKind::Chart => "chart",
        crate::rich_model::RichInlineObjectKind::Other => "other",
    }
}

fn serialize_color(color: Option<crate::rich_model::RichColor>, out: &mut String) {
    match color {
        Some(color) => {
            out.push_str("{\"red\":");
            out.push_str(&color.red.to_string());
            out.push_str(",\"green\":");
            out.push_str(&color.green.to_string());
            out.push_str(",\"blue\":");
            out.push_str(&color.blue.to_string());
            out.push('}');
        }
        None => out.push_str("null"),
    }
}

fn table_cell_background_color(cell: &RichTableCell) -> Option<RichColor> {
    cell.raw_style
        .as_value()
        .and_then(|style| style.path(&["backgroundColor", "color", "rgbColor"]))
        .map(json_color)
}

fn table_cell_border_width_pt(cell: &RichTableCell) -> Option<f32> {
    let style = cell.raw_style.as_value()?;
    for key in ["borderTop", "borderBottom", "borderLeft", "borderRight"] {
        if let Some(width) = style
            .path(&[key, "width", "magnitude"])
            .and_then(|value| json_number(Some(value)))
        {
            return Some(width);
        }
    }
    None
}

fn table_cell_border_color(cell: &RichTableCell) -> Option<RichColor> {
    let style = cell.raw_style.as_value()?;
    for key in ["borderTop", "borderBottom", "borderLeft", "borderRight"] {
        if let Some(color) = style.path(&[key, "color", "rgbColor"]) {
            return Some(json_color(color));
        }
    }
    None
}

fn table_cell_border_dash_style(cell: &RichTableCell) -> Option<&str> {
    let style = cell.raw_style.as_value()?;
    for key in ["borderTop", "borderBottom", "borderLeft", "borderRight"] {
        if let Some(style) = style.path(&[key, "dashStyle"]).and_then(JsonValue::as_str) {
            return Some(style);
        }
    }
    None
}

fn table_cell_content_alignment(cell: &RichTableCell) -> Option<&str> {
    cell.raw_style
        .as_value()
        .and_then(|style| style.path(&["contentAlignment"]))
        .and_then(JsonValue::as_str)
}

fn table_cell_padding_pt(cell: &RichTableCell) -> Option<f32> {
    let style = cell.raw_style.as_value()?;
    for key in ["paddingTop", "paddingBottom", "paddingLeft", "paddingRight"] {
        if let Some(padding) = style
            .path(&[key, "magnitude"])
            .and_then(|value| json_number(Some(value)))
        {
            return Some(padding);
        }
    }
    None
}

fn json_color(value: &JsonValue) -> RichColor {
    RichColor {
        red: json_number(value.get("red")).unwrap_or(0.0),
        green: json_number(value.get("green")).unwrap_or(0.0),
        blue: json_number(value.get("blue")).unwrap_or(0.0),
    }
}

fn json_number(value: Option<&JsonValue>) -> Option<f32> {
    match value? {
        JsonValue::Number(number) => number.parse().ok(),
        _ => None,
    }
}

fn number_field(out: &mut String, key: &str, value: Option<f32>) {
    out.push('"');
    out.push_str(key);
    out.push_str("\":");
    match value {
        Some(value) => out.push_str(&value.to_string()),
        None => out.push_str("null"),
    }
}

fn string_or_null_field(out: &mut String, key: &str, value: Option<&str>) {
    out.push('"');
    out.push_str(key);
    out.push_str("\":");
    match value {
        Some(value) => {
            out.push('"');
            out.push_str(&json_escape(value));
            out.push('"');
        }
        None => out.push_str("null"),
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

fn named_style_label(style: RichNamedStyle) -> &'static str {
    match style {
        RichNamedStyle::NormalText => "NORMAL_TEXT",
        RichNamedStyle::Title => "TITLE",
        RichNamedStyle::Subtitle => "SUBTITLE",
        RichNamedStyle::Heading(level) => match level {
            1 => "HEADING_1",
            2 => "HEADING_2",
            3 => "HEADING_3",
            4 => "HEADING_4",
            5 => "HEADING_5",
            _ => "HEADING_6",
        },
    }
}

fn alignment_label(alignment: crate::rich_model::RichAlignment) -> &'static str {
    match alignment {
        crate::rich_model::RichAlignment::Start => "START",
        crate::rich_model::RichAlignment::Center => "CENTER",
        crate::rich_model::RichAlignment::End => "END",
        crate::rich_model::RichAlignment::Justified => "JUSTIFIED",
    }
}

fn source_kind_label(kind: crate::rich_model::RichSourceKind) -> &'static str {
    match kind {
        crate::rich_model::RichSourceKind::Body => "body",
        crate::rich_model::RichSourceKind::Header => "header",
        crate::rich_model::RichSourceKind::Footer => "footer",
        crate::rich_model::RichSourceKind::Footnote => "footnote",
        crate::rich_model::RichSourceKind::TableCell => "tableCell",
        crate::rich_model::RichSourceKind::InlineObject => "inlineObject",
        crate::rich_model::RichSourceKind::NamedRange => "namedRange",
        crate::rich_model::RichSourceKind::DocumentStyle => "documentStyle",
        crate::rich_model::RichSourceKind::NamedStyle => "namedStyle",
        crate::rich_model::RichSourceKind::List => "list",
        crate::rich_model::RichSourceKind::Tab => "tab",
        crate::rich_model::RichSourceKind::Suggestion => "suggestion",
        crate::rich_model::RichSourceKind::Bookmark => "bookmark",
        crate::rich_model::RichSourceKind::Unknown => "unknown",
    }
}

fn field(out: &mut String, key: &str, value: &str) {
    out.push('"');
    out.push_str(key);
    out.push_str("\":\"");
    out.push_str(&json_escape(value));
    out.push('"');
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rich_model::{
        RichBlock, RichColor, RichInline, RichNodeIdentity, RichParagraphStyle, RichRawJson,
        RichSegment, RichSourceKind, RichTextRun,
    };
    use std::collections::BTreeMap;

    fn ident(seed: &str) -> RichNodeIdentity {
        RichNodeIdentity::local_only(
            RichNodeId::synthetic(seed.to_string()),
            RichSourceKind::Body,
        )
    }

    #[test]
    fn serializes_paragraph_with_stable_id_and_runs() {
        let mut id = RichNodeIdentity::local_only(
            RichNodeId::stable("", "", &["paragraph", "0"], "h"),
            RichSourceKind::Body,
        );
        id.source_start_index = Some(1);
        let para = RichParagraph {
            identity: id,
            style: RichParagraphStyle {
                named_style: RichNamedStyle::Heading(2),
                indent_start: Some(36.0),
                indent_first_line: Some(18.0),
                line_spacing: Some(115.0),
                space_above: Some(8.0),
                space_below: Some(10.0),
                ..RichParagraphStyle::default()
            },
            list: None,
            inlines: vec![
                RichInline::TextRun(RichTextRun {
                    identity: ident("r1"),
                    text: "Hello ".to_string(),
                    style: RichStyle::default(),
                }),
                RichInline::TextRun(RichTextRun {
                    identity: ident("r2"),
                    text: "world".to_string(),
                    style: RichStyle {
                        bold: true,
                        font_family: Some("Times New Roman".to_string()),
                        font_size_pt: Some(16.0),
                        weighted_font_weight: Some(700),
                        foreground_color: Some(RichColor {
                            red: 0.8,
                            green: 0.1,
                            blue: 0.1,
                        }),
                        background_color: Some(RichColor {
                            red: 1.0,
                            green: 0.9,
                            blue: 0.2,
                        }),
                        link_url: Some("https://example.com".to_string()),
                        ..RichStyle::default()
                    },
                }),
            ],
            raw_extras: RichRawJson::empty(),
        };
        let mut doc = RichDocument::skeleton("d", "T");
        doc.revision.revision_id = "rev1".to_string();
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
        let json = serialize_rich_document_for_swift(&doc);
        assert!(json.contains("\"documentId\":\"d\""));
        assert!(json.contains("\"revisionId\":\"rev1\""));
        assert!(json.contains("\"namedStyle\":\"HEADING_2\""));
        assert!(json.contains("\"sourceStartIndex\":1"));
        assert!(json.contains("\"indentStart\":36"));
        assert!(json.contains("\"indentFirstLine\":18"));
        assert!(json.contains("\"lineSpacing\":115"));
        assert!(json.contains("\"spaceAbove\":8"));
        assert!(json.contains("\"spaceBelow\":10"));
        assert!(json.contains("\"text\":\"Hello \""));
        assert!(json.contains("\"text\":\"world\""));
        assert!(json.contains("\"bold\":true"));
        assert!(json.contains("\"fontFamily\":\"Times New Roman\""));
        assert!(json.contains("\"fontSizePt\":16"));
        assert!(json.contains("\"fontWeight\":700"));
        assert!(json.contains("\"foregroundColor\":{\"red\":0.8,\"green\":0.1,\"blue\":0.1}"));
        assert!(json.contains("\"backgroundColor\":{\"red\":1,\"green\":0.9,\"blue\":0.2}"));
        assert!(json.contains("\"linkUrl\":\"https://example.com\""));
    }

    #[test]
    fn table_structure_serializes_without_protecting_cell_paragraphs() {
        let mut doc = RichDocument::skeleton("d", "T");
        let cell_para = RichParagraph {
            identity: ident("cell-p"),
            style: RichParagraphStyle::default(),
            list: None,
            inlines: vec![RichInline::TextRun(RichTextRun {
                identity: ident("cell-r"),
                text: "cell text".to_string(),
                style: RichStyle::default(),
            })],
            raw_extras: RichRawJson::empty(),
        };
        let table = crate::rich_model::RichTable {
            identity: ident("t"),
            start_index: 1,
            rows: vec![crate::rich_model::RichTableRow {
                identity: ident("row"),
                cells: vec![crate::rich_model::RichTableCell {
                    identity: ident("cell"),
                    content: vec![RichBlock::Paragraph(cell_para)],
                    row_span: 1,
                    column_span: 1,
                    raw_style: RichRawJson::from_value(
                        crate::json::parse_json(
                            r#"{"backgroundColor":{"color":{"rgbColor":{"red":1,"green":0.9,"blue":0.2}}}}"#,
                        )
                        .unwrap(),
                    ),
                }],
                raw_style: RichRawJson::empty(),
            }],
            columns: 1,
            raw_style: RichRawJson::empty(),
        };
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
                blocks: vec![RichBlock::Table(table)],
                style: RichRawJson::empty(),
            },
            headers: BTreeMap::new(),
            footers: BTreeMap::new(),
            footnotes: BTreeMap::new(),
            child_tabs: Vec::new(),
        });
        let json = serialize_rich_document_for_swift(&doc);
        assert!(json.contains("\"blocks\":[{\"kind\":\"table\""));
        assert!(json.contains("\"tables\":[{\"id\""));
        assert!(json.contains("\"rows\":[{\"id\""));
        assert!(json.contains("\"cells\":[{\"id\""));
        assert!(json.contains("\"rowSpan\":1"));
        assert!(json.contains("\"columnSpan\":1"));
        assert!(json.contains("\"backgroundColor\":{\"red\":1,\"green\":0.9,\"blue\":0.2}"));
        assert!(json.contains("\"protected\":false"));
        assert!(json.contains("\"text\":\"cell text\""));
    }

    #[test]
    fn serializes_supplementary_segments_for_swift() {
        let mut doc = RichDocument::skeleton("d", "T");
        let header_para = RichParagraph {
            identity: ident("header-p"),
            style: RichParagraphStyle::default(),
            list: None,
            inlines: vec![RichInline::TextRun(RichTextRun {
                identity: ident("header-r"),
                text: "header text".to_string(),
                style: RichStyle::default(),
            })],
            raw_extras: RichRawJson::empty(),
        };
        let footnote_para = RichParagraph {
            identity: ident("footnote-p"),
            style: RichParagraphStyle::default(),
            list: None,
            inlines: vec![RichInline::TextRun(RichTextRun {
                identity: ident("footnote-r"),
                text: "footnote text".to_string(),
                style: RichStyle::default(),
            })],
            raw_extras: RichRawJson::empty(),
        };
        let mut headers = BTreeMap::new();
        headers.insert(
            "h1".to_string(),
            RichSegment {
                identity: ident("header-seg"),
                segment_id: "h1".to_string(),
                kind: RichSourceKind::Header,
                blocks: vec![RichBlock::Paragraph(header_para)],
                style: RichRawJson::empty(),
            },
        );
        let mut footnotes = BTreeMap::new();
        footnotes.insert(
            "fn1".to_string(),
            RichSegment {
                identity: ident("footnote-seg"),
                segment_id: "fn1".to_string(),
                kind: RichSourceKind::Footnote,
                blocks: vec![RichBlock::Paragraph(footnote_para)],
                style: RichRawJson::empty(),
            },
        );
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
                blocks: Vec::new(),
                style: RichRawJson::empty(),
            },
            headers,
            footers: BTreeMap::new(),
            footnotes,
            child_tabs: Vec::new(),
        });
        let json = serialize_rich_document_for_swift(&doc);
        assert!(json.contains("\"headers\":[{\"segmentId\":\"h1\",\"kind\":\"header\""));
        assert!(json.contains("\"footnotes\":[{\"segmentId\":\"fn1\",\"kind\":\"footnote\""));
        assert!(json.contains("\"text\":\"header text\""));
        assert!(json.contains("\"text\":\"footnote text\""));
    }
}
