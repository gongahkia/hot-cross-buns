//! Editor-emitted operations on a `RichDocument`.
//!
//! Operations are the canonical edit unit. The editor never replaces the
//! whole document; it emits a sequence of `RichOperation`s that:
//!   1. apply to the local `RichDocument` (via `rich_apply.rs`),
//!   2. append to `<doc>/operation-log.jsonl` for crash recovery,
//!   3. compile to a `documents.batchUpdate` request (via `rich_batch.rs`).
//!
//! Per RICHTEXT-TODO §"Editing Operations". This module defines the
//! implemented rich-operation surface plus deferred variants for inline
//! objects / footnotes / headers / footers. Deferred variants return
//! `OperationError::NotYetImplemented` from apply/compile by design, so
//! we ship a small correct surface rather than a large broken one.

use crate::rich_index::Utf16Offset;
use crate::rich_model::{RichAlignment, RichColor, RichNodeId};

/// Envelope around every operation. Carries the metadata required for
/// replay, conflict detection, and audit.
///
/// `inverse` is populated by `rich_apply.rs` when the apply succeeds; the
/// raw operation as emitted by the editor does not need to compute it.
#[derive(Debug, Clone, PartialEq)]
pub struct RichOperationEnvelope {
    pub operation_id: String,
    pub document_id: String,
    pub tab_id: String,
    pub base_revision_id: String,
    pub local_timestamp: String,
    pub actor: String,
    pub op: RichOperation,
    pub inverse: Option<Box<RichOperation>>,
}

impl RichOperationEnvelope {
    pub fn new(
        operation_id: impl Into<String>,
        document_id: impl Into<String>,
        tab_id: impl Into<String>,
        base_revision_id: impl Into<String>,
        local_timestamp: impl Into<String>,
        actor: impl Into<String>,
        op: RichOperation,
    ) -> Self {
        Self {
            operation_id: operation_id.into(),
            document_id: document_id.into(),
            tab_id: tab_id.into(),
            base_revision_id: base_revision_id.into(),
            local_timestamp: local_timestamp.into(),
            actor: actor.into(),
            op,
            inverse: None,
        }
    }
}

/// One semantic edit. UTF-16 offsets are scoped to the *node's text*, not
/// the document body — `rich_batch.rs` translates them to Docs body
/// indexes using `source_start_index` from the node identity plus the
/// node's own UTF-16 length.
#[derive(Debug, Clone, PartialEq)]
pub enum RichOperation {
    /// Insert `text` at `(node_id, utf16_offset)` inside a paragraph's
    /// text content. The node is expected to be a `RichTextRun` *inside*
    /// the paragraph addressed by `paragraph_id`.
    InsertText {
        paragraph_id: RichNodeId,
        utf16_offset: Utf16Offset,
        text: String,
    },
    /// Delete `[utf16_start, utf16_end)` inside the paragraph's text.
    /// Spans across multiple text runs in the same paragraph but cannot
    /// cross paragraph boundaries in v1.
    DeleteRange {
        paragraph_id: RichNodeId,
        utf16_start: Utf16Offset,
        utf16_end: Utf16Offset,
    },
    /// Replace `[utf16_start, utf16_end)` inside the paragraph with
    /// `text`. Equivalent to `DeleteRange` + `InsertText` but emitted as
    /// a single op so the compiler can generate a tight batch.
    ReplaceRange {
        paragraph_id: RichNodeId,
        utf16_start: Utf16Offset,
        utf16_end: Utf16Offset,
        text: String,
    },
    /// Apply a style delta to the paragraph's `[utf16_start, utf16_end)`
    /// range. Fields set to `None` are left unchanged.
    SetTextStyle {
        paragraph_id: RichNodeId,
        utf16_start: Utf16Offset,
        utf16_end: Utf16Offset,
        delta: RichStyleDelta,
    },
    /// Clear inline character styling from the paragraph's
    /// `[utf16_start, utf16_end)` range, resetting it to the named
    /// style defaults.
    ClearTextStyle {
        paragraph_id: RichNodeId,
        utf16_start: Utf16Offset,
        utf16_end: Utf16Offset,
    },
    /// Set a paragraph's named style (heading level / title / normal).
    SetParagraphNamedStyle {
        paragraph_id: RichNodeId,
        named_style: crate::rich_model::RichNamedStyle,
    },
    /// Apply paragraph-level style changes without disturbing untouched
    /// paragraph style fields.
    SetParagraphStyle {
        paragraph_id: RichNodeId,
        delta: RichParagraphStyleDelta,
    },
    /// Update a document named-style definition, e.g. Heading 1's
    /// inherited bold/alignment defaults.
    SetNamedStyle {
        named_style: crate::rich_model::RichNamedStyle,
        delta: RichNamedStyleDelta,
    },
    /// Add a hyperlink to a range. Equivalent to `SetTextStyle` with
    /// `link_url` set, but exposed separately so the editor can model
    /// "create link" as a distinct user intent.
    CreateLink {
        paragraph_id: RichNodeId,
        utf16_start: Utf16Offset,
        utf16_end: Utf16Offset,
        url: String,
    },
    /// Remove a hyperlink from a range. Equivalent to `SetTextStyle` with
    /// `link_url: Some(None)`, but explicit for symmetry with `CreateLink`.
    DeleteLink {
        paragraph_id: RichNodeId,
        utf16_start: Utf16Offset,
        utf16_end: Utf16Offset,
    },

