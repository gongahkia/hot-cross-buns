#![allow(dead_code)]

use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};
use zip::{CompressionMethod, ZipWriter, write::SimpleFileOptions};

pub(crate) const FIXTURE_REVISION: &str = "wukong-111-v1";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct SourceFixture {
    pub(crate) id: &'static str,
    pub(crate) file_count: usize,
    pub(crate) bytes_per_file: usize,
}

impl SourceFixture {
    pub(crate) const fn total_bytes(self) -> usize {
        self.file_count * self.bytes_per_file
    }
}

pub(crate) const SMALL_PROJECT: SourceFixture = SourceFixture {
    id: "small-project",
    file_count: 4,
    bytes_per_file: 4 * 1024,
};
pub(crate) const MANY_SMALL_FILES: SourceFixture = SourceFixture {
    id: "many-small-files",
    file_count: 512,
    bytes_per_file: 1024,
};
pub(crate) const ONE_LARGE_ADDON: SourceFixture = SourceFixture {
    id: "one-large-addon",
    file_count: 1,
    bytes_per_file: 8 * 1024 * 1024,
};
pub(crate) const SOURCE_FIXTURES: [SourceFixture; 3] =
    [SMALL_PROJECT, MANY_SMALL_FILES, ONE_LARGE_ADDON];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct GraphFixture {
    pub(crate) id: &'static str,
    pub(crate) package_count: usize,
}

pub(crate) const MEDIUM_GRAPH: GraphFixture = GraphFixture {
    id: "medium-dependency-graph",
    package_count: 64,
};
pub(crate) const LARGE_GRAPH: GraphFixture = GraphFixture {
    id: "large-dependency-graph",
    package_count: 1_024,
};
pub(crate) const GRAPH_FIXTURES: [GraphFixture; 2] = [MEDIUM_GRAPH, LARGE_GRAPH];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum CacheState {
    Cold,
    Warm,
    OfflineHit,
}

impl CacheState {
    pub(crate) const fn id(self) -> &'static str {
        match self {
            Self::Cold => "cold-cache",
            Self::Warm => "warm-cache",
            Self::OfflineHit => "offline-cache-hit",
        }
    }
}

pub(crate) const CACHE_STATES: [CacheState; 3] =
    [CacheState::Cold, CacheState::Warm, CacheState::OfflineHit];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct ConcurrentInstallFixture {
    pub(crate) id: &'static str,
    pub(crate) project_count: usize,
}

pub(crate) const CONCURRENT_PROJECT_INSTALLS: ConcurrentInstallFixture = ConcurrentInstallFixture {
    id: "concurrent-two-project-installs",
    project_count: 2,
};

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct SourceEntry {
    pub(crate) relative_path: PathBuf,
    pub(crate) bytes: Vec<u8>,
}

pub(crate) fn source_entries(fixture: SourceFixture) -> Vec<SourceEntry> {
    (0..fixture.file_count)
        .map(|index| SourceEntry {
            relative_path: source_relative_path(fixture, index),
            bytes: deterministic_bytes(fixture.bytes_per_file, index),
        })
        .collect()
}

pub(crate) fn source_relative_path(fixture: SourceFixture, index: usize) -> PathBuf {
    if fixture.file_count == 1 {
        PathBuf::from("plugin.gd")
    } else {
        PathBuf::from(format!("scripts/file-{index:04}.gd"))
    }
}

pub(crate) fn write_source_tree(root: &Path, fixture: SourceFixture) {
    for entry in source_entries(fixture) {
        let destination = root.join(entry.relative_path);
        fs::create_dir_all(
            destination
                .parent()
                .expect("fixture source entry should have a parent"),
        )
        .expect("fixture source directory should create");
        fs::write(destination, entry.bytes).expect("fixture source entry should write");
    }
}

pub(crate) fn write_archive(path: &Path, fixture: SourceFixture) {
    let file = fs::File::create(path).expect("fixture ZIP should create");
    let mut writer = ZipWriter::new(file);
    for entry in source_entries(fixture) {
        let path = entry.relative_path.to_string_lossy().replace('\\', "/");
        writer
            .start_file(
                format!("addons/benchmark-addon/{path}"),
                SimpleFileOptions::default().compression_method(CompressionMethod::Stored),
            )
            .expect("fixture ZIP entry should start");
        writer
            .write_all(&entry.bytes)
            .expect("fixture ZIP entry should write");
    }
    writer.finish().expect("fixture ZIP should finish");
}

fn deterministic_bytes(length: usize, seed: usize) -> Vec<u8> {
    (0..length)
        .map(|offset| {
            u8::try_from((seed.wrapping_mul(31).wrapping_add(offset)) % 251)
                .expect("fixture byte should fit")
        })
        .collect()
}
