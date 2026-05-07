//! Tab-aware Google Docs JSON -> RichDocument parser.
//!
//! Distinct from the legacy `docs_json.rs` parser, which produces a
//! Markdown-flavoured `DocsDocument`. This parser preserves every
//! structural concern the editor needs and stamps every node with a
//! `RichNodeIdentity` so editor operations can address nodes by stable id
//! rather than positional index.
//!
//! Multi-tab handling: if the response carries a top-level `tabs` array
//! (Docs API tabs surface, GA 2024-06), we parse the tab tree directly.
//! Legacy single-tab responses synthesize a single synthetic root tab
//! whose `tab_id` is empty; downstream code should treat empty `tab_id`
//! as "default tab" rather than as an error.

use crate::json::{parse_json, JsonError, JsonValue};
use crate::rich_model::{
    RichAlignment, RichBaselineOffset, RichBlock, RichColor, RichDocument, RichEquation,
    RichFootnoteRef, RichInline, RichInlineMarker, RichInlineObject, RichInlineObjectKind,
    RichInlineObjectRef, RichList, RichListAnchor, RichListGlyph, RichListLevel, RichNamedRange,
    RichNamedStyle, RichNodeId, RichNodeIdentity, RichParagraph, RichParagraphStyle,
    RichPersonChip, RichRawJson, RichRevision, RichRichLinkChip, RichSectionBreak, RichSegment,
    RichSourceKind, RichStyle, RichSuggestion, RichSuggestionKind, RichTab, RichTable,
    RichTableCell, RichTableRow, RichTextRun, RichUnsupported, RICH_SCHEMA_VERSION,
};
use crate::sha256::sha256;
use std::collections::BTreeMap;

