# Reviewed reusable routines

Routines extend the existing skills library with named parameters, source
prerequisites, allowed future effects and HCB-managed model-request/token limits.
They are text procedures executed through ordinary Work tools and permissions.

## Save and reuse

1. After a useful workflow, ask HCB to save it as a reusable routine. Specify
   what varies, such as the project or topic. HCB proposes a skill containing
   the procedure, its verification steps and routine metadata. Review and accept
   the proposal before it enters the enabled library. Saving does not schedule
   or execute it. The capture ID identifies the proposal's originating run; it
   is not certification that a procedure was independently verified.
2. Find **Skills and routines** in the command palette or Settings, or ask which
   routines are available. The inspector shows the actual procedure and supports
   reviewed enabling/disabling of that exact revision for future tasks. Existing
   skill list/show/enable/disable controls still apply. Ordinary text skills
   continue to work as before.
3. Ask HCB to use a named routine with the required values. The agent reads its
   metadata, then uses `skill_prepare`. The review shows the actual expanded
   procedure, exact parameters, source prerequisites, effects and limits.
4. Approval releases that revision's procedure for the current task. Declining,
   disabling the skill, changing it during review, invalid parameters or missing
   foreground approval leave the routine inactive. Active specialist assignments
   must settle before activation. Parameters are expanded once and are not
   evaluated as code or recursively expanded.

Each activation needs fresh review. The model-facing `skill_read` response
returns metadata rather than an unapproved parameterized procedure. The library
inspector remains available for the person to read its full text.

## Scope and limits

After activation the host classifies subsequent registered tool calls using the
existing plan-effect rules. Calls outside the reviewed routine effects are
rejected. Reads remain available; code includes its verification checks, and
publishing includes connected writes. Unclassified operations are rejected.
Another reviewed activation can select a different procedure within the
original task's authority.

Source labels describe prerequisites; they do not grant folder, account, browser
or computer access. Effect labels cannot install tools, widen the original task
or replace exact external-action reviews. The procedure and parameter values
are reference data, never permission authority.

The remaining request and reported-token budget can only narrow. Existing usage
is retained, and lower task/parent limits still apply. The effective budget is
sealed into execution accounting, including later restrictions when preparing
reviewed recovery. Token accounting depends on provider reports and is checked
between calls; in-flight requests may exceed a reported-token threshold. CLI
workers retain their separate execution limits and costs. Existing task time,
step and delegation bounds remain in force.

Parameterized activation is foreground-only. Saving a routine does not create
standing authorization, an unattended job or a second workflow engine.

## Recovery

Use retained task attempts, outputs, worker logs and action receipts to establish
what completed. Setup-related CLI failures now expose structured recovery
guidance. Only a host-classified read-only attempt can enter the existing
reviewed retry preparation; this does not execute the retry itself.

Timeouts and exhausted budgets require inspection and a new budget/scope review.
They do not authorize replay of partially completed work. Explicit cancellation
does not create retry authority. Ambiguous external effects retain the existing
receipt/reconciliation boundary. A reviewed continuation should preserve
completed steps and current evidence rather than repeat a whole recipe.

The host does not establish semantic correctness of a recipe or prove that a
model interpreted each step correctly. These changes provide explicit activation,
scope enforcement, accounting and recovery evidence for human review.
