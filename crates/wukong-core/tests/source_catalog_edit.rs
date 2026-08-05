use std::{
    fs,
    path::{Path, PathBuf},
};
use tempfile::TempDir;
use wukong_core::{
    diagnostic::ErrorCode,
    operation_lock::AdvisoryLock,
    source_catalog::SourceCatalog,
    source_catalog_edit::{CatalogEditEntry, add_entry, remove_entry},
};

const SHA256: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const INITIAL_CATALOG: &str = r#"# retained catalog comment
schema = 1

# alpha is reviewed
[[package]]
name = "alpha"
[package.git]
url = "https://EXAMPLE.test:443/alpha.git"
root = "./addons/alpha"

# zeta is unrelated
[[package]]
name = "zeta"
[package.http]
version = "1.0.0"
url = "https://example.test/zeta.zip"
sha256 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
root = "addons/zeta"
"#;

#[test]
fn invariant_add_preserves_existing_catalog_content_and_validates_before_atomic_write() {
    let fixture = Fixture::with_catalog(INITIAL_CATALOG);
    let before = fixture.content();

    add_entry(
        fixture.path(),
        &CatalogEditEntry::Http {
            name: "beta".to_owned(),
            version: "1.2.3".to_owned(),
            url: "https://example.test/beta.zip".to_owned(),
            sha256: SHA256.to_owned(),
            root: PathBuf::from("addons/beta"),
        },
    )
    .expect("candidate should be added");

    let content = fixture.content();
    assert!(content.contains("# retained catalog comment"));
    assert!(content.contains("# alpha is reviewed"));
    assert!(content.contains("# zeta is unrelated"));
    assert!(content.contains("name = \"beta\""));
    assert!(content.starts_with(&before));
    SourceCatalog::load(fixture.path())
        .and_then(|catalog| catalog.validate(fixture.path()))
        .expect("written catalog should validate");
}

#[test]
fn invariant_add_creates_a_valid_schema_one_catalog_when_absent() {
    let fixture = Fixture::without_catalog();

    add_entry(
        fixture.path(),
        &CatalogEditEntry::Git {
            name: "alpha".to_owned(),
            url: "https://example.test/alpha.git".to_owned(),
            root: PathBuf::from("addons/alpha"),
            tag_prefix: Some("v".to_owned()),
        },
    )
    .expect("candidate should create a catalog");

    let content = fixture.content();
    assert!(content.starts_with("schema = 1\n"));
    assert!(content.contains("[[package]]"));
    SourceCatalog::load(fixture.path())
        .and_then(|catalog| catalog.validate(fixture.path()))
        .expect("created catalog should validate");
}

#[test]
fn invariant_invalid_add_leaves_catalog_bytes_unchanged() {
    let fixture = Fixture::with_catalog(INITIAL_CATALOG);
    let before = fixture.content();

    let error = add_entry(
        fixture.path(),
        &CatalogEditEntry::Git {
            name: "alpha".to_owned(),
            url: "https://user:secret-value@example.test/alpha.git".to_owned(),
            root: PathBuf::from("../addons/alpha"),
            tag_prefix: None,
        },
    )
    .expect_err("unsafe candidate should not be added");

    assert_eq!(error.code(), ErrorCode::UserInput);
    assert!(!error.message().contains("secret-value"));
    assert_eq!(fixture.content(), before);
}

#[test]
fn invariant_remove_uses_canonical_exact_selection_and_preserves_unrelated_content() {
    let fixture = Fixture::with_catalog(INITIAL_CATALOG);
    let zeta = r#"# zeta is unrelated
[[package]]
name = "zeta"
[package.http]
version = "1.0.0"
url = "https://example.test/zeta.zip"
sha256 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
root = "addons/zeta"
"#;

    remove_entry(
        fixture.path(),
        &CatalogEditEntry::Git {
            name: "alpha".to_owned(),
            url: "https://example.test/alpha.git".to_owned(),
            root: PathBuf::from("addons/alpha"),
            tag_prefix: None,
        },
    )
    .expect("canonical selection should remove alpha");

    let content = fixture.content();
    assert!(!content.contains("name = \"alpha\""));
    assert!(content.contains(zeta));
    SourceCatalog::load(fixture.path())
        .and_then(|catalog| catalog.validate(fixture.path()))
        .expect("remaining catalog should validate");
}

#[test]
fn invariant_missing_or_concurrent_edits_leave_catalog_bytes_unchanged() {
    let fixture = Fixture::with_catalog(INITIAL_CATALOG);
    let before = fixture.content();
    let missing = remove_entry(
        fixture.path(),
        &CatalogEditEntry::Http {
            name: "missing".to_owned(),
            version: "1.0.0".to_owned(),
            url: "https://example.test/missing.zip".to_owned(),
            sha256: SHA256.to_owned(),
            root: PathBuf::from("addons/missing"),
        },
    )
    .expect_err("missing candidate should fail");
    assert_eq!(missing.code(), ErrorCode::UserInput);
    assert_eq!(fixture.content(), before);

    let lock = AdvisoryLock::try_acquire(
        &fixture.directory.path().join(".wukong.sources.toml.lock"),
        "fixture catalog",
    )
    .expect("fixture lock should acquire");
    let concurrent = add_entry(
        fixture.path(),
        &CatalogEditEntry::Http {
            name: "beta".to_owned(),
            version: "1.0.0".to_owned(),
            url: "https://example.test/beta.zip".to_owned(),
            sha256: SHA256.to_owned(),
            root: PathBuf::from("addons/beta"),
        },
    )
    .expect_err("concurrent edit should fail");
    assert_eq!(concurrent.code(), ErrorCode::SourceAccess);
    assert!(concurrent.recovery().is_some());
    assert_eq!(fixture.content(), before);
    drop(lock);
}

struct Fixture {
    directory: TempDir,
    catalog_path: PathBuf,
}

impl Fixture {
    fn with_catalog(content: &str) -> Self {
        let fixture = Self::without_catalog();
        fs::write(&fixture.catalog_path, content).expect("catalog fixture should write");
        fixture
    }

    fn without_catalog() -> Self {
        let directory = TempDir::new().expect("fixture should exist");
        let catalog_path = directory.path().join("wukong.sources.toml");
        Self {
            directory,
            catalog_path,
        }
    }

    fn path(&self) -> &Path {
        &self.catalog_path
    }

    fn content(&self) -> String {
        fs::read_to_string(&self.catalog_path).expect("catalog should read")
    }
}
