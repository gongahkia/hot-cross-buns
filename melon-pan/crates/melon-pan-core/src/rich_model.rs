//! Canonical rich-document model.
//!
//! Replaces the previous Markdown-leaning DocsDocument as the in-memory
//! projection of a Google Docs document. Carries every structural concern
//! the editor and sync layers need: tabs, segments, headers, footers,
//! footnotes, named ranges, suggestions, inline objects, and raw JSON for
//! anything we don't model yet.
//!
//! Every node carries a stable identity envelope (`RichNodeId`) so editor
//! operations can address a node without depending on Docs positional
//! indexes, which shift on every insert/delete.

use crate::json::JsonValue;
use crate::sha256::sha256;
use std::collections::BTreeMap;

/// Schema version stamped onto serialized rich docs. Bump when the layout
/// of these structs changes in a way that breaks on-disk caches.
pub const RICH_SCHEMA_VERSION: u32 = 1;

/// Stable identifier for a rich node.
///
/// Derived from a tab id + segment id + structural path + content hash so
/// that re-parsing the same Docs JSON yields the same id, while two
/// distinct nodes never collide. Falls back to `Synthetic` when the input
/// has no anchorable identity (e.g. a freshly-typed paragraph the user
/// hasn't synced yet).
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum RichNodeId {
    /// Hash hex of `(tab|segment|path|content_hash)`. Stable across pulls.
    Stable(String),
    /// Caller-provided UUID-shaped string, used when no stable anchor exists.
    Synthetic(String),
}

impl RichNodeId {
    pub fn as_str(&self) -> &str {
        match self {
            RichNodeId::Stable(value) | RichNodeId::Synthetic(value) => value,
        }
    }

    /// Builds a stable id by hashing the structural path and content hash.
    /// `tab_id` and `segment_id` may be empty for legacy single-tab docs.
    pub fn stable(
        tab_id: &str,
        segment_id: &str,
        structural_path: &[&str],
        content_hash: &str,
    ) -> Self {
        let mut buf = String::with_capacity(64);
        buf.push_str(tab_id);
        buf.push('|');
        buf.push_str(segment_id);
        buf.push('|');
        for part in structural_path {
            buf.push_str(part);
            buf.push('/');
        }
        buf.push('|');
        buf.push_str(content_hash);
        let digest = sha256(buf.as_bytes());
        // 16 bytes / 32 hex chars is plenty of collision resistance for
        // local identity and keeps disk size down.
        let mut hex = String::with_capacity(32);
        for byte in &digest[..16] {
            use std::fmt::Write;
            let _ = write!(hex, "{byte:02x}");
        }
        RichNodeId::Stable(hex)
    }

    /// Build a synthetic id from a caller-provided seed (e.g. operation id +
    /// counter). The runtime is responsible for providing seeds that will
    /// not collide within an open document.
    pub fn synthetic(seed: impl Into<String>) -> Self {
        RichNodeId::Synthetic(seed.into())
    }
}

/// Identity + provenance carried by every node.
///
/// `source_*` fields preserve where the node came from in the raw Docs
/// JSON so operations can be replayed against a freshly pulled document.
/// `raw_hash` is the sha256-hex of the canonical content; if it changes,
/// the node has been edited locally.
#[derive(Debug, Clone, PartialEq)]
pub struct RichNodeIdentity {
    pub local_id: RichNodeId,
    pub source_tab_id: String,
    pub source_segment_id: String,
    pub source_start_index: Option<u32>,
    pub source_end_index: Option<u32>,
    pub source_revision_id: String,
    pub source_kind: RichSourceKind,
    pub raw_hash: String,
}

impl RichNodeIdentity {
    /// Identity for nodes that have no Docs counterpart yet (locally created
    /// before first sync). Source indexes/revision are blank.
    pub fn local_only(local_id: RichNodeId, source_kind: RichSourceKind) -> Self {
        Self {
            local_id,
            source_tab_id: String::new(),
            source_segment_id: String::new(),
            source_start_index: None,
            source_end_index: None,
            source_revision_id: String::new(),
            source_kind,
            raw_hash: String::new(),
        }
    }
}

