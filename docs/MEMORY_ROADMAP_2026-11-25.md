# Memory and knowledge roadmap — 25 November 2026

**Recommendation:** measure significance and downstream usefulness before adding
more automatic storage. HCB has meaningful integrity controls; its larger gap is
deciding which evidence deserves durable memory, when to retrieve it, and whether
using it improves the assistant's behavior. This document is an audit and proposed
implementation plan. It does not enable additional learning or background model
calls.

## Verified current foundation

- Personal/goal memories retain exact user quotes, timestamps, source fingerprints
  and bounded evidence. Chat admission checks ownership, temporary wording,
  sensitive content and credentials. A model compares meaning against a scoped
  snapshot, with reviewed correction and withdrawal boundaries. This is already
  more than a plain vector database. See [memory suitability](../internal/tools/memory_suitability.go),
  [semantic relations](../internal/memory/semantic.go) and
  [chat admission](../internal/tools/chat_memory.go).
- Known changeable profile facts receive a 90-day confirmation policy. Stable
  preferences are not expired merely by age. Source changes, exclusions and
  forgotten concepts affect recall; reading a memory does not reconfirm it. See
  [freshness](../internal/memory/freshness.go) and [evidence](../internal/memory/evidence.go).
- Normal Work requests combine lexical and optional embedding retrieval, a small
  foreground profile, saved notes and active procedural learnings. Semantic search
  already exists; adding embeddings alone would not address significance. See
  [context assembly](../cmd/hot-cross-buns/work_service.go) and
  [retrieval index](../internal/retrieval/index.go).
- Saved notes, skills/routines, chat history and retained task evidence remain
  distinct stores. Continuations refresh previously used knowledge references.
  The browser exposes Memory and Context and sources; `memory_status` exposes
  freshness/review metadata. See [reference refresh](../internal/workrun/knowledge_refresh.go).
- Background maintenance already scans bounded observations and proposes lessons
  after repeated failures; it does not broadly synthesize autobiographical or
  project knowledge. There are deterministic learning evaluations, lifecycle
  tests and focused live-memory evaluation support. These are useful foundations,
  not proof of reliable long-term personalization. See
  [maintenance](../internal/learning/maintenance.go),
  [learning evaluations](../internal/eval/learning.go) and
  [memory live evaluation](../cmd/hot-cross-buns/memory_live_eval_test.go).

## Biggest gaps and additions

### 1. Significance has no measured, end-to-end learning loop — first priority

The admission policy checks whether material is eligible to be remembered; that
is different from predicting its future value. The current model prompt asks for
enduring facts/preferences, while deterministic wording rules and recognized
categories constrain capture. Those controls do not establish that a saved item
was important, that an omitted item was unimportant, or that the user wanted it
applied in this situation. [Inference] This is the largest quality risk for the
kind of personal assistant HCB is intended to become.

Add a separate **memory candidate** stage: source quote/locator, owner, scope,
proposed type, reason for future usefulness, expected duration, uncertainty and
review requirement. Let the model propose significance; let the host validate
evidence and authority. Explicit user requests take precedence. Repetition is
supporting evidence, never proof of importance or correctness. Do not silently
promote inferred personal claims to confirmed facts.

Start with synthetic multi-session cases containing meaningful decisions among
routine chatter, third-party quotes, temporary instructions, paraphrases and
corrections. Score useful captures, harmful captures and important omissions, then
test whether later answers actually respect the relevant constraints. Keep a
no-memory control and blind held-out cases. Compare local and cloud orchestrators
under the same contract rather than assuming they judge salience equally well.

### 2. Time is handled as expiry/review, not a general history of changing facts

The fixed review policy covers selected profile subjects. Expiry does not express
that a trip ended, a project changed stage, or a constraint applied only during an
event. Add observed time, validity interval, event status and explicit
supersession edges. Resolve relative dates using the originating timezone and
retain the original wording. Distinguish “planned” from “occurred”; passing a date
alone must not convert an intention into a claimed outcome.

Acceptance: a trip location does not replace home location; a cancelled booking
does not become a completed trip; a new role can supersede the current role while
earlier role history remains attributable. Ambiguous transitions ask for review.

### 3. Retrieval measures relevance more directly than usefulness

Context assembly selects bounded lexical/semantic hits and a small profile. It
does not expose a single policy that optimizes task usefulness, diversity,
temporal applicability and token cost across all knowledge types.

Keep existing scope/freshness filtering, then add task-aware reranking and a
shared token budget. Treat factual evidence, user constraints and procedural
guidance as different inputs. Add “retrieve more / ask / abstain” behavior when
evidence is weak. Never reinterpret cosine similarity as factual confidence.
Persist why an item was selected or excluded and link the actual supplied
revision to the answer. Test irrelevant personalization as a failure too.

### 4. Consolidation is narrow and failure-focused

Extend the existing supervisor/observation mechanism with an opt-in, budgeted
consolidation pass over newly eligible source references. It should propose
merges, corrections, summaries and source-linked project pages, including useful
successful decisions and tested procedures. Use a retained cursor, cancellation,
resource limits and an explicit change review; reuse existing store revision
guards. A summary is derived knowledge, not a replacement for its evidence.

