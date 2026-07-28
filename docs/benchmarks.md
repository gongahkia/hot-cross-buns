# Benchmark methodology

No performance claims are published yet.

## Measurements

The component harness measures independently:

- Manifest and lockfile parsing
- Dependency resolution
- Source download or fetch
- Extraction and package preparation
- Hashing and cache access
- Materialisation
- Cold and warm end-to-end synchronisation
- No-op synchronisation

Run the local deterministic workloads with:

```sh
cargo +1.85.0 bench -p wukong-core --bench component_harness
```

It reports manifest/lockfile parsing, resolver work, ZIP extraction, local-tree
hashing, cache lookup, copy materialisation, and no-op sync as separate rows.
It does not make performance claims or compare runs.

Git and HTTPS fetch rows require immutable public inputs supplied through
`WUKONG_BENCH_GIT_URL` plus `WUKONG_BENCH_GIT_REV`, and
`WUKONG_BENCH_HTTP_URL` plus `WUKONG_BENCH_HTTP_SHA256`. Without a complete
pair, the harness emits a skip row and opens no network connection. Configured
fetches run both cold-cache and warm offline-cache workloads. Do not provide
credentials in benchmark environment variables.

## Resolver baseline

Run the source-pinned graph-traversal baseline with:

```sh
cargo +1.85.0 bench -p wukong-core --bench resolver_baseline
```

It builds a deterministic 1,024-package chain before timing and verifies that
the traversal reaches every package. Its single output row records the fixture,
iteration count, and elapsed nanoseconds. It is a fixture baseline, not a
published performance result or a version-solver benchmark.

## Required context

Each result must record hardware, operating system, Rust version, filesystem,
network conditions, cache state, fixture revision, command, repetition count,
and raw timings.

## Fixtures

`crates/wukong-core/benches/fixtures.rs` defines revision `wukong-111-v1`.
Fixtures are generated from deterministic bytes at runtime, so they need no
network access or mutable fixture download.

| Fixture | Shape |
| --- | --- |
| Small project | 4 files × 4 KiB |
| Medium dependency graph | 64-package chain |
| Large graph | 1,024-package chain |
| Many small files | 512 files × 1 KiB |
| One large addon | 1 file × 8 MiB |
| Cold cache | empty cache before the operation |
| Warm cache | populated, verified cache before the operation |
| Offline cache hit | populated cache with networking disabled |
| Concurrent project installs | 2 independent project roots sharing the cache |

The component harness uses the small-project and medium-graph fixtures; the
resolver baseline uses the large graph. Run each cache and concurrency scenario
as a distinct workload; do not merge their timings.

## Reporting

Report median and spread, retain raw result data, and distinguish
package-manager-controlled work from network time. Do not compare results with
different fixture, cache, network, or hardware conditions as equivalent.
