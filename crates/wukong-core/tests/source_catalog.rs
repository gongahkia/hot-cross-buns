use proptest::{collection, prelude::*};
use std::{fs, path::Path};
use tempfile::TempDir;
use wukong_core::{
    diagnostic::ErrorCode,
    source_catalog::{CatalogCandidate, SourceCatalog, ValidatedCatalogCandidate},
};

const CATALOG_PATH: &str = "fixture/wukong.sources.toml";
const SHA256: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

proptest! {
    #[test]
    fn invariant_catalog_serialization_is_order_independent_and_idempotent(
        names in collection::btree_set("[a-z][a-z0-9]{0,5}", 1..8),
    ) {
        let entries = names.iter().enumerate().map(|(index, name)| {
            format!(
                "[[package]]\nname = \"{name}\"\n[package.http]\nversion = \"1.0.0\"\nurl = \"https://example.test/{name}.zip\"\nsha256 = \"{index:064x}\"\nroot = \"addons/{name}\"\n"
            )
        }).collect::<Vec<_>>();
        let first = canonical(&format!("schema = 1\n\n{}", entries.concat()));
        let mut reverse = entries;
        reverse.reverse();
        let second = canonical(&format!("schema = 1\n\n{}", reverse.concat()));

        prop_assert_eq!(&first, &second);
        prop_assert_eq!(canonical(&first), first);
    }
}

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

#[test]
fn invariant_catalog_validation_normalises_typed_safe_candidates_without_source_access() {
    let catalog = parse(&format!(
        r#"
schema = 1

[[package]]
name = "zeta"
[package.git]
url = "https://EXAMPLE.test:443/zeta.git"
root = "./addons/zeta"
tag-prefix = "v"

[[package]]
name = "alpha"
[package.http]
version = "1.2.3"
url = "https://127.0.0.1:9/unreachable.zip"
sha256 = "{SHA256}"
root = "addons/alpha"
"#,
    ));

    let validated = catalog
        .validate(Path::new(CATALOG_PATH))
        .expect("validation should not acquire a source");
    let packages = validated.packages();
    assert_eq!(
        packages.keys().map(ToString::to_string).collect::<Vec<_>>(),
        ["alpha", "zeta"]
    );
    assert!(matches!(
        packages.get("alpha").and_then(|candidates| candidates.first()),
        Some(ValidatedCatalogCandidate::Http(candidate))
            if candidate.version().to_string() == "1.2.3"
                && candidate.url() == "https://127.0.0.1:9/unreachable.zip"
                && candidate.sha256() == SHA256
                && candidate.root() == Path::new("addons/alpha")
    ));
    assert!(matches!(
        packages.get("zeta").and_then(|candidates| candidates.first()),
        Some(ValidatedCatalogCandidate::Git(candidate))
            if candidate.source().as_str() == "https://example.test/zeta.git"
                && candidate.root() == Path::new("addons/zeta")
                && candidate.tag_prefix().is_some_and(|prefix| prefix.as_str() == "v")
    ));
}

#[test]
fn invariant_catalog_validation_rejects_unsafe_or_ambiguous_declarations() {
    let cases = [
        (
            catalog_with_git("Bad_Name", "https://example.test/alpha.git", "addons/alpha"),
            "package.Bad_Name.name",
        ),
        (
            catalog_with_git(
                "alpha",
                "https://user:secret-value@example.test/alpha.git",
                "addons/alpha",
            ),
            "package.alpha.git.url",
        ),
        (
            catalog_with_git("alpha", "https://example.test/alpha.git", "../addons/alpha"),
            "package.alpha.git.root",
        ),
        (
            catalog_with_http(
                "alpha",
                "not-a-version",
                "https://example.test/alpha.zip",
                SHA256,
                "addons/alpha",
            ),
            "package.alpha.http.version",
        ),
        (
            catalog_with_http(
                "alpha",
                "1.0.0",
                "https://example.test/alpha.zip?access_token=secret-value",
                SHA256,
                "addons/alpha",
            ),
            "package.alpha.http.url",
        ),
        (
            catalog_with_http(
                "alpha",
                "1.0.0",
                "https://example.test/alpha.zip",
                "ABC",
                "addons/alpha",
            ),
            "package.alpha.http.sha256",
        ),
        (
            catalog_with_http(
                "alpha",
                "1.0.0",
                "https://example.test/alpha.zip",
                SHA256,
                "C:\\\\addons",
            ),
            "package.alpha.http.root",
        ),
    ];

    for (input, field) in cases {
        let error = validation_error(&input);
        assert_eq!(error.code(), ErrorCode::UserInput);
        assert_eq!(error.message(), format!("{field} is invalid"));
        assert!(error.recovery().is_some());
        assert!(!error.message().contains("secret-value"));
        assert!(!error.cause().unwrap_or_default().contains("secret-value"));
        assert!(
            !error
                .source_description()
                .expect("catalog source should be recorded")
                .as_str()
                .contains("secret-value")
        );
    }
}

