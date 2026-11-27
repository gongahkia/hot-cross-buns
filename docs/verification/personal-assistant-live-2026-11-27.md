# Personal assistant live acceptance · 27 November 2026

## Method

This journey uses the real browser product at `http://127.0.0.1:4317`, its
existing profile and selected OpenAI orchestrator, and local Codex CLI. Requests
were submitted through the composer and approvals through the UI. Canonical
memory records, request journals, tool activity, usage accounting and scheduler
history were inspected independently of the model's confirmation prose.

Personal transcripts and detailed state captures stay under the ignored,
private `.hot-cross-buns/local-dev` directory. No credentials are included in
this report. `scripts/observe-ui.mjs` is a reusable, read-only observer of the
same event stream the browser consumes; it cannot approve or dispatch work.
Raw snapshot capture requires its explicit `--content` option.

## Verified journeys

- **Memory save:** an explicit, real HCB product-direction request reached
  `memory_remember`, required review, and created one canonical record. The UI
  confirmation corresponded to an actual on-disk save.
- **Correction:** a clarification updated that same ID, without an additional
  active record. It survived a full application restart and was read back by
  `knowledge_search` / `knowledge_read`.
- **Forgetting:** a clearly temporary session note was added through Memory,
  then forgotten conversationally. The owning record was removed, a reviewed
  abstract withdrawal barrier was retained, and the original memories remained.
  A subsequent answer did not repeat the forgotten note, but failed the narrower
  category question described below.
- **Temporary-context handling:** a conversational session-order statement
  became an inactive suggestion rather than an enduring active preference.
  After it became stale, its decline action worked in the existing Memory UI.
- **Scheduling:** the agent created one reminder through an exact **Allow
  once** review. It stored a one-time execution timestamp, Singapore time zone,
  main-conversation delivery target and `run_once` catch-up policy.
- **Actual downtime:** HCB stopped at 13:19:39, the reminder was due at 13:20:00,
  and HCB restarted at 13:20:35. No attempt existed while it was offline. One
  attempt started at 13:20:35 and completed at 13:20:39; its result appeared in
  main chat and acknowledged being 36 seconds late. Subsequent checks found
  one attempt rather than repeated catch-up executions. The original recurring
  schedule's definition hash remained unchanged.
- **Local delegation:** a substantial repository-inspection request opened a
  named task and dispatched `cli_codex` using the local Codex CLI identity. Its
  streamed output and completed result were retained, and the report returned
  to main chat. The request explicitly prohibited API-specialist substitution
  and file changes. Its outcome did not claim to have executed tests it only
  inspected.
- **Live delegated file writing:** a subsequent, explicitly scoped request
  had local Codex create the one permitted local acceptance-report file, append
  a verification line and read it back. The manager independently read it, and
  an external filesystem/hash check confirmed the actual live path and contents
  rather than merely a staged artifact. The SHA-256 was
  `876766386f6e91fe6bf05c81a70ef9455af85e12dfef95bd594ecbcab0ceb212`.
  The first wording asked the fresh writer to assert an earlier inspection
  outside its new source scope; it declined. A narrower exact-content request
  succeeded without expanding file authority. No source-code edit, install or
  agent-created commit was requested.
- **Continuation:** an explicit follow-up continued the same task ID; its
  journal recorded `task_continued: true`. The follow-up and response were also
  retained in the task conversation. Ordinary memory questions stayed inline.
- **Task navigation:** after restart, searching past tasks found this task and
  opened its inner conversation with its task-reply composer. The wordmark's
  Main chat action returned to the main conversation.
- **Search caret:** the focused Tasks search field contained a visible animated
  caret in its popover, with nonzero dimensions and opacity 1.
- **Sync:** the real two-daemon Syncthing script passed twice, including after
  its cleanup improvements. It verified automatic stored-memory import,
  revision-bound import receipt reporting, pending offline delivery and import
  after reconnection. These were two isolated profiles on one Mac, not two
  physical devices, and did not exercise model recall on the receiving device.

## Failures and product gaps

1. **History privacy preparation can dominate a simple reply.** After the
   forgetting operation, the next narrow memory question caused 58 retrieval
   model requests before its routing request. Preparation took approximately
   141 seconds; the UI showed generic Thinking/Working on it with no tool
   activity or preparation-specific cancellation control. The request completed
   about 144 seconds after admission. The combined retrieval and routing
   accounting recorded 66,520 tokens. Subsequent requests repeated substantial
   screening in routing and execution preparation.

   `ScreenHistory` bounds individual comparisons but performs sequential
   comparisons over supplied fragments. Continuity invokes it across recent
   history and other evidence. The 12-second router timeout begins after that
   preparation. Recommendation: bind cached verdicts to exact content, scope,
   policy revision and model/prompt identity; impose an aggregate preparation
   budget; omit unchecked history when necessary; expose progress and
   cancellation. Keep the existing fail-closed privacy behavior.

2. **Memory category answers are unreliable.** Asked whether any active saved
   Personal context notes remained about this acceptance session, HCB answered
   “Yes” and listed name, tone and product-direction memories. The temporary
   note had actually been removed and the Personal context category was empty.
   No forgotten note was resurfaced, but the answer did not satisfy the query.