Do not create an unrestricted “dreaming” worker that rewrites personal facts or
executes tools. Reject unsupported assertions, preserve withdrawn topics and
invalidate derived summaries when their supporting evidence is removed. Test
incremental passes against contradictory transcripts and concurrent corrections.

### 5. Ownership and conditional applicability need richer representation

Existing goal scopes and canonical concepts are valuable but do not model a
general relationship between people, organizations, projects and circumstances.
Add stable entity IDs and scoped aliases, with explicit ownership and
applicability conditions. Resolve only evidence-backed aliases. Start with
project/person associations and conditional preferences; a new graph database is
not a prerequisite.

Acceptance: a colleague's preference never becomes the user's default; work
formatting does not override personal writing; similarly named projects remain
separate; delegated agents receive only the task's eligible knowledge snapshot.

### 6. Memory management needs one explanation and feedback surface

The current stores and answer-context view expose useful evidence, but review is
spread across personal memory, notes, lessons and routines. Add a unified index
that preserves those types. Show “why saved,” “why used,” source excerpts,
current/superseded status, review date and dependencies. Add explicit pin,
task-only exclusion, snooze, correction and “not useful here” feedback. A pin may
affect selection but must not bypass source validation, forgetting or task scope.

Show proposed consolidation changes as diffs. Measure dismissal and correction
rates without treating a lack of clicks as user confirmation.

### 7. Derived knowledge needs a complete invalidation contract

There are already withdrawal rules, history screening, embedding owner lifecycle
controls and continuation refresh. Preserve them. Before adding summaries/wikis,
define deletion and correction propagation across every new derived form and
retrieval cache. Retained historical task receipts are a different retention
surface; forgetting a fact must not be described as erasing all prior history or
backups.

Add a dependency registry from source revisions to derived claims, an inspectable
invalidation state and regression tests where forgotten or corrected content is
embedded, summarized, copied into a routine and present in a retained chat.
Derived data must not become a route for silently relearning withdrawn topics.

### 8. Outcome learning must distinguish verified procedures from plausible stories

Reviewed routines exist, but an originating run ID is not evidence that every
step succeeded or explains why it succeeded. Attach verification receipts and
known preconditions to promoted procedures. Keep hypotheses separate from tested
rules. Extend observations beyond repeated failures to verified successes and
user corrections, with independent evidence and scope. Never infer that a
recurring failure proves one shared cause.

## Published Anthropic and OpenAI work

**Anthropic — 6 November 2026:** its memory engineering report separates
transcripts, notes, richer representations and injected context. It treats
salience as anticipating future need, reports source-checking during offline
consolidation, and explores navigable wikis. Its experiments also show that more
notes can waste context and that restricting stronger models to recording only
failures can reduce memory's benefit. These are reported evaluations, not proof
that the same policy works for HCB or every model. [The components of agent
memory](https://www.anthropic.com/research/components-of-agent-memory).

**OpenAI — 4 June 2026:** its Dreaming report describes background synthesis
across conversations to address stale, incorrect and growing memory. It evaluates
carrying forward context, applying preferences and staying current as time passes.
The publication describes product objectives and examples; it does not provide a
complete reproducible implementation for HCB. [Dreaming: Better memory for a more
helpful ChatGPT](https://openai.com/index/chatgpt-memory-dreaming/).

Anthropic's earlier context-engineering guidance also separates compaction from
persistent notes and recommends loading high-signal context incrementally. HCB
should evaluate durable recall separately from whether one long task survives
compaction. [Effective context engineering for AI
agents](https://www.anthropic.com/research/effective-context-engineering-for-ai-agents).

**HCB recommendation [Inference]:** adopt evidence-backed consolidation and
evaluate downstream usefulness, while retaining HCB's review and permission
boundaries. Do not copy a vendor's memory-directory layout or claim vendor
performance transfers to smaller local models.

## Proposed implementation order and defaults

1. Add the longitudinal benchmark and per-answer selection trace first. Baseline
   current behavior before changing capture or ranking. Include precision/recall
   of admission, preference adherence, temporal correctness, forgotten-topic
   resurfacing, irrelevant personalization, latency and tokens.
2. Introduce candidate significance, entity/temporal metadata and user feedback
   through versioned extensions of existing stores. Migrate without inventing
   meaning for old records; unknown metadata stays unknown.
3. Add task-aware retrieval and dependency invalidation, with correction and
   deletion regressions as release checks.
4. Enable a narrowly scoped consolidation experiment only after those checks
   pass. Initially propose changes for review and cap per-profile model usage.
   Promote verified procedures last.

Recommended defaults: normal chat eligibility follows the current learning
setting; new background model consolidation is off until enabled; sensitive or
uncertain claims require review; existing memories never grant tool permissions;
user corrections outrank generated summaries. No additional clarification is
needed to implement the benchmark. Before enabling consolidation, confirm its
model, token/cost ceiling and eligible source scopes in Settings.

## Verification limits

This is source inspection and primary-source research, not a fresh live-model
memory benchmark. Significance quality and local/cloud parity remain unverified.
The existing deterministic tests establish their specified invariants only.
