# Personal-assistant gaps and proposed work — 24 November 2026

## Scope and conclusion

This records the preceding repository inspection, sanitized local configuration
checks, retained test evidence and comparison with current first-party Muse,
ChatGPT dots, Claude Duet and Grok Bot documentation. It proposes work; it does
not authorize or implement the proposals.

The intended product is a personal assistant powered by a local model that can
use a laptop's tools. Local versus cloud hosting is excluded as a competitive
advantage. The relevant outcomes are useful task completion, continuity,
appropriate initiative, tool access, understandable reviews and recovery.

**[Inference] HCB has substantial supervised execution infrastructure, but its
complete everyday personal-assistant workflows are less proven than its individual
mechanisms.** Improving UI and adding adapters alone does not establish that it
can reliably take an ongoing responsibility off the user's hands.

Statuses below distinguish missing features, deliberate boundaries, incomplete
integration, current configuration and insufficient evidence. Competitor product
documentation describes capabilities, not independently measured reliability.
No comparative success-rate, latency, cost or percentage-parity claim is justified.

## Current local setup

Observed during this assessment; these values are a dated snapshot, not defaults
or a claim about subsequent configuration:

- Orchestrator: OpenAI / `gpt-5-mini`.
- Configured CLI agent: Codex, using the local CLI's ChatGPT login.
- Configured connected services: zero.
- Scheduled checks: zero; the running app reported its scheduler stopped.
- Explicit specialist model overrides: zero; native specialists inherit the
  orchestrator unless separately configured.

A locally running Codex CLI and a locally hosted inference model are different
things. The current orchestrator configuration does not demonstrate the target
local-model assistant workflow. Empty connector/schedule configuration is an
activation gap, not evidence that the corresponding framework is absent.

## Implementation updates after this assessment

The register below preserves the original assessment. Subsequent verified changes:

- **Memory planning follow-up:** The [25 November memory roadmap](MEMORY_ROADMAP_2026-11-25.md)
  identifies remaining significance, temporal, retrieval, consolidation and
  management gaps against current source and primary Anthropic/OpenAI work.
  These are proposed additions; no broader memory-learning policy is enabled.

- **25 November follow-up:** Multi-agent dependency context/completion checks,
  memory review status, separate scheduled-folder read grants and reviewed
  parameterized routines/recovery are implemented. See the
  [verification record](verification/personal-assistant-core-2026-11-25.md) and
  [routine guide](ROUTINES.md). Native macOS acceptance remains blocked by
  missing Accessibility permission; this is not a claim of complete assistant
  reliability or closure of every historical issue below.

- **G1:** Managed local models can use explicitly granted browser text snapshots and references. A subsequent computer-access change adds selected-app macOS accessibility snapshots, reviewed control actions and one-task chat grants through Settings → Computer access. The native acceptance test is blocked by missing macOS Accessibility permission; local-model quality remains unverified because Ollama was not running. This is bounded accessibility control, not unrestricted desktop automation. See [computer access](COMPUTER-ACCESS.md) and its [verification record](verification/computer-access-2026-11-24.md).
- **Live filesystem follow-up:** Foreground tasks now have inline task-only, saved-folder and full-filesystem choices, Settings permission management, and scoped live access shared with CLI delegates. A local Codex login smoke test passed live read/update/create/delete checks against disposable files. This does not enable arbitrary scheduled filesystem access or establish Pi compatibility. See [live filesystem access](LIVE-FILESYSTEM.md).
- **G5:** Optional Google Calendar reads, availability and reviewed event changes are implemented, with separate account consent. Real-account acceptance is unverified; Calendar-specific change-only watches and Google Tasks remain unavailable. See [Google Calendar](GOOGLE-CALENDAR.md).
- **G2/G8:** The preceding orchestration/voice work is recorded separately in [voice and orchestration verification](verification/voice-orchestration-2026-11-24.md).

[Local browser and Calendar verification](verification/local-browser-calendar-2026-11-24.md) records the current tests and limits. These updates do not establish overall personal-assistant or competitor parity.

## Issue register