    // ---- table shape operations ----
    /// V2: insert a new empty table at `paragraph_id`.
    InsertTable {
        paragraph_id: RichNodeId,
        rows: u32,
        columns: u32,
    },
    DeleteTable {
        table_id: RichNodeId,
    },
    InsertTableRow {
        table_id: RichNodeId,
        row_index: u32,
        insert_below: bool,
    },
    DeleteTableRow {
        table_id: RichNodeId,
        row_index: u32,
    },
    InsertTableColumn {
        table_id: RichNodeId,
        column_index: u32,
        insert_right: bool,
    },
    DeleteTableColumn {
        table_id: RichNodeId,
        column_index: u32,
    },
    /// Cancel a previously queued local operation before it is compiled
    /// into a Google Docs batch. This is used by AppKit undo for
    /// destructive operations whose lossless inverse cannot be expressed
    /// after the delete has already reached the server.
    CancelOperation {
        operation_id: String,
    },
    SetTableCellStyle {
        table_id: RichNodeId,
        row_index: u32,
        column_index: u32,
        row_span: u32,
        column_span: u32,
        delta: RichTableCellStyleDelta,
    },
    SetTableColumnWidth {
        table_id: RichNodeId,
        column_index: u32,
        width_pt: f32,
    },
    SetTableRowMinHeight {
        table_id: RichNodeId,
        row_index: u32,
        min_height_pt: f32,
    },
    MergeTableCells {
        table_id: RichNodeId,
        row_index: u32,
        column_index: u32,
        row_span: u32,
        column_span: u32,
    },
    UnmergeTableCells {
        table_id: RichNodeId,
        row_index: u32,
        column_index: u32,
        row_span: u32,
        column_span: u32,
    },

    // ---- list operations ----
    CreateList {
        paragraph_id: RichNodeId,
        ordered: bool,
    },
    UpdateListNesting {
        paragraph_id: RichNodeId,
        nesting_level: u8,
    },
    DeleteList {
        paragraph_id: RichNodeId,
    },

    // ---- declared, not yet implemented ----
    InsertInlineImage {
        paragraph_id: RichNodeId,
        utf16_offset: Utf16Offset,
        uri: String,
    },
    DeleteInlineObject {
        object_id: String,
    },
    CreateHeader,
    DeleteHeader {
        header_id: String,
    },
    CreateFooter,
    DeleteFooter {
        footer_id: String,
    },
    CreateFootnote {
        paragraph_id: RichNodeId,
        utf16_offset: Utf16Offset,
    },
    DeleteFootnote {
        footnote_id: String,
    },
    /// Sentinel that protects an unsupported region from being silently
    /// dropped. Apply is a no-op; compile emits nothing. Useful when the
    /// editor needs to acknowledge "user tried to edit through a protected
    /// node" without actually editing.
    NoOpUnsupportedProtection {
        node_id: RichNodeId,
    },
}

