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
materialisation, project-only no-op sync, cold direct sync, warm direct sync,
and frozen no-op direct sync as separate rows. The direct-sync workloads include
one package, 64 aliases, and 100 local dependencies.
Their stable row names are `direct-sync-cold`, `direct-sync-warm`, and
`direct-sync-frozen-noop`.
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
   WUKONG_BENCH_FIXTURE=small-project WUKONG_BENCH_CACHE_STATE=cold-cache \
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

The stress_harness integration test exercises real local lock and sync
transactions at 1, 10, 100, and 500 package roots. It verifies the lockfile,
installed state, fresh materialisation, and no-op state for each count. This
is a correctness harness, not a scale claim or a substitute for recorded
stress results.

## Observed local component result

On 2026-08-07, commit `6a1f29be34ee0f034af1d6aed5bf8135c3ee6bcd` was measured
with the collector on macOS 26.5.2, APFS, Apple M3, 16 GB memory, and Rust
1.85.0. The collector ran 15 independent invocations of the local-only
component harness; each row below represents 20 iterations within one
invocation. Git and HTTPS rows were intentionally skipped in this collection
because it measured only deterministic local fixtures.

| Workload | Median for 20 iterations | Range | Interpretation |
| --- | ---: | ---: | --- |
| Cold direct sync, small project | 869.764 ms | 798.251–1,381.226 ms | local package preparation and first materialisation |
| Warm direct sync, 64 aliases | 1,031.046 ms | 994.489–3,788.041 ms | repeated ownership/materialisation planning |
| Warm direct sync, 100 local dependencies | 1,659.085 ms | 1,569.769–6,273.003 ms | largest measured local workload |
| Frozen no-op direct sync, small project | 17.685 ms | 16.864–55.287 ms | lock-and-state reuse without source access |
| Automatic materialisation, small project | 2.427 ms | 2.269–7.996 ms | reflink-or-copy selection |
| Copy materialisation, small project | 65.967 ms | 57.145–82.238 ms | forced file-copy baseline |

The whole harness had a median wall time of 8.741 seconds (8.189–20.372
seconds). These data identify large local dependency sets and repeated aliases
as the dominant measured work. They do not justify a general speed claim or
an optimization: the wide tail requires profiling on a controlled host before
changing cache, transaction, or source-validation behavior.

The raw collector record was reviewed locally but is not committed because its
environment capture contains host-specific data. Reproduce it with the
collection procedure above, retain redacted raw observations, and add public
Git, HTTPS, Linux, and Windows rows before publishing a cross-platform result.

## Observed public-source component result

A second 15-sample collection used credential-free public inputs: the exact
Git revision `e2347a35a6c0922cfb0a077cf5ed21696fba46da` of
[`npkgz/cli-progress`](https://github.com/npkgz/cli-progress), plus its
SHA-256-pinned 160 KiB GitHub archive
`0914eb4a64d014ed21dfe33bba065e72377df913f4390ed51a30f0a956b7821f`.
It used the same Wukong commit, host, Rust version, and filesystem as the
local collection. No proxy environment variables were set; VPN state was not
recorded.

| Workload | Median for iterations shown | Range | Notes |
| --- | ---: | ---: | --- |
| Git cold fetch (3) | 1,960.107 ms | 1,879.449–3,144.811 ms | clone and immutable-revision verification |
| Git warm offline fetch (20) | 342.897 ms | 271.571–529.873 ms | verified cached checkout reuse |
| HTTPS cold fetch (3) | 856.999 ms | 800.985–1,773.847 ms | download, SHA-256 verification, and cache publication |
| HTTPS warm offline fetch (20) | 8.937 ms | 7.769–40.186 ms | verified cached archive reuse |

The complete network-inclusive harness had a 14.788-second median wall time
(13.410–21.027 seconds); all 15 commands exited successfully. This records one
public GitHub network condition and a small archive only. It neither measures
large archives nor supports a general network-performance claim.

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
