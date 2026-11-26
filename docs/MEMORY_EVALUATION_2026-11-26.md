# Memory and context evaluation — 2026-11-26

The immediate implementation replaces fixed conversation and retained-task text
thresholds with deployment-aware input budgets. It does not make recall complete
or summaries lossless. The recommendation for the next memory iteration is to
improve measurable retrieval of current, source-backed facts before adding a
second memory service or autonomous memory rewriting.

## What changed now

- The wordmark menu contains product controls, without a separate History list.
  Cmd/Ctrl-P searches retained work, supports pagination and opens its existing
  details or relevant exchange. Returning to HCB preserves one conversational
  home and the original work's execution/approval scope.
- Native model capacity follows exact documented identities, explicit deployment
  configuration and read-only Ollama allocation metadata. Unknown deployments
  have labeled conservative fallbacks. System prompts, tool definitions,
  serialized history, media estimates and output reservations count toward the
  admission check. See [capacity details](MODEL_CONTEXT_BUDGETS.md).
- Recent context and archive summaries adapt to that input allowance. Tool loops
  and continuations compact at complete interaction boundaries, retaining the
  current task and latest interaction. Compacted tool text remains in private
  revision archives; knowledge dependencies survive for later correction and
  withdrawal checks. This is source preservation, not a promise that a model
  summary preserves every nuance.

## Evaluation design

The committed [daily corpus](../internal/eval/testdata/daily-memory-v1/dataset.json)
contains 13 synthetic scenarios across immediate assistance, research,
one-time scheduling and recurring work. Cases cover exceptions, revised dates,
draft-only permission, revised research findings, unresolved evidence, limited
benchmark scope, timezone conversion, expiry, missing account access, paused
work, repeated notifications and unknown-address abstention.

Every source is admitted through the canonical conversation store. Older facts
are followed by 56 explicitly transient observations. Each question uses actual
continuity preparation, including summary maintenance and retrieval. Three
reading strategies use the same real `gpt-5-mini` model:

1. **Recent only:** the prepared recent exchange, without archive or saved memory.
2. **HCB hybrid:** current HCB recent context, hierarchical summaries and recall.
3. **Hybrid plus neighbors:** HCB hybrid plus up to twelve source turns adjoining
   selected recall results. This is a controlled experiment, not a production
   change to privacy or scope screening.

Each strategy runs at controlled 16,384- and 65,536-token windows, with a
2,048-token output reserve. These are enforced HCB budgets on the same cloud
model, not tests of two distinct model capacities or of local-model quality.
Expected facts are withheld from the prompts. A deterministic grader compares
typed JSON fields exactly; a case passes only when every field matches and the
answer has no extra fields. Source retrieval, correct interpretation and exact
formatting are therefore separate possible failure causes.

The run is capped at 128 model requests and two million aggregate tokens.
Reported per-trial latency measures the final reading call; aggregate usage also
includes archive maintenance. Arms share the prepared evidence per question.
Archive caches warm in corpus order, windows run in fixed order, and each case is
sampled once. There is no summaries-only arm, so this comparison cannot isolate
the contribution of every context component. This is a diagnostic comparison, not a statistically powered
benchmark, a published leaderboard reproduction or a months-long longitudinal
study. Semantically equivalent answers may fail its strict grader.

Three additional isolated checks execute the production Work/job adapters:
reading a fixture file, a delayed one-time check, and an unchanged recurring
monitor that should stay quiet. They do not start a real scheduler, connect an
account or authorize an external action. The separate production memory journey
tests capture, fresh-task recall, correction, forgetting, reviewed significance
and consolidation, including invalidation of derived knowledge.

## Measured results

The [main live report](evaluations/daily-memory-2026-11-26.json) contains 78
reading trials, 30 graded fields per arm/window and three production execution
checks. There were no reading-call transport or JSON errors.

| Controlled window | Strategy | Strict cases | Exact fields | Mean reading input tokens | Median reading latency |
| --- | --- | --- | --- | --- | --- |
| 16K | Recent only | 1/13 | 3/30 | 1,931 | 4.23 s |
| 16K | HCB hybrid | 12/13 | 29/30 | 2,530 | 5.84 s |
| 16K | Hybrid plus neighbors | 12/13 | 29/30 | 3,485 | 5.17 s |
| 64K | Recent only | 1/13 | 2/30 | 8,511 | 3.95 s |
| 64K | HCB hybrid | 11/13 | 28/30 | 9,402 | 5.08 s |
| 64K | Hybrid plus neighbors | 12/13 | 29/30 | 10,357 | 5.26 s |

The [interactive chart](evaluations/daily-memory-2026-11-26.html) switches between
windows. These timings exclude continuity preparation; they must not be read as
end-to-end response latency.

Interpret the misses before choosing an implementation:

- At 16K both hybrid arms, and at 64K the base hybrid, returned
  `request_gmail_access` rather than the requested enum `request_access`. They
  correctly said the inbox had not been checked. The strict grader counts this
  as a miss; it is a format/instruction mismatch, not evidence that access was
  fabricated or a fact was forgotten.
