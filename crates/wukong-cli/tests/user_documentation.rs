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
    ] {
        let content = fs::read_to_string(root.join(path)).expect("user guide should exist");
        assert!(
            content.contains(required_text),
            "{path} should contain {required_text:?}"
        );
    }
}
