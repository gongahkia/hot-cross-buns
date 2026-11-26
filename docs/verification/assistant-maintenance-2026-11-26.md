# Background summaries and recurring evidence — 2026-11-26

HCB now prepares replies from cached summaries and original-source retrieval.
Summary inference runs through a coalesced private queue outside the reply path.
Recurring decisions receive copyable source references, and verified quiet
results retain those references for inspection. No new product page, toggle or
permanent button is added.

## Summary lifecycle

- The existing private SQLite cache holds the pending request, captured model,
  processing scope, admission boundary and retry state. It stores neither a tool
  grant nor credentials.
- The existing UI history worker and job supervisor drain the queue. Only one
  claim is active in a profile, including when multiple hosts are running. A
  claim expires after two minutes if its process crashes. Ownership is checked
  before inference and publication; a stale worker cannot complete a newer
  claim.
- Each claim has a 90-second deadline, up to two summary calls, and an aggregate
  limit of eight model requests and 200,000 tokens. Privacy comparisons consume
  that budget too. Screened source batches are smaller so comparisons leave
  room for summarization. A bounded claim can continue in a later pass.
- Summary calls have up to 60 seconds. Provider failures back off from one
  minute to two, four and so on, capped at one hour. New messages in the same
  scope update the pending request without resetting backoff. Retry state
  survives a normal restart.
- A changed destination or privacy setting invalidates the captured request.
  Source digests, memory versions and scope checks reject stale publication;
  the original transcripts remain authoritative. Host shutdown cancels pending
  inference. Deleting/rebuilding the disposable cache drops queued maintenance
  and retry state; a fresh conversation request can enqueue it again.

This removes summary generation from normal reply preparation. Required privacy
screening and retrieval can still involve their existing bounded work. It does
not make all replies instantaneous or summaries lossless.

## Recurring decisions

A successful captured file read now includes `evidence` metadata and an
`evidence_references` array alongside its existing result. Web evidence and
retained-evidence reads expose the same copyable array. The scheduled prompt
asks the model to copy these values verbatim and keep clock explanations in
`rationale`.

The host verifies retained bytes and their digest. For local source references,
that digest must also match the frozen source. Evidence IDs and line ranges
both undergo those checks, including when data changes after the reference set
was built. Unread sources, invented IDs, missing snapshots and tampered bytes
remain ineligible. Connected-account and output-file references keep their
existing operation/item and retained-file checks.

Quiet results retain validated references in their existing `WatchDecision`.
Changed results still request attention. Invalid references or unresolved read
failures request review; they are not hidden to make a monitor quiet. Reference
integrity establishes which bytes were retained, not whether those bytes entail
an LLM's claim.

## Live verification

The opt-in checks used `gpt-5-mini` with the existing orchestrator credential,
isolated configuration/state and synthetic files. No real scheduler, connected
account, email, PR or external action was used.

The [summary check](../evaluations/async-summary-2026-11-26.json) passed. It
measured read-only foreground context preparation, then invoked the production
queue/worker, reused a cached summary covering 32 source turns, and answered
from that summary alone. The corrected Juniper deadline was `2026-12-02`, and
`delivered` remained false. This verifies one correction/plan distinction, not
long-term memory quality. The live run preceded the final metadata-only lease
recheck and privacy-budget hardening; those boundaries have deterministic
regression coverage.

The [recurring check](../evaluations/recurring-evidence-2026-11-26.json) passed
all three production job-adapter executions: unchanged v1, repeated unchanged
v1, and changed v2. Both v1 checks were quiet. The v2 check requested attention.
Each retained a verified source ID, and the v2 ID differed from the v1 ID. All
checks started late and kept lateness separate from evidence references. Usage
was reported for all ten model calls: 87,768 input and 3,093 output tokens.
These checks do not establish scheduler/restart reliability or local-model
quality; they exercise the decision and evidence path identified in the earlier
[memory evaluation](../MEMORY_EVALUATION_2026-11-26.md).

To repeat with a new report destination:

```sh
fnm exec --using 26.7.0 node --env-file=.env scripts/memory-eval.mjs \
  --suite maintenance --report /tmp/hcb-summary-maintenance.json
fnm exec --using 26.7.0 node --env-file=.env scripts/memory-eval.mjs \
  --suite recurring --report /tmp/hcb-recurring-evidence.json
```

These are bounded paid inference checks; report creation is exclusive. Ordinary
`make check` skips them and runs the deterministic suite.

## Regression verification

Tests cover no summary inference in foreground preparation, cached reuse,
source/privacy invalidation, host cancellation, one-profile claim ownership,
crash expiry, stale completion, scope changes, retry persistence and progress
under withdrawal screening. Production job-adapter tests cover valid quiet and
attention results, fabricated IDs, tampered retained bytes and changed-source
IDs. Browser tests verify the first reply without a summary, later cached
summary use and cold restart without unnecessary recomputation.

The full check uses the repository's Node 26.7.0 environment and canonical macOS
temporary directory:

```sh
canonical_tmpdir=$(python3 -c 'import os,tempfile;print(os.path.realpath(tempfile.gettempdir()))')
TMPDIR="$canonical_tmpdir" fnm exec --using 26.7.0 make check
```

An initial full run hit a transient SQLite lock in the new read-only test poll.
The poll now retries only SQLite BUSY/LOCKED errors; other failures remain fatal.
The subsequent full run passed. Final lease-ownership hardening was additionally
verified with focused tests and a fresh full run.