/// Where in the Docs JSON tree this node was originally parsed from.
/// Used for routing operations back to the correct request type.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum RichSourceKind {
    Body,
    Header,
    Footer,
    Footnote,
    TableCell,
    InlineObject,
    NamedRange,
    DocumentStyle,
    NamedStyle,
    List,
    Tab,
    Suggestion,
    Bookmark,
    Unknown,
}

/// Top-level rich document. One per open Google Doc.
#[derive(Debug, Clone, PartialEq)]
pub struct RichDocument {
    pub schema_version: u32,
    pub identity: RichNodeIdentity,
    pub document_id: String,
    pub title: String,
    pub revision: RichRevision,
    /// Top-level tab tree. Single-tab legacy docs synthesize one root tab
    /// so callers can ignore the legacy/multi-tab distinction.
    pub tabs: Vec<RichTab>,
    /// Document-wide style (default font, page size, margins, etc.) kept
    /// as raw JSON until we model it.
    pub document_style: RichRawJson,
    /// Map of named-style-type -> style metadata, raw for now.
    pub named_styles: RichRawJson,
    /// Ordered list of named-range snapshots — used by sync layer to verify
    /// anchors survive a push.
    pub named_ranges: Vec<RichNamedRange>,
    /// Suggestions/tracked changes — preserved verbatim.
    pub suggestions: Vec<RichSuggestion>,
    /// Inline-object catalog keyed by Docs inlineObjectId. Body anchors
    /// reference these by id.
    pub inline_objects: BTreeMap<String, RichInlineObject>,
    /// List metadata catalog keyed by Docs listId. Paragraphs reference
    /// list ids; this preserves nesting glyphs and properties.
    pub lists: BTreeMap<String, RichList>,
    /// Bookmarks keyed by Docs bookmarkId, raw for now.
    pub bookmarks: BTreeMap<String, RichRawJson>,
    /// Anything else from the response we didn't recognize, keyed by the
    /// top-level field name. Preserved on push.
    pub unknown_fields: BTreeMap<String, RichRawJson>,
}

/// Revision/version envelope.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct RichRevision {
    pub revision_id: String,
    /// Drive `modifiedTime` (RFC3339).
    pub modified_time: String,
    /// Wall-clock time at which we pulled this revision.
    pub pulled_at: String,
}

/// One Google Docs tab.
///
/// Tabs can nest. `child_tabs` carries the nested tabs verbatim; the editor
/// surfaces them as a sub-selector.
#[derive(Debug, Clone, PartialEq)]
pub struct RichTab {
    pub identity: RichNodeIdentity,
    pub tab_id: String,
    pub title: String,
    pub index: u32,
    pub parent_tab_id: Option<String>,
    /// Body segment of this tab. Always present.
    pub body: RichSegment,
    /// Headers keyed by Docs headerId.
    pub headers: BTreeMap<String, RichSegment>,
    /// Footers keyed by Docs footerId.
    pub footers: BTreeMap<String, RichSegment>,
    /// Footnotes keyed by Docs footnoteId.
    pub footnotes: BTreeMap<String, RichSegment>,
    pub child_tabs: Vec<RichTab>,
}

/// A segment is a flat ordered list of blocks (body, header, footer, footnote).
#[derive(Debug, Clone, PartialEq)]
pub struct RichSegment {
    pub identity: RichNodeIdentity,
    pub segment_id: String,
    pub kind: RichSourceKind,
    pub blocks: Vec<RichBlock>,
    /// Raw segment-level style (e.g. section style for body segments).
    pub style: RichRawJson,
}

/// A top-level block within a segment.
#[derive(Debug, Clone, PartialEq)]
pub enum RichBlock {
    Paragraph(RichParagraph),
    Table(RichTable),
    SectionBreak(RichSectionBreak),
    /// An element we don't model. Preserved verbatim and rendered as a
    /// protected placeholder in the editor.
    Unsupported(RichUnsupported),
}