3. **A forgetting request created an unsolicited artifact.** The memory
   operation succeeded, then `write_artifact` produced `memo.md` and the final
   answer mentioned host validation. No memo was requested. The distinction
   between modifying memory and producing a document needs better admission.

4. **Unrelated memory changes invalidate suggestions.** Correcting the product
   direction made the independently proposed temporary session-order suggestion
   stale. The UI hid its original text and offered a fresh proposal rather than
   acceptance. Declining remained available after expanding the stale entry.
   Recommendation: review the dependency breadth used for proposal revisions.

5. **Browser recovery was uneven.** The backend and scheduler restarted, and a
   new event observer connected, while the existing automated browser tab stayed
   at Connecting to local host/Connection lost until reloaded. A reload restored
   the conversation and showed the reminder. Browser/proxy involvement has not
   been isolated; this is an observed recovery failure, not a proven root cause.

6. **Old onboarding text appears at the bottom.** An existing introduction
   message dated the previous day appeared after current exchanges. The saved
   introduction status was completed. This is an ordering/display issue rather
   than evidence that onboarding ran again.

7. **Legacy schedule-window metadata remains incomplete.** One existing recurring
   task expresses its requested future date range only in the prompt, with no
   structured start/end boundary. Its next due time precedes that requested
   range. The definition was intentionally left unchanged. New schedule-window
   tests do not establish automatic migration of such legacy definitions.

8. **Research does not enrich existing project memory.** An explicit request
   to inspect the public Sagasu README and add a dated, sourced description
   successfully fetched the page. HCB found only the general five-project
   memory, not an editable Sagasu-specific context record, and correctly
   declined to claim a save. No save tool was called and the project memory
   stayed unchanged. The research capability works; persistence into project
   knowledge remains missing in this workflow.

9. **Queued inline work can fail its retained-scope check.** A request to cancel
   only the completed test reminder was submitted while research ran. It became
   visible as **1 queued**, then failed immediately on dispatch with
   `independent task execution settings changed`. No cancellation tool ran.
   This is a failed conversational cancellation test, not a successful cleanup.
   The guard was left intact. For cleanup only, the existing native job command
   removed the exact test definition after independently checking its ID, name,
   objective and completed attempt. Its history remains; the original recurring
   definition hash still matches. This fallback is not counted as a UI pass.

10. **An unrelated previous deliverable carried into research.** The Sagasu
    result's deliverables included the earlier forgetting operation's `memo.md`
    with the same content hash, despite the research run not writing an artifact.
    This establishes inherited output in this journey; artifact carry-forward
    needs to distinguish a deliverable revision from a new unrelated action.

## Final state

HCB is running again with its supervisor. The temporary active memory is gone,
its temporary suggestion was declined, and the completed test reminder's
definition was removed while retaining its single execution history. The
reviewed forgetting barrier remains in effect; no privacy controls were removed
to make the tests pass. The real product-direction memory remains corrected.
The pre-existing memories and recurring schedule were preserved. There are no
active test tasks or pending approvals. The failed queued request remains in
history as evidence rather than being relabelled as successful.

## Setup boundaries

- Computer access reports missing macOS Accessibility permission for the HCB
  runtime/launcher. No app was controlled and no macOS permission was bypassed.
- Transcription is disabled. Local Whisper runtime and models are unavailable.
  The disabled microphone and existing Voice models setup UI were checked;
  physical recording, waveform behavior and transcription accuracy were not.
- HCB has no configured account connectors in this profile. Connections exposes
  setup for Google, GitHub, GitLab, Slack, Notion and other services. No actual
  email was sent, PR published or account credentials requested.
- Receiving-device model recall, two physical devices, document-format fidelity,
  local chat-model parity and a visual inspection of the live terminal-output
  popup were not established by this tranche. Its contextual header icon was
  observed while the worker was active; click attempts happened after the
  worker had completed and the icon had hidden again.

## Checks and tooling

- `node --check scripts/observe-ui.mjs` passed; its single-snapshot and sustained
  event observation were exercised against the real app. Identical snapshots
  are now deduplicated, output defaults to a 64 MiB limit, and private raw
  acceptance captures were compressed after complete gzip round-trip checks.
- Targeted conflict, forgetting, receipt, catch-up, one-time, date-window and
  scheduled-access tests passed in `internal/memorysync`, `internal/jobs`,
  `internal/fileaccess` and `internal/workrun`.
- Two actual `scripts/memory-sync-e2e.py` runs passed. The script now accurately
  says it checks stored-memory import rather than model recall, and attempts
  termination of every owned process with a kill fallback.
- Several browser selector/wait attempts timed out during asynchronous UI
  changes. Fresh state inspection and stable controls were used to continue;
  those automation failures are not counted as product test passes.

The most useful next fix is bounded, visible privacy preparation. A small MCP
could later wrap current context-bound actions, scoped request/approval reads,
usage and tool events, and terminal-state waits. It should reuse the production
permission checks rather than bypass them. Browser control remains necessary
for layout, focus, discoverability and actual interaction verification.
