# One Hot Cross Buns assistant

HCB has one conversational home. People ask for help there while independent
tasks, schedules, projects and specialists keep their own execution context
underneath it. The ordinary interface has no Main chat / New chat choice or
response-fork action.

## Interaction

- Start and return to HCB's existing persistent home conversation.
- Requests that need tools appear in that conversation as compact task updates.
  Their results appear there when available; opening the status inspects their
  history, public activity and generated files without leaving the home draft.
- **Reply in HCB** selects that task in the existing composer. The selection is
  visible and can be cleared. It carries an explicit task identity through draft
  storage, admission and routing. Routing cannot use that selection to control a
  different task. Existing fresh-state and permission checks still apply.
- Exact approvals, recovery and detailed task work can open the original task
  context. **Back to HCB** returns to the same home and its draft.
- Past work retains older tasks and conversations from previous versions.
  Command/Ctrl-P opens searchable, paginated results on demand; the wordmark menu
  contains settings and connections rather than an empty or duplicate history list. Command/Ctrl-K opens commands;
  Command/Ctrl-F searches the current transcript.

## Context and compatibility

One assistant does not mean one unbounded model prompt. Existing bounded
conversation retrieval, shared memory and independent task contexts remain in
use. Selecting a task supplies its available summary and control capabilities;
it does not grant access to that task's files, tools or credentials.

The host inspects only already-owned or reachable task snapshots. It does not
start replacement work to populate details. Native approvals and external-action
receipts retain their original owner, exact identity and permission scope.
Raw model reasoning and private tool arguments are not included in inspection.

Existing transcripts, task origins and drafts are retained rather than merged or
deleted. Legacy conversation identities and internal creation/fork APIs remain
for compatibility and execution isolation; they are not separate assistant types
in normal navigation. A disconnected or unavailable task cannot be silently
retargeted by a reply. When saved drafts are disabled, task selection stays only
in memory for the current host lifetime.

New UI should reuse the conversational home and contextual controls. Add a
permanent page, toggle or button only when the task cannot be served clearly by
the existing interaction loop.

## Verification

`web/tests/one-assistant.test.mjs` exercises the actual Go runtime and application
host with an isolated model fixture: background execution, read-only inspection,
home draft preservation, selected-task admission, stale/foreign target rejection,
reply-context persistence and use with saved drafts disabled. Existing main-chat
compatibility tests cover retained history and independent owner lifetimes.
Router tests reject attempts to control another task; rendering tests cover
history navigation, inline actions and inspectable task results/activity.
