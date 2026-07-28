#[path = "../benches/component_harness.rs"]
mod component_harness;

#[test]
fn invariant_component_benchmark_lock_fixture_is_parseable_and_deterministic() {
    let lock = component_harness::lock_fixture();

    assert_eq!(lock.packages().len(), 1);
    assert_eq!(lock.to_toml(), lock.to_toml());
}
