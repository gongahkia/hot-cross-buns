use std::hint::black_box;
use std::time::Instant;

const PACKAGE_COUNT: usize = 1_024;
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
    let graph = SourcePinnedGraph::chain(PACKAGE_COUNT);
    assert_eq!(graph.traverse_from_root(), PACKAGE_COUNT);

    let started = Instant::now();
    for _ in 0..ITERATIONS {
        black_box(graph.traverse_from_root());
    }
    let elapsed = started.elapsed();
    println!(
        "benchmark=source-pinned-graph-traversal fixture=chain-{PACKAGE_COUNT} packages={PACKAGE_COUNT} iterations={ITERATIONS} elapsed_ns={}",
        elapsed.as_nanos()
    );
}
