# All Working Limitations To Remedy Megalog

This file tracks known remaining limitations that should be revisited after the current implementation pass. Items here are not necessarily release blockers, but they are the unresolved edges that should stay visible.

## MCP Hardening

Source: `temporary-mcp-concerns`

- A malicious local client that already has the bearer token can still read all data exposed by read tools. That is inherent in the configured MCP trust model; the remaining mitigation is clear Settings visibility, token reset, read-only mode, and future per-client scoping if product requirements demand it.
- The current manual MCP-client validation is documented instead of fully automated because the repository does not vendor a concrete third-party MCP client binary. The curl smoke test exercises the same HTTP boundary against the running app, and a real interactive client pass is called out in docs.
- Rate limiting is in-memory and resets when the app restarts. That is acceptable for a local desktop endpoint, but persistent abuse counters would be needed if the server ever becomes remotely reachable.
- The future BYOK in-app chat and external MCP server must share one permissioned internal tool layer. If they grow separate tool implementations, authorization, dry-run/write behavior, auditing, error handling, and sensitive-field policy will drift.
- AI-initiated writes need explicit permissioning and durable audit trails. Write paths should support read-only mode, dry-run previews, user confirmation for destructive actions, and undo/history where feasible.
- BYOK provider credentials must be stored only in Keychain and excluded from MCP responses, logs, diagnostics bundles, crash reports, export archives, and prompt/tool transcript storage.
- MCP/BYOK responses need a deliberate sensitive-information policy for personal information and confidential business content, including attendees, locations, Meet links, descriptions, notes bodies, and raw provider payloads. The concern is not to hide all useful context, but to make disclosure intentional, configurable, and testable.
- MCP/BYOK hardening should include request/session rate limits that behave predictably with real clients that reconnect, retry, stream, or issue malformed requests.

## Whole-App Product Hardening

Source: whole-application audit after MCP hardening.

- Large-account synthetic backend/cache/sync/derived-loop performance is substantially improved for roughly 10k-20k event Google Calendar accounts. The 15k-event benchmark suite now covers Google event decode/map, full event sync, cache sidecar save/load, AppModel startup/apply, derived snapshot rebuilds, prepared calendar snapshots, menu bar status, date parsing, merge, sidecar, day bucketing, and tag semantics. Keep the user-visible performance issue open until real SwiftUI/Instruments validation confirms launch, scrolling, calendar transitions, and sync under UI load on a large account.
- Command Palette open is improved by preserving the entity cache and avoiding empty-open indexing, but large-account entity indexing/search should still move off the main actor or be precomputed incrementally. First search after data changes can still hitch because tasks, events, and notes are indexed synchronously.
- Battery optimization remains a product-quality concern. Reducing polling or background work must not make sync feel broken; the UI should make Low Power Mode, background throttling, unfocused-window throttling, and delayed refreshes understandable to users.
- Battery work should measure the combined cost of foreground polling, background refresh, Spotlight indexing, notification scheduling, calendar snapshot rebuilds, menu bar timers, and adaptive status refreshes. Each path may look cheap alone while still producing excessive wakeups together.
- Battery throttling must not starve pending writes, sync conflict repair, auth recovery, or user-visible freshness. The implementation needs explicit rules for which work is deferred, which work is urgent, and how deferred work catches up.
- Battery optimization should be validated with Xcode Energy gauge sessions for idle foreground, active foreground, backgrounded, menu-bar-only, and Low Power Mode usage, plus counters for polls/hour, API calls/hour, Spotlight runs/hour, notification sync runs/hour, wakeups, CPU, and memory.
- Raw Google diagnostics need per-field controls instead of a single all-or-nothing switch. The current warning is accurate, but support debugging may need task/event payloads while still suppressing attendee names, locations, Meet links, descriptions, or other user-chosen fields.
- The GitHub release workflow needs a first-class trust path for users downloading Hot Cross Buns directly from releases. Apple notarization is separate from release-asset verification; even without paid Apple distribution, the app should produce a reproducible release artifact, publish checksums, sign or attest the checksums/release manifest, verify downloaded assets in the in-app updater before presenting them as ready, and document the verification path for manual GitHub downloads.
- Dead/refactor leftovers marked `TODO: prune` should be removed as part of the broader GitHub issue cleanup rather than during unrelated security work. This is not a user-facing blocker by itself, but leaving dead production source raises maintenance risk and makes future hardening audits noisier.
