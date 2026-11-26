# Continuing personal conversation

The conversational home uses conversational routing from its first message. Simple replies use
current context without starting Work. Requests needing tools or execution still
enter separately scoped Work. The composer and background-task controls stay the
same; archive maintenance adds no new history dashboard.

## Context prepared for each request

- Recent public user/assistant text stays in detail within the selected model
  input allowance. Its count grows with available tokens; it is no longer fixed
  to eight turns. Per-source I/O ceilings remain, and shortened excerpts carry a
  label. See [model-aware budgets](MODEL_CONTEXT_BUDGETS.md) for capacity sources,
  reservations and conservative estimation limits.
- Earlier discussion is represented by source-linked section summaries and
  higher-level overviews. These preserve historical decisions, corrections,
  unresolved questions and reported outcomes, rather than becoming a profile or
  an authorization record. Current memory and task records take precedence.
- Current preferences and query-relevant memories come from the existing editable
  memory store, respecting exclusions, expiry, conflicts and source validity.
- A token-budgeted selection of up to sixteen original excerpts is recalled from indexed dialogue and public
  Work output. Full-text search covers every indexed chat, independently of chat
  recency. When embeddings are available, reciprocal rank fusion combines word
  matches with semantic matches. Scope, branch ancestry, admission time and
  withdrawal rules are checked before embedding and again before disclosure.
- Main chat receives bounded active responsibilities, unfinished plan steps,
  pending/recovery requests and enabled schedule definitions. Side chats receive
  their goal's responsibilities. Retained state needs inspection; a schedule
  definition does not establish that it ran or that an external action occurred.
  Completed/failed/stopped task outcomes are reread from journals and public
  revisions, including after a worker closes. They carry no control authority.

Only the current user message can provide fresh evidence for passive memory
learning. Summaries and retrieved text cannot save themselves as personal facts,
approve actions, expand tool/account/workspace access, start schedules or replay
interrupted work. Earlier-chat opt-out keeps current-chat recall and saved memory
available. Goal-bound histories and their task/branch ancestry stay scoped.

## Incremental local archive

Canonical conversation/revision JSON remains authoritative. A private, disposable
SQLite cache at `hot-cross-buns/cache/conversations-v1.sqlite` contains public
history sources, overlapping 1,500-character chunks, FTS5 search, summary nodes,
dependencies, embedding vectors and progress checkpoints. Captured options,
credentials, attachment bytes, tool replay and action tokens are excluded.

Native writes update the index. Foreground preparation attempts at most 128
sources with a separate two-second backfill deadline; background maintenance
visits four chats per sweep with 32-source pages and a four-second deadline.
Discovery rotates across all chat directory identities, rather than the latest
24. Checkpoints survive restarts. A rotating 32-source stat audit also discovers
external edits/deletions. Selected excerpts are reread from canonical files;
changed or missing candidates are withheld and repaired.

Preparation no longer calls the legacy full-history scanner with its 4,096-turn /
16 MiB ceiling. Index errors or unfinished backfill produce context notices and
recent canonical dialogue remains usable. Backfill neither starts inference nor
changes canonical history. Large archives catch up over time; partial indexing
is not complete recall.

## Source-linked summary layers

Each level-zero node summarizes at most 32 older turns from originals, keeping
recent turns separate. A new section is normally created after four additional
old turns or when its text budget fills. Two disjoint frontier nodes of the same
level can form a parent overview. Originals and lower-level sections remain
available; the whole growing history is not repeatedly compressed into one
mutable summary.

Dependencies retain exact source digests, child-node digests and linked memory
versions. A source mutation invalidates its section and ancestors. A linked
memory correction/deletion invalidates only dependent sections and ancestors;
an unrelated memory edit preserves the existing summaries. Memory owners send
best-effort cache notifications, and preparation also reconciles versions.
Withdrawal-policy changes re-screen selected sections and source excerpts; known
forgotten source chats remain excluded from cross-chat retrieval. A memory change
during preparation rejects that prepared snapshot. This is selective withdrawal,
not universal semantic deletion of user-visible transcripts.

Nodes publish transactionally after source-digest checks. Forks build from their
own selected history. An older admitted task cannot replace the newer main-chat
summary view. `conversations/<id>/continuity.json` is now a bounded derived view;
SQLite source-linked nodes are the reusable summary cache.

