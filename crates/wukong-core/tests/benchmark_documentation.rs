const BENCHMARKS: &str = include_str!("../../../docs/benchmarks.md");

#[test]
fn invariant_benchmark_methodology_requires_comparable_raw_measurements() {
    for required in [
        "hardware",
        "operating-system version",
        "network conditions",
        "cache state",
        "competitor name and version",
        "15 independent times",
        "standard deviation",
        "raw/01.stdout",
        "WUKONG_BENCH_FIXTURE",
        "direct-sync-frozen-noop",
    ] {
        assert!(
            BENCHMARKS.contains(required),
            "benchmark methodology must require {required}"
        );
    }
}
