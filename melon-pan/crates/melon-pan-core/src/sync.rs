//! Pull-side persistence pipeline for rich Google Docs.
//!
//! Markdown was removed from the core in the rich-docs-only cut. Pulls now
//! cache `current.docs.json` (raw API payload) and the parsed
//! `RichDocument` is the in-memory canonical form. A plain-text projection
//! is still produced for Spotlight/search/preview/diagnostics — never as a
//! source of truth.

use crate::fidelity::FidelityReport;
use crate::rich_model::{
    RichBlock, RichDocument, RichInline, RichListGlyph, RichNamedStyle, RichTab,
};
use crate::storage::{LocalCacheStore, MetadataRecord};
use std::io;

#[derive(Debug, Clone, PartialEq)]
pub struct PulledDocument {
    pub document: RichDocument,
    pub raw_docs_json: String,
    pub drive_modified_time: String,
    pub pulled_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PersistedPull {
    pub document_id: String,
    pub revision_id: String,
    pub plain_text: String,
    pub metadata: MetadataRecord,
}

pub fn persist_pulled_document(
    store: &LocalCacheStore,
    pulled: PulledDocument,
) -> io::Result<PersistedPull> {
    let document_id = pulled.document.document_id.clone();
    let revision_id = pulled.document.revision.revision_id.clone();
    let plain_text = docs_to_plain_text(&pulled.document);

    let metadata = MetadataRecord::from_rich_pull(
        document_id.clone(),
        revision_id.clone(),
        pulled.drive_modified_time.clone(),
        pulled.pulled_at.clone(),
        &pulled.raw_docs_json,
        FidelityReport::perfect(),
    );

    // Snapshots are written before mutable current files, matching MELON-PAN.md section 5.3.
    store.write_rich_snapshot(&document_id, &revision_id, &pulled.raw_docs_json)?;
    store.write_current_rich_doc(&document_id, &pulled.raw_docs_json, &metadata)?;

    Ok(PersistedPull {
        document_id,
        revision_id,
        plain_text,
        metadata,
    })
}

/// Plain-text projection of every body block across every tab.
///
/// Used for search, Spotlight, preview snippets, diagnostics, and
/// accessibility fallback. NOT the canonical document — `RichDocument` is.
/// Lossy by construction: paragraph styles become `# ` heading prefixes,
/// list markers become `- ` / `1. `, tables become tab-separated rows,
/// inline objects become `[image]`, etc.
pub fn docs_to_plain_text(document: &RichDocument) -> String {
    let mut out = String::new();
    for tab in &document.tabs {
        append_tab_text(tab, &mut out);
    }
    out
}

fn append_tab_text(tab: &RichTab, out: &mut String) {
    for block in &tab.body.blocks {
        append_block_text(block, out);
    }
    for child in &tab.child_tabs {
        append_tab_text(child, out);
    }
}

fn append_block_text(block: &RichBlock, out: &mut String) {
    match block {
        RichBlock::Paragraph(paragraph) => {
            if let Some(anchor) = &paragraph.list {
                let indent = "  ".repeat(anchor.nesting_level as usize);
                out.push_str(&indent);
                out.push_str(list_marker_prefix(&anchor.list_id, anchor.nesting_level));
            } else {
                match paragraph.style.named_style {
                    RichNamedStyle::Heading(level) => {
                        out.push_str(&"#".repeat(level.into()));
                        out.push(' ');
                    }
                    RichNamedStyle::Title => out.push_str("# "),
                    RichNamedStyle::Subtitle => out.push_str("## "),
                    RichNamedStyle::NormalText => {}
                }
            }
            append_inlines_text(&paragraph.inlines, out);
            if !out.ends_with('\n') {
                out.push('\n');
            }
        }
        RichBlock::Table(table) => {
            for row in &table.rows {
                let mut cells = Vec::new();
                for cell in &row.cells {
                    let mut cell_text = String::new();
                    for inner in &cell.content {
                        append_block_text(inner, &mut cell_text);
                    }
                    cells.push(cell_text.split_whitespace().collect::<Vec<_>>().join(" "));
                }
                out.push_str(&cells.join("\t"));
                out.push('\n');
            }
        }
        RichBlock::SectionBreak(_) => {
            out.push_str("\n---\n");
        }
        RichBlock::Unsupported(unsupported) => {
            out.push('[');
            out.push_str(&unsupported.description);
            out.push_str("]\n");
        }
    }
}

fn append_inlines_text(inlines: &[RichInline], out: &mut String) {
    for inline in inlines {
        match inline {
            RichInline::TextRun(run) => out.push_str(run.text.trim_end_matches('\n')),
            RichInline::InlineObjectRef(_) => out.push_str("[image]"),
            RichInline::FootnoteRef(_) => out.push_str("[footnote]"),
            RichInline::PageBreak(_) => out.push_str("\n\n"),
            RichInline::ColumnBreak(_) => out.push_str("\n"),
            RichInline::HorizontalRule(_) => out.push_str("\n---\n"),
            RichInline::AutoText(_) => out.push_str("[auto-text]"),
            RichInline::Equation(_) => out.push_str("[equation]"),
            RichInline::PersonChip(chip) => {
                if chip.display_text.is_empty() {
                    out.push_str("[person]");
                } else {
                    out.push('@');
                    out.push_str(&chip.display_text);
                }
            }
            RichInline::RichLinkChip(chip) => {
                if chip.title.is_empty() {
                    out.push_str("[link]");
                } else {
                    out.push_str(&chip.title);
                }
            }
            RichInline::Unsupported(unsupported) => {
                out.push('[');
                out.push_str(&unsupported.description);
                out.push(']');
            }
        }
    }
}

fn list_marker_prefix(_list_id: &str, _nesting_level: u8) -> &'static str {
    // Plain-text preview can't tell ordered/unordered without consulting
    // RichDocument.lists; for the preview we always emit `- ` so search
    // results and Spotlight snippets stay readable. Editor renders the
    // real glyph from RichListGlyph.
    "- "
}