Replies read cached archive summaries without generating them. An asynchronous
maintenance claim makes at most two archive summary calls. Source batches, summary
results and the final serialized context fit the selected model allowance, with
room reserved for system instructions, the current message and output. Calls use
the captured model and shared usage accounting, so a cloud model can charge for
summarization. Unprofiled compatibility callers retain the earlier bounded
turn/text policy. Failed or malformed
summaries leave originals and unrelated valid sections available for retry.

## Semantic recall and permission

The default embedder is local Ollama `embeddinggemma:latest` when installed and
running. Nothing is installed, downloaded or started automatically. An unavailable
runtime, failed embedding, invalid vector or embedding deadline falls back to
word matching. One request examines one checkpointed page of 32 pending chunks,
embeds at most 15 eligible chunks plus its query, and has a three-second semantic
budget. Vector search streams from SQLite and retains only the best candidates;
it has no 4,096-document in-memory limit.

Cloud embedding adapters reuse existing OpenAI/Gemini support. Saved-knowledge
upload permission alone does **not** authorize conversation embedding. Memory &
privacy has a separate reviewed cloud-history upload control; reviewed app
retrieval changes can also set `chat_history_upload`. Changing provider resets
that permission. Chat model selection/API-key presence never enables it.
Processing scope pins the embedding settings so prepared work cannot silently
switch its embedding destination. Revocation stops future history embedding
calls; already supplied context cannot be withdrawn from a running provider call.

Source mutations and dependent memory changes remove affected vectors. Forgetting
also removes vectors for known suppressed source chats. Canonical checks and
privacy screening remain authoritative if a cache notification is interrupted.
The source text remains in user-visible history until the user deletes it.

## Practical limits and verification

Recall is selective. It evaluates bounded candidate windows and fits selected
excerpts into a model-dependent budget; it may miss relevant material. Embeddings fill incrementally during
requests, so a large legacy archive initially relies more on word matching.
Vector comparison is linear disk I/O, not an approximate-nearest-neighbor index.
The existing private SQLite cache ceiling is 512 MiB; reaching it degrades to
recent canonical context rather than rejecting a new message. Very large
installations may eventually need sharding or a dedicated vector index.

Tests cover large legacy backfill beyond 4,096 turns, text beyond 16 MiB, restart
checkpoints, chats outside the old recency window, semantic-only matches, exact
matching during outages, admission/goal/opt-out/withdrawal checks before upload,
vector validation and compare-and-set publication, targeted invalidation,
unchanged-section reuse, malformed summaries, deletion, cache failure, forks,
commitments and the real browser gateway. Deterministic tests verify mechanisms,
not longitudinal recall quality. See [verification](verification/continuity-archive-2026-11-23.md).

An opt-in synthetic model check uses the configured provider and credential store:

```sh
HOT_CROSS_BUNS_LIVE_CONTINUITY=1 go test ./cmd/hot-cross-buns -run '^TestLiveConversationContinuity$' -count=1 -v -timeout=150s
```

It uses temporary state and no connected-account actions. It tests a correction
and an unconfirmed booking across a summary and a subsequent answer; this is one
semantic case, not months-long personal-agent evidence.

The daily synthetic recall comparison and research review are recorded in
[Memory evaluation, 2026-11-26](MEMORY_EVALUATION_2026-11-26.md). These complement
mechanism tests; they do not establish months-long personal-assistant reliability.

## Background summary maintenance

Conversation routing queues a private, coalesced maintenance request in the
existing SQLite cache. It pins the model, processing scope, admission boundary,
exclusions and privacy settings; it carries no tool or action authority. The
UI history worker and existing job supervisor can drain it. A per-profile claim
prevents duplicate processing across hosts, expires after two minutes on a crash,
and retains newer requests when an older claim finishes. Host shutdown cancels
inference.

Each claim has a 90-second deadline and a four-request/200,000-token aggregate
budget. Summary calls have up to 60 seconds independently of reply preparation.
Failed claims retry after one minute, then two, four and so on up to one hour.
New messages in the same scope update the pending snapshot without resetting
backoff. A changed scope requires fresh admission; outdated requests are
discarded before transmission. Successful work continues in bounded batches.

Processing destination and current privacy settings are checked before and
after each maintenance inference. Memory versions and source digests are
checked before publication; scope changes, corrections and withdrawal reject
stale results. Canonical history remains intact. Cache loss drops derived work
and retry state; the next conversation can requeue maintenance. The initial
32K-window live check published 32 source turns and preserved the corrected
deadline and its unfulfilled state from the summary alone. See
[the raw check](evaluations/async-summary-2026-11-26.json).