/// Style delta for `SetTextStyle`. `Some(value)` overrides; `None` leaves
/// the existing style on the run unchanged. `Some(None)` for an `Option`
/// field clears that field.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct RichStyleDelta {
    pub bold: Option<bool>,
    pub italic: Option<bool>,
    pub underline: Option<bool>,
    pub strikethrough: Option<bool>,
    pub font_family: Option<Option<String>>,
    pub font_size_pt: Option<Option<f32>>,
    pub foreground_color: Option<Option<RichColor>>,
    pub background_color: Option<Option<RichColor>>,
    /// Outer Option = "is this delta touching link?"; inner Option = "set
    /// to URL / clear to None".
    pub link_url: Option<Option<String>>,
}

/// Paragraph-level style delta for `SetParagraphStyle`.
/// `None` means "leave unchanged".
#[derive(Debug, Clone, Default, PartialEq)]
pub struct RichParagraphStyleDelta {
    pub alignment: Option<RichAlignment>,
    pub indent_start: Option<f32>,
    pub indent_end: Option<f32>,
    pub indent_first_line: Option<f32>,
    pub line_spacing: Option<f32>,
    pub space_above: Option<f32>,
    pub space_below: Option<f32>,
}

/// Named-style definition delta for `SetNamedStyle`.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct RichNamedStyleDelta {
    pub text_style: RichStyleDelta,
    pub paragraph_style: RichParagraphStyleDelta,
}

