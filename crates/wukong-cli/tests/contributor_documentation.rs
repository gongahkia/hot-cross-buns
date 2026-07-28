use std::{fs, path::PathBuf};

#[test]
fn invariant_contributor_guides_cover_maintainer_workflows() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    for (path, required_text) in [
        ("docs/architecture.md", "## Core boundaries"),
        ("docs/source-adapter-guide.md", "## Required coverage"),
        ("docs/fixture-guide.md", "## Compatibility corpus process"),
        ("docs/release-process.md", "Release process"),
        ("docs/debugging.md", "RUST_BACKTRACE=1"),
        ("docs/adr/README.md", "## When to write an ADR"),
    ] {
        let content = fs::read_to_string(root.join(path)).expect("contributor guide should exist");
        assert!(
            content.contains(required_text),
            "{path} should contain {required_text:?}"
        );
    }
}
