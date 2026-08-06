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
        ("docs/external-testing.md", "## Onboarding ledger"),
        ("docs/stress-testing.md", "Schema version: 1"),
        ("docs/manual-verification.md", "Schema version: 1"),
        (
            "docs/compatibility-expansion.md",
            "Compatibility expansion status",
        ),
        (
            "docs/one-point-zero-readiness.md",
            "## Reconsideration gate",
        ),
        (
            "docs/adr/0039-one-point-zero-compatibility-policy.md",
            "format migration",
        ),
        ("docs/adr/README.md", "## When to write an ADR"),
    ] {
        let content = fs::read_to_string(root.join(path)).expect("contributor guide should exist");
        assert!(
            content.contains(required_text),
            "{path} should contain {required_text:?}"
        );
    }
}

#[test]
fn invariant_external_testing_ledger_uses_immutable_fixture_references() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let content = fs::read_to_string(root.join("docs/external-testing.md"))
        .expect("external-testing ledger should exist");
    for reference in [
        "godot-input-helper",
        "ccfad58f7eea997e3d4f0903dcac9212da2b2208",
        "godot-game-settings",
        "79a996d8f7310f30a2651e058acddef9d4819b43",
        "quest-manager",
        "8fe88bc8a415d0b57e32a11b6114518e6d62ff6d",
    ] {
        assert!(
            content.contains(reference),
            "external-testing ledger should contain {reference:?}"
        );
    }
}
