#[path = "../benches/fixtures.rs"]
mod fixtures;

use std::{fs, path::Path};
use tempfile::TempDir;

#[test]
fn invariant_benchmark_source_fixtures_have_deterministic_declared_contents() {
    assert_eq!(fixtures::FIXTURE_REVISION, "wukong-111-v1");
    let directory = TempDir::new().expect("fixture directory should create");

    for fixture in fixtures::SOURCE_FIXTURES {
        let entries = fixtures::source_entries(fixture);
        assert_eq!(entries, fixtures::source_entries(fixture));
        assert_eq!(entries.len(), fixture.file_count);
        assert_eq!(
            entries.iter().map(|entry| entry.bytes.len()).sum::<usize>(),
            fixture.total_bytes()
        );

        let root = directory.path().join(fixture.id);
        fixtures::write_source_tree(&root, fixture);
        assert_eq!(file_count(&root), fixture.file_count);
        assert_eq!(byte_count(&root), fixture.total_bytes());
    }
}

#[test]
fn invariant_benchmark_fixture_matrix_covers_graph_cache_and_concurrency_states() {
    assert_eq!(
        fixtures::GRAPH_FIXTURES
            .iter()
            .map(|fixture| fixture.id)
            .collect::<Vec<_>>(),
        ["medium-dependency-graph", "large-dependency-graph"]
    );
    assert_eq!(fixtures::MEDIUM_GRAPH.package_count, 64);
    assert_eq!(fixtures::LARGE_GRAPH.package_count, 1_024);
    assert_eq!(
        fixtures::CACHE_STATES.map(fixtures::CacheState::id),
        ["cold-cache", "warm-cache", "offline-cache-hit"]
    );
    assert_eq!(fixtures::CONCURRENT_PROJECT_INSTALLS.project_count, 2);
}

fn file_count(root: &Path) -> usize {
    fs::read_dir(root)
        .expect("fixture directory should read")
        .map(|entry| entry.expect("fixture entry should read").path())
        .map(|path| if path.is_dir() { file_count(&path) } else { 1 })
        .sum()
}

fn byte_count(root: &Path) -> usize {
    fs::read_dir(root)
        .expect("fixture directory should read")
        .map(|entry| entry.expect("fixture entry should read").path())
        .map(|path| {
            if path.is_dir() {
                byte_count(&path)
            } else {
                usize::try_from(
                    fs::metadata(path)
                        .expect("fixture file metadata should read")
                        .len(),
                )
                .expect("fixture byte count should fit")
            }
        })
        .sum()
}