- At 64K both hybrid arms recalled the paused Hazel status but returned
  `run_now: null` instead of `false`. This is an unresolved inference despite
  the status being recalled, not unauthorized execution. Neighbors did not
  repair it.
- Neighbor expansion added about 955 reading input tokens per question in both
  windows. Its one strict-case gain at 64K was the access-action enum, not a
  demonstrated recovery of a missing source fact. One sample cannot establish
  a latency gain or a quality advantage.
- All hybrid runtime and research cases passed in both windows. Current
  corrections, draft-only restrictions, research disagreement and benchmark
  scope survived this source-retrieval test. The recent-only baseline still
  answered the unknown-address question correctly, as it should when evidence
  is absent.

**Important limitation discovered by the run:** every prepared context reported
zero summarized turns. The main run recorded 26 requests without reported usage.
A [focused repeat with preparation diagnostics](evaluations/daily-memory-diagnostic-2026-11-26.json)
confirmed a summary request hit the existing 12-second context deadline, emitted
an unavailable-summary notice and continued with original-source retrieval.
[Inference] This timeout pattern explains the main run's missing summaries, but
individual preparation errors were not recorded by that first run. Consequently
these scores demonstrate retrieval fallback and reading behavior, **not live
summary nuance retention**. Deterministic compaction tests and the separate live
reviewed-consolidation journey provide different, narrower evidence.

The main run used 114 model requests and 590,113 **reported** tokens, with usage
unknown for 26 requests; the actual billable total cannot be inferred from the
reported total. It completed in 801.54 seconds. The focused repeat made four
requests, with one unknown-usage summary timeout. The committed harness now
records preparation notices/errors and supports case/window selection so this
failure is visible on subsequent runs.

Production execution outcomes were:

| Check | Outcome | What it establishes |
| --- | --- | --- |
| Foreground file inspection | Passed | Read the fixture's four samples and corrected deadline without editing or sending. |
| Delayed one-time job adapter | Completed | The production adapter executed; this assertion did not independently grade the lateness explanation or test a real laptop restart. |
| Unchanged recurring monitor | **Failed quietness check** | Work completed, but unverified quiet-decision evidence references caused the host to request review. The integrity guard stayed in force; this is unwanted user attention, not a transport failure. |

The [separate memory journey](evaluations/memory-journey-2026-11-26.json) passed
its eight model-facing steps and two catalog/withdrawal checks. It used 22
requests and 267,527 reported tokens, with no unknown usage. It demonstrated
fresh-task recall, replacement of a preference, forgetting, a reviewed
significance candidate and source-backed consolidation whose derived content
was invalidated by forgetting. Its small synthetic significance scores do not
establish a real-world capture threshold or long-term usefulness.

The live process exits successfully when it completes its measurements; quality
failures remain in the report rather than being converted into passing results.
The main run preceded the final adaptive archive-aggregation adjustment; because
it produced no summaries, it does not evaluate that adjustment.

## Research and existing systems

