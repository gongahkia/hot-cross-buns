# Desktop assistant implementation — 26 November 2026

The five prioritized scheduling/follow-through gaps now have implementation and
verification. Mobile/messaging reach remains deliberately outside this milestone.
No local chat model was installed. Cross-app document/PR/model controls were also
extended in response to the same request.

## Delivered

1. **Schedule date windows.** Recurring tasks have an inclusive start and exclusive
   end, enforced by the timer, due checks and execution claims. Reviews and
   inspection show eligible upcoming occurrences and human-readable dates. A
   November 30–December 6 daily series produces exactly seven runs; DST and
   restart/catch-up cases are covered. Dates must be structured, not prompt-only.
2. **Scheduled access.** Chat-created schedules can select exact configured
   accounts and allowed read operations, inspect/draft mode and a per-run budget.
   An exact review binds descriptors, permissions and account identity. Changes
   are rechecked at apply/execution; the agreement cannot restore revoked access.
   Google uses the verified account pin, allowing normal access-token refresh.
   New bindings require review even with Always scheduling. Sending/publishing
   remains a separate foreground approval. Existing scheduled-folder grants
   remain the filesystem boundary.
3. **Event-triggered work.** An explicitly reviewed task can use event types and
   exact field filters instead of a timer. Scheduled tasks exposes endpoint
   enable/revoke and one-time key setup. Bounded HMAC-authenticated deliveries
   enter a durable replay-protected queue and run through the normal scheduler,
   budgets, output validation and inbox. Native claims retain exact input events
   before execution so a restart does not silently replay the same delivery.
   Gmail/local change gates remain available; Calendar now supports bounded,
   explicitly selected 1–30 local-day windows with complete pagination or a
   visible error. Legacy Calendar watches without a calendar ID are not revived.
4. **Routine automation.** A schedule can bind an enabled routine by exact
   revision and bounded parameters. Review shows its expanded procedure.
   Changes/disablement require renewed review; effects and request/token limits
   only narrow. Read/draft routines can prepare staged artifacts or proposals;
   they cannot execute external actions. Saving a routine alone starts nothing.
5. **Proactive follow-through.** Ordinary schedules can use explicit notification
   conditions and the existing evidence-checked quiet/attention decision path.
   New artifacts/proposals cannot be silently hidden. A failed account read
   produces review rather than a false quiet success. Existing goal watches keep
   their adaptive wakes, change gates, attention preferences, durable inbox and
   feedback/reconciliation paths. Task details expose dates, account scope,
   routine revision and event types without requiring raw commands.

## Additional requested capabilities

- **Documents:** existing PPTX/XLSX editors remain available. New DOCX exact-text
  editing preserves formatting runs and unrelated archive parts; missing or
  ambiguous matches fail. PDF supports page selection/reordering/duplication,
  rotation, removal and visible text stamps. Selected original uploads and
  source/previous/output mounts are supported. Edits create staged copies;
  existing reviewed output Save exports them to a local destination.
- **Email:** retained the existing Gmail send/reply/attachment implementation.
  Its integration tests exercise selected original bytes, frozen attachment
  hashes, exact approval, denial, draft proposals, thread/header construction and
  uncertain send receipts. No second sender or implicit account grant was added.
- **PRs:** GitHub is available in Connections, scoped to one exact repository.
  It reads PRs, files/patches, reviews, comments, check runs and commit statuses;
  reviewed writes create draft PRs from existing branches, edit, comment, review
  and merge. Head checks reject stale proposals; merge uses GitHub's atomic SHA
  guard and reviews bind a commit ID. Uncertain/missing confirmations stay
  uncertain. Code generation/authorized pushes use the existing CLI workflow.
- **Mixed models:** Models → Specialists has configured cloud/local selections,
  step limits, inheritance and an exact single-use Save review. Chat can request
  the same assignment. Existing dependency pipelines, retained output,
  continuation, budgets and cancellation remain the coordinator. A fixture runs
  separate reader/verifier/reviewer models through a dependency pipeline and
  stages a report without concealing contradictory evidence. Codex keeps its
  local CLI login; the manager's API key does not replace it.
- **Context efficiency:** settings update references are returned on inspection
  rather than repeated on every unrelated chat/memory turn. The update tool's
  description shrank from 4,598 to 1,027 bytes. Validation and reviews are unchanged.

## Verification

`make check` passed with the canonical macOS temp directory: all Go packages,
`go vet`, 154 browser tests, 145 host tests and the OAuth build test. Focused checks
also passed for the later mixed-model and live-test additions. Real Chromium
exercised selecting, reviewing and saving a specialist assignment in a disposable
profile. It caught a missing native bridge allowlist entry, which was corrected
and covered by a full gateway/native-IPC regression test.

Live API tests used only disposable synthetic inputs:

- OpenAI manager → local Codex CLI: one inline read grant, actual delegation,
  completed CLI work and the correct file marker returned without the manager
  reading the file itself. All six checks passed.
- Conversational scheduling: one review saved exactly seven 20:00 Singapore runs
  inside the requested date window. All six checks passed; no supervisor started.
- Memory journey: all eight stages passed before and after context reduction,
  including capture, fresh-task recall, correction, forgetting, significance
  proposal and reviewed consolidation. No measured unnecessary captures,
  important omissions, irrelevant applications or forbidden resurfacing.
  Observed input tokens were 288,778 → 214,582; model requests 23 → 19; elapsed
  journey time about 101 → 89 seconds. This single pair is not an isolated
  causal or statistical benchmark; provider/model choices can vary.

Machine-readable evidence: [desktop-assistant-2026-11-26.json](verification/desktop-assistant-2026-11-26.json).

## Remaining limits and next milestone

- No local chat model was installed or benchmarked; that is the next approved
  testing milestone. Provider compatibility, latency and usefulness still need
  task-based measurement. No live Gemini test was attempted.
- No real Gmail or GitHub account was connected/sent/mutated in this pass.
  Controlled HTTP and full-runtime fixtures establish the implementation path;
  actual account scopes and provider acceptance need a separately authorized
  account test. PR metadata/comment head preflight is not an atomic server lock;
  GitHub branch rules and merge's SHA guard remain authoritative.
- Event endpoints remain loopback-only. A remote service needs an explicitly
  configured authenticated forwarder/adapter. Native GitHub/Gmail webhook
  signature formats are not accepted directly as the HCB HMAC protocol.
  Replay identities are retained for 30 days; the queue is bounded and can refuse
  overload. Event batches are admitted at most once per minute, with up to eight
  deliveries per execution; this is not a real-time message bus.
- PDF stamps are not secure redaction or arbitrary underlying text replacement.
  DOCX tracked changes/field recalculation and native Office layout fidelity are
  not established. Editing can invalidate document signatures. The PDF library
  is pinned to a Go 1.25-compatible release and runs offline.
- I cannot verify physical microphone or native macOS app interaction from these
  software fixtures. Existing turn-based voice and scoped computer-use controls
  remain; this work does not claim continuous full-duplex voice or general visual
  takeover quality.
- Existing prompt-only personal schedules were not silently interpreted or
  migrated. Their dates/account scope should be explicitly inspected and reviewed
  using the updated timing controls or a conversational edit. The implementation
  does not retroactively guess the intent of old task prompts.