| ID | Issue and status | Practical consequence | Evidence and proposed direction |
| --- | --- | --- | --- |
| G1 | **Local-model browser/desktop access: deliberately restricted.** | The target local-model assistant cannot currently use the same browser/desktop surfaces as the supported OpenAI path. The localhost split preview is user-facing and does not grant the agent browser control. | [Provider gate](../cmd/hot-cross-buns/work_service.go), [execution checks](../internal/workrun/executor.go), [capability boundaries](WORK_CAPABILITIES.md). Start with a bounded, policy-controlled browser capability for one supported local model. Do not simply remove the provider gate or weaken reviews. |
| G2 | **Orchestration correctness: partial live validation with recorded failures.** | A valid patch or completed worker does not mean that the manager preserved context or completed the overall request. | A recorded Copilot combined run put `continue` in assignment prose rather than the tool argument. The recorded personal-assistant lifecycle probe passed 12/14, omitting requested dependency information and consequently its agenda representation. [Recorded results](verification/orchestration-2026-11-23.md). Preserve failures and test the manager's actual tool arguments and final retained state. |
| G3 | **CLI compatibility and handoff coverage: uneven.** | Adapter support cannot be presented as universal installed-version readiness. | Codex has a live 6/6 native-session pass. Latest retained local Pi execution rejects `--no-approve`; Copilot reports a certificate-format error. Claude native continuation is implemented but not live-verified in this session. Gemini was excluded by user instruction. Earlier OpenCode successes are historical evidence. See the handoff inventory below. |
| G4 | **Connected-account and schedule activation: currently unconfigured.** | The inspected profile cannot presently perform email-based personal follow-up or recurring checks using connected services. | The inspected profile had no connectors or checks. Use existing Connections and reviewed follow-up flows when the user chooses a real bounded responsibility. Do not silently connect accounts, grant access or enable schedules. |
| G5 | **Calendar and Google Tasks: unavailable by prior product decision.** | Local plan dates cannot replace reading invitations, reconciling availability or maintaining a real calendar. | [Current product guide](../internal/productguide/capabilities.json), [connector registry](../internal/connector/connector.go). Reintroducing calendar access requires an explicit scope decision; this is not merely a broken existing calendar feature. |
| G6 | **Complete recurring personal-assistant workflow: acceptance incomplete.** | Scheduling, change detection and notifications may work individually while the complete user responsibility remains noisy, incomplete or difficult to recover. | [Follow-up acceptance](PROJECT-FOLLOWUP-ACCEPTANCE.md). Demonstrate initial setup, useful first result, meaningful change, quiet/noise decisions, duplicate suppression, correction, delivery, pause and recovery in the same retained workflow. |
| G7 | **Long-term memory usefulness: implemented mechanisms, limited quality evidence.** | Successful storage, summary reuse and retrieval fixtures do not establish dependable recall over months, languages or changing real responsibilities. | [Continuity design](CONVERSATION-CONTINUITY.md), [archive verification](verification/continuity-archive-2026-11-23.md). Measure correct and incorrect recall, corrections, omissions and stale facts. The recorded local embedding probe was unavailable; deterministic embedding fixtures are not a real local-model quality benchmark. |
| G8 | **Voice: infrastructure exists, current browser integration incomplete.** | The current web interface has no microphone/live-call controls despite older Electron voice documentation. | [Current web entry point](../web/public/index.html), [client](../web/public/client.mjs), [historical voice documentation](LOCAL-VOICE.md). Reuse the existing speech services if voice becomes a priority; do not count a retired UI as an available product feature. |
| G9 | **Workflow teaching and routine reuse: partial.** | Users can have procedural skills without a smooth path from a successful real workflow to a tested, discoverable recurring responsibility. | [Skill list/read tools](../internal/tools/knowledge.go), [reviewed skill suggestions](../internal/tools/suggestion.go), [follow-up setup](../internal/followup/setup.go). Reuse these mechanisms. A mature demonstration-capture and routine-validation journey has not been established by this assessment. |
| G10 | **Cross-app reach and completion: narrower than the competitor expectation.** | A task crossing email, calendar, documents and an arbitrary website can encounter missing operations or separately configured browser/control surfaces. | The [registry](../internal/connector/connector.go) supports Google, Slack, Atlassian, Notion, HTTP and mapped MCP operations, within finite scopes. Establish complete workflows across selected tools rather than treating an integration count as proof of task coverage. |
| G11 | **Notification and delivery usefulness: operational acceptance still limited.** | An update recorded in a journal or handed to the OS does not establish that the right person saw a useful alert at the right time. | [Notification delivery](NOTIFICATION_DELIVERY.md) separates durable attempts and retries from physical display, Focus/Do Not Disturb and mobile delivery acceptance. Evaluate useful, noisy and missed alerts separately. |
| G12 | **Documentation and product-surface drift.** | Older audits and Electron/terminal documentation can overstate today's browser integration or describe now-retired Calendar support. | Prefer the current registry, web entry points and [web runtime document](WEB-ONLY-RUNTIME.md). Keep historical reports intact and label their scope; reconcile current user-facing claims with executable behavior. |
| G13 | **Broader usability, performance and reliability evidence: insufficient for parity claims.** | Passing engineering checks does not establish low repair effort, acceptable latency/cost or personal-assistant usefulness. | [Pilot procedure](PROJECT_FOLLOWUP_PILOT.md), [follow-up acceptance](PROJECT-FOLLOWUP-ACCEPTANCE.md). Record completion, user corrections, intervention, latency, usage, failures and human output judgments. No head-to-head competitor benchmark was performed. |

