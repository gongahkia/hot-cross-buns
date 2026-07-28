mod fixtures;

use fixtures::LARGE_GRAPH;
use std::hint::black_box;
use std::time::Instant;
const ITERATIONS: usize = 1_000;

pub(crate) struct SourcePinnedGraph {
    dependencies: Vec<Vec<usize>>,
}

impl SourcePinnedGraph {
    pub(crate) fn chain(package_count: usize) -> Self {
        assert!(package_count > 0, "a benchmark graph needs a root package");
        let dependencies = (0..package_count)
            .map(|package| package.checked_sub(1).into_iter().collect())
            .collect();
        Self { dependencies }
    }

    pub(crate) fn traverse_from_root(&self) -> usize {
        let mut visited = vec![false; self.dependencies.len()];
        let mut pending = vec![self.dependencies.len() - 1];
        let mut count = 0;

        while let Some(package) = pending.pop() {
            if visited[package] {
                continue;
            }
            visited[package] = true;
            count += 1;
            pending.extend(self.dependencies[package].iter().rev().copied());
        }
        count
    }
}

#[allow(dead_code)]
fn main() {
    let package_count = LARGE_GRAPH.package_count;
    let graph = SourcePinnedGraph::chain(package_count);
    assert_eq!(graph.traverse_from_root(), package_count);

    let started = Instant::now();
    for _ in 0..ITERATIONS {
        black_box(graph.traverse_from_root());
    }
    let elapsed = started.elapsed();
    println!(
        "benchmark=source-pinned-graph-traversal fixture={} packages={package_count} iterations={ITERATIONS} elapsed_ns={}",
        LARGE_GRAPH.id,
        elapsed.as_nanos()
    );
}
