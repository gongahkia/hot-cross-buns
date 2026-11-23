# Incremental conversation archive verification — 23 November 2026

This extends [the first continuity verification](continuity-2026-11-23.md).
The production context path now uses paged SQLite history, source-linked summary
sections and optional hybrid recall. The old 4,096-turn / 16 MiB scanner remains
only as a legacy/test helper; it is not called by conversation preparation.

## Checks

- Final full repository check passed: Go tests and vet, 87 browser gateway/rendering
  tests, 142 shared-host tests and one OAuth build check. The Node suites reported
  zero failures and zero skips.
- Focused Go race checks passed for summaries, correction/withdrawal, concurrent
  memory changes, hybrid fallback and scope, cache failure, summary dependencies,
  vector validation/search, deleted candidates, missed-hook repair and discovery
  past an unreadable chat.
- The opt-in live continuity probe passed using the configured OpenAI `gpt-5.6`
  credential store. A corrected synthetic deadline survived 16 summarized turns;
  a draft comparison was explicitly not treated as a confirmed booking. The
  probe used temporary synthetic state and made no connected-account actions.
- Local Ollama was unavailable at `127.0.0.1:11434`. A real local embedding call
  could not be verified. Deterministic embedding fixtures cover semantic-only
  matches, restart reuse, unavailable-provider lexical fallback, validation and
  privacy/scope checks before source upload. No model was installed or started.

Commands:

```sh
TMPDIR=/var/tmp GOMAXPROCS=2 GOFLAGS=-p=1 GOMEMLIMIT=2GiB make check
TMPDIR=/var/tmp GOMAXPROCS=1 GOFLAGS=-p=1 GOMEMLIMIT=768MiB go test -race ./internal/continuity ./internal/worksession -run 'Test(Hybrid|Summary|Malformed|Corrections|MemoryMutation|HistorySections|HistorySummary|HistoryVectors|HistoryVectorSearch|HistoryIndexNever|UnavailableArchive|HistoryFailedHook|HistoryDiscovery)'
TMPDIR=/var/tmp GOMAXPROCS=1 GOFLAGS=-p=1 HOT_CROSS_BUNS_LIVE_CONTINUITY=1 go test ./cmd/hot-cross-buns -run '^TestLiveConversationContinuity$' -count=1 -v -timeout=100s
```

The first full check also passed before the final recovery hardening. An earlier
race attempt overlapped creation of the recovery helper and failed to compile;
the final race run against the complete source tree passed both packages. This
was not a runtime failure or a weakened test. The first final full rerun was
stopped when its Go build process stopped advancing with a 768 MiB memory budget;
it was restarted with two Go threads and a 2 GiB budget. Paid live Go probes remain opt-in
and are skipped in ordinary checks.

## Behavioral coverage

- A legacy archive of 4,200 unindexed dialogue turns backfills in bounded pages,
  retains its cursor across calls, and returns the latest window without using
  the old full-history scanner.
- Full-text recall finds an old source after 28 newer chats exist. The production
  recall path searches indexed dialogue and selected public Work output, rather
  than reading the latest 24 conversations on each message.
- Preparation remains usable with more than 16 MiB of canonical dialogue text.
  Private admission options are absent from public index/summary inputs.
- A cache symlink is rejected; recent canonical dialogue remains usable and its
  outside target is untouched. Missing, changed and deleted selected candidates
  are not disclosed from stale cache rows.
- A failed source hook leaves a durable repair marker. Repair invalidates exactly
  the dependent section before normal summary reuse. Discovery rotates past
  corrupt chat metadata instead of starving later conversations.
- Summary sections are reused across restart. A new section is generated from
  originals, then a separate parent overview is built from child sections. An
  unrelated memory correction does not recompute existing sections; a linked
  dependency change invalidates its leaf and ancestors, preserving unrelated
  leaves. Older task admission and forks do not receive future summaries or roll
  back the current main-chat view.
- Semantic-only vocabulary matches work alongside lexical ranking. Vectors are
  provider/scope/version bound, normalized and validated. A delayed response for
  a changed source cannot resurrect its vector. Streaming search handles 5,000
  vectors without the legacy 4,096-document cap.
- Goal, ancestry, admission-time and earlier-chat opt-out checks run before source
  embedding. Forgotten known source chats are withheld and their vectors purged.
  Provider outages retain exact-word recall. Current saved memory remains editable
  and concurrent withdrawal rejects a prepared snapshot.
- Saved-knowledge cloud consent does not enable chat-history upload. Its separate
  review names conversation excerpts, task output and queries. Cancellation does
  not save permission, revocation is immediate for future calls, and changing
  provider does not transfer the permission. Embedding settings participate in
  captured processing scope.
- Gateway tests use normal replies, cold restart, memory correction/forgetting
  and discussion of completed delegated output after its worker closes.

## Bounds

These tests establish wiring, bounded preparation and privacy/invalidation
mechanisms. They do not measure months-long semantic recall quality, multilingual
retrieval quality or a universal rate of successful remembering. Summaries can
lose detail; originals remain searchable. Indexing/embeddings catch up over time,
selected candidate windows are bounded, vector comparison is linear disk I/O and
the shared disposable SQLite cache retains its 512 MiB ceiling. Cache exhaustion
or unavailable providers degrade context with notices instead of proving complete
recall. See [implementation details](../CONVERSATION-CONTINUITY.md).

Native macOS/Windows, physical-device and notification acceptance were not rerun
for this backend change.