## Handoff inventory

| Worker | Implemented continuation | Evidence and remaining issue |
| --- | --- | --- |
| Native HCB specialists | Retained result supplied to a new assignment; active guidance where supported. | Manager tool use and overall outcome remain important; worker completion is not sufficient. |
| Codex | Retained native conversation and private checkout; local CLI login. | Live 6/6 pass: two worker turns, same native conversation after restart, remembered facts without repeating them in the follow-up assignment, original source unchanged. |
| Pi | Native-session continuation and steering. | Latest retained local execution failed because the installed CLI rejected `--no-approve`; current end-to-end readiness is not established. |
| Claude Code | Native-session continuation and structured questions; no active-turn steering. | Implemented, but not live-verified in this session. |
| Gemini | Fresh invocation with the selected prior result. | Live testing excluded by user instruction; no successful live claim. |
| Copilot | Fresh invocation with the selected prior result. | Earlier retained-result tests passed; the latest retained local attempt failed with a certificate-format error. The earlier combined manager handoff also exposed the incorrect `continue` argument issue. |
| OpenCode | Fresh invocation with the selected prior result. | Earlier recorded live handoff tests passed; not freshly retested in the current profile. |

The [supervisor](../internal/orchestrator/supervisor.go) checks role/task identity,
configuration and retained-session eligibility before continuation. A manager
selects the prior task; it does not inject an arbitrary native thread ID.
Cross-provider handoff transfers supplied results and evidence, not hidden
conversation state. Result handoff must not be called native-session resumption.

Machine-local reports from 24 November are ignored evaluation artifacts and may
not exist in another checkout:

- [Codex native-session pass](../.hot-cross-buns/local-agent-verification-20261124/codex-local-handoff-wait.json).
- [Pi installed-CLI failure](../.hot-cross-buns/local-agent-verification-20261124/pi-inspect-runtime.json).
- [Copilot diagnostic failure](../.hot-cross-buns/local-agent-verification-20261124/copilot-inspect-diagnostic.json).
- [Portable 23 November verification](verification/orchestration-2026-11-23.md).

These are retained observations, not tests newly rerun while writing this document.

## Competitive expectations

