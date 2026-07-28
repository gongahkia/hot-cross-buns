use std::{fs, path::PathBuf};

#[test]
fn invariant_user_guides_cover_the_supported_workflows() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    for (path, required_text) in [
        ("docs/quickstart.md", "60-second quick start"),
        ("docs/command-reference.md", "wukong --version"),
        ("docs/manifest.md", "Field reference"),
        ("docs/lockfile.md", "## Policy"),
        ("docs/git-fetching.md", "## Dependency guide"),
        ("docs/http-archives.md", "## Dependency guide"),
        ("docs/local-paths.md", "## Dependency guide"),
        ("docs/ci.md", "wukong sync --frozen"),
        ("docs/security.md", "package scripts"),
        ("docs/troubleshooting.md", "wukong doctor"),
        ("docs/native-extensions.md", "opaque"),
        ("docs/launch-article.md", "Reproducibility is the product"),
    ] {
        let content = fs::read_to_string(root.join(path)).expect("user guide should exist");
        assert!(
            content.contains(required_text),
            "{path} should contain {required_text:?}"
        );
    }
}

#[test]
fn invariant_launch_article_covers_the_declared_release_topics_without_claiming_release() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let article = fs::read_to_string(root.join("docs/launch-article.md"))
        .expect("launch article draft should exist");
    for section in [
        "Draft for publication",
        "Reproducibility is the product",
        "Resolver and source boundaries",
        "Canonical trees and a content-addressed cache",
        "Installation is a transaction",
        "Security model",
        "Performance: measure before claiming",
        "Existing workflows and tools",
        "Known limitations and next evidence",
    ] {
        assert!(
            article.contains(section),
            "launch article should contain {section:?}"
        );
    }
}
