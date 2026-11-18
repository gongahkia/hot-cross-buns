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

The format-3 engine and direct document/capture source operations are implemented. Dated and undated format-3 documents now use the shared block editor directly, with visible attached bodies, contextual block editing, live preview, native input undo, recoverable drafts and completion in either location. The explicit upgrade has source preview, original download and normal journal undo. Missing visible render trees use bounded cached previews with global reference context. Plain prose does not inflate unfinished counts; actionable branches under plain outlines still count.

Focused checks cover direct writing, exact exports, mixed completion, ordered-list checkboxes, rich content, native undo/recovery, previewed upgrade/undo, direct links/backlinks, cross-window stale drafts, popup lifecycle and recurrence body edits/rescheduling. Final acceptance passed 345 unit tests, 15 Python tests, the production build and 273 Chromium browser tests. See the verification record below for the dependency-audit exception and unavailable checks.

Scratchpad is now opened from Commands rather than a navigation tab. The named popup is reused without navigating an open draft; mobile and blocked popups use an in-app dialog. Format-3 capture uses the shared editor and retains the existing ownership/takeover lease. Rendered blocks can be copied or moved without flattening their Markdown, with atomic journal/capture undo and keyboard redo. Accepted writes and transfers hold the capture lease until they settle, including takeover during a stalled save. Legacy transfers queued behind a text save release their pending state after completion. Legacy selection menus now remain inside the capture dialog's modal boundary. Scoped browser checks cover popup reuse, fallback, drafts, takeover, rich transfers, legacy selection/capture recovery and notifications; the new window helper has four passing unit cases.

Outline creation now uses one Add child action, plain/task conversion and grouped movement controls. Child creation opens the shared local Markdown draft before any source commit. Scheduled moves cannot discard their fields, and unscheduled moves retain completion and attached content. Explicitly reopening a task clears its retained completion date in either location; undo restores both. New workspaces start in format 3; legacy row-editor coverage explicitly opens saved format-1 workspaces.

Dated now offers List and Calendar, with day/week/month navigation, canonical timed/untimed/all-day/overnight/recurring content, holiday view overlays, day-document creation, explicit schedule/move forms, recurrence scope, completion and undo. Generated occurrences open without materialization. Recurring body edits stay local through scope review, and a logical occurrence remains available after its replacement receives a new ID. Forms provide the calendar rescheduling path; drag/resize is intentionally excluded.

The [format-3 performance report](PARSER_PERFORMANCE.md#unified-writing-measurements) and [raw measurements](performance/unified-writing-2026-11-18.json) cover three samples each at 1,000/10,000 entries, local typing, completion, worker transfer, durable saving and calendar navigation. Desktop/month/week and phone/day/capture screenshots were inspected in light and dark appearances; the mechanical UI scan returned no findings. This is Chromium/viewport verification, not a physical-device or live cloud-provider test. README.md remains unchanged.

## Final verification

`npm run verify` completed the 345-unit / 15-Python / build / 273-browser sequence with no functional failures or skipped unit/browser tests. The command then exited 1 because `npm audit --audit-level=low` reports four high-severity findings through Vite/fdir/tinyglobby/picomatch. The dependency audit remains unresolved; no unrelated downgrade or validation weakening was applied. The production build also retains the large-main-chunk and optional Mermaid asset warnings.

Earlier full runs exposed obsolete Scratchpad-tab assertions, transition/drag-coordinate timing assumptions and capture keyboard-undo/pending-state gaps. The implementation and tests were corrected, with explicit source comparisons, lease-handoff and pending-transfer regressions. The final full functional run passed after those changes.

`npm run benchmark:markdown -- --samples=3` completed both dataset sizes and restored the normal production build. The measured format-3 dataset predates the final identity/lease guards; its dated typing, completion and calendar paths do not exercise those new rejection/handoff cases. See the raw report for phase counts and sample limits. Local verification used Node 26.7 and Chromium 156; the Node 22/24 CI matrix, other browser engines, physical phones and real multi-device cloud-provider delivery were not run here. Browser provider checks use isolated fault models.

`git diff --check` passed. README.md retains its starting SHA-256, `0d2d10d75f9c6f66bdc45c7a1dc6e5616be75f695ff6cf13171fff47440b155c`.

Identified top-level entries stay top-level when using structured controls: the current child grammar has no planner-ID metadata, so demotion is rejected instead of dropping identity. Unidentified, unscheduled roots can be indented; existing child branches can move, nest and promote with their attached Markdown. Use Add child to extend an identified entry. Calendar drag/resize and nested planner identities are not implemented.