#[test]
fn invariant_catalog_validation_rejects_canonical_duplicate_candidates_deterministically() {
    let input = format!(
        r#"
schema = 1

[[package]]
name = "zeta"
[package.http]
version = "1.0.0"
url = "https://example.test/zeta.zip"
sha256 = "{SHA256}"
root = "addons/zeta"

[[package]]
name = "alpha"
[package.git]
url = "https://EXAMPLE.test:443/alpha.git"
root = "./addons/alpha"

[[package]]
name = "alpha"
[package.git]
url = "https://example.test/alpha.git"
root = "addons/alpha"
"#,
    );

    let first = validation_error(&input);
    let second = validation_error(&input);
    assert_eq!(first, second);
    assert_eq!(first.message(), "package.alpha.source is invalid");
    assert_eq!(first.cause(), Some("duplicate source candidate"));
    assert!(first.recovery().is_some());
}

#[test]
fn invariant_catalog_complete_validation_reports_every_declaration_failure_in_order() {
    let catalog = parse(
        r#"
schema = 1

[[package]]
name = "Bad_Name"
[package.git]
url = "https://user:secret-value@example.test/alpha.git"
root = "../addons/alpha"
tag-prefix = ""

[[package]]
name = "alpha"
[package.http]
version = "not-a-version"
url = "https://example.test/alpha.zip?access_token=secret-value"
sha256 = "ABC"
root = "/addons/alpha"
"#,
    );

    let errors = catalog
        .validate_all(Path::new(CATALOG_PATH))
        .expect_err("invalid declarations should fail");
    assert_eq!(
        errors
            .iter()
            .map(|error| error.message())
            .collect::<Vec<_>>(),
        [
            "package.Bad_Name.name is invalid",
            "package.Bad_Name.git.url is invalid",
            "package.Bad_Name.git.root is invalid",
            "package.Bad_Name.git.tag-prefix is invalid",
            "package.alpha.http.version is invalid",
            "package.alpha.http.url is invalid",
            "package.alpha.http.sha256 is invalid",
            "package.alpha.http.root is invalid",
        ]
    );
    for error in errors {
        assert_eq!(error.code(), ErrorCode::UserInput);
        assert!(error.recovery().is_some());
        assert!(!error.message().contains("secret-value"));
        assert!(!error.cause().unwrap_or_default().contains("secret-value"));
    }
}

#[test]
fn invariant_catalog_serialization_emits_only_canonical_validated_schema_one_fields() {
    let catalog = parse(&format!(
        r#"
schema = 1

[[package]]
name = "zeta"
[package.git]
url = "https://EXAMPLE.test:443/zeta.git"
root = "./addons/zeta"
tag-prefix = "v"

[[package]]
name = "alpha"
[package.http]
version = "1.2.3"
url = "https://example.test/alpha-1.2.3.zip"
sha256 = "{SHA256}"
root = "addons/alpha"

[[package]]
name = "alpha"
[package.http]
version = "1.0.0"
url = "https://example.test/alpha-1.0.0.zip"
sha256 = "{SHA256}"
root = "./addons/alpha"
"#,
    ));

    let output = catalog
        .to_toml(Path::new(CATALOG_PATH))
        .expect("validated catalog should serialize");
    assert_eq!(
        output,
        format!(
            r#"schema = 1

[[package]]
name = "alpha"
[package.http]
version = "1.0.0"
url = "https://example.test/alpha-1.0.0.zip"
sha256 = "{SHA256}"
root = "addons/alpha"

[[package]]
name = "alpha"
[package.http]
version = "1.2.3"
url = "https://example.test/alpha-1.2.3.zip"
sha256 = "{SHA256}"
root = "addons/alpha"

[[package]]
name = "zeta"
[package.git]
url = "https://example.test/zeta.git"
root = "addons/zeta"
tag-prefix = "v"
"#,
        )
    );
    assert_eq!(canonical(&output), output);
}

fn parse(input: &str) -> SourceCatalog {
    SourceCatalog::parse(Path::new(CATALOG_PATH), input).expect("catalog should parse")
}

fn parse_error(input: &str) -> Box<wukong_core::diagnostic::Diagnostic> {
    SourceCatalog::parse(Path::new(CATALOG_PATH), input).expect_err("catalog should fail")
}

fn validation_error(input: &str) -> Box<wukong_core::diagnostic::Diagnostic> {
    parse(input)
        .validate(Path::new(CATALOG_PATH))
        .expect_err("catalog validation should fail")
}

fn canonical(input: &str) -> String {
    parse(input)
        .to_toml(Path::new(CATALOG_PATH))
        .expect("valid catalog should serialize")
}

fn catalog_with_git(name: &str, url: &str, root: &str) -> String {
    format!(
        r#"
schema = 1
[[package]]
name = "{name}"
[package.git]
url = "{url}"
root = "{root}"
"#,
    )
}

fn catalog_with_http(name: &str, version: &str, url: &str, sha256: &str, root: &str) -> String {
    format!(
        r#"
schema = 1
[[package]]
name = "{name}"
[package.http]
version = "{version}"
url = "{url}"
sha256 = "{sha256}"
root = "{root}"
"#,
    )
}