#[derive(Debug, Clone, PartialEq)]
pub struct RichParagraph {
    pub identity: RichNodeIdentity,
    pub style: RichParagraphStyle,
    pub list: Option<RichListAnchor>,
    pub inlines: Vec<RichInline>,
    /// Raw bullet/style fields we didn't normalize.
    pub raw_extras: RichRawJson,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct RichParagraphStyle {
    pub named_style: RichNamedStyle,
    pub alignment: Option<RichAlignment>,
    pub indent_start: Option<f32>,
    pub indent_end: Option<f32>,
    pub indent_first_line: Option<f32>,
    pub line_spacing: Option<f32>,
    pub space_above: Option<f32>,
    pub space_below: Option<f32>,
    /// Anything else from `paragraphStyle` we didn't normalize.
    pub raw: RichRawJson,
}

#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub enum RichNamedStyle {
    #[default]
    NormalText,
    Title,
    Subtitle,
    Heading(u8),
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum RichAlignment {
    Start,
    Center,
    End,
    Justified,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RichListAnchor {
    pub list_id: String,
    pub nesting_level: u8,
}

/// One element inside a paragraph: a styled text run, an inline object,
/// a footnote ref, a smart chip, etc.
#[derive(Debug, Clone, PartialEq)]
pub enum RichInline {
    TextRun(RichTextRun),
    InlineObjectRef(RichInlineObjectRef),
    FootnoteRef(RichFootnoteRef),
    PageBreak(RichInlineMarker),
    ColumnBreak(RichInlineMarker),
    HorizontalRule(RichInlineMarker),
    AutoText(RichInlineMarker),
    Equation(RichEquation),
    PersonChip(RichPersonChip),
    RichLinkChip(RichRichLinkChip),
    Unsupported(RichUnsupported),
}

#[derive(Debug, Clone, PartialEq)]
pub struct RichInlineMarker {
    pub identity: RichNodeIdentity,
    pub raw: RichRawJson,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RichTextRun {
    pub identity: RichNodeIdentity,
    pub text: String,
    pub style: RichStyle,
}

/// Inline character-level style. Mirrors the Docs `textStyle` surface but
/// keeps only fields the editor renders/edits; the rest stays in `raw`.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct RichStyle {
    pub bold: bool,
    pub italic: bool,
    pub underline: bool,
    pub strikethrough: bool,
    pub small_caps: bool,
    pub baseline: RichBaselineOffset,
    pub font_family: Option<String>,
    pub font_size_pt: Option<f32>,
    pub weighted_font_weight: Option<i32>,
    pub foreground_color: Option<RichColor>,
    pub background_color: Option<RichColor>,
    pub link_url: Option<String>,
    /// Original Docs `textStyle` JSON for fields we didn't promote.
    pub raw: RichRawJson,
}

#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub enum RichBaselineOffset {
    #[default]
    None,
    Subscript,
    Superscript,
}

/// RGB color, components in 0..=1. None of the fields are required;
/// Docs sometimes returns `{}` for "default theme color" which we keep as
/// `None` everywhere.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RichColor {
    pub red: f32,
    pub green: f32,
    pub blue: f32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RichInlineObjectRef {
    pub identity: RichNodeIdentity,
    pub object_id: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RichFootnoteRef {
    pub identity: RichNodeIdentity,
    pub footnote_id: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RichEquation {
    pub identity: RichNodeIdentity,
    /// Docs API v1 does not expose equation source, so this is the raw
    /// element JSON for round-tripping.
    pub raw: RichRawJson,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RichPersonChip {
    pub identity: RichNodeIdentity,
    pub person_id: Option<String>,
    pub display_text: String,
    pub raw: RichRawJson,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RichRichLinkChip {
    pub identity: RichNodeIdentity,
    pub uri: String,
    pub title: String,
    pub raw: RichRawJson,
}

/// Standalone inline object (image/drawing/chart/etc.) referenced by id
/// from text runs.
#[derive(Debug, Clone, PartialEq)]
pub struct RichInlineObject {
    pub identity: RichNodeIdentity,
    pub object_id: String,
    pub kind: RichInlineObjectKind,
    pub alt_title: String,
    pub alt_description: String,
    pub content_uri: Option<String>,
    pub raw: RichRawJson,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum RichInlineObjectKind {
    Image,
    Drawing,
    Chart,
    Other,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RichTable {
    pub identity: RichNodeIdentity,
    pub start_index: u32,
    pub rows: Vec<RichTableRow>,
    pub columns: u32,
    pub raw_style: RichRawJson,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RichTableRow {
    pub identity: RichNodeIdentity,
    pub cells: Vec<RichTableCell>,
    pub raw_style: RichRawJson,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RichTableCell {
    pub identity: RichNodeIdentity,
    pub content: Vec<RichBlock>,
    pub row_span: u32,
    pub column_span: u32,
    pub raw_style: RichRawJson,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RichSectionBreak {
    pub identity: RichNodeIdentity,
    pub raw: RichRawJson,
}

/// Everything we can't represent yet. Editor renders as protected
/// placeholder. `raw` is the verbatim JSON node the parser saw.
#[derive(Debug, Clone, PartialEq)]
pub struct RichUnsupported {
    pub identity: RichNodeIdentity,
    pub stable_anchor: String,
    pub description: String,
    pub raw: RichRawJson,
}

/// Owned raw JSON kept for round-tripping. Wrapping it in a struct lets us
/// add canonical hashing/serialization helpers later without changing the
/// shape of every site that holds raw fragments.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct RichRawJson(pub Option<JsonValue>);

impl RichRawJson {
    pub fn empty() -> Self {
        RichRawJson(None)
    }

    pub fn from_value(value: JsonValue) -> Self {
        RichRawJson(Some(value))
    }

    pub fn from_optional(value: Option<JsonValue>) -> Self {
        RichRawJson(value)
    }

    pub fn as_value(&self) -> Option<&JsonValue> {
        self.0.as_ref()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_none()
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct RichNamedRange {
    pub identity: RichNodeIdentity,
    pub name: String,
    pub range_id: String,
    pub anchor_text: String,
    pub start_index: u32,
    pub end_index: u32,
    pub source_tab_id: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RichSuggestion {
    pub identity: RichNodeIdentity,
    pub suggestion_id: String,
    pub kind: RichSuggestionKind,
    pub raw: RichRawJson,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum RichSuggestionKind {
    Insertion,
    Deletion,
    Formatting,
    Other,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RichList {
    pub identity: RichNodeIdentity,
    pub list_id: String,
    pub nesting_levels: Vec<RichListLevel>,
    pub raw: RichRawJson,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RichListLevel {
    pub glyph_type: RichListGlyph,
    pub start_number: Option<u32>,
    pub indent_first_line: Option<f32>,
    pub indent_start: Option<f32>,
    pub raw: RichRawJson,
}

#[derive(Debug, Clone, PartialEq)]
pub enum RichListGlyph {
    Bullet(String),
    Decimal,
    AlphaUpper,
    AlphaLower,
    RomanUpper,
    RomanLower,
    Unspecified,
    Other(String),
}

/// Position inside a rich document, addressing a node by stable id and an
/// inline UTF-16 offset within that node when applicable.
///
/// Editor selection is built from `RichPosition` pairs; the index module
/// is responsible for converting to/from Docs body indexes when emitting
/// batchUpdate requests.
#[derive(Debug, Clone, PartialEq)]
pub struct RichPosition {
    pub tab_id: String,
    pub segment_id: String,
    pub node_id: RichNodeId,
    /// UTF-16 code-unit offset within the node's text, when meaningful.
    pub utf16_offset: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RichRange {
    pub start: RichPosition,
    pub end: RichPosition,
}

#[derive(Debug, Clone, PartialEq)]
pub enum RichSelection {
    Caret(RichPosition),
    Range(RichRange),
    /// Multi-range selection (rectangular table selection, find-all, etc.).
    /// Empty vec means "no selection".
    Multi(Vec<RichRange>),
    /// Whole-table or whole-object selection — the node is selected as an
    /// opaque unit, no inline offset.
    Object {
        tab_id: String,
        node_id: RichNodeId,
    },
}

/// Anchor used by comments/named ranges to point into the document
/// independently of byte indexes. Resolved against `RichNodeId`s.
#[derive(Debug, Clone, PartialEq)]
pub struct RichAnchor {
    pub anchor_id: String,
    pub tab_id: String,
    pub start: RichPosition,
    pub end: RichPosition,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct RichCommentAuthor {
    pub display_name: String,
    pub email_address: Option<String>,
    pub photo_link: Option<String>,
    pub me: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RichCommentQuotedFileContent {
    pub mime_type: String,
    pub value: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct RichCommentReply {
    pub id: String,
    pub author: Option<RichCommentAuthor>,
    pub content: String,
    pub html_content: String,
    pub created_time: Option<String>,
    pub modified_time: Option<String>,
    pub deleted: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct RichComment {
    pub id: String,
    pub author: Option<RichCommentAuthor>,
    pub content: String,
    pub html_content: String,
    /// Raw Drive comment anchor JSON/string. Drive anchors are intentionally
    /// stored verbatim here because Google may return legacy string anchors or
    /// structured anchors depending on the producer. The editor can display
    /// quote/context immediately and resolve exact ranges later.
    pub anchor: Option<String>,
    pub quoted_file_content: Option<RichCommentQuotedFileContent>,
    pub resolved: bool,
    pub created_time: Option<String>,
    pub modified_time: Option<String>,
    pub replies: Vec<RichCommentReply>,
}

impl RichDocument {
    /// Skeleton document with no body content. Used by the parser before
    /// it has populated tabs/lists/etc., and by tests.
    pub fn skeleton(document_id: impl Into<String>, title: impl Into<String>) -> Self {
        let document_id = document_id.into();
        let title = title.into();
        let identity = RichNodeIdentity::local_only(
            RichNodeId::stable("", "", &["document", document_id.as_str()], ""),
            RichSourceKind::Body,
        );
        Self {
            schema_version: RICH_SCHEMA_VERSION,
            identity,
            document_id,
            title,
            revision: RichRevision::default(),
            tabs: Vec::new(),
            document_style: RichRawJson::empty(),
            named_styles: RichRawJson::empty(),
            named_ranges: Vec::new(),
            suggestions: Vec::new(),
            inline_objects: BTreeMap::new(),
            lists: BTreeMap::new(),
            bookmarks: BTreeMap::new(),
            unknown_fields: BTreeMap::new(),
        }
    }

    /// Iterates body blocks in document order across every tab. Used by
    /// search/outline/plain-text extraction.
    pub fn body_blocks(&self) -> impl Iterator<Item = &RichBlock> {
        TabBlockIter::new(&self.tabs)
    }
}

/// Depth-first walk of every tab's body segment. Headers/footers/footnotes
/// are exposed through their own iterators when needed; outline/search
/// only want body blocks.
struct TabBlockIter<'a> {
    stack: Vec<TabFrame<'a>>,
}

struct TabFrame<'a> {
    blocks: std::slice::Iter<'a, RichBlock>,
    children: std::slice::Iter<'a, RichTab>,
}

impl<'a> TabBlockIter<'a> {
    fn new(tabs: &'a [RichTab]) -> Self {
        let mut stack = Vec::new();
        push_tabs(&mut stack, tabs);
        Self { stack }
    }
}

fn push_tabs<'a>(stack: &mut Vec<TabFrame<'a>>, tabs: &'a [RichTab]) {
    // Reverse so the first tab is on top of the stack.
    for tab in tabs.iter().rev() {
        stack.push(TabFrame {
            blocks: tab.body.blocks.iter(),
            children: tab.child_tabs.iter(),
        });
    }
}

impl<'a> Iterator for TabBlockIter<'a> {
    type Item = &'a RichBlock;

    fn next(&mut self) -> Option<Self::Item> {
        loop {
            let frame = self.stack.last_mut()?;
            if let Some(block) = frame.blocks.next() {
                return Some(block);
            }
            // Body exhausted; descend into nested tabs before popping.
            if let Some(child) = frame.children.next() {
                self.stack.push(TabFrame {
                    blocks: child.body.blocks.iter(),
                    children: child.child_tabs.iter(),
                });
                continue;
            }
            self.stack.pop();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stable_id_is_deterministic_and_path_sensitive() {
        let a = RichNodeId::stable("tab1", "seg1", &["paragraph", "0"], "deadbeef");
        let b = RichNodeId::stable("tab1", "seg1", &["paragraph", "0"], "deadbeef");
        let c = RichNodeId::stable("tab1", "seg1", &["paragraph", "1"], "deadbeef");
        assert_eq!(a, b);
        assert_ne!(a, c);
        assert_eq!(a.as_str().len(), 32); // 16 bytes hex
    }

    #[test]
    fn stable_and_synthetic_ids_do_not_compare_equal_when_text_matches() {
        let stable = RichNodeId::stable("", "", &["x"], "y");
        let synthetic = RichNodeId::synthetic(stable.as_str().to_string());
        // Same hex string but different variant — distinct identity.
        assert_ne!(stable, synthetic);
    }

    #[test]
    fn skeleton_document_has_schema_version_and_identity() {
        let doc = RichDocument::skeleton("doc-1", "Untitled");
        assert_eq!(doc.schema_version, RICH_SCHEMA_VERSION);
        assert_eq!(doc.document_id, "doc-1");
        assert_eq!(doc.title, "Untitled");
        assert!(doc.tabs.is_empty());
        assert!(matches!(doc.identity.local_id, RichNodeId::Stable(_)));
    }

    #[test]
    fn body_blocks_iterates_nested_tabs_in_order() {
        fn ident(seed: &str) -> RichNodeIdentity {
            RichNodeIdentity::local_only(
                RichNodeId::synthetic(seed.to_string()),
                RichSourceKind::Body,
            )
        }
        fn paragraph(text: &str) -> RichBlock {
            RichBlock::Paragraph(RichParagraph {
                identity: ident(text),
                style: RichParagraphStyle::default(),
                list: None,
                inlines: vec![RichInline::TextRun(RichTextRun {
                    identity: ident(&format!("{text}.run")),
                    text: text.to_string(),
                    style: RichStyle::default(),
                })],
                raw_extras: RichRawJson::empty(),
            })
        }
        fn segment(blocks: Vec<RichBlock>, seed: &str) -> RichSegment {
            RichSegment {
                identity: ident(&format!("{seed}.seg")),
                segment_id: seed.to_string(),
                kind: RichSourceKind::Body,
                blocks,
                style: RichRawJson::empty(),
            }
        }
        fn tab(id: &str, blocks: Vec<RichBlock>, children: Vec<RichTab>) -> RichTab {
            RichTab {
                identity: ident(&format!("{id}.tab")),
                tab_id: id.to_string(),
                title: id.to_string(),
                index: 0,
                parent_tab_id: None,
                body: segment(blocks, id),
                headers: BTreeMap::new(),
                footers: BTreeMap::new(),
                footnotes: BTreeMap::new(),
                child_tabs: children,
            }
        }
        let mut doc = RichDocument::skeleton("doc-1", "T");
        doc.tabs.push(tab(
            "root",
            vec![paragraph("root-a"), paragraph("root-b")],
            vec![tab("nested", vec![paragraph("nested-a")], vec![])],
        ));
        doc.tabs
            .push(tab("second", vec![paragraph("second-a")], vec![]));

        let texts: Vec<String> = doc
            .body_blocks()
            .filter_map(|block| match block {
                RichBlock::Paragraph(paragraph) => paragraph.inlines.iter().find_map(|inline| {
                    if let RichInline::TextRun(run) = inline {
                        Some(run.text.clone())
                    } else {
                        None
                    }
                }),
                _ => None,
            })
            .collect();
        assert_eq!(
            texts,
            vec!["root-a", "root-b", "nested-a", "second-a"]
                .into_iter()
                .map(String::from)
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn raw_json_round_trips_optional_value() {
        let raw = RichRawJson::from_value(JsonValue::String("hi".to_string()));
        assert_eq!(raw.as_value().and_then(JsonValue::as_str), Some("hi"));
        assert!(!raw.is_empty());
        let empty = RichRawJson::empty();
        assert!(empty.is_empty());
        assert!(empty.as_value().is_none());
    }
}
