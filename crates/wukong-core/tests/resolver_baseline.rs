#[path = "../benches/resolver_baseline.rs"]
mod resolver_baseline;

#[test]
fn source_pinned_graph_traversal_visits_every_package_once() {
    assert_eq!(
        resolver_baseline::SourcePinnedGraph::chain(4).traverse_from_root(),
        4
    );
}
