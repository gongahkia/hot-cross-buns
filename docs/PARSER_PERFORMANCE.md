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

Browser imports, source saves, structured edits, explicit outline upgrades, initial workspace loading and scratchpad save/capture preparation use one dedicated parser worker. It returns compact planning models; main-thread adoption freezes projections before use. Requests have distinct identities, cancellation handling, an eight-request bound and a 30-second deadline. A crashed worker is terminated; cancelled or late responses cannot resolve a different request. When workers are absent or infrastructure fails, the same full validator runs synchronously so offline or restricted environments retain editing and recovery. Content-validation errors never bypass the validator.

Vite resolves `decode-named-character-reference` to its DOM-free default export for both bundles. Its browser conditional export creates a DOM element at module load and cannot run in a worker. The grammar and source coordinates are the same on both paths; no synthetic DOM or reduced parser is used.

Structured edits and undo/redo are queued in order. Worker results are checked against the current source and discard generation before publishing state. Inline outline edits additionally check their original content before applying positional operations. Scratchpad preparation runs outside IndexedDB transactions, followed by an atomic source/revision comparison; up to three retries can incorporate independent task edits, while newer scratchpad revisions reject the old draft. Provider transactions retain their synchronous final guards and conservative review behavior.

`journalBackground.test.mjs` checks request ordering, cancellation, failure/restart, deadlines, bounded work, invalid content and worker operations. `background.spec.ts` verifies an actual production worker, rendering during a 5,000-entry parse and recovery after worker failure. One local browser run continued 66 animation frames during that parse. The existing 1,200-entry browser regression also exercises completion/undo and search; neither test establishes universal latency targets.

Incremental parsing is deferred. Avoiding redundant parses and moving full validation off the UI thread address measured costs without changing reference resolution or arbitrary Markdown ownership. Future incremental work must compare complete resulting source, diagnostics and UTF-16 ranges against the current parser, including global references, frontmatter, nested fences, section boundaries and terminal scratchpad changes. A worker improves responsiveness; it does not remove full-document CPU cost or full-snapshot storage/history amplification.
