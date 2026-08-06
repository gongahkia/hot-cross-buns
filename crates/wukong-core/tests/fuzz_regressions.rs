use std::{
    fs,
    path::{Path, PathBuf},
};
use tempfile::TempDir;
use wukong_core::{
    archive::{ExtractionLimits, extract_zip},
    lockfile::Lockfile,
    manifest::Manifest,
    source_catalog::SourceCatalog,
};

#[test]
fn invariant_manifest_fuzz_regression_corpus_never_panics() {
    for path in corpus("manifest") {
        let input = fs::read(&path).expect("manifest corpus input should read");
        if let Ok(input) = std::str::from_utf8(&input) {
            let _ = Manifest::parse(Path::new("wukong.toml"), input);
        }
    }
}

#[test]
fn invariant_lockfile_fuzz_regression_corpus_never_panics() {
    for path in corpus("lockfile") {
        let input = fs::read(&path).expect("lockfile corpus input should read");
        if let Ok(input) = std::str::from_utf8(&input) {
            let _ = Lockfile::parse(Path::new("wukong.lock"), input);
        }
    }
}

#[test]
fn invariant_source_catalog_fuzz_regression_corpus_never_panics() {
    for path in corpus("source_catalog") {
        let input = fs::read(&path).expect("source catalog corpus input should read");
        if let Ok(input) = std::str::from_utf8(&input) {
            if let Ok(catalog) = SourceCatalog::parse(Path::new("wukong.sources.toml"), input) {
                let _ = catalog.validate(Path::new("wukong.sources.toml"));
            }
        }
    }
}

#[test]
fn invariant_archive_fuzz_regression_corpus_never_panics() {
    for path in corpus("archive") {
        let fixture = TempDir::new().expect("fixture should create");
        let archive = fixture.path().join("input.zip");
        let staging = fixture.path().join("staging");
        fs::copy(&path, &archive).expect("archive corpus input should copy");
        fs::create_dir(&staging).expect("staging directory should create");

        let _ = extract_zip(
            &archive,
            &staging,
            ExtractionLimits::tightened(32, 16 * 1024, 8),
        );
    }
}

#[test]
fn invariant_fuzz_seed_corpora_include_valid_and_invalid_parser_cases() {
    let valid_manifest = fs::read_to_string(corpus_path("manifest", "valid-minimal.toml"))
        .expect("valid manifest seed should read");
    let invalid_manifest = fs::read_to_string(corpus_path("manifest", "invalid-duplicate.toml"))
        .expect("invalid manifest seed should read");
    let valid_lockfile = fs::read_to_string(corpus_path("lockfile", "valid-empty.toml"))
        .expect("valid lockfile seed should read");
    let invalid_lockfile = fs::read_to_string(corpus_path("lockfile", "invalid-schema.toml"))
        .expect("invalid lockfile seed should read");
    let valid_catalog = fs::read_to_string(corpus_path("source_catalog", "valid-http.toml"))
        .expect("valid source catalog seed should read");
    let unsafe_catalog = fs::read_to_string(corpus_path("source_catalog", "unsafe-root.toml"))
        .expect("unsafe source catalog seed should read");

    assert!(Manifest::parse(Path::new("wukong.toml"), &valid_manifest).is_ok());
    assert!(Manifest::parse(Path::new("wukong.toml"), &invalid_manifest).is_err());
    assert!(Lockfile::parse(Path::new("wukong.lock"), &valid_lockfile).is_ok());
    assert!(Lockfile::parse(Path::new("wukong.lock"), &invalid_lockfile).is_err());
    assert!(
        SourceCatalog::parse(Path::new("wukong.sources.toml"), &valid_catalog)
            .and_then(|catalog| catalog.validate(Path::new("wukong.sources.toml")))
            .is_ok()
    );
    assert!(
        SourceCatalog::parse(Path::new("wukong.sources.toml"), &unsafe_catalog)
            .and_then(|catalog| catalog.validate(Path::new("wukong.sources.toml")))
            .is_err()
    );
}

fn corpus(target: &str) -> Vec<PathBuf> {
    let directory = corpus_root().join(target);
    let mut paths = fs::read_dir(directory)
        .expect("fuzz corpus directory should exist")
        .map(|entry| entry.expect("fuzz corpus entry should read").path())
        .collect::<Vec<_>>();
    paths.sort();
    assert!(!paths.is_empty(), "fuzz corpus should not be empty");
    paths
}

fn corpus_path(target: &str, file: &str) -> PathBuf {
    corpus_root().join(target).join(file)
}

fn corpus_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fuzz/corpus")
}