/// Cell-level style delta for `SetTableCellStyle`.
/// Outer Option means "touch this field"; inner Option means "set to
/// this value" or "clear/reset".
#[derive(Debug, Clone, Default, PartialEq)]
pub struct RichTableCellStyleDelta {
    pub background_color: Option<Option<RichColor>>,
    pub border_width_pt: Option<Option<f32>>,
    pub border_color: Option<Option<RichColor>>,
    pub border_dash_style: Option<Option<RichTableBorderDashStyle>>,
    pub border_top_width_pt: Option<Option<f32>>,
    pub border_right_width_pt: Option<Option<f32>>,
    pub border_bottom_width_pt: Option<Option<f32>>,
    pub border_left_width_pt: Option<Option<f32>>,
    pub padding_pt: Option<Option<f32>>,
    pub content_alignment: Option<Option<RichTableCellContentAlignment>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RichTableBorderDashStyle {
    Solid,
    Dot,
    Dash,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RichTableCellContentAlignment {
    Top,
    Middle,
    Bottom,
}

impl RichTableCellStyleDelta {
    pub fn background_color(color: Option<RichColor>) -> Self {
        Self {
            background_color: Some(color),
            ..Self::default()
        }
    }

    pub fn is_empty(&self) -> bool {
        self.background_color.is_none()
            && self.border_width_pt.is_none()
            && self.border_color.is_none()
            && self.border_dash_style.is_none()
            && self.border_top_width_pt.is_none()
            && self.border_right_width_pt.is_none()
            && self.border_bottom_width_pt.is_none()
            && self.border_left_width_pt.is_none()
            && self.padding_pt.is_none()
            && self.content_alignment.is_none()
    }
}

impl RichNamedStyleDelta {
    pub fn is_empty(&self) -> bool {
        self.text_style.is_empty() && self.paragraph_style.is_empty()
    }
}

impl RichParagraphStyleDelta {
    pub fn alignment(value: RichAlignment) -> Self {
        Self {
            alignment: Some(value),
            ..Self::default()
        }
    }

    pub fn is_empty(&self) -> bool {
        self.alignment.is_none()
            && self.indent_start.is_none()
            && self.indent_end.is_none()
            && self.indent_first_line.is_none()
            && self.line_spacing.is_none()
            && self.space_above.is_none()
            && self.space_below.is_none()
    }
}

impl RichStyleDelta {
    pub fn bold(value: bool) -> Self {
        Self {
            bold: Some(value),
            ..Self::default()
        }
    }

    pub fn italic(value: bool) -> Self {
        Self {
            italic: Some(value),
            ..Self::default()
        }
    }

    pub fn link(url: Option<String>) -> Self {
        Self {
            link_url: Some(url),
            ..Self::default()
        }
    }

    pub fn font_family(value: Option<String>) -> Self {
        Self {
            font_family: Some(value),
            ..Self::default()
        }
    }

    pub fn font_size_pt(value: Option<f32>) -> Self {
        Self {
            font_size_pt: Some(value),
            ..Self::default()
        }
    }

    pub fn foreground_color(value: Option<RichColor>) -> Self {
        Self {
            foreground_color: Some(value),
            ..Self::default()
        }
    }

    pub fn background_color(value: Option<RichColor>) -> Self {
        Self {
            background_color: Some(value),
            ..Self::default()
        }
    }

    pub fn is_empty(&self) -> bool {
        self.bold.is_none()
            && self.italic.is_none()
            && self.underline.is_none()
            && self.strikethrough.is_none()
            && self.font_family.is_none()
            && self.font_size_pt.is_none()
            && self.foreground_color.is_none()
            && self.background_color.is_none()
            && self.link_url.is_none()
    }
}

/// Errors surfaced by apply / compile / validate.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OperationError {
    /// The addressed node was not found in the local document. Usually
    /// means the document has been re-pulled and the operation's
    /// `paragraph_id` is now stale; the editor should re-emit against the
    /// fresh model.
    NodeNotFound(String),
    /// The addressed node exists but is not a text-bearing node (e.g.
    /// `InsertText` against a table block).
    WrongNodeKind {
        node_id: String,
        expected: &'static str,
    },
    /// UTF-16 offset is past the end of the node's text, or end < start.
    OffsetOutOfRange {
        node_id: String,
        offset: u32,
        max: u32,
    },
    /// Operation kind is declared but not yet implemented in V1.
    NotYetImplemented(&'static str),
    /// Wrapper for `crate::rich_index::IndexError`s that bubble out of
    /// boundary clamping.
    Index(String),
    /// The op tried to edit through a `RichUnsupported` node.
    ProtectedNode(String),
}

impl std::fmt::Display for OperationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            OperationError::NodeNotFound(id) => write!(f, "node not found: {id}"),
            OperationError::WrongNodeKind { node_id, expected } => {
                write!(f, "wrong node kind for {node_id}: expected {expected}")
            }
            OperationError::OffsetOutOfRange {
                node_id,
                offset,
                max,
            } => {
                write!(f, "offset {offset} past end {max} for node {node_id}")
            }
            OperationError::NotYetImplemented(name) => {
                write!(f, "operation not yet implemented in V1: {name}")
            }
            OperationError::Index(message) => write!(f, "index error: {message}"),
            OperationError::ProtectedNode(id) => {
                write!(f, "tried to edit through protected node: {id}")
            }
        }
    }
}

impl std::error::Error for OperationError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn style_delta_helpers_set_only_target_field() {
        let bold = RichStyleDelta::bold(true);
        assert_eq!(bold.bold, Some(true));
        assert_eq!(bold.italic, None);
        assert!(!bold.is_empty());

        let cleared_link = RichStyleDelta::link(None);
        assert_eq!(cleared_link.link_url, Some(None));

        let foreground = RichStyleDelta::foreground_color(Some(RichColor {
            red: 1.0,
            green: 0.0,
            blue: 0.0,
        }));
        assert_eq!(
            foreground.foreground_color,
            Some(Some(RichColor {
                red: 1.0,
                green: 0.0,
                blue: 0.0,
            }))
        );

        assert!(RichStyleDelta::default().is_empty());
    }

    #[test]
    fn envelope_carries_metadata() {
        let env = RichOperationEnvelope::new(
            "op-1",
            "doc-1",
            "",
            "rev-1",
            "2026-05-04T00:00:00Z",
            "user@example.com",
            RichOperation::InsertText {
                paragraph_id: RichNodeId::synthetic("p"),
                utf16_offset: Utf16Offset(0),
                text: "hi".to_string(),
            },
        );
        assert_eq!(env.operation_id, "op-1");
        assert_eq!(env.document_id, "doc-1");
        assert!(env.inverse.is_none());
    }
}
