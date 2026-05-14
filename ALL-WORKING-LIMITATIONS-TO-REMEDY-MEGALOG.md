# All Working Limitations To Remedy Megalog

This file tracks known remaining limitations that should be revisited after the current implementation pass. Items here are not necessarily release blockers, but they are the unresolved edges that should stay visible.

## MCP Hardening

Source: `temporary-mcp-concerns`

- A malicious local client that already has the bearer token can still read all data exposed by read tools. That is inherent in the configured MCP trust model; the remaining mitigation is clear Settings visibility, token reset, read-only mode, and future per-client scoping if product requirements demand it.
- The current manual MCP-client validation is documented instead of fully automated because the repository does not vendor a concrete third-party MCP client binary. The curl smoke test exercises the same HTTP boundary against the running app, and a real interactive client pass is called out in docs.
- Rate limiting is in-memory and resets when the app restarts. That is acceptable for a local desktop endpoint, but persistent abuse counters would be needed if the server ever becomes remotely reachable.

## Whole-App Product Hardening

Source: whole-application audit after MCP hardening.

- Raw Google diagnostics need per-field controls instead of a single all-or-nothing switch. The current warning is accurate, but support debugging may need task/event payloads while still suppressing attendee names, locations, Meet links, descriptions, or other user-chosen fields.
- The GitHub release workflow needs a first-class trust path for users downloading Hot Cross Buns directly from releases. Apple notarization is separate from release-asset verification; even without paid Apple distribution, the app should produce a reproducible release artifact, publish checksums, sign or attest the checksums/release manifest, verify downloaded assets in the in-app updater before presenting them as ready, and document the verification path for manual GitHub downloads.
- Dead/refactor leftovers marked `TODO: prune` should be removed as part of the broader GitHub issue cleanup rather than during unrelated security work. This is not a user-facing blocker by itself, but leaving dead production source raises maintenance risk and makes future hardening audits noisier.
