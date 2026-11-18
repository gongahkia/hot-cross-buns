# Unified writing implementation

Approved 18 November 2026. This extends the earlier Markdown plan: Dated and Undated are the two core views, Calendar belongs within Dated, and Scratchpad is shared quick capture opened from Commands. README.md remains untouched.

## Implementation sequence

1. Add document format 3 with optional checkboxes in both dated and undated outlines, preserving versions 1/2 on read and providing an explicit, previewable, undoable upgrade. Keep database schema 4 and revision protocol 2. Preserve source outside intentional edits.
2. Expose date/list documents directly through one source-aware Markdown editing surface. Render inactive blocks, keep active drafts local and recoverable, and validate complete candidates before committing. Retain existing nested content, attached bodies, identities and scheduling metadata. Simplify child creation, conversion and movement controls.
3. Remove Scratchpad from primary navigation. Add Open Scratchpad to Commands, reuse/focus one browser popup and provide an in-app fallback for mobile/blocked popups. Use the same writing surface and preserve capture structure in atomic moves and undo.
4. Add List/Calendar presentations under Dated, with day/week/month navigation, timed/untimed/spanning/recurring content, day-document access and create/edit/reschedule controls using existing recurrence operations. Preserve floating times and keyboard equivalents.
5. Verify source edits, upgrades, mixed outlines, rich blocks, recovery, cross-window ownership, capture, scheduling, recurrence and calendar interactions. Inspect desktop/phone and light/dark UI, run full checks and repeat large-journal measurements.

## Acceptance boundaries

- Writing directly under a date or inside an undated document must not require a task or a separate Notes container.
- Task state is independent of location; a calendar uses the same dated content rather than a separate event store.
- Scratchpad remains in Planner.md and retains unsaved/failed drafts through window changes; closing a popup must not imply that pending text was saved.
- Preserve IDs, metadata, recurrence, completion, source spelling, shared scratchpad, sync branches, history and recovery except where an explicit user operation intentionally edits them.
- Existing clients must reject the newer format rather than reinterpret it. No automatic read/import/sync upgrade, schema downgrade, TXT compatibility or live external calendar connection.
- Keep the existing quiet visual language and contextual controls; no permanent formatting toolbar or competing editor.
- Tests and measurements must prove the final behavior. Known dependency audit findings and unavailable real-device validation must remain explicit.

## Progress

The format-3 engine, explicit upgrade primitive and direct document/capture source operations are implemented. Focused tests cover mixed outlines, completion and metadata preservation, document boundaries, rich capture moves, source ownership, Unicode and all supported line endings. The format foundation passed the complete unit suite and production build. Editor, popup and calendar integration and final acceptance remain outstanding. The prior rendering/navigation work and its support matrix are the baseline, not evidence that this product transition is complete.