| Product | Relevant documented expectation | Implication for HCB |
| --- | --- | --- |
| [Muse](https://muse.ai/blog/how-we-designed-muse) | Continuing main/side conversations, goals, selective proactive updates, browser actions and interactive artifacts. | Existing HCB memory, goals and artifacts need to combine into useful follow-through with little coaching and interruption. |
| [ChatGPT dots](https://learn.chatgpt.com/docs/dots/tasks-and-memory) | Multiple ongoing responsibilities, parallel delegation, revisiting tasks and relevant memory. | Validate prioritization and context transfer as responsibilities change; do not infer this from storage and delegation tests alone. |
| [Claude Duet](https://support.claude.com/en/articles/17631495-get-started-with-claude-duet) | Email/calendar briefs, follow-up, shared memory across channels, connected tools and reviewable outputs. | Calendar and a complete daily-assistant loop are material gaps. Duet also documents restrictions on model selection and browser takeover; the comparison is not uniformly one-sided. |
| [Grok Bot](https://docs.x.ai/grok-bot/overview), [skills and routines](https://docs.x.ai/grok-bot/skills-routines-and-automations) | Cooperating bots, connected apps, reusable skills, scheduled/event-triggered routines and workflow teaching where available. | The closest target: a dependable intent-to-tools-to-result loop, with reusable procedures, relevant follow-up and recovery. |

These descriptions were consulted on 24 November 2026. They are not proof of
universal feature availability or independently observed competitor success.
Do not combine every documented competitor feature into one imaginary baseline.

## Existing work that should not be rebuilt

HCB already has scoped Work execution, source snapshots, staged artifacts,
reviewed actions, editable evidence-linked memory, indexed chat history,
source-linked summaries, optional hybrid recall, goal/plan records, recurring
checks, originating-chat updates, skills, coding delegation and recovery records.

The UI changes preceding this assessment are also implemented: reactions as model
input, Mermaid guidance, inline media, file previews, Canvas, localhost split
previews, agent activity, task-scoped Plan visibility, the quick composer picker
and a separate Models dashboard. Provider reasoning-token controls remain
unavailable; Low/Standard/High currently select HCB work budgets.

The completed implementation check passed Go tests/vet, 103 web tests, 142 host
tests and the OAuth build check. This is engineering verification, not evidence
that all issues in the register are resolved. Browser visual verification was
not performed for those UI changes.

## Recommended first milestone

**Prove one local-model, controlled-browser personal-assistant workflow.**

**[Inference] This should come first because it addresses the defining functional
gap in the user's intended product and produces an outcome-level reliability
baseline.** A broad desktop-control rewrite, more provider adapters or another
dashboard would spread effort without first establishing that loop.

Start with a selected project folder and one explicitly approved browser origin.
The assistant reads project notes and the page, creates a source-linked brief,
accepts a corrected deadline, and uses that correction on a later follow-up.
It should explain a failed page read truthfully and resume from retained state
after recovery. Initially keep connected-account writes and arbitrary desktop
input outside the milestone.

Proposed sequence, not work already authorized or completed:

1. Select and verify one supported local model's structured tool-call behavior.
   Record its model/version and runtime configuration; do not silently fall back
   to cloud inference.
2. Establish a baseline using the existing source, memory, Work and review paths.
   Inspect the current local-model browser restriction and define the smallest
   explicit capability surface needed for the scenario.
3. Implement that bounded browser surface under existing session/origin reviews,
   tool schemas, resource limits and cancellation. Preserve the desktop/CUA
   restriction until a separate driver and acceptance scope are established.
4. Exercise the same retained task through the scenarios below. Check actual
   tool arguments, source freshness, owner/session identity and final artifacts;
   a natural-language claim of success does not count.
5. Review output usefulness and manual repair effort before widening access,
   adding accounts or introducing recurring execution.

### Acceptance scenarios

| Scenario | Required observable result |
| --- | --- |
| Initial task | Correct source-linked brief from the selected folder and approved page, with a usable retained artifact. |
| User correction | Revised deadline is used later; stale text is not presented as current truth. |
| Continuation/restart | The original task and permitted context remain bound correctly; no invented native continuation or duplicate execution. |
| Tool failure and recovery | Missing/stale coverage is explicit; restored access permits inspected recovery without claiming the failed read succeeded. |
| Follow-up and silence | A meaningful change produces an actionable update; irrelevant or unchanged input does not produce duplicate alerts. |

Record completion, incorrect facts, omitted requirements, tool/manager failures,
user interventions, manual corrections, latency, model requests, usage and any
measured cost. Separately record whether the person would actually use the
output. Establish and retain a baseline before claiming an improvement; no
target success rate is an observed result yet.

## Proposed order after the first milestone

1. Fix measured orchestration failures and the installed CLI compatibility issues
   needed by real workflows. Preserve the successful Codex path and failed reports.
2. Complete one recurring follow-up loop, including useful silence, delivery,
   correction, pause and recovery acceptance.
3. Decide calendar scope and activate only the accounts needed for a chosen
   personal-assistant responsibility, with the user's explicit authorization.
4. Improve skill/routine discovery and reuse from successful workflows.
5. Add current-web voice integration if observed usage makes it worthwhile.
6. Expand tool breadth and desktop control from evidence about unmet tasks.

No accounts, schedules, models or permissions were changed for this document.