// Silence unused-import lint when the helper is removed but glyph types
// are still referenced for future preview customization.
#[allow(dead_code)]
fn _glyph_kind_is_ordered(glyph: &RichListGlyph) -> bool {
    matches!(
        glyph,
        RichListGlyph::Decimal
            | RichListGlyph::AlphaUpper
            | RichListGlyph::AlphaLower
            | RichListGlyph::RomanUpper
            | RichListGlyph::RomanLower
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rich_model::{
        RichBlock, RichInline, RichNamedStyle, RichNodeId, RichNodeIdentity, RichParagraph,
        RichParagraphStyle, RichRawJson, RichSegment, RichSourceKind, RichStyle, RichTab,
        RichTextRun,
    };
    use std::collections::BTreeMap;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn ident(seed: &str) -> RichNodeIdentity {
        RichNodeIdentity::local_only(
            RichNodeId::synthetic(seed.to_string()),
            RichSourceKind::Body,
        )
    }

    fn paragraph(style: RichNamedStyle, text: &str) -> RichBlock {
        RichBlock::Paragraph(RichParagraph {
            identity: ident(&format!("para:{text}")),
            style: RichParagraphStyle {
                named_style: style,
                ..RichParagraphStyle::default()
            },
            list: None,
            inlines: vec![RichInline::TextRun(RichTextRun {
                identity: ident(&format!("run:{text}")),
                text: text.to_string(),
                style: RichStyle::default(),
            })],
            raw_extras: RichRawJson::empty(),
        })
    }

    fn single_tab_doc(blocks: Vec<RichBlock>) -> RichDocument {
        let mut doc = RichDocument::skeleton("doc1", "Title");
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
                blocks,
                style: RichRawJson::empty(),
            },
            headers: BTreeMap::new(),
            footers: BTreeMap::new(),
            footnotes: BTreeMap::new(),
            child_tabs: Vec::new(),
        });
        doc
    }

    #[test]
    fn plain_text_renders_headings_and_paragraphs() {
        let doc = single_tab_doc(vec![
            paragraph(RichNamedStyle::Heading(1), "Title"),
            paragraph(RichNamedStyle::NormalText, "Hello world"),
        ]);
        let plain = docs_to_plain_text(&doc);
        assert_eq!(plain, "# Title\nHello world\n");
    }

    #[test]
    fn persist_pull_writes_snapshot_before_current_contract() {
        let root = std::env::temp_dir().join(format!(
            "melon-pan-sync-test-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let store = LocalCacheStore::new(&root);
        store.initialize().unwrap();

        let mut doc = single_tab_doc(vec![paragraph(RichNamedStyle::Heading(1), "Title")]);
        doc.revision.revision_id = "rev1".to_string();

        let persisted = persist_pulled_document(
            &store,
            PulledDocument {
                document: doc,
                raw_docs_json: "{\"documentId\":\"doc1\"}".to_string(),
                drive_modified_time: "2026-05-01T00:00:00Z".to_string(),
                pulled_at: "2026-05-01T00:00:01Z".to_string(),
            },
        )
        .unwrap();

        let paths = store.paths_for("doc1");
        assert_eq!(persisted.plain_text, "# Title\n");
        assert!(paths.snapshot_dir.join("rev1.docs.json").exists());

        std::fs::remove_dir_all(root).unwrap();
    }
}
