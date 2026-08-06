use std::path::{Path, PathBuf};
use wukong_core::godot_support_matrix::{GodotSupportLevel, GodotSupportMatrix};

#[test]
fn invariant_reviewed_matrix_parses_deterministically_without_network_access() {
    let path = matrix_path();
    let first = GodotSupportMatrix::load(&path).expect("reviewed matrix should load");
    let second = GodotSupportMatrix::load(&path).expect("repeated matrix load should work");

    assert_eq!(first, second);
    assert_eq!(
        first
            .branches()
            .iter()
            .map(|entry| {
                (
                    entry.branch().as_str(),
                    entry.version().to_string(),
                    entry.level().as_str(),
                )
            })
            .collect::<Vec<_>>(),
        [
            ("4.5".to_owned(), "4.5.2".to_owned(), "partial"),
            ("4.6".to_owned(), "4.6.3".to_owned(), "supported"),
            ("4.7".to_owned(), "4.7.1".to_owned(), "supported")
        ]
    );
}

#[test]
fn invariant_invalid_duplicate_and_stale_matrix_entries_fail_before_use() {
    for (input, expected) in [
        ("schema = 2\n", "schema must be 1"),
        (
            "schema = 1\n\n[[branch]]\nseries = \"4.6\"\nversion = \"4.6.3\"\nsupport = \"supported\"\n\n[[branch]]\nseries = \"4.6\"\nversion = \"4.6.3\"\nsupport = \"partial\"\n",
            "duplicate Godot branch 4.6",
        ),
        (
            "schema = 1\n\n[[branch]]\nseries = \"4.7.1\"\nversion = \"4.7.1\"\nsupport = \"supported\"\n",
            "invalid Godot branch series",
        ),
        (
            "schema = 1\n\n[[branch]]\nseries = \"4.7\"\nversion = \"4.7.1\"\nsupport = \"supported\"\n\n[[branch]]\nseries = \"4.6\"\nversion = \"4.6.3\"\nsupport = \"supported\"\n",
            "branches must be ascending",
        ),
    ] {
        let error = GodotSupportMatrix::parse(Path::new("config/godot-support.toml"), input)
            .expect_err("invalid reviewed matrix should fail");
        assert!(error.message().contains(expected), "{}", error.message());
    }
}

#[test]
fn invariant_matrix_rejects_unknown_status_and_shape() {
    let unsupported = GodotSupportMatrix::parse(
        Path::new("config/godot-support.toml"),
        "schema = 1\n\n[[branch]]\nseries = \"4.6\"\nversion = \"4.6.3\"\nsupport = \"eol\"\n",
    )
    .expect_err("unsupported status should fail");
    assert!(
        unsupported
            .message()
            .contains("unsupported Godot support status")
    );

    let stale = GodotSupportMatrix::parse(
        Path::new("config/godot-support.toml"),
        "schema = 1\n\n[[branch]]\nseries = \"4.6\"\nversion = \"4.6.3\"\nsupport = \"supported\"\nrelease = \"4.6.3\"\n",
    )
    .expect_err("unreviewed shape should fail");
    assert!(stale.message().contains("unknown field branch[0].release"));
}

#[test]
fn invariant_matrix_rejects_pre_release_or_cross_branch_versions() {
    for input in [
        "schema = 1\n\n[[branch]]\nseries = \"4.6\"\nversion = \"4.6.3-rc.1\"\nsupport = \"supported\"\n",
        "schema = 1\n\n[[branch]]\nseries = \"4.6\"\nversion = \"4.7.1\"\nsupport = \"supported\"\n",
    ] {
        assert!(GodotSupportMatrix::parse(Path::new("config/godot-support.toml"), input).is_err());
    }
}

#[test]
fn invariant_support_levels_are_typed() {
    assert_eq!(
        GodotSupportLevel::parse("supported").unwrap(),
        GodotSupportLevel::Supported
    );
    assert_eq!(
        GodotSupportLevel::parse("partial").unwrap(),
        GodotSupportLevel::Partial
    );
}

fn matrix_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join("config/godot-support.toml")
}
