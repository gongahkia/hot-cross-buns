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
hashing, cache lookup, ownership-map construction, copy and automatic
materialisation, project-only no-op sync, and warm direct sync as separate
rows. The direct-sync workload includes one package and 64 aliases sharing one
local source, which exposes repeated canonical-tree work.
It does not make performance claims or compare runs.

## Measured design decisions

The component harness is used to choose implementation work, not to publish
speed claims. It covers the following current decisions:

- Independent direct-source preparation is scheduled on at most four workers;
  package ordering and the first reported failure remain deterministic.
- Package preparation streams each file once while calculating its tree and
  file checksums. Ownership-map construction reuses those verified file
  checksums instead of reading prepared files again.
- Automatic materialisation attempts copy-on-write reflinks, then uses a copy.
  It never uses hardlinks because an editable project file must not alias a
  local source or cache object.
- ZIP extraction streams each entry directly into its transaction staging root.
- A sync with no writes, removals, or state changes returns before staging a
  transaction.

Git checkout reuse remains content-addressed by canonical source and immutable
commit. The harness does not schedule configured network measurements unless
the public immutable inputs described below are supplied.

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

## Collection procedure

1. Record the checked-out commit, fixture revision, Rust version, hardware,
   operating-system version, and filesystem before the first run.
2. Select one fixture and one cache state. Prepare that state before every
   repetition; do not retain accidental state from an earlier run.
3. For network workloads, record target host, region, connection type, whether
   a proxy or VPN was active, and whether the network was otherwise idle. Do
   not place credentials in the record or command environment.
4. Run the exact command 15 independent times. Save the complete stdout,
   stderr, exit status, and elapsed wall time of each invocation. The collector
   automates this layout without deleting or replacing an existing result
   directory:

   ```sh
   scripts/collect-benchmark-runs.sh benchmarks/results/<date>-component-harness
   ```

   Pass an explicit command after the directory for a distinct workload. Set
   `WUKONG_BENCH_NETWORK_CONDITIONS` to the reviewed, credential-free
   description before collecting any network workload.
5. Keep raw output immutable. Produce median, minimum, maximum, and standard deviation only as derived data; never replace the raw observations.

Use a unique result directory such as
`benchmarks/results/2026-07-29-component-harness/` containing:

```text
metadata.toml
raw/01.stdout
raw/01.stderr
raw/01.status
...
raw/15.stdout
raw/15.stderr
raw/15.status
raw/15.wall_ns
summary.md
```

`metadata.toml` must include this schema, with actual values substituted:

```toml
schema = 1
wukong_revision = "<git commit>"
fixture_revision = "wukong-111-v1"
fixture = "small-project"
cache_state = "cold-cache"
command = "cargo +1.85.0 bench -p wukong-core --bench component_harness"
repetitions = 15
rustc = "<rustc -Vv output or path to it>"
hardware = "<CPU, core count, memory, storage>"
operating_system = "<name and version>"
filesystem = "<filesystem type and mount details>"
network_conditions = "<not-applicable or target, region, connection, proxy/VPN>"
```

The collector stores raw system context in `environment/` files and references
them from `metadata.toml`. Review those files before committing or sharing
results: remove personal mount paths and any non-benchmark information while
retaining the filesystem and host facts needed for comparison.

For macOS, `system_profiler SPHardwareDataType SPSoftwareDataType`, `rustc
-Vv`, and `mount` provide the required local context. Use equivalent native
commands on Linux and Windows.

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

State the fixture, cache state, hardware, operating system, filesystem,
network conditions, Rust version, command, repetition count, and raw-result
directory beside every reported number. Distinguish package-manager-controlled
work from network time.

Competitor comparisons must record the competitor name and version, exact
command, fixture preparation, cache state, network conditions, and each raw
run. Do not call different dependency sources, cache states, fixtures, or
hardware equivalent; report them separately instead. No benchmark result is a
speed claim until this metadata and raw data are available for review.
