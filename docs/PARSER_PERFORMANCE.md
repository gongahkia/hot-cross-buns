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

Browser imports, source saves, structured edits, explicit outline upgrades, initial workspace loading and scratchpad save/capture preparation use one dedicated parser worker. It returns compact planning models; main-thread adoption freezes projections before use. Requests have distinct identities, cancellation handling, an eight-request bound and a 30-second deadline. A crashed worker is terminated; cancelled or late responses cannot resolve a different request. When workers are absent or infrastructure fails, the same full validator runs synchronously so offline or restricted environments retain editing and recovery. Deadlines and explicit cancellations remain rejected instead of resubmitting the expensive operation on the UI thread. Content-validation errors never bypass the validator.

Vite resolves `decode-named-character-reference` to its DOM-free default export for both bundles. Its browser conditional export creates a DOM element at module load and cannot run in a worker. The grammar and source coordinates are the same on both paths; no synthetic DOM or reduced parser is used.

Structured edits and undo/redo are queued in order. Worker results are checked against the current source and discard generation before publishing state. Inline outline edits additionally check their original content before applying positional operations. Scratchpad preparation runs outside IndexedDB transactions, followed by an atomic source/revision comparison; up to three retries can incorporate independent task edits, while newer scratchpad revisions reject the old draft. Provider transactions retain their synchronous final guards and conservative review behavior.

`journalBackground.test.mjs` checks request ordering, cancellation, failure/restart, deadlines, bounded work, invalid content and worker operations. `background.spec.ts` verifies an actual production worker, rendering during a 5,000-entry parse and recovery after worker failure. One local browser run continued 66 animation frames during that parse. The existing 1,200-entry browser regression also exercises completion/undo and search; neither test establishes universal latency targets.

Production incremental parsing is deferred. Avoiding redundant parses and moving full validation off the UI thread address measured costs without changing reference resolution or arbitrary Markdown ownership. Future incremental work must compare complete resulting source, diagnostics and UTF-16 ranges against the current parser, including global references, frontmatter, nested fences, section boundaries and terminal scratchpad changes. A worker improves responsiveness; it does not remove full-document CPU cost or full-snapshot storage/history amplification.

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

The narrow benchmark-only incremental-title experiment now updates retained root text trees too and matches the complete model for 180 generated edits across formats 1/2/3, BOM and supported line endings. Its 10,000-entry median is 3.05 ms; it remains excluded from production. The next parser priority is conservative changed-candidate invalidation with complete-source/model/diagnostic equivalence, followed by smaller worker model transfers. Full validation, database version 4 and revision protocol 2 remain intact.
