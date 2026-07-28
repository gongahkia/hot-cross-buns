use std::{fs, io::Write, path::Path};
use tempfile::TempDir;
use wukong_core::{
    archive::{ExtractionLimits, extract_zip},
    diagnostic::ErrorCode,
};
use zip::{CompressionMethod, ZipWriter, write::SimpleFileOptions};

#[test]
fn invariant_valid_zip_extracts_only_inside_a_new_staging_root() {
    let fixture = Fixture::new();
    fixture.write_zip(&[("addons/example/plugin.gd", b"extends Node\n")]);

    let extracted = extract_zip(
        fixture.archive_path(),
        fixture.staging_parent(),
        ExtractionLimits::default(),
    )
    .expect("safe archive should extract");

    assert_eq!(
        fs::read_to_string(extracted.root().join("addons/example/plugin.gd"))
            .expect("extracted file should exist"),
        "extends Node\n"
    );
    assert!(extracted.root().starts_with(fixture.staging_parent()));
}

#[test]
fn invariant_unsafe_zip_paths_fail_without_creating_staging_output() {
    for name in [
        "../escape",
        "/absolute",
        "C:/drive",
        "\\\\server\\share",
        "a/../b",
    ] {
        let fixture = Fixture::new();
        fixture.write_zip(&[(name, b"malicious")]);

        let error = extract_zip(
            fixture.archive_path(),
            fixture.staging_parent(),
            ExtractionLimits::default(),
        )
        .expect_err("unsafe archive path should fail");

        assert_eq!(error.code(), ErrorCode::SourceAccess);
        assert!(staging_entries(fixture.staging_parent()).is_empty());
        assert!(!fixture.directory.path().join("escape").exists());
    }
}

#[test]
fn invariant_symlink_entries_are_rejected_without_staging_output() {
    let fixture = Fixture::new();
    let archive = fs::File::create(fixture.archive_path()).expect("archive should create");
    let mut writer = ZipWriter::new(archive);
    writer
        .add_symlink("linked", "../../outside", SimpleFileOptions::default())
        .expect("symlink fixture should write");
    writer.finish().expect("archive should finish");

    let error = extract_zip(
        fixture.archive_path(),
        fixture.staging_parent(),
        ExtractionLimits::default(),
    )
    .expect_err("symlink archive should fail");

    assert_eq!(error.code(), ErrorCode::SourceAccess);
    assert!(staging_entries(fixture.staging_parent()).is_empty());
}

#[test]
fn invariant_limits_reject_archives_before_staging_output() {
    let fixture = Fixture::new();
    fixture.write_zip(&[("one", b"1"), ("two", b"2")]);

    let error = extract_zip(
        fixture.archive_path(),
        fixture.staging_parent(),
        ExtractionLimits::tightened(1, 10, 100),
    )
    .expect_err("file count should fail");

    assert_eq!(error.code(), ErrorCode::SourceAccess);
    assert!(error.message().contains("file-count"));
    assert!(staging_entries(fixture.staging_parent()).is_empty());
}

#[test]
fn invariant_expansion_ratio_limit_rejects_nonempty_entries() {
    let fixture = Fixture::new();
    fixture.write_zip(&[("one", b"content")]);

    let error = extract_zip(
        fixture.archive_path(),
        fixture.staging_parent(),
        ExtractionLimits::tightened(10, 1024, 0),
    )
    .expect_err("zero ratio should fail nonempty entry");

    assert_eq!(error.code(), ErrorCode::SourceAccess);
    assert!(error.message().contains("expansion-ratio"));
    assert!(staging_entries(fixture.staging_parent()).is_empty());
}

fn staging_entries(path: &Path) -> Vec<std::path::PathBuf> {
    fs::read_dir(path)
        .expect("staging parent should be readable")
        .map(|entry| entry.expect("staging entry should read").path())
        .collect()
}

struct Fixture {
    directory: TempDir,
    archive_path: std::path::PathBuf,
    staging_parent: std::path::PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let directory = TempDir::new().expect("temporary directory should be created");
        let staging_parent = directory.path().join("staging");
        fs::create_dir(&staging_parent).expect("staging parent should be created");
        Self {
            archive_path: directory.path().join("package.zip"),
            directory,
            staging_parent,
        }
    }

    fn archive_path(&self) -> &Path {
        &self.archive_path
    }
    fn staging_parent(&self) -> &Path {
        &self.staging_parent
    }

    fn write_zip(&self, entries: &[(&str, &[u8])]) {
        let archive = fs::File::create(&self.archive_path).expect("archive should create");
        let mut writer = ZipWriter::new(archive);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        for (name, content) in entries {
            writer
                .start_file(*name, options)
                .expect("archive entry should start");
            writer
                .write_all(content)
                .expect("archive entry should write");
        }
        writer.finish().expect("archive should finish");
    }
}
