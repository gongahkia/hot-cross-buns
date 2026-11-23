# Conversation continuity verification — 23 November 2026

Verified on Linux using the private Go runtime and the real browser gateway.

The scan ceilings and lexical-only recall limitations below describe the first
implementation. They are superseded by [incremental archive verification](continuity-archive-2026-11-23.md).

## Automated checks

`TMPDIR=/var/tmp GOMAXPROCS=1 GOFLAGS=-p=1 GOMEMLIMIT=768MiB make check`
passed: Go tests and vet, 87 browser tests, 142 shared-host tests, and the OAuth
build check. The Node suites reported zero failures and zero skips. Paid Go
probes remain opt-in and are skipped by ordinary checks.

Focused race checks also passed:

```sh
TMPDIR=/var/tmp GOMAXPROCS=1 GOFLAGS=-p=1 go test -race ./internal/continuity ./internal/worksession -run 'Summary|Continuity|ContextHistory|Commitments|Recall|MemoryMutation|Corrections'
```

Coverage includes durable summary reuse and extension, recent-context batching,
equal-time admission ordering, original-history preservation, malformed summaries,
source and privacy invalidation, stale/concurrent writers, deleted chats, forks,
older task preparation, memory correction/exclusion/forgetting, concurrent memory
withdrawal, retrieval opt-out, goal boundaries, refreshed commitments and paused
schedules. Gateway tests exercise normal replies, cold restart, memory edits and
forgetting through the existing API, and discussion of a completed delegated
result after its worker has closed. Historical results have no control capability.

## Live provider check

`HOT_CROSS_BUNS_LIVE_CONTINUITY=1 go test ./cmd/hot-cross-buns -run '^TestLiveConversationContinuity$' -count=1 -v -timeout=100s`
passed using the configured OpenAI `gpt-5.6` model and existing credential store.
The probe summarized 16 older synthetic turns, then answered using that summary
and the recent conversation. The corrected deadline survived; the answer did not
confuse a draft comparison with a confirmed booking. There were no email, booking,
or other connected-account actions, and real chats/settings were not modified.

This is one synthetic semantic case, not a measured recall rate, model comparison,
or months-long personal-agent evaluation. The current history scan is bounded to
4,096 public turns / 16 MiB; older-chat recall is lexical and bounded. Native
macOS/Windows, physical-device, and notification acceptance were not rerun for
this backend change. See [the implementation boundaries](../CONVERSATION-CONTINUITY.md).
