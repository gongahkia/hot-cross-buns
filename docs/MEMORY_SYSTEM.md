# Memory and knowledge management

HCB separates exact personal statements, proposed memories, saved reference
notes and reusable procedures. Memory is reference context: it never grants file,
account, browser or computer permissions.

## Capture and significance

Clear, enduring user statements continue through the existing `memory_remember`
path and current chat-learning setting. Sensitive/ambiguous admission, semantic
identity checks, correction revisions and withdrawn-topic checks remain in use.

For decisions, plans, conditional preferences or uncertain future usefulness,
`memory_propose` creates an inactive candidate containing the exact current user
quote, a reason for future usefulness, importance and temporal applicability.
The source is the host-bound current user message, not a model-written transcript.
Candidates do not enter automatic recall.

Open **Memory → Suggestions**, inspect the statement, its proposed applicability
and any existing memories it would reconcile, then choose **Review and save** or
**Decline suggestion**. Acceptance checks the exact reviewed candidate and source
snapshot again. If relevant saved state changes first, the proposal becomes
stale and needs to be recreated. Stale proposal text is withheld from the
catalog. Goal-scoped proposals remain owned by their goal.

The importance label and explanation are proposals about usefulness, not a
calibrated confidence score or proof that the statement is true. The benchmark
and its limitations are described in the [verification record](verification/memory-system-2026-11-25.md).

## Temporal and conditional context

Reviewed context distinguishes `current`, `planned`, `occurred`, `cancelled` and
`historical` states. It supports an applicability interval, IANA timezone,
entity label and optional task-topic terms. Dates must be absolute and reviewed;
ambiguous relative dates should not be invented. Applicability dates describe
when the context should be used, rather than establishing that an event occurred.

Passing a date never changes a plan into a completed event. Historical,
cancelled, not-yet-applicable and ended context stays inspectable in management
but is excluded from automatic recall. Conditional context does not enter the
always-available profile and needs a matching task topic. Corrections to a
temporally annotated statement require fresh applicability review before reuse;
an age-confirmation action cannot clear that requirement.

Existing version-1 records stay readable. Context and recall-policy extensions
use version 2 so an older binary cannot silently ignore those constraints.

## Retrieval and explanations

Work preparation keeps existing lexical and optional semantic shortlists, then
applies a shared selection policy to personal memories and saved notes. User pins
and reviewed constraints get priority, repeated content can be omitted, and an
oversized item does not block smaller useful items. Scope, exclusions, source
checks, snooze and temporal applicability are checked before selection.

Automatically supplied saved knowledge has a conservative ceiling of 4096 tokens,
using UTF-8 byte counts as a tokenizer-independent upper bound. This is an initial
knowledge-selection ceiling, not the total request or tool-schema budget. Explicit
later reads remain available through existing bounded tools and execution limits.
Ordinary chat continuity uses the same selector for its personal-memory capsule
and preserves applicability metadata.

Work answers retain selected source revisions, selection reasons and bounded
identifier-only omission explanations. **Context and sources → Why context was
selected or omitted** exposes this trace. It describes supplied inputs, not the
model's hidden reasoning. Missing context is not evidence that something was
never stated; the agent can inspect eligible knowledge or ask for clarification.

Ranking uses explicit deterministic priorities over the existing retrieval
results. It is not a trained usefulness model or a guarantee of relevant recall.

## Management controls

Memory groups personal records, saved notes, guidance, suggestions and routines
without combining their owning stores or permissions. Expanded records show why
they were saved, source statements, temporal context and source dependencies where
available.

For global personal memories and saved notes:

- **Pin for recall** changes selection priority. It does not override source,
  scope, expiry, snooze, withdrawal or task-topic restrictions.
- **Snooze for 7 days** pauses recall without deleting the record. **Resume
  recall** clears that pause; other eligibility checks still apply.
- **Not useful here · omit next task** excludes the item from saved recall and
  knowledge tools for the next task in the owning conversation. **Include for
  next task** reverses the queued exclusion. Existing chat text is not erased.
- **Edit** and **Forget** use the exact inspected revision. Forgetting affects
  future recall and blocks silent relearning of the withdrawn topic; historical
  chats and retained task receipts are separate retention surfaces.

These controls express selection preferences; they do not train model weights.
Goal-specific changes remain in the owning goal's controls. Routines link to the
existing skills/routine management and activation reviews.

## Reviewed consolidation and invalidation

Ask HCB to organize inspected saved knowledge. `knowledge_consolidate` proposes a
compact derived note from one to eight eligible saved memory/note/skill sources.
The approval shows the proposed summary and actual original source statements.
Acceptance saves pinned source revisions while leaving the originals intact.
For existing-note changes, the existing `suggest_change` review supports
`knowledge_sources`; routines can declare those dependencies too. Personal-fact
merges retain the existing semantic reconciliation review.

Source links are not independent verification of every summary claim. Review
uncertainty and contradictions rather than approving an unsupported synthesis.
No new unattended model-consolidation process is enabled: consolidation is a
foreground, reviewed tool path. Existing bounded failure-lesson maintenance is
separate.

Dependency checks run transitively when derived items are read. Corrected,
forgotten, out-of-scope, snoozed or otherwise invalid sources make dependent
content unavailable to recall, knowledge reads and routine activation. Cycles
and excessive dependency depth are rejected. Pinning alone does not change
source meaning; resuming an unchanged snoozed source can make it eligible again.
Recreate stale summaries from current evidence rather than clearing their
dependency links to bypass review.

This is invalidation of future use, not physical erasure of every old file,
backup or already-sent model context. Existing notes/routines without declared
dependencies cannot acquire reliable lineage retroactively; inspect and recreate
them when that lineage is needed.

## Evaluation commands

Normal `make check` includes deterministic scoring, temporal, selection,
dependency, review, management and regression tests. Paid live tests are opt-in
and use synthetic statements with disposable state.

```sh
node --env-file=.env scripts/memory-eval.mjs --suite journey --report /tmp/hcb-memory-journey-new.json
node --env-file=.env scripts/memory-eval.mjs --suite focused --report /tmp/hcb-memory-focused-new.json
```

Each report path must be new. The default evaluation model is `gpt-5-mini`;
`--model` chooses another OpenAI model explicitly. API credentials stay in the
process environment. The journey uses production Work-service preparation,
provider calls, memory tools, catalog acceptance and consolidation review. The
focused suite uses a deliberately stricter four-step completion limit. Neither
suite establishes local-model parity or long-term generalization.

## Local Markdown category files

Memory sections now expose their local Markdown paths. Existing editable memory/note text imports through revision-checked correction APIs before recall; review-controlled records remain read-only in those files. See [the editing and conflict guide](MEMORY_MARKDOWN_FILES.md).
