#![no_main]

use libfuzzer_sys::fuzz_target;
use std::{fs, io::Write};
use tempfile::TempDir;
use wukong_core::archive::{ExtractionLimits, extract_zip};
use zip::{CompressionMethod, ZipWriter, write::SimpleFileOptions};

const MAX_INPUT_BYTES: usize = 64 * 1024;
const MAX_GENERATED_BYTES: usize = 16 * 1024;

fuzz_target!(|input: &[u8]| {
    if input.len() > MAX_INPUT_BYTES {
        return;
    }
    let Ok(fixture) = TempDir::new() else {
        return;
    };
    exercise_raw_archive(fixture.path(), input);
    exercise_generated_archive(fixture.path(), input);
});

fn exercise_raw_archive(root: &std::path::Path, input: &[u8]) {
    let archive = root.join("raw.zip");
    let staging = root.join("raw-staging");
    if fs::write(&archive, input).is_ok() && fs::create_dir(&staging).is_ok() {
        let _ = extract_zip(
            &archive,
            &staging,
            ExtractionLimits::tightened(32, MAX_GENERATED_BYTES as u64, 8),
        );
    }
}

fn exercise_generated_archive(root: &std::path::Path, input: &[u8]) {
    let archive = root.join("generated.zip");
    let staging = root.join("generated-staging");
    let Ok(file) = fs::File::create(&archive) else {
        return;
    };
    let mut writer = ZipWriter::new(file);
    let flags = input.first().copied().unwrap_or_default();
    let name = generated_name(input.get(1..).unwrap_or_default());
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    let mut content = input.get(1..).unwrap_or_default().to_vec();
    content.truncate(MAX_GENERATED_BYTES);
    if flags & 0b100 != 0 {
        content = vec![0_u8; MAX_GENERATED_BYTES];
    }
    if flags & 0b001 != 0 {
        let _ = writer.add_symlink(&name, "target", options);
    } else if writer.start_file(&name, options).is_ok() {
        let _ = writer.write_all(&content);
        if flags & 0b010 != 0 && writer.start_file(&name, options).is_ok() {
            let _ = writer.write_all(&content);
        }
    }
    if writer.finish().is_ok() && fs::create_dir(&staging).is_ok() {
        let _ = extract_zip(
            &archive,
            &staging,
            ExtractionLimits::tightened(8, MAX_GENERATED_BYTES as u64, 2),
        );
    }
}

fn generated_name(input: &[u8]) -> String {
    let mut name = String::from_utf8_lossy(input)
        .chars()
        .take(128)
        .collect::<String>();
    if name.is_empty() {
        name = "addons/é/plugin.gd".to_owned();
    }
    name
}