const SYNTHETIC_ROOT_TAB_ID: &str = "";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RichParseError {
    InvalidJson(JsonError),
    MissingField(&'static str),
}

/// Maximum `endIndex` seen across the body content array. Used by callers
/// (like batchUpdate index math) that still need the legacy body length
/// projection without re-parsing the whole document.
pub fn body_end_index_from_raw(raw: &str) -> Result<u32, RichParseError> {
    let root = parse_json(raw).map_err(RichParseError::InvalidJson)?;
    let mut max_end = 2_u32;
    collect_body_end_indexes(&root, &mut max_end);
    Ok(max_end)
}

pub fn parse_rich_document(raw: &str) -> Result<RichDocument, RichParseError> {
    let root = parse_json(raw).map_err(RichParseError::InvalidJson)?;

    let document_id = required_string(&root, &["documentId"], "documentId")?.to_string();
    let title = root
        .path(&["title"])
        .and_then(JsonValue::as_str)
        .unwrap_or("Untitled")
        .to_string();
    let revision_id = root
        .path(&["revisionId"])
        .and_then(JsonValue::as_str)
        .unwrap_or("")
        .to_string();

    let mut doc = RichDocument::skeleton(&document_id, &title);
    doc.schema_version = RICH_SCHEMA_VERSION;
    doc.revision = RichRevision {
        revision_id: revision_id.clone(),
        modified_time: String::new(),
        pulled_at: String::new(),
    };

    doc.document_style = clone_optional_or_first_document_tab(&root, "documentStyle");
    doc.named_styles = clone_optional_or_first_document_tab(&root, "namedStyles");

    doc.inline_objects = parse_inline_objects(&root, &revision_id);
    doc.lists = parse_lists(&root, &revision_id);
    doc.bookmarks = parse_bookmarks(&root);
    doc.named_ranges = parse_named_ranges(&root, &revision_id);
    doc.suggestions = parse_suggestions(&root, &revision_id);

    // Tab tree: explicit `tabs` array -> parse it; otherwise synthesize one.
    if let Some(tabs) = root.path(&["tabs"]).and_then(JsonValue::as_array) {
        for (index, tab_value) in tabs.iter().enumerate() {
            doc.tabs
                .push(parse_tab(tab_value, None, index as u32, &revision_id));
        }
    } else {
        doc.tabs.push(parse_legacy_root_tab(&root, &revision_id));
    }

    doc.unknown_fields = collect_unknown_top_level_fields(&root);

    Ok(doc)
}

fn parse_tab(
    tab_value: &JsonValue,
    parent_tab_id: Option<String>,
    index: u32,
    revision_id: &str,
) -> RichTab {
    let tab_id = tab_value
        .path(&["tabProperties", "tabId"])
        .and_then(JsonValue::as_str)
        .unwrap_or("")
        .to_string();
    let title = tab_value
        .path(&["tabProperties", "title"])
        .and_then(JsonValue::as_str)
        .unwrap_or("")
        .to_string();
    let document_tab = tab_value.get("documentTab");

    let body = parse_segment(
        document_tab.and_then(|t| t.get("body")),
        &tab_id,
        "body",
        RichSourceKind::Body,
        revision_id,
    );

    let headers = parse_segment_map(
        document_tab.and_then(|t| t.get("headers")),
        &tab_id,
        RichSourceKind::Header,
        revision_id,
    );
    let footers = parse_segment_map(
        document_tab.and_then(|t| t.get("footers")),
        &tab_id,
        RichSourceKind::Footer,
        revision_id,
    );
    let footnotes = parse_segment_map(
        document_tab.and_then(|t| t.get("footnotes")),
        &tab_id,
        RichSourceKind::Footnote,
        revision_id,
    );

    let mut child_tabs = Vec::new();
    if let Some(children) = tab_value.path(&["childTabs"]).and_then(JsonValue::as_array) {
        for (child_index, child) in children.iter().enumerate() {
            child_tabs.push(parse_tab(
                child,
                Some(tab_id.clone()),
                child_index as u32,
                revision_id,
            ));
        }
    }

    let identity = identity_for(
        &tab_id,
        "",
        &["tab", &tab_id],
        revision_id,
        RichSourceKind::Tab,
        &title,
    );

    RichTab {
        identity,
        tab_id,
        title,
        index,
        parent_tab_id,
        body,
        headers,
        footers,
        footnotes,
        child_tabs,
    }
}

fn collect_body_end_indexes(value: &JsonValue, max_end: &mut u32) {
    if let Some(content) = value
        .path(&["body", "content"])
        .and_then(JsonValue::as_array)
    {
        for element in content {
            if let Some(end_index) = number_as_u32(element.get("endIndex")) {
                *max_end = (*max_end).max(end_index);
            }
        }
    }

    if let Some(tabs) = value.path(&["tabs"]).and_then(JsonValue::as_array) {
        for tab in tabs {
            collect_body_end_indexes(tab, max_end);
        }
    }
    if let Some(document_tab) = value.get("documentTab") {
        collect_body_end_indexes(document_tab, max_end);
    }
    if let Some(children) = value.path(&["childTabs"]).and_then(JsonValue::as_array) {
        for child in children {
            collect_body_end_indexes(child, max_end);
        }
    }
}

fn parse_legacy_root_tab(root: &JsonValue, revision_id: &str) -> RichTab {
    let body = parse_segment(
        root.get("body"),
        SYNTHETIC_ROOT_TAB_ID,
        "body",
        RichSourceKind::Body,
        revision_id,
    );
    let headers = parse_segment_map(
        root.get("headers"),
        SYNTHETIC_ROOT_TAB_ID,
        RichSourceKind::Header,
        revision_id,
    );
    let footers = parse_segment_map(
        root.get("footers"),
        SYNTHETIC_ROOT_TAB_ID,
        RichSourceKind::Footer,
        revision_id,
    );
    let footnotes = parse_segment_map(
        root.get("footnotes"),
        SYNTHETIC_ROOT_TAB_ID,
        RichSourceKind::Footnote,
        revision_id,
    );

    let identity = identity_for(
        SYNTHETIC_ROOT_TAB_ID,
        "",
        &["tab", "<root>"],
        revision_id,
        RichSourceKind::Tab,
        "",
    );

    RichTab {
        identity,
        tab_id: SYNTHETIC_ROOT_TAB_ID.to_string(),
        title: String::new(),
        index: 0,
        parent_tab_id: None,
        body,
        headers,
        footers,
        footnotes,
        child_tabs: Vec::new(),
    }
}

fn parse_segment_map(
    value: Option<&JsonValue>,
    tab_id: &str,
    kind: RichSourceKind,
    revision_id: &str,
) -> BTreeMap<String, RichSegment> {
    let mut out = BTreeMap::new();
    let Some(JsonValue::Object(map)) = value else {
        return out;
    };
    for (segment_id, segment_value) in map {
        out.insert(
            segment_id.clone(),
            parse_segment(Some(segment_value), tab_id, segment_id, kind, revision_id),
        );
    }
    out
}

fn parse_segment(
    value: Option<&JsonValue>,
    tab_id: &str,
    segment_id: &str,
    kind: RichSourceKind,
    revision_id: &str,
) -> RichSegment {
    let identity = identity_for(
        tab_id,
        segment_id,
        &["segment", segment_id],
        revision_id,
        kind,
        "",
    );
    let mut blocks = Vec::new();
    if let Some(content) = value
        .and_then(|v| v.get("content"))
        .and_then(JsonValue::as_array)
    {
        for (index, element) in content.iter().enumerate() {
            blocks.push(parse_structural_element(
                element,
                tab_id,
                segment_id,
                index,
                revision_id,
                kind,
            ));
        }
    }
    let style = clone_optional_owned(value, "sectionStyle");
    RichSegment {
        identity,
        segment_id: segment_id.to_string(),
        kind,
        blocks,
        style,
    }
}

fn parse_structural_element(
    element: &JsonValue,
    tab_id: &str,
    segment_id: &str,
    index: usize,
    revision_id: &str,
    kind: RichSourceKind,
) -> RichBlock {
    let start_index = number_as_u32(element.get("startIndex"));
    let end_index = number_as_u32(element.get("endIndex"));

    if let Some(paragraph) = element.get("paragraph") {
        return RichBlock::Paragraph(parse_paragraph(
            paragraph,
            tab_id,
            segment_id,
            index,
            start_index,
            end_index,
            revision_id,
            kind,
        ));
    }
    if let Some(table) = element.get("table") {
        return RichBlock::Table(parse_table(
            table,
            tab_id,
            segment_id,
            index,
            start_index,
            end_index,
            revision_id,
        ));
    }
    if let Some(section) = element.get("sectionBreak") {
        let identity = identity_for(
            tab_id,
            segment_id,
            &["section", &index.to_string()],
            revision_id,
            kind,
            "",
        );
        return RichBlock::SectionBreak(RichSectionBreak {
            identity,
            raw: RichRawJson::from_value(section.clone()),
        });
    }

    // Anything else (tableOfContents, unknown future elements): preserve
    // raw and tag as Unsupported. The editor will render a protected
    // placeholder.
    let identity = identity_for(
        tab_id,
        segment_id,
        &["unsupported", &index.to_string()],
        revision_id,
        RichSourceKind::Unknown,
        "",
    );
    let description = describe_unsupported_block(element);
    let stable_anchor = stable_anchor_from_indexes(start_index, end_index);
    RichBlock::Unsupported(RichUnsupported {
        identity,
        stable_anchor,
        description,
        raw: RichRawJson::from_value(element.clone()),
    })
}

fn describe_unsupported_block(element: &JsonValue) -> String {
    if element.get("tableOfContents").is_some() {
        return "tableOfContents".to_string();
    }
    if let JsonValue::Object(fields) = element {
        let names: Vec<&str> = fields
            .keys()
            .filter(|key| key.as_str() != "startIndex" && key.as_str() != "endIndex")
            .map(String::as_str)
            .collect();
        if !names.is_empty() {
            return format!("unknown structural element: {}", names.join(","));
        }
    }
    "unknown structural element".to_string()
}

fn parse_paragraph(
    paragraph: &JsonValue,
    tab_id: &str,
    segment_id: &str,
    index: usize,
    start_index: Option<u32>,
    end_index: Option<u32>,
    revision_id: &str,
    kind: RichSourceKind,
) -> RichParagraph {
    let style_json = paragraph.get("paragraphStyle");
    let style = parse_paragraph_style(style_json);
    let list = paragraph.get("bullet").map(|bullet| RichListAnchor {
        list_id: bullet
            .get("listId")
            .and_then(JsonValue::as_str)
            .unwrap_or("")
            .to_string(),
        nesting_level: number_as_u32(bullet.get("nestingLevel"))
            .unwrap_or(0)
            .min(255) as u8,
    });

    let mut inlines = Vec::new();
    if let Some(elements) = paragraph.get("elements").and_then(JsonValue::as_array) {
        for (run_index, run_value) in elements.iter().enumerate() {
            inlines.push(parse_paragraph_element(
                run_value,
                tab_id,
                segment_id,
                index,
                run_index,
                revision_id,
                kind,
            ));
        }
    }

    let identity = RichNodeIdentity {
        local_id: RichNodeId::stable(
            tab_id,
            segment_id,
            &["paragraph", &index.to_string()],
            &content_hash_for_paragraph(&inlines, &style),
        ),
        source_tab_id: tab_id.to_string(),
        source_segment_id: segment_id.to_string(),
        source_start_index: start_index,
        source_end_index: end_index,
        source_revision_id: revision_id.to_string(),
        source_kind: kind,
        raw_hash: hex_short(&sha256(format!("{:?}", paragraph).as_bytes())),
    };

    RichParagraph {
        identity,
        style,
        list,
        inlines,
        raw_extras: RichRawJson::empty(),
    }
}

fn parse_paragraph_style(value: Option<&JsonValue>) -> RichParagraphStyle {
    let Some(value) = value else {
        return RichParagraphStyle::default();
    };
    let named_style = value
        .get("namedStyleType")
        .and_then(JsonValue::as_str)
        .map(named_style_from_docs)
        .unwrap_or_default();
    let alignment = value
        .get("alignment")
        .and_then(JsonValue::as_str)
        .and_then(alignment_from_docs);
    RichParagraphStyle {
        named_style,
        alignment,
        indent_start: dimension_to_pt(value.get("indentStart")),
        indent_end: dimension_to_pt(value.get("indentEnd")),
        indent_first_line: dimension_to_pt(value.get("indentFirstLine")),
        line_spacing: number_as_f32(value.get("lineSpacing")),
        space_above: dimension_to_pt(value.get("spaceAbove")),
        space_below: dimension_to_pt(value.get("spaceBelow")),
        raw: RichRawJson::from_value(value.clone()),
    }
}

fn named_style_from_docs(value: &str) -> RichNamedStyle {
    match value {
        "TITLE" => RichNamedStyle::Title,
        "SUBTITLE" => RichNamedStyle::Subtitle,
        other => match other
            .strip_prefix("HEADING_")
            .and_then(|n| n.parse::<u8>().ok())
        {
            Some(level) => RichNamedStyle::Heading(level.clamp(1, 6)),
            None => RichNamedStyle::NormalText,
        },
    }
}

fn alignment_from_docs(value: &str) -> Option<RichAlignment> {
    match value {
        "START" => Some(RichAlignment::Start),
        "CENTER" => Some(RichAlignment::Center),
        "END" => Some(RichAlignment::End),
        "JUSTIFIED" => Some(RichAlignment::Justified),
        _ => None,
    }
}

fn parse_paragraph_element(
    element: &JsonValue,
    tab_id: &str,
    segment_id: &str,
    paragraph_index: usize,
    run_index: usize,
    revision_id: &str,
    kind: RichSourceKind,
) -> RichInline {
    let start_index = number_as_u32(element.get("startIndex"));
    let end_index = number_as_u32(element.get("endIndex"));
    let path_components = [
        "paragraph".to_string(),
        paragraph_index.to_string(),
        "run".to_string(),
        run_index.to_string(),
    ];
    let path_refs: Vec<&str> = path_components.iter().map(String::as_str).collect();

    let make_identity = |sub_kind: RichSourceKind, content_hint: &str| RichNodeIdentity {
        local_id: RichNodeId::stable(tab_id, segment_id, &path_refs, content_hint),
        source_tab_id: tab_id.to_string(),
        source_segment_id: segment_id.to_string(),
        source_start_index: start_index,
        source_end_index: end_index,
        source_revision_id: revision_id.to_string(),
        source_kind: sub_kind,
        raw_hash: hex_short(&sha256(format!("{:?}", element).as_bytes())),
    };

    if let Some(text_run) = element.get("textRun") {
        let text = text_run
            .get("content")
            .and_then(JsonValue::as_str)
            .unwrap_or("")
            .to_string();
        let style = parse_text_style(text_run.get("textStyle"));
        return RichInline::TextRun(RichTextRun {
            identity: make_identity(kind, &text),
            text,
            style,
        });
    }

    if let Some(inline) = element.get("inlineObjectElement") {
        let object_id = inline
            .get("inlineObjectId")
            .and_then(JsonValue::as_str)
            .unwrap_or("")
            .to_string();
        return RichInline::InlineObjectRef(RichInlineObjectRef {
            identity: make_identity(RichSourceKind::InlineObject, &object_id),
            object_id,
        });
    }

    if let Some(footnote) = element.get("footnoteReference") {
        let footnote_id = footnote
            .get("footnoteId")
            .and_then(JsonValue::as_str)
            .unwrap_or("")
            .to_string();
        return RichInline::FootnoteRef(RichFootnoteRef {
            identity: make_identity(RichSourceKind::Footnote, &footnote_id),
            footnote_id,
        });
    }

    if element.get("pageBreak").is_some() {
        return RichInline::PageBreak(RichInlineMarker {
            identity: make_identity(kind, "pageBreak"),
            raw: RichRawJson::from_value(element.clone()),
        });
    }

    if element.get("columnBreak").is_some() {
        return RichInline::ColumnBreak(RichInlineMarker {
            identity: make_identity(kind, "columnBreak"),
            raw: RichRawJson::from_value(element.clone()),
        });
    }

    if element.get("horizontalRule").is_some() {
        return RichInline::HorizontalRule(RichInlineMarker {
            identity: make_identity(kind, "horizontalRule"),
            raw: RichRawJson::from_value(element.clone()),
        });
    }

    if element.get("autoText").is_some() {
        return RichInline::AutoText(RichInlineMarker {
            identity: make_identity(kind, "autoText"),
            raw: RichRawJson::from_value(element.clone()),
        });
    }

    if element.get("equation").is_some() {
        return RichInline::Equation(RichEquation {
            identity: make_identity(kind, "equation"),
            raw: RichRawJson::from_value(element.clone()),
        });
    }

    if let Some(person) = element.get("person") {
        let person_id = person
            .get("personId")
            .and_then(JsonValue::as_str)
            .map(ToString::to_string);
        let display_text = person
            .path(&["personProperties", "name"])
            .and_then(JsonValue::as_str)
            .unwrap_or("")
            .to_string();
        return RichInline::PersonChip(RichPersonChip {
            identity: make_identity(kind, "personChip"),
            person_id,
            display_text,
            raw: RichRawJson::from_value(element.clone()),
        });
    }

    if let Some(rich_link) = element.get("richLink") {
        let uri = rich_link
            .path(&["richLinkProperties", "uri"])
            .and_then(JsonValue::as_str)
            .unwrap_or("")
            .to_string();
        let title = rich_link
            .path(&["richLinkProperties", "title"])
            .and_then(JsonValue::as_str)
            .unwrap_or("")
            .to_string();
        return RichInline::RichLinkChip(RichRichLinkChip {
            identity: make_identity(kind, "richLinkChip"),
            uri,
            title,
            raw: RichRawJson::from_value(element.clone()),
        });
    }

    let stable_anchor = stable_anchor_from_indexes(start_index, end_index);
    RichInline::Unsupported(RichUnsupported {
        identity: make_identity(RichSourceKind::Unknown, "unsupported"),
        stable_anchor,
        description: describe_unsupported_inline(element),
        raw: RichRawJson::from_value(element.clone()),
    })
}

fn describe_unsupported_inline(element: &JsonValue) -> String {
    if let JsonValue::Object(fields) = element {
        let names: Vec<&str> = fields
            .keys()
            .filter(|key| key.as_str() != "startIndex" && key.as_str() != "endIndex")
            .map(String::as_str)
            .collect();
        if !names.is_empty() {
            return format!("unknown inline element: {}", names.join(","));
        }
    }
    "unknown inline element".to_string()
}

fn parse_text_style(value: Option<&JsonValue>) -> RichStyle {
    let Some(value) = value else {
        return RichStyle::default();
    };
    let baseline = value
        .get("baselineOffset")
        .and_then(JsonValue::as_str)
        .map(baseline_from_docs)
        .unwrap_or_default();
    let foreground_color = value
        .path(&["foregroundColor", "color", "rgbColor"])
        .map(parse_color);
    let background_color = value
        .path(&["backgroundColor", "color", "rgbColor"])
        .map(parse_color);
    let font_family = value
        .path(&["weightedFontFamily", "fontFamily"])
        .and_then(JsonValue::as_str)
        .map(ToString::to_string);
    let font_size_pt = dimension_to_pt(value.get("fontSize"));
    let weighted_font_weight =
        value
            .path(&["weightedFontFamily", "weight"])
            .and_then(|v| match v {
                JsonValue::Number(n) => n.parse::<i32>().ok(),
                _ => None,
            });
    RichStyle {
        bold: value
            .get("bold")
            .and_then(JsonValue::as_bool)
            .unwrap_or(false),
        italic: value
            .get("italic")
            .and_then(JsonValue::as_bool)
            .unwrap_or(false),
        underline: value
            .get("underline")
            .and_then(JsonValue::as_bool)
            .unwrap_or(false),
        strikethrough: value
            .get("strikethrough")
            .and_then(JsonValue::as_bool)
            .unwrap_or(false),
        small_caps: value
            .get("smallCaps")
            .and_then(JsonValue::as_bool)
            .unwrap_or(false),
        baseline,
        font_family,
        font_size_pt,
        weighted_font_weight,
        foreground_color,
        background_color,
        link_url: value
            .path(&["link", "url"])
            .and_then(JsonValue::as_str)
            .map(ToString::to_string),
        raw: RichRawJson::from_value(value.clone()),
    }
}

fn baseline_from_docs(value: &str) -> RichBaselineOffset {
    match value {
        "SUBSCRIPT" => RichBaselineOffset::Subscript,
        "SUPERSCRIPT" => RichBaselineOffset::Superscript,
        _ => RichBaselineOffset::None,
    }
}

fn parse_color(value: &JsonValue) -> RichColor {
    RichColor {
        red: number_as_f32(value.get("red")).unwrap_or(0.0),
        green: number_as_f32(value.get("green")).unwrap_or(0.0),
        blue: number_as_f32(value.get("blue")).unwrap_or(0.0),
    }
}

fn parse_table(
    table: &JsonValue,
    tab_id: &str,
    segment_id: &str,
    index: usize,
    start_index: Option<u32>,
    end_index: Option<u32>,
    revision_id: &str,
) -> RichTable {
    let columns = number_as_u32(table.get("columns")).unwrap_or(0);
    let rows_value = table
        .get("tableRows")
        .and_then(JsonValue::as_array)
        .unwrap_or(&[]);
    let mut rows = Vec::with_capacity(rows_value.len());
    for (row_index, row) in rows_value.iter().enumerate() {
        let cells_value = row
            .get("tableCells")
            .and_then(JsonValue::as_array)
            .unwrap_or(&[]);
        let mut cells = Vec::with_capacity(cells_value.len());
        for (cell_index, cell) in cells_value.iter().enumerate() {
            let mut cell_blocks = Vec::new();
            if let Some(content) = cell.get("content").and_then(JsonValue::as_array) {
                for (block_index, block_value) in content.iter().enumerate() {
                    cell_blocks.push(parse_structural_element(
                        block_value,
                        tab_id,
                        segment_id,
                        // Synthesize a unique block path using row/cell/block indices.
                        encode_table_block_index(index, row_index, cell_index, block_index),
                        revision_id,
                        RichSourceKind::TableCell,
                    ));
                }
            }
            let row_span = number_as_u32(cell.path(&["tableCellStyle", "rowSpan"])).unwrap_or(1);
            let column_span =
                number_as_u32(cell.path(&["tableCellStyle", "columnSpan"])).unwrap_or(1);
            let identity = identity_for(
                tab_id,
                segment_id,
                &[
                    "table",
                    &index.to_string(),
                    "row",
                    &row_index.to_string(),
                    "cell",
                    &cell_index.to_string(),
                ],
                revision_id,
                RichSourceKind::TableCell,
                "",
            );
            cells.push(RichTableCell {
                identity,
                content: cell_blocks,
                row_span,
                column_span,
                raw_style: clone_optional_owned(Some(cell), "tableCellStyle"),
            });
        }
        let identity = identity_for(
            tab_id,
            segment_id,
            &["table", &index.to_string(), "row", &row_index.to_string()],
            revision_id,
            RichSourceKind::TableCell,
            "",
        );
        rows.push(RichTableRow {
            identity,
            cells,
            raw_style: clone_optional_owned(Some(row), "tableRowStyle"),
        });
    }

    RichTable {
        identity: RichNodeIdentity {
            local_id: RichNodeId::stable(tab_id, segment_id, &["table", &index.to_string()], ""),
            source_tab_id: tab_id.to_string(),
            source_segment_id: segment_id.to_string(),
            source_start_index: start_index,
            source_end_index: end_index,
            source_revision_id: revision_id.to_string(),
            source_kind: RichSourceKind::TableCell,
            raw_hash: hex_short(&sha256(format!("{:?}", table).as_bytes())),
        },
        start_index: start_index.unwrap_or(0),
        rows,
        columns,
        raw_style: clone_optional_owned(Some(table), "tableStyle"),
    }
}

/// Encode a (parent_index, row, cell, block) tuple into a usize so the
/// recursive parser can keep its `index: usize` shape. We use 16 bits per
/// component which is more than enough for any real document.
fn encode_table_block_index(
    parent_index: usize,
    row_index: usize,
    cell_index: usize,
    block_index: usize,
) -> usize {
    (parent_index & 0xFFFF) << 48
        | (row_index & 0xFFFF) << 32
        | (cell_index & 0xFFFF) << 16
        | (block_index & 0xFFFF)
}

fn parse_inline_objects(root: &JsonValue, revision_id: &str) -> BTreeMap<String, RichInlineObject> {
    let mut out = BTreeMap::new();
    parse_inline_objects_from_container(root, revision_id, &mut out);
    visit_document_tabs(root, &mut |document_tab| {
        parse_inline_objects_from_container(document_tab, revision_id, &mut out);
    });
    out
}

fn parse_inline_objects_from_container(
    value: &JsonValue,
    revision_id: &str,
    out: &mut BTreeMap<String, RichInlineObject>,
) {
    let Some(JsonValue::Object(objects)) = value.get("inlineObjects") else {
        return;
    };
    for (object_id, value) in objects {
        let embedded = value.path(&["inlineObjectProperties", "embeddedObject"]);
        let kind = embedded
            .map(|e| {
                if e.get("imageProperties").is_some() {
                    RichInlineObjectKind::Image
                } else if e.get("embeddedDrawingProperties").is_some() {
                    RichInlineObjectKind::Drawing
                } else if e.get("linkedContentReference").is_some() {
                    RichInlineObjectKind::Chart
                } else {
                    RichInlineObjectKind::Other
                }
            })
            .unwrap_or(RichInlineObjectKind::Other);
        let alt_title = embedded
            .and_then(|e| e.get("title"))
            .and_then(JsonValue::as_str)
            .unwrap_or("")
            .to_string();
        let alt_description = embedded
            .and_then(|e| e.get("description"))
            .and_then(JsonValue::as_str)
            .unwrap_or("")
            .to_string();
        let content_uri = embedded
            .and_then(|e| e.path(&["imageProperties", "contentUri"]))
            .and_then(JsonValue::as_str)
            .map(ToString::to_string);

        out.insert(
            object_id.clone(),
            RichInlineObject {
                identity: identity_for(
                    "",
                    "",
                    &["inlineObject", object_id],
                    revision_id,
                    RichSourceKind::InlineObject,
                    object_id,
                ),
                object_id: object_id.clone(),
                kind,
                alt_title,
                alt_description,
                content_uri,
                raw: RichRawJson::from_value(value.clone()),
            },
        );
    }
}

fn parse_lists(root: &JsonValue, revision_id: &str) -> BTreeMap<String, RichList> {
    let mut out = BTreeMap::new();
    parse_lists_from_container(root, revision_id, &mut out);
    visit_document_tabs(root, &mut |document_tab| {
        parse_lists_from_container(document_tab, revision_id, &mut out);
    });
    out
}

fn parse_lists_from_container(
    value: &JsonValue,
    revision_id: &str,
    out: &mut BTreeMap<String, RichList>,
) {
    let Some(JsonValue::Object(lists)) = value.get("lists") else {
        return;
    };
    for (list_id, value) in lists {
        let nesting_levels = value
            .path(&["listProperties", "nestingLevels"])
            .and_then(JsonValue::as_array)
            .map(|levels| levels.iter().map(parse_list_level).collect())
            .unwrap_or_default();
        out.insert(
            list_id.clone(),
            RichList {
                identity: identity_for(
                    "",
                    "",
                    &["list", list_id],
                    revision_id,
                    RichSourceKind::List,
                    list_id,
                ),
                list_id: list_id.clone(),
                nesting_levels,
                raw: RichRawJson::from_value(value.clone()),
            },
        );
    }
}

fn parse_list_level(value: &JsonValue) -> RichListLevel {
    let glyph_type = value
        .get("glyphType")
        .and_then(JsonValue::as_str)
        .unwrap_or("");
    let glyph_symbol = value
        .get("glyphSymbol")
        .and_then(JsonValue::as_str)
        .unwrap_or("");
    let glyph = if !glyph_symbol.is_empty() {
        RichListGlyph::Bullet(glyph_symbol.to_string())
    } else {
        match glyph_type {
            "DECIMAL" => RichListGlyph::Decimal,
            "ALPHA" => RichListGlyph::AlphaLower,
            "UPPER_ALPHA" => RichListGlyph::AlphaUpper,
            "ROMAN" => RichListGlyph::RomanLower,
            "UPPER_ROMAN" => RichListGlyph::RomanUpper,
            "GLYPH_TYPE_UNSPECIFIED" | "" => RichListGlyph::Unspecified,
            other => RichListGlyph::Other(other.to_string()),
        }
    };
    RichListLevel {
        glyph_type: glyph,
        start_number: number_as_u32(value.get("startNumber")),
        indent_first_line: dimension_to_pt(value.get("indentFirstLine")),
        indent_start: dimension_to_pt(value.get("indentStart")),
        raw: RichRawJson::from_value(value.clone()),
    }
}

fn parse_bookmarks(root: &JsonValue) -> BTreeMap<String, RichRawJson> {
    let mut out = BTreeMap::new();
    if let Some(JsonValue::Object(map)) = root.get("bookmarks") {
        for (id, value) in map {
            out.insert(id.clone(), RichRawJson::from_value(value.clone()));
        }
    }
    out
}

fn parse_named_ranges(root: &JsonValue, revision_id: &str) -> Vec<RichNamedRange> {
    let mut out = Vec::new();
    parse_named_ranges_from_container(root, revision_id, &body_plain_text(root), &mut out);
    visit_document_tabs(root, &mut |document_tab| {
        parse_named_ranges_from_container(
            document_tab,
            revision_id,
            &body_plain_text(document_tab),
            &mut out,
        );
    });
    out.sort_by(|a, b| (a.name.clone(), a.start_index).cmp(&(b.name.clone(), b.start_index)));
    out
}

fn parse_named_ranges_from_container(
    value: &JsonValue,
    revision_id: &str,
    body_text: &str,
    out: &mut Vec<RichNamedRange>,
) {
    let Some(JsonValue::Object(by_name)) = value.get("namedRanges") else {
        return;
    };
    for (name, value) in by_name {
        let Some(entries) = value.path(&["namedRanges"]).and_then(JsonValue::as_array) else {
            continue;
        };
        for entry in entries {
            let range_id = entry
                .get("namedRangeId")
                .and_then(JsonValue::as_str)
                .unwrap_or("")
                .to_string();
            let Some(ranges) = entry.get("ranges").and_then(JsonValue::as_array) else {
                continue;
            };
            for range in ranges {
                let start = number_as_u32(range.get("startIndex")).unwrap_or(0);
                let end = number_as_u32(range.get("endIndex")).unwrap_or(0);
                if end <= start {
                    continue;
                }
                let tab_id = range
                    .get("tabId")
                    .and_then(JsonValue::as_str)
                    .unwrap_or("")
                    .to_string();
                let anchor_text = slice_body_text(&body_text, start, end);
                out.push(RichNamedRange {
                    identity: identity_for(
                        &tab_id,
                        "",
                        &["namedRange", range_id.as_str()],
                        revision_id,
                        RichSourceKind::NamedRange,
                        range_id.as_str(),
                    ),
                    name: name.clone(),
                    range_id: range_id.clone(),
                    anchor_text,
                    start_index: start,
                    end_index: end,
                    source_tab_id: tab_id,
                });
            }
        }
    }
}

fn parse_suggestions(root: &JsonValue, revision_id: &str) -> Vec<RichSuggestion> {
    let mut out = Vec::new();
    let Some(JsonValue::Object(suggestions)) = root
        .get("suggestionsViewMode")
        .and_then(|_| root.get("suggestions"))
    else {
        return out;
    };
    for (id, value) in suggestions {
        let kind = match value
            .get("suggestionType")
            .and_then(JsonValue::as_str)
            .unwrap_or("")
        {
            "INSERTION" => RichSuggestionKind::Insertion,
            "DELETION" => RichSuggestionKind::Deletion,
            "FORMATTING" => RichSuggestionKind::Formatting,
            _ => RichSuggestionKind::Other,
        };
        out.push(RichSuggestion {
            identity: identity_for(
                "",
                "",
                &["suggestion", id],
                revision_id,
                RichSourceKind::Suggestion,
                id,
            ),
            suggestion_id: id.clone(),
            kind,
            raw: RichRawJson::from_value(value.clone()),
        });
    }
    out
}

fn collect_unknown_top_level_fields(root: &JsonValue) -> BTreeMap<String, RichRawJson> {
    const KNOWN: &[&str] = &[
        "documentId",
        "title",
        "revisionId",
        "body",
        "headers",
        "footers",
        "footnotes",
        "documentStyle",
        "namedStyles",
        "lists",
        "bookmarks",
        "namedRanges",
        "inlineObjects",
        "positionedObjects",
        "suggestionsViewMode",
        "tabs",
        "documentTab",
    ];
    let mut out = BTreeMap::new();
    if let JsonValue::Object(fields) = root {
        for (key, value) in fields {
            if !KNOWN.contains(&key.as_str()) {
                out.insert(key.clone(), RichRawJson::from_value(value.clone()));
            }
        }
    }
    out
}

fn body_plain_text(root: &JsonValue) -> String {
    let mut out = String::new();
    out.push(' '); // Pad index 0 so 1-based Docs slice math works.
    let Some(content) = root
        .path(&["body", "content"])
        .and_then(JsonValue::as_array)
    else {
        return out;
    };
    for element in content {
        if let Some(paragraph) = element.get("paragraph") {
            if let Some(elements) = paragraph.get("elements").and_then(JsonValue::as_array) {
                for run in elements {
                    if let Some(text) = run
                        .path(&["textRun", "content"])
                        .and_then(JsonValue::as_str)
                    {
                        out.push_str(text);
                    }
                }
            }
        }
    }
    out
}

fn slice_body_text(body: &str, start: u32, end: u32) -> String {
    let chars: Vec<char> = body.chars().collect();
    let s = start as usize;
    let e = (end as usize).min(chars.len());
    if s >= chars.len() || s >= e {
        return String::new();
    }
    let mut out: String = chars[s..e].iter().collect();
    if let Some(stripped) = out.strip_suffix('.') {
        out = stripped.to_string();
    }
    out
}

fn identity_for(
    tab_id: &str,
    segment_id: &str,
    path: &[&str],
    revision_id: &str,
    kind: RichSourceKind,
    content_hint: &str,
) -> RichNodeIdentity {
    RichNodeIdentity {
        local_id: RichNodeId::stable(tab_id, segment_id, path, content_hint),
        source_tab_id: tab_id.to_string(),
        source_segment_id: segment_id.to_string(),
        source_start_index: None,
        source_end_index: None,
        source_revision_id: revision_id.to_string(),
        source_kind: kind,
        raw_hash: String::new(),
    }
}

fn content_hash_for_paragraph(inlines: &[RichInline], style: &RichParagraphStyle) -> String {
    let mut buf = String::new();
    buf.push_str(&format!("{:?}", style.named_style));
    for inline in inlines {
        match inline {
            RichInline::TextRun(run) => buf.push_str(&run.text),
            RichInline::InlineObjectRef(o) => {
                buf.push_str("[obj:");
                buf.push_str(&o.object_id);
                buf.push(']');
            }
            RichInline::FootnoteRef(f) => {
                buf.push_str("[fn:");
                buf.push_str(&f.footnote_id);
                buf.push(']');
            }
            _ => buf.push_str("[inline]"),
        }
    }
    hex_short(&sha256(buf.as_bytes()))
}

fn stable_anchor_from_indexes(start: Option<u32>, end: Option<u32>) -> String {
    match (start, end) {
        (Some(s), Some(e)) => format!("{s}-{e}"),
        (Some(s), None) => format!("{s}-?"),
        (None, Some(e)) => format!("?-{e}"),
        _ => "?-?".to_string(),
    }
}

fn hex_short(bytes: &[u8; 32]) -> String {
    let mut out = String::with_capacity(32);
    use std::fmt::Write;
    for b in &bytes[..16] {
        let _ = write!(out, "{b:02x}");
    }
    out
}

fn dimension_to_pt(value: Option<&JsonValue>) -> Option<f32> {
    let dim = value?;
    // Docs `Dimension` is `{ magnitude, unit }`. Unit is typically "PT".
    let magnitude = number_as_f32(dim.get("magnitude"))?;
    let unit = dim.get("unit").and_then(JsonValue::as_str).unwrap_or("PT");
    Some(match unit {
        "PT" => magnitude,
        // Treat unknown units as PT — the editor should not silently drop
        // a value just because we didn't model the unit.
        _ => magnitude,
    })
}

fn number_as_u32(value: Option<&JsonValue>) -> Option<u32> {
    match value? {
        JsonValue::Number(value) => value.parse().ok(),
        _ => None,
    }
}

fn number_as_f32(value: Option<&JsonValue>) -> Option<f32> {
    match value? {
        JsonValue::Number(value) => value.parse().ok(),
        _ => None,
    }
}

fn clone_optional(root: &JsonValue, key: &str) -> RichRawJson {
    match root.get(key) {
        Some(value) => RichRawJson::from_value(value.clone()),
        None => RichRawJson::empty(),
    }
}

fn clone_optional_or_first_document_tab(root: &JsonValue, key: &str) -> RichRawJson {
    let direct = clone_optional(root, key);
    if !direct.is_empty() {
        return direct;
    }
    let mut found = RichRawJson::empty();
    visit_document_tabs(root, &mut |document_tab| {
        if found.is_empty() {
            found = clone_optional(document_tab, key);
        }
    });
    found
}

fn visit_document_tabs(root: &JsonValue, visitor: &mut impl FnMut(&JsonValue)) {
    if let Some(tabs) = root.path(&["tabs"]).and_then(JsonValue::as_array) {
        for tab in tabs {
            visit_tab(tab, visitor);
        }
    }
}

fn visit_tab(tab: &JsonValue, visitor: &mut impl FnMut(&JsonValue)) {
    if let Some(document_tab) = tab.get("documentTab") {
        visitor(document_tab);
    }
    if let Some(children) = tab.path(&["childTabs"]).and_then(JsonValue::as_array) {
        for child in children {
            visit_tab(child, visitor);
        }
    }
}

fn clone_optional_owned(value: Option<&JsonValue>, key: &str) -> RichRawJson {
    match value.and_then(|v| v.get(key)) {
        Some(value) => RichRawJson::from_value(value.clone()),
        None => RichRawJson::empty(),
    }
}

fn required_string<'a>(
    root: &'a JsonValue,
    path: &[&str],
    field: &'static str,
) -> Result<&'a str, RichParseError> {
    root.path(path)
        .and_then(JsonValue::as_str)
        .ok_or(RichParseError::MissingField(field))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_legacy_single_tab_document() {
        let raw = r#"
        {
          "documentId": "doc1",
          "title": "Example",
          "revisionId": "rev1",
          "body": {
            "content": [
              {"startIndex":1,"endIndex":9,"paragraph":{"paragraphStyle":{"namedStyleType":"HEADING_1"},"elements":[{"textRun":{"content":"Title\n"}}]}},
              {"startIndex":9,"endIndex":27,"paragraph":{"elements":[{"textRun":{"content":"Hello ","textStyle":{}}},{"textRun":{"content":"world\n","textStyle":{"bold":true,"link":{"url":"https://example.com"}}}}]}}
            ]
          }
        }"#;
        let doc = parse_rich_document(raw).unwrap();
        assert_eq!(doc.document_id, "doc1");
        assert_eq!(doc.title, "Example");
        assert_eq!(doc.revision.revision_id, "rev1");
        assert_eq!(doc.tabs.len(), 1);
        let tab = &doc.tabs[0];
        assert_eq!(tab.tab_id, "");
        assert_eq!(tab.body.blocks.len(), 2);
        match &tab.body.blocks[0] {
            RichBlock::Paragraph(p) => {
                assert_eq!(p.style.named_style, RichNamedStyle::Heading(1));
                let text = match &p.inlines[0] {
                    RichInline::TextRun(run) => run.text.clone(),
                    _ => panic!("expected text run"),
                };
                assert_eq!(text, "Title\n");
            }
            other => panic!("unexpected block: {:?}", other),
        }
        match &tab.body.blocks[1] {
            RichBlock::Paragraph(p) => {
                let bold_run = p.inlines.iter().find_map(|inline| {
                    if let RichInline::TextRun(run) = inline {
                        if run.style.bold {
                            return Some(run);
                        }
                    }
                    None
                });
                let bold_run = bold_run.expect("expected a bold run");
                assert_eq!(bold_run.text, "world\n");
                assert_eq!(
                    bold_run.style.link_url.as_deref(),
                    Some("https://example.com")
                );
            }
            _ => panic!("expected paragraph"),
        }
    }

    #[test]
    fn parses_explicit_tab_tree() {
        let raw = r#"
        {
          "documentId": "doc-tabs",
          "title": "Tabs",
          "revisionId": "rev2",
          "tabs": [
            {
              "tabProperties": {"tabId": "t1", "title": "First"},
              "documentTab": {
                "body": {"content": [
                  {"paragraph":{"elements":[{"textRun":{"content":"Outer\n"}}]}}
                ]}
              },
              "childTabs": [
                {
                  "tabProperties": {"tabId": "t1.a", "title": "Nested"},
                  "documentTab": {
                    "body": {"content": [
                      {"paragraph":{"elements":[{"textRun":{"content":"Inner\n"}}]}}
                    ]}
                  }
                }
              ]
            }
          ]
        }"#;
        let doc = parse_rich_document(raw).unwrap();
        assert_eq!(doc.tabs.len(), 1);
        let outer = &doc.tabs[0];
        assert_eq!(outer.tab_id, "t1");
        assert_eq!(outer.title, "First");
        assert_eq!(outer.body.segment_id, "body");
        assert_eq!(outer.child_tabs.len(), 1);
        match &outer.body.blocks[0] {
            RichBlock::Paragraph(paragraph) => {
                assert_eq!(paragraph.identity.source_tab_id, "t1");
                assert_eq!(paragraph.identity.source_segment_id, "body");
            }
            other => panic!("expected paragraph, got {other:?}"),
        }
        let inner = &outer.child_tabs[0];
        assert_eq!(inner.parent_tab_id.as_deref(), Some("t1"));
        assert_eq!(inner.body.segment_id, "body");
        let texts: Vec<String> = doc
            .body_blocks()
            .filter_map(|block| match block {
                RichBlock::Paragraph(p) => p.inlines.iter().find_map(|inline| {
                    if let RichInline::TextRun(run) = inline {
                        Some(run.text.trim().to_string())
                    } else {
                        None
                    }
                }),
                _ => None,
            })
            .collect();
        assert_eq!(texts, vec!["Outer".to_string(), "Inner".to_string()]);
    }

    #[test]
    fn parses_tab_scoped_catalog_fields() {
        let raw = r#"
        {
          "documentId": "doc-tabs",
          "title": "Tabs",
          "revisionId": "rev2",
          "tabs": [
            {
              "tabProperties": {"tabId": "t1", "title": "First"},
              "documentTab": {
                "documentStyle": {"marginTop": {"magnitude": 72, "unit": "PT"}},
                "namedStyles": {"styles": []},
                "body": {"content": [
                  {"paragraph":{"bullet":{"listId":"list1"},"elements":[{"textRun":{"content":"Item\n"}}]}}
                ]},
                "inlineObjects": {
                  "obj1": {"inlineObjectProperties":{"embeddedObject":{"imageProperties":{"contentUri":"https://img"},"title":"alt"}}}
                },
                "lists": {
                  "list1": {"listProperties":{"nestingLevels":[{"glyphType":"DECIMAL"}]}}
                }
              }
            }
          ]
        }"#;
        let doc = parse_rich_document(raw).unwrap();
        assert!(!doc.document_style.is_empty());
        assert!(!doc.named_styles.is_empty());
        assert!(doc.inline_objects.contains_key("obj1"));
        assert!(doc.lists.contains_key("list1"));
    }

    #[test]
    fn unsupported_structural_elements_are_preserved_with_raw_json() {
        let raw = r#"
        {
          "documentId": "doc-unsup",
          "title": "T",
          "revisionId": "rev3",
          "body": {"content": [
            {"tableOfContents": {"content": []}}
          ]}
        }"#;
        let doc = parse_rich_document(raw).unwrap();
        let block = &doc.tabs[0].body.blocks[0];
        match block {
            RichBlock::Unsupported(u) => {
                assert_eq!(u.description, "tableOfContents");
                assert!(u.raw.as_value().is_some());
            }
            _ => panic!("expected unsupported"),
        }
    }

    #[test]
    fn equation_inline_is_preserved_separately_from_text() {
        let raw = r#"
        {
          "documentId": "doc-eq",
          "title": "T",
          "revisionId": "rev",
          "body": {"content": [
            {"paragraph":{"elements":[
              {"textRun":{"content":"Pre "}},
              {"equation": {}},
              {"textRun":{"content":" Post\n"}}
            ]}}
          ]}
        }"#;
        let doc = parse_rich_document(raw).unwrap();
        let p = match &doc.tabs[0].body.blocks[0] {
            RichBlock::Paragraph(p) => p,
            _ => panic!(),
        };
        assert_eq!(p.inlines.len(), 3);
        assert!(matches!(p.inlines[1], RichInline::Equation(_)));
    }

    #[test]
    fn lists_and_inline_objects_are_catalogued() {
        let raw = r#"
        {
          "documentId":"d",
          "title":"T",
          "revisionId":"r",
          "body": {"content": [
            {"paragraph":{"bullet":{"listId":"L1","nestingLevel":0},"elements":[{"textRun":{"content":"Item\n"}}]}}
          ]},
          "lists": {"L1":{"listProperties":{"nestingLevels":[{"glyphType":"DECIMAL"}]}}},
          "inlineObjects": {"obj1":{"inlineObjectProperties":{"embeddedObject":{"imageProperties":{"contentUri":"https://img"},"title":"alt"}}}}
        }"#;
        let doc = parse_rich_document(raw).unwrap();
        let list = doc.lists.get("L1").expect("list missing");
        assert_eq!(list.nesting_levels.len(), 1);
        assert!(matches!(
            list.nesting_levels[0].glyph_type,
            RichListGlyph::Decimal
        ));
        let obj = doc.inline_objects.get("obj1").expect("object missing");
        assert!(matches!(obj.kind, RichInlineObjectKind::Image));
        assert_eq!(obj.alt_title, "alt");
        assert_eq!(obj.content_uri.as_deref(), Some("https://img"));
        let p = match &doc.tabs[0].body.blocks[0] {
            RichBlock::Paragraph(p) => p,
            _ => panic!(),
        };
        let anchor = p.list.as_ref().expect("list anchor missing");
        assert_eq!(anchor.list_id, "L1");
        assert_eq!(anchor.nesting_level, 0);
    }

    #[test]
    fn named_ranges_capture_anchor_text_via_body_indexes() {
        let raw = r#"
        {
          "documentId":"d",
          "title":"T",
          "revisionId":"r",
          "body": {"content": [
            {"paragraph":{"elements":[{"textRun":{"content":"Important phrase.\n"}}]}}
          ]},
          "namedRanges": {
            "comment-anchor": {
              "namedRanges":[{
                "namedRangeId":"kix.abc",
                "ranges":[{"startIndex":1,"endIndex":17}]
              }]
            }
          }
        }"#;
        let doc = parse_rich_document(raw).unwrap();
        assert_eq!(doc.named_ranges.len(), 1);
        let nr = &doc.named_ranges[0];
        assert_eq!(nr.name, "comment-anchor");
        assert_eq!(nr.range_id, "kix.abc");
        assert_eq!(nr.anchor_text, "Important phrase");
    }

    #[test]
    fn unknown_top_level_fields_are_preserved_for_round_trip() {
        let raw = r#"
        {
          "documentId":"d","title":"T","revisionId":"r",
          "futureField":{"answer":42}
        }"#;
        let doc = parse_rich_document(raw).unwrap();
        let raw = doc
            .unknown_fields
            .get("futureField")
            .expect("unknown field dropped");
        assert!(raw.as_value().is_some());
    }

    #[test]
    fn missing_document_id_is_an_error() {
        let raw = r#"{"title":"x"}"#;
        let err = parse_rich_document(raw).unwrap_err();
        assert!(matches!(err, RichParseError::MissingField("documentId")));
    }
}
