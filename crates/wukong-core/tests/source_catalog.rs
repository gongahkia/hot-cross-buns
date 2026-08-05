use std::{fs, path::Path};
use tempfile::TempDir;
use wukong_core::{
    diagnostic::ErrorCode,
    source_catalog::{CatalogCandidate, SourceCatalog},
};

const CATALOG_PATH: &str = "fixture/wukong.sources.toml";

#[test]
fn invariant_catalog_parses_typed_git_and_http_candidates_in_deterministic_order() {
    let catalog = parse(
        r#"
schema = 1

[[package]]
name = "zeta"
[package.git]
url = "https://example.test/zeta.git"
root = "addons/zeta"
tag-prefix = "v"

[[package]]
name = "alpha"
[package.http]
version = "1.0.0"
url = "https://example.test/alpha-1.0.0.zip"
sha256 = "0000"
root = "addons/alpha"

[[package]]
name = "alpha"
[package.http]
version = "1.2.3"
url = "https://example.test/alpha.zip"
sha256 = "0123"
root = "addons/alpha"
"#,
    );

    let packages = catalog.packages();
    assert_eq!(
        packages
            .keys()
            .map(wukong_core::source_catalog::CatalogPackageName::as_str)
            .collect::<Vec<_>>(),
        ["alpha", "zeta"]
    );
    let alpha = packages
        .get("alpha")
        .expect("alpha candidates should exist");
    assert_eq!(alpha.len(), 2);
    assert!(matches!(
        alpha.first(),
        Some(CatalogCandidate::Http(candidate))
            if candidate.version() == "1.0.0"
                && candidate.url() == "https://example.test/alpha-1.0.0.zip"
                && candidate.sha256() == "0000"
                && candidate.root() == Path::new("addons/alpha")
    ));
    assert!(matches!(
        alpha.get(1),
        Some(CatalogCandidate::Http(candidate))
            if candidate.version() == "1.2.3"
                && candidate.url() == "https://example.test/alpha.zip"
                && candidate.sha256() == "0123"
                && candidate.root() == Path::new("addons/alpha")
    ));
    assert!(matches!(
        packages.get("zeta").and_then(|candidates| candidates.first()),
        Some(CatalogCandidate::Git(candidate))
            if candidate.url() == "https://example.test/zeta.git"
                && candidate.root() == Path::new("addons/zeta")
                && candidate.tag_prefix() == Some("v")
    ));
}

#[test]
fn invariant_catalog_rejects_unknown_and_malformed_schema_fields() {
    for input in [
        "schema = 1\nunknown = true\n",
        "schema = 1\n[[package]]\nname = \"alpha\"\n",
        "schema = 1\n[[package]]\nname = \"alpha\"\n[package.git]\nurl = 1\nroot = \"addons/alpha\"\n",
        "schema = 2\n",
    ] {
        let error = parse_error(input);
        assert_eq!(error.code(), ErrorCode::UserInput);
        assert!(error.recovery().is_some());
    }
}

#[test]
fn invariant_catalog_syntax_and_utf8_fail_without_source_access() {
    let syntax = parse_error("schema = 1\nschema = 1\n");
    assert_eq!(syntax.code(), ErrorCode::UserInput);
    assert!(
        syntax
            .message()
            .contains("invalid wukong.sources.toml syntax")
    );

    let fixture = TempDir::new().expect("fixture should exist");
    let path = fixture.path().join("wukong.sources.toml");
    fs::write(&path, [0xff_u8]).expect("invalid bytes should write");
    let utf8 = SourceCatalog::load(&path).expect_err("invalid UTF-8 should fail");
    assert_eq!(utf8.code(), ErrorCode::UserInput);
    assert!(utf8.message().contains("must be UTF-8"));
}

#[test]
fn invariant_catalog_parsing_never_acquires_declared_sources() {
    let catalog = parse(
        r#"
schema = 1

[[package]]
name = "offline"
[package.http]
version = "1.0.0"
url = "https://127.0.0.1:9/unreachable.zip"
sha256 = "not-validated-until-catalog-validation"
root = "../not-validated-until-catalog-validation"
"#,
    );

    assert_eq!(catalog.packages().len(), 1);
}

fn parse(input: &str) -> SourceCatalog {
    SourceCatalog::parse(Path::new(CATALOG_PATH), input).expect("catalog should parse")
}

fn parse_error(input: &str) -> Box<wukong_core::diagnostic::Diagnostic> {
    SourceCatalog::parse(Path::new(CATALOG_PATH), input).expect_err("catalog should fail")
}
