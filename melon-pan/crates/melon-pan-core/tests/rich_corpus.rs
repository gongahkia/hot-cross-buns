use melon_pan_core::{
    parse_json, parse_rich_document, JsonValue, RichBlock, RichInline, RichNamedStyle,
    RICH_SCHEMA_VERSION,
};
use std::path::{Path, PathBuf};

fn corpus_root() -> PathBuf {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir
        .parent()
        .and_then(|crates| crates.parent())
        .map(|root| root.join("tests").join("rich-corpus"))
        .expect("repo layout has crates/<crate>/, walk up two parents")
}

#[test]
fn basic_heading_fixture_matches_expected_snapshot() {
    let fixture = corpus_root().join("basic-heading");
    let raw = std::fs::read_to_string(fixture.join("current.docs.json"))
        .expect("fixture docs json should exist");
    let expected_raw = std::fs::read_to_string(fixture.join("expected.snap.json"))
        .expect("expected snapshot should exist");
    let expected = parse_json(&expected_raw).expect("expected snapshot should parse");
    let doc = parse_rich_document(&raw).expect("fixture should parse as rich doc");

    assert_eq!(doc.schema_version, RICH_SCHEMA_VERSION);
    assert_eq!(
        expected.path(&["documentId"]).and_then(JsonValue::as_str),
        Some(doc.document_id.as_str())
    );
    assert_eq!(
        expected.path(&["title"]).and_then(JsonValue::as_str),
        Some(doc.title.as_str())
    );
    assert_eq!(
        expected.path(&["revisionId"]).and_then(JsonValue::as_str),
        Some(doc.revision.revision_id.as_str())
    );

    let paragraphs = top_level_paragraphs(&doc.tabs[0].body.blocks);
    assert_eq!(paragraphs.len(), 2);
    assert_eq!(paragraphs[0].style.named_style, RichNamedStyle::Heading(1));
    assert_eq!(paragraph_text(paragraphs[0]), "Project brief\n");
    assert_eq!(paragraphs[1].style.named_style, RichNamedStyle::NormalText);
    assert_eq!(paragraph_text(paragraphs[1]), "Body text with emphasis.\n");
    assert!(matches!(
        paragraphs[1].inlines.first(),
        Some(RichInline::TextRun(run)) if run.style.bold
    ));
}

#[test]
fn every_rich_corpus_fixture_has_docs_json_and_expected_snapshot() {
    let root = corpus_root();
    let entries = std::fs::read_dir(&root).expect("rich corpus dir should exist");
    let mut count = 0;
    for entry in entries {
        let path = entry.expect("dir entry").path();
        if !path.is_dir() {
            continue;
        }
        assert_required_file(&path, "current.docs.json");
        assert_required_file(&path, "expected.snap.json");
        count += 1;
    }
    assert!(count > 0, "rich corpus should contain at least one fixture");
}

fn assert_required_file(root: &Path, name: &str) {
    let path = root.join(name);
    assert!(path.exists(), "missing {}", path.display());
}

fn top_level_paragraphs(blocks: &[RichBlock]) -> Vec<&melon_pan_core::RichParagraph> {
    blocks
        .iter()
        .filter_map(|block| match block {
            RichBlock::Paragraph(paragraph) => Some(paragraph),
            _ => None,
        })
        .collect()
}

fn paragraph_text(paragraph: &melon_pan_core::RichParagraph) -> String {
    paragraph
        .inlines
        .iter()
        .filter_map(|inline| match inline {
            RichInline::TextRun(run) => Some(run.text.as_str()),
            _ => None,
        })
        .collect()
}