Anthropic's context-engineering guidance treats compaction, structured notes and
delegated context as distinct techniques, and warns that aggressive compaction
can discard subtle information. Its practical lesson here is to preserve source
material and measure what is omitted before optimizing a short summary for
precision. [Anthropic context engineering](https://www.anthropic.com/research/effective-context-engineering-for-ai-agents).

OpenAI's memory/compaction example distinguishes working context, reusable memory
and reviewed artifacts. [Inference] HCB should keep those lifecycles distinct:
an ephemeral task observation need not become a personal preference, and a saved
summary should not become evidence that an external action succeeded.
[OpenAI reliable-agent memory example](https://developers.openai.com/cookbook/examples/agents_sdk/building_reliable_agents_memory_compaction).

LongMemEval tests extraction, cross-session reasoning, time, updates and
abstention. LoCoMo emphasizes long-range conversational and temporal reasoning.
MemoryAgentBench evaluates incremental retrieval, learning, long-range
understanding and selective forgetting. These support a broader evaluation than
whether the assistant can repeat a saved preference. Our small corpus borrows
these dimensions without claiming their published scores or coverage.
[LongMemEval](https://arxiv.org/abs/2410.10813),
[LoCoMo](https://arxiv.org/abs/2402.17753),
[MemoryAgentBench](https://arxiv.org/abs/2507.05257).

Existing systems offer useful mechanisms, with different integration costs:

| System | Useful mechanism | HCB fit and unresolved questions |
| --- | --- | --- |
| Mem0 | Fact extraction, entity/keyword/semantic retrieval and temporal ranking. | Candidate reference implementation for retrieval experiments. Its README distinguishes proprietary managed-platform benchmark optimizations from the open-source SDK; those scores are not evidence that adding the SDK improves HCB. Review its treatment of agent-generated claims against HCB's source/authority distinction. |
| Graphiti | Temporal facts, provenance to episodes, entity relationships and hybrid graph retrieval. | Useful model for validity windows and cross-project relationships. It adds a Python/graph runtime and surrounding governance; HCB would still need its own permissions, withdrawal, evaluation and operations. |
| Letta memory blocks | Bounded persistent context blocks, shared blocks and explicit read-only blocks. | Useful pattern for a small current profile and task scratchpad. Full block replacement and concurrent writers require conflict handling; persistent blocks alone do not choose significant facts or solve recall. |

These descriptions come from the projects' primary documentation, rather than
an integration or comparative runtime test:
[Mem0 README](https://github.com/mem0ai/mem0),
[Graphiti README](https://github.com/getzep/graphiti),
[Letta memory blocks](https://docs.letta.com/v1-sdk/memory/memory-blocks).

## Proposed next iteration

Keep HCB's canonical sources, editable memory and derived archive. The first
follow-up should address summary maintenance latency and recurring evidence
references before adding more retrieved text. A bounded foreground attempt
should not repeatedly pay for a summary that times out; evaluate asynchronous,
source-version-checked maintenance and an explicit retry/backoff policy. For
quiet recurring decisions, expose canonical evidence references to the model
and measure valid reference use without weakening host validation. Neither
production change is included in this evaluation-focused implementation.

Then add a held-out evaluation set before selecting the next retrieval change:

1. **Recover related evidence within budget.** Compare the current hybrid with
   time/entity-aware ranking and bounded neighboring-source reads. Check exact
   source coverage, answer utility, latency and tokens. Every added source must
   pass the same admission, scope, exclusion and withdrawal checks as an original
   recall hit. More context is a hypothesis to test, not automatically better.
2. **Keep current state and historical state separate.** Exercise corrections,
   future plans, temporary constraints and elapsed date windows. Prefer typed
   canonical schedule/account/task state for execution; historical statements
   cannot grant access or establish that something ran.
3. **Measure significance over a conversation.** Score important omissions,
   unnecessary captures, later useful applications and irrelevant
   personalization. Include conversations where saving nothing is correct.
   Evaluate one consolidated proposal when a topic settles rather than a write
   after every exchange.
4. **Consolidate from sources with a reversible proposal.** Preserve source IDs,
   versions, valid time, uncertainty and exceptions. Keep pin/exclusion controls,
   conflict checks and existing approval policy. Bound maintenance calls and
   make a bad merge reversible; do not use a summary to verify itself.
5. **Test invalidation end to end.** Change or forget a fact after it influences
   summaries, routines and retained work. Check future answers, cached retrieval
   and resumed work, including a process restart. Report both known-source
   suppression and cases where semantically equivalent private information
   still resurfaces.

Candidate improvements should be accepted on held-out gains without regressions
in abstention, permissions, forgetting or recurring-work noise. Repeat with
multiple seeds and swapped case/arm order, then test a separately approved local
model using its actual allocation. No new memory service, automatic model
installation or permission expansion is part of this implementation.

## Reproduce

With a usable orchestrator `OPENAI_API_KEY` already in `.env`:

```sh
fnm exec --using 26.7.0 node --env-file=.env scripts/context-memory-eval.mjs \
  --report /tmp/hcb-daily-memory.json
fnm exec --using 26.7.0 node --env-file=.env scripts/memory-eval.mjs \
  --suite journey --report /tmp/hcb-memory-journey.json
```

A focused repeat, without the three runtime checks:

```sh
fnm exec --using 26.7.0 node --env-file=.env scripts/context-memory-eval.mjs \
  --case meal-exception --window 16384 --report /tmp/hcb-memory-diagnostic.json
```

Reports use exclusive creation, so select a new destination on each run. These
are opt-in paid model calls with synthetic isolated state. Regular `make check`
skips the live tests and runs the deterministic boundary/regression suite.

## Verification and limits

`TMPDIR="$(python3 -c 'import os,tempfile;print(os.path.realpath(tempfile.gettempdir()))')" fnm exec --using 26.7.0 make check` passed: 80 Go packages with tests, Go vet, 159 browser tests, 146 host tests and one OAuth build test. Live tests are opt-in and skipped by this command.

The isolated real-browser check used 65 retained contexts. It confirmed the
wordmark has product controls without the History list; Cmd/Ctrl-P exposes past
work, the list paginates past its first page, search finds an older record, and
opening/returning from that record preserves the home conversation. The only
browser console error was an existing missing favicon request. Temporary test
state and browser artifacts were removed.

Earlier verification attempts failed under the shell's Node 20 dependency loader
and on fake providers without declared capacity. They were rerun under Node
26.7.0 with explicit fixture allocations, retaining the capacity guard. A
separate adaptive-summary test confirms model-facing archive aggregation can
exceed the legacy 12 KiB compatibility view while fitting its token allocation.

No live Gemini or downloaded local model was tested. Non-OpenAI text uses a
conservative byte-based estimator, media counting is approximate, and unknown
deployments require declared capacity when the fallback differs from their
actual limits. Native CLI agents retain their own context management. These
limits are explicit; a passing fixture run is not model-quality parity.

## Follow-up implementation

The recommended asynchronous summary maintenance and recurring reference work
is implemented and verified in the [follow-up report](verification/assistant-maintenance-2026-11-26.md).
The original measurements above remain unchanged; the new focused live checks
provide evidence for those two changes rather than replacing the original run.
