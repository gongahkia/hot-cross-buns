# Markdown parser dependency patch

The runtime uses remark/micromark to retain real CommonMark/GFM structure and exact source offsets. Profiling a 1,000-entry planner found repeated prefix copies in `micromark-util-edit-map@1.0.0`. Its `EditMap.consume` empties and rebuilds an unchanged event prefix for each container. Large planning lists with metadata fences amplify that cost.

[`scripts/patch-markdown-parser.mjs`](../scripts/patch-markdown-parser.mjs) removes only that redundant prefix copy/reset from the production and development exports, following the proposed correction in [upstream PR #249](https://github.com/micromark/micromark/pull/249). [Issue #256](https://github.com/micromark/micromark/issues/256) documents the same failure boundary. The proposal remains upstream work, not a released upstream guarantee.

`npm ci` applies the correction through `postinstall`. The script checks version and complete original file SHA-256 values, accepts its own already-patched output, and rejects unexpected dependency bytes. `prebuild` and `pretest:unit` require the patch; an install with lifecycle scripts disabled must run the patch explicitly before verification. No parser grammar or validation is disabled. The dependency's existing MIT license remains in its package.

`tests/markdownParserPatch.test.mjs` checks both exports against deterministic edit sequences, including replacement/removal/insertion, same-index additions, ordering, object identity, reuse and no-op consumption. It also measures copied references to catch the prefix regression without a host-time assertion. The planner source/offset fixtures and 10,000-entry performance tests exercise the actual patched parser. These finite tests are not a complete CommonMark conformance certification.

When upstream releases a correction, inspect its semantics, update the lockfile and remove this patch and its install/check hooks together. Run the full format, operation, performance and browser suites before removing it; do not silently bypass a checksum mismatch.

## Reusing planning models

Each immutable document retains its compact planning model in a WeakMap. Merge operations use those models for identity checks, source-field ownership and insertion validation instead of repeatedly reparsing baseline/browser/file sources through the two-entry source cache. Models expire with their documents; no full remark AST is retained and the global source cache remains limited to two entries. Undo history retains at most 100 documents in the current UI.

Duplicate group detection and edited-group lookup use sets/maps. Ambiguous desired group names or reused group identities are rejected before source edits. Source offsets, full candidate validation, immutable projections and conservative conflict behavior remain unchanged.

The 10,000-item merge regression now changes different entries on both sides, checks both results and times the actual merge. The former case had an unchanged side and exercised a fast path. On an Apple M3 with Node 26.7, one local run measured 640 ms for this merge and 1,138 ms for the round trip. These single-run measurements are not cross-device performance guarantees; CI also checks supported Node 22/24 configurations.

## Background validation

Browser imports, source saves, structured edits, explicit outline upgrades, initial workspace loading and scratchpad save/capture preparation use one dedicated parser worker. It returns planning models or bounded token deltas against exact session baselines; main-thread replay/adoption freezes models and projections before use. Requests have distinct identities, cancellation handling, an eight-request bound and a 30-second deadline. A crashed worker is terminated; cancelled or late responses cannot resolve a different request. When workers are absent or infrastructure fails, the same source validator runs synchronously so offline or restricted environments retain editing and recovery. Deadlines and explicit cancellations remain rejected instead of resubmitting the expensive operation on the UI thread. Content-validation errors never bypass the validator.

Vite resolves `decode-named-character-reference` to its DOM-free default export for both bundles. Its browser conditional export creates a DOM element at module load and cannot run in a worker. The grammar and source coordinates are the same on both paths; no synthetic DOM or reduced parser is used.

Structured edits and undo/redo are queued in order. Worker results are checked against the current source and discard generation before publishing state. Inline outline edits additionally check their original content before applying positional operations. Scratchpad preparation runs outside IndexedDB transactions, followed by an atomic source/revision comparison; up to three retries can incorporate independent task edits, while newer scratchpad revisions reject the old draft. Provider transactions retain their synchronous final guards and conservative review behavior.

`journalBackground.test.mjs` checks request ordering, cancellation, failure/restart, deadlines, bounded work, invalid content and worker operations. `background.spec.ts` verifies an actual production worker, rendering during a 5,000-entry parse and recovery after worker failure. One local browser run continued 66 animation frames during that parse. The existing 1,200-entry browser regression also exercises completion/undo and search; neither test establishes universal latency targets.

General incremental parsing was deferred at this stage; the later bounded production path is described below. Avoiding redundant parses and moving full validation off the UI thread address measured costs without changing reference resolution or arbitrary Markdown ownership. Future incremental work must compare complete resulting source, diagnostics and UTF-16 ranges against the current parser, including global references, frontmatter, nested fences, section boundaries and terminal scratchpad changes. A worker improves responsiveness; it does not remove full-document CPU cost or full-snapshot storage/history amplification.

## Visible-date source index

The 10,000-entry browser benchmark reproduced a default-week failure with only 20 current rows: each date rescanned all historical entries and exhausted the unchanged 100,000-work budget. `seriesView.ts` now reuses a source index for frozen journal containers, including date groups, replacement identities, skip sets and span/recurrence candidates. Ordinary completed history is indexed once rather than revisited for every visible date. Mutable documents or mutable indexed skip/replacement data rebuild the index.

Work and the 5,000-visible-row limit remain enforced. `seriesIndex.test.mjs` checks the original 10,000-entry week, visible-row rejection, mutable-data invalidation and equivalence with uncached recurrence/span/replacement projections. The browser benchmark now completes at both 1,000 and 10,000 entries without changing its seven-day view or the projection ceilings.

## Browser measurements

Run `npm run benchmark:markdown -- --samples=3`. The command builds the production profiling variant, starts its own preview server, uses a fresh Chromium context per sample, writes `.tmp/markdown-benchmark/latest.json`, then restores the ordinary production build. Instrumentation is disabled in normal builds; measurement records contain phase names, durations and sizes, not journal content.

The [2026-11-18 results](performance/markdown-2026-11-18.json) used an Apple M3, macOS arm64, Node 26.7.0 and Chromium 156.0.8078.4, with three samples per size, 20 visible entries and seven visible dates. Source sizes were 82,379 and 836,488 bytes. Values below are milliseconds, median / p95. With three samples, p95 is the largest sample; these are local observations, not service-level targets or a comparison against Notion or Obsidian.

| Measurement | 1,000 entries | 10,000 entries |
| --- | ---: | ---: |
| Cold full parse, worker CPU | 103.2 / 105.7 | 894.6 / 913.5 |
| Full parse, worker round trip | 106.1 / 108.7 | 925.3 / 944.2 |
| Full-source echo round trip | 0.1 / 0.2 | 0.4 / 0.5 |
| Compact-model echo round trip | 3.4 / 3.5 | 36.2 / 36.6 |
| Main-thread model adoption during completion | 1.2 / 2.0 | 12.9 / 13.4 |
| React render work per completion commit | 1.9 / 6.3 | 1.8 / 12.6 |
| Changed-candidate completion validation, worker CPU | 97.2 / 98.0 | 817.4 / 824.2 |
| Completion durable save | 28.0 / 30.3 | 64.1 / 65.2 |

Echo round trips include structured cloning, scheduling and both directions, rather than pure copying CPU time. React's production profiler adds overhead, measures render work rather than browser paint, and reports multiple commits per action. Durable save includes opening IndexedDB, validation, serialization and transaction completion. The phases can overlap or repeat; summing these medians does not describe end-to-end latency. Browser timer resolution can report zero for tiny delta transfers.

The [baseline](performance/markdown-before-validation-reuse-2026-11-18.json) already included the visible-date index correction. Subsequent measurements exposed repeated validation of unchanged source: importing materialized an already-parsed document, and storage reparsed validated documents after their source fell out of the two-entry cache. Unchanged materialization now reuses its canonical document, and storage can reuse canonical references only when their exact source matches. Arbitrary mutable objects do not qualify. Changed candidates still receive full validation; database version 4 and revision protocol 2 remain unchanged.

At 10,000 entries, median import materialization worker time fell from 831.2 to 13.6 ms and completion durable save from 995.0 to 64.1 ms. At 1,000 entries those figures fell from 90.2 to 1.5 ms and 141.7 to 28.0 ms. The final completion trace contains no synchronous main-thread parser invocation. `journalBackground.test.mjs` and `markdown.test.mjs` check identity reuse and rejection of unvalidated storage references.

### Incremental and revision-patch evaluation

`scripts/experiments/markdownIncremental.ts` is a benchmark-only prototype for same-length ASCII root-title edits with unchanged syntax and validated source. It shares unchanged model data and is compared deeply against the complete parser. The 10,000-entry median was 0.074 ms versus 1,065.5 ms for the complete title reparse. This narrow result cannot be extrapolated to arbitrary Markdown edits. Generated differential tests cover 120 accepted edits across format versions, BOM and line endings; definition, fence, section, scratchpad, Unicode, stale-source and size-changing edits require the full-parser fallback.

The prototype also extracts a revision delta without splitting UTF-16 surrogate pairs. At 10,000 entries extraction cost 2.0 ms median, while a full-source echo cost 0.4 ms. Source-only patches therefore do not justify changing the revision protocol on this evidence. The 36.2 ms compact-model round trip is a better future transfer target, but full parsing remains the dominant completion cost. A next parser optimization should address changed-candidate validation with conservative invalidation and complete-model equivalence checks before shipping incremental behavior.

## Unified-writing measurements

The [format-3 writing results](performance/unified-writing-2026-11-18.json) repeat the three-sample, 20-visible-entry, seven-date dataset on the same Apple M3 / Node 26.7 / Chromium 156 environment. Source sizes remain 82,379 and 836,488 bytes. The benchmark now opens the direct document editor, types in a local block without saving, opens Calendar and advances one month. It restores the ordinary production build afterward.

Values are milliseconds, median / p95; with three samples p95 is the largest observation.

| Measurement | 1,000 entries | 10,000 entries |
| --- | ---: | ---: |
| Cold full parse, worker CPU | 117.1 / 121.3 | 914.3 / 925.7 |
| Full parse, worker round trip | 125.6 / 131.8 | 966.3 / 969.9 |
| Compact-model echo round trip | 10.0 / 11.7 | 50.0 / 56.6 |
| Main-thread model adoption during completion | 2.5 / 3.6 | 16.3 / 16.5 |
| React render work per completion commit | 0.2 / 5.9 | 0.3 / 18.7 |
| Changed-candidate completion validation, worker CPU | 95.9 / 110.1 | 811.0 / 850.1 |
| Completion durable save | 15.9 / 17.3 | 52.7 / 55.5 |
| Local input event to second animation frame | 23.4 / 25.4 | 26.9 / 28.3 |
| React render work per local typing commit | 1.0 / 2.7 | 1.0 / 3.1 |
| Calendar opening, automation elapsed time | 74.3 / 84.5 | 78.4 / 78.6 |
| Next month, automation elapsed time | 66.8 / 67.5 | 66.6 / 67.2 |
| React render work per calendar commit | 1.9 / 5.5 | 3.3 / 6.4 |

The two-frame input measure is a paint-opportunity proxy, not physical input-to-display latency. Calendar elapsed times include browser automation/protocol overhead; React render timings are recorded separately. Local typing does not commit or validate a durable journal candidate. These measurements do not establish a Notion/Obsidian speed comparison, universal input targets or real-phone performance.

Format 3 retains bounded root-outline render trees in addition to attached bodies. The serialized compact model grew from 602,073 to 1,253,823 characters at 1,000 entries and from 6,186,116 to 7,436,199 at 10,000 entries. This explains a real transfer/adoption tradeoff; visible documents reuse saved trees or bounded cached fallback previews rather than keeping an unbounded full AST. Completion validation remains similar to the previous full-parser measurements. Lower durable-save observations cannot be attributed to this UI change alone.

The narrow benchmark-only incremental-title experiment now updates retained root text trees too and matches the complete model for 180 generated edits across formats 1/2/3, BOM and supported line endings. Its 10,000-entry median is 3.05 ms; it remains excluded from production. The following production-validation section implements the first conservative subset; arbitrary Markdown invalidation remains future work; smaller worker responses are implemented in the later bounded-transfer section. Full validation, database version 4 and revision protocol 2 remain intact.

## Conservative incremental validation

The production source-edit path now reuses validated grammar for same-width ASCII plain-title replacements and changes to existing planning checkbox characters. It accepts a candidate only when every differing character belongs to one of those certified tokens. Existing offsets, metadata, reference context, UTF-8 byte count and line count stay unchanged. Task ancestry and completion-date constraints are checked again, and both planning fields and retained render trees are updated. Other candidates go through the original complete parser, including invalid completion candidates so that their diagnostics retain the original behavior.

Full parser results are deeply frozen and certified by a private validator instance. Copied, shallow-frozen or wire-adopted objects cannot qualify by claiming that they were validated. The token index is weakly scoped to its model and shared across accepted edits whose geometry is unchanged; no second full Markdown AST or durable index is introduced. State ownership, full-source equality checks, undo, database version 4 and revision protocol 2 remain unchanged. An unseen imported/source baseline still needs full parsing; exact already-validated sources retain their existing cache reuse.

`plannerIncremental.test.mjs` compares complete models, including diagnostics, global reference/footnote/math indexes and all UTF-16 ranges, against a fresh full parse. Its corpus includes 972 checkbox candidates across three formats, three markers, nine rich titles, BOM and LF/CRLF/CR; 216 sequential plain-title edits; mixed dated/undated outlines; depth 32; tabs; render-budget fallbacks; untrusted/copied certificates; mixed safe/unsafe changes; metadata, structure, capture, reference and Unicode fallbacks; and a 10,000-entry worker/source-adapter round trip. These finite cases support the narrow recognizer, not a general CommonMark incremental-parsing claim. `incremental-validation.spec.ts` checks the actual worker path, exact export/undo and full fallback for rich writing.

The [three-sample browser report](performance/incremental-validation-2026-11-18.json) uses the same format-3 fixture, 20 visible entries and seven dates as the earlier report. The benchmark now asserts that each measured completion actually takes the production incremental path. Values below are milliseconds, median / p95.

| Measurement | 1,000 entries | 10,000 entries |
| --- | ---: | ---: |
| Completion materialization and validation, worker CPU | 5.2 / 5.4 | 37.8 / 41.4 |
| Completion worker round trip | 17.7 / 18.0 | 102.1 / 107.8 |
| Main-thread model adoption | 3.3 / 4.9 | 20.8 / 22.5 |
| Completion durable save | 16.2 / 18.2 | 68.5 / 77.5 |
| React render work per completion commit | 0.3 / 5.8 | 0.5 / 26.6 |
| Local input event to second frame | 20.7 / 24.4 | 19.6 / 25.1 |
| Cold full parse, worker CPU | 143.8 / 164.0 | 1,099.6 / 1,232.2 |

At 10,000 entries, the measured worker completion work fell from the earlier 811.0 ms median to 37.8 ms, about 21 times less worker time for this eligible operation. This is not a 21-times end-to-end latency claim: full-model transfer, adoption, rendering and saving remain measurable, and phases can overlap. Three-sample p95 is the maximum observation. The input metric remains a paint-opportunity proxy; no physical-device or Notion/Obsidian comparison is established.

The newer cold full-parse numbers are higher than the historical run. The reproducible six-pair same-process comparison measured full-read medians of 1,145.0 ms before and 1,099.9 ms after. [Inference] The historical increase is consistent with run-to-run variation; these small samples do not isolate an attributable full-parse regression. The later bounded-transfer section addresses worker result size; variable-length Markdown invalidation should remain behind complete-model equivalence tests.

### Paired comparison and verification

Run `node --experimental-strip-types scripts/benchmark-validation-comparison.mjs --baseline=bdd39a6 --samples=6`. The script resolves a local commit, extracts only its source into an owned temporary directory, runs both versions with the same installed dependencies, alternates execution order, checks exact saved source and complete-model equality outside the timer, and removes the temporary source afterward. Results are written to `.tmp/validation-comparison/latest.json`. It does not check out files over the working tree or change journal data.

The [six-pair Node report](performance/incremental-comparison-2026-11-18.json) compares `bdd39a6` with `ca5d874` at 10,000 entries. Completion materialization/validation medians were 1,121.5 ms before and 33.2 ms after (about 33.8 times less CPU elapsed time within this Node scope). Cloning, full baseline reads, browser communication, painting and durable saving are outside that completion timer. Full-read medians were 1,145.0 / 1,099.9 ms. These scopes differ from the three-sample browser worker measurements and must not be presented as end-to-end user latency.

Final `npm run verify`: 355 unit tests, 15 Python tests, TypeScript/production build and 275 Chromium browser tests passed. The command then exited 1 on the unchanged four high-severity dependency findings through Vite/fdir/tinyglobby/picomatch. The existing large-main-chunk and optional Mermaid asset warnings remain. No validation gate, dependency audit threshold, database version or revision protocol was weakened. `git diff --check` passed; README.md remains unchanged. Local runs used Node 26.7 on Apple M3/macOS and Chromium 156. Node 22/24 CI, other browser engines and physical devices were not run here.


## Bounded worker transfers

The worker and client each retain four session-local model baselines keyed by request ID. Requests advertise a baseline only for an identical complete source. A compact response contains source-token patches produced by the worker's incremental validator, with expected fragments and replacement text, rather than a complete source or model. Its receipt names the direct immutable baseline by a weak reference, avoiding a chain that retains historical models. Compact responses are limited to 256 ordered, nonoverlapping, same-width patches and 65,536 combined expected/replacement characters; other results send the complete model. No-op requests can return an empty delta.

The client enrolls complete responses from its current worker session in a separate private validator. It checks request/model IDs, its pinned baseline and source, patch bounds, exact fragments, surrogate boundaries and permitted token grammar before replaying a delta. Unchanged model nodes and frozen entry/group projections retain identity. Arbitrary stored or copied models cannot enroll themselves in either private validator. This is a transport optimization, not a new persisted format or revision protocol.

An unusable compact result triggers one retry of the submitted-input snapshot with complete-model output required. The retry shares the original deadline and cancellation; repeated compact responses cannot extend it or create a retry loop. Missing worker baselines and unsupported edits send complete models directly. A restart clears client baselines, request IDs remain monotonic and old-worker messages/errors are ignored. The bridge still never commits state: source/revision checks, editing ownership, undo and sync remain with their existing callers. Worker errors and parse failures retain their existing recovery behavior.

`journalTransport.test.mjs` checks complete-model equivalence, direct-baseline receipts, no-op responses, cache eviction, oversized deltas, absent weak references, malformed ranges/fragments, Unicode and completion constraints. `journalBackground.test.mjs` covers negotiated deltas, out-of-order pinned baselines after eviction, stale IDs, restart/old-port events, corrupted-response repair, caller mutation after submission, cancellation during repair, original deadlines and validation errors. Real-browser tests cover compact completion, undo/redo, rich-content full validation, restart/bootstrap, corrupted-response recovery and later writing synchronized from another window.

Run `npm run benchmark:markdown -- --samples=3` to reproduce the measurement on the current checkout. The [three-sample browser report](performance/worker-deltas-2026-11-18.json), measured from the source committed in `c47d2cf`, repeats the same format-3 fixture with 20 visible entries and seven dates. Each completion must use production incremental validation and a compact response below 1,024 serialized characters. Times are milliseconds, median / p95.

| Measurement | 1,000 entries | 10,000 entries |
| --- | ---: | ---: |
| Completion materialization/validation and response preparation, worker | 4.0 / 4.1 | 25.9 / 27.3 |
| Completion worker round trip, including local delta replay | 14.7 / 15.2 | 57.8 / 58.9 |
| Request snapshot, outside round-trip timer | 0.8 / 0.8 | 10.9 / 11.3 |
| Main-thread model adoption | 0.0 / 0.1 | 0.3 / 0.3 |
| Completion durable save | 8.8 / 9.4 | 46.9 / 48.8 |
| React render work per completion commit | 0.3 / 5.2 | 0.3 / 21.5 |
| Local input event to second frame | 25.7 / 26.0 | 24.7 / 26.8 |
| Cold full parse, worker | 122.3 / 127.1 | 907.1 / 925.9 |

At 10,000 entries the completion response is about 190 serialized characters, compared with the earlier complete model's 7,436,199 characters. Median worker round trip was 102.1 ms before and 57.8 ms in this run, with a new 10.9 ms request-snapshot cost measured separately. Completion adoption samples include subsequent exact-source/no-op reads; frozen models are now enrolled before adoption, so replay/freezing work belongs to the round-trip timer. Local delta replay reached 8.9 ms in this run. Do not attribute the adoption reduction solely to projection caching or add phase medians into an end-to-end latency claim.

Profiling serializes each response to count its characters before adding that count field; this instrumentation is absent in ordinary production. Its overhead is included in round trips, but excluded from worker-work timing. The comparison is between sequential historical runs, not alternating paired measurements. Three-sample p95 is the maximum, and full-parse/typing variation is not evidence of an attributable regression or improvement. Full source and dirty projections still travel to the worker, source comparison/token indexing still scale with journal size, and arbitrary Markdown edits retain full parsing. Physical devices, non-Chromium engines and Notion/Obsidian performance are not measured.


Verification for this change: `npm run verify` passed 371 unit tests, 15 Python tests, TypeScript/production build and 278 Chromium browser tests, then exited 1 on the same four high-severity dependency findings through Vite/fdir/tinyglobby/picomatch. Dependency manifests, lockfiles and the audit threshold were unchanged. Existing large-main-chunk and optional Mermaid bundle warnings remain. The three-sample benchmark completed and restored the ordinary production build. Runs used Node 26.7 on Apple M3/macOS and Chromium 156; Node 22/24 CI, other browser engines, physical devices and live cloud services were not tested. `git diff --check` passed, and README.md retained SHA-256 `0d2d10d75f9c6f66bdc45c7a1dc6e5616be75f695ff6cf13171fff47440b155c`.
