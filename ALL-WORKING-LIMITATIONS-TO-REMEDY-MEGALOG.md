# All Working Limitations To Remedy Megalog

This file tracks known remaining limitations that should be revisited after the current implementation pass. Items here are not necessarily release blockers, but they are the unresolved edges that should stay visible.

## MCP Hardening

Source: `temporary-mcp-concerns`

- A malicious local client that already has the bearer token can still read all data exposed by read tools. That is inherent in the configured MCP trust model; the remaining mitigation is clear Settings visibility, token reset, read-only mode, and future per-client scoping if product requirements demand it.
- The current manual MCP-client validation is documented instead of fully automated because the repository does not vendor a concrete third-party MCP client binary. The curl smoke test exercises the same HTTP boundary against the running app, and a real interactive client pass is called out in docs.
- Rate limiting is in-memory and resets when the app restarts. That is acceptable for a local desktop endpoint, but persistent abuse counters would be needed if the server ever becomes remotely reachable.

## Whole-App Product Hardening

Source: whole-application audit after MCP hardening.

- Local backup encryption must match the user's cache-encryption expectation. This was a real product issue because the UI/security model implied local encrypted data while backup files could still carry plaintext task, event, account, and pending-mutation data. Current remediation encrypts local backups when cache encryption is enabled and fails closed if the backup key material is unavailable; keep regression coverage around this path.
- Raw Google diagnostics need per-field controls instead of a single all-or-nothing switch. The current warning is accurate, but support debugging may need task/event payloads while still suppressing attendee names, locations, Meet links, descriptions, or other user-chosen fields.
- Markdown-to-Calendar HTML conversion must remain robust against literal HTML and unsafe link schemes. Current remediation escapes normal text, escapes link labels/attributes, and leaves disallowed schemes as plain text; keep testing this because it sits on a user-input-to-Google-HTML boundary.
- Share-extension inbox writes must stay bounded before the main app consumes them. Current remediation applies size, source, freshness, and queue-count limits at write time, but this should be revisited if future share payload types expand beyond text and URLs.
- Dead/refactor leftovers marked `TODO: prune` should be removed as part of the broader GitHub issue cleanup rather than during unrelated security work. This is not a user-facing blocker by itself, but leaving dead production source raises maintenance risk and makes future hardening audits noisier.
