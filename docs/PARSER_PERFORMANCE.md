# Markdown parser dependency patch

The runtime uses remark/micromark to retain real CommonMark/GFM structure and exact source offsets. Profiling a 1,000-entry planner found repeated prefix copies in `micromark-util-edit-map@1.0.0`. Its `EditMap.consume` empties and rebuilds an unchanged event prefix for each container. Large planning lists with metadata fences amplify that cost.

[`scripts/patch-markdown-parser.mjs`](../scripts/patch-markdown-parser.mjs) removes only that redundant prefix copy/reset from the production and development exports, following the proposed correction in [upstream PR #249](https://github.com/micromark/micromark/pull/249). [Issue #256](https://github.com/micromark/micromark/issues/256) documents the same failure boundary. The proposal remains upstream work, not a released upstream guarantee.

`npm ci` applies the correction through `postinstall`. The script checks version and complete original file SHA-256 values, accepts its own already-patched output, and rejects unexpected dependency bytes. `prebuild` and `pretest:unit` require the patch; an install with lifecycle scripts disabled must run the patch explicitly before verification. No parser grammar or validation is disabled. The dependency's existing MIT license remains in its package.

`tests/markdownParserPatch.test.mjs` checks both exports against deterministic edit sequences, including replacement/removal/insertion, same-index additions, ordering, object identity, reuse and no-op consumption. It also measures copied references to catch the prefix regression without a host-time assertion. The planner source/offset fixtures and 10,000-entry performance tests exercise the actual patched parser. These finite tests are not a complete CommonMark conformance certification.

When upstream releases a correction, inspect its semantics, update the lockfile and remove this patch and its install/check hooks together. Run the full format, operation, performance and browser suites before removing it; do not silently bypass a checksum mismatch.
