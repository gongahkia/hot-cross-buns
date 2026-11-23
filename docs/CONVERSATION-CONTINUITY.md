# Continuing personal conversation

Main chat uses conversational routing from its first message. Simple replies can
use the current context without starting Work. Requests needing tools, memory
changes, investigation, or execution still enter separately scoped Work. The
interface keeps the same composer, thinking trace, and background-task controls.

## Context prepared for each request

- Recent public user/assistant text is retained in detail: normally eight turns,
  with up to three additional turns while waiting for the next summary batch.
  The text budget is 48 KiB; a single message is bounded to 8 KiB, with an explicit
  shortened-excerpt label. Original text remains in the conversation store.
- A rolling summary preserves objectives, decisions, corrections, open questions,
  promised follow-ups, reported outcomes, and source-turn identifiers. It is
  historical reference, not a personal profile or an authorization record.
- Current saved preferences and query-relevant memories are loaded from the
  existing memory store, respecting exclusions, expiry, conflicts and source
  validity. Memory remains editable in the normal Memory view.
- Lexical recall supplies up to four source-linked excerpts from older turns in
  the current chat and, when earlier-chat retrieval is enabled, at most 24 other
  retained chats. It includes dialogue as well as Work revisions. Goal-bound
  histories and their task/branch ancestry remain scoped. These bounded matches
  do not establish that everything relevant has been found.
- Main chat receives bounded active responsibilities and unfinished plan steps,
  retained pending/recovery requests, and enabled schedule definitions. Side
  chats receive only their selected goal's responsibilities. Retained running
  state explicitly needs inspection; it is not a liveness check. A configured
  schedule does not prove that the supervisor ran or an external action occurred.

The router can send a request to existing history tools when bounded recall is
insufficient and the user's earlier-chat setting permits that search. Durable
facts/preferences can enter existing memory tools when learning is enabled.
Explicit remember/edit/forget requests also use those tools. Only the current
user message can supply fresh evidence for a passive memory save; summaries and
retrieved excerpts cannot. Recognition still depends on the model's decision.

## Durable summaries

`internal/worksession` prepares a public timeline from the selected Work ancestry
and the same chat's dialogue. Equal-time dialogue uses sequence order. Captured
options, tool replay, credentials, files, action tokens and live control rights
are excluded. Admission boundaries exclude the current message and later text.

The derived `conversations/<id>/continuity.json` stores the summary, exact covered
prefix count/digest, memory-policy epoch, optimistic revision and update time.
Publication is private, bounded and atomic; concurrent writers use a process
lock and revision check. Publication cannot recreate a deleted conversation.
Forks build their own summary from their selected visible history. Preparing an
older task cannot replace a newer incompatible main-chat summary.

Older context is summarized in groups, normally after four additional old turns
or when its text budget fills. A request performs at most two summary calls;
each batch has at most 32 source turns and 48 KiB of excerpt text, plus the prior
summary. Summaries are limited to 12 KiB. Calls use the selected chat model and
the existing shared provider-usage accounting; they can incur provider charges.
No embeddings or separate service are required.

Original transcripts are never deleted by compaction. A changed source prefix,
memory edit/withdrawal, exclusion or processing setting invalidates the cache.
Withdrawn historical topics are screened by the existing privacy filter before
they can enter a new summary, recent context, recall, or commitment reference.
Known forgotten source chats remain excluded from cross-chat recall. A memory
change during preparation rejects that prepared snapshot. This preserves the
existing distinction between forgetting agent memory and deleting user-visible
transcripts; it is not a claim of universal semantic deletion.

Planning and execution rebuild continuity from owning stores under their original
captured scope. Historical task reports carry false control capabilities;
summaries and memories cannot approve actions, expand accounts/workspaces, start
schedules, or replay interrupted work. Current user corrections and current
memory/task records take precedence over historical summaries.

## Failure and verification boundaries

A failed or malformed summarizer leaves its prior valid cache and original
history intact. The next request can retry summarization. Partial coverage and
unavailable older history are explicit context notices; the router must not
claim complete recall. Invalid cache files, unavailable current history and
privacy-filter failures are reported instead of trusting questionable context.
Current-history preparation has a hard scan ceiling of 4,096 public turns and
16 MiB; reaching it reports a limit rather than silently dropping old state.

Tests cover summary reuse/extension/restart, recent text without batching gaps,
source boundaries, private-input exclusion, stale writes, forks, deleted chats,
correction/exclusion/forgetting, concurrent memory changes, opt-out and goal
boundaries, current commitments, schedule changes, and the real browser gateway
through the Go runtime. Deterministic fixtures verify these mechanisms; they do
not measure longitudinal recall quality or a live model's semantic judgments.
