# Benchmark methodology

No performance claims are published yet.

## Measurements

When implemented, measure independently:

- Manifest and lockfile parsing
- Dependency resolution
- Source download or fetch
- Extraction and package preparation
- Hashing and cache access
- Materialisation
- Cold and warm end-to-end synchronisation
- No-op synchronisation

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

Use pinned fixtures representing a small project, a medium graph, a large graph,
many small files, and one large addon. Measure cold, warm, offline cache-hit,
and concurrent-install scenarios separately.

## Reporting

Report median and spread, retain raw result data, and distinguish
package-manager-controlled work from network time. Do not compare results with
different fixture, cache, network, or hardware conditions as equivalent.
