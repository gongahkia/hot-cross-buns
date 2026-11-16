# Hot Cross Buns follow-ups

Hot Cross Buns is becoming a single-file Markdown browser planner while keeping dated/undated workflows, a shared scratchpad and a quiet interface. [MARKDOWN_FORMAT.md](./docs/MARKDOWN_FORMAT.md) defines the running format; [runtime and rollback guidance](./docs/MARKDOWN_RUNTIME.md) covers source ownership, storage and sync. README.md is intentionally unchanged during this transition.

[Implementation stages](./docs/MARKDOWN_PLANNER_PLAN.md) separate the delivered runtime from later rich rendering, source search/linking and day/week/month calendar views. Live Google/Outlook connections remain outside scope; only one-time imports are supported.

## Markdown transition

- [x] Freeze the single-document contract: visible hcb metadata, explicit identity, readable planning fields, terminal shared scratchpad and floating wall times.
- [x] Add source-preserving parsing and validated atomic source patches, identity insertion, title edits, non-recurring completion and scratchpad replacement, with paired TXT/Markdown semantic fixtures.
- [x] Connect one document mutation path to durable storage, drafts, undo, immutable revisions and explicit branch review. Include scratchpad in saves/restores and fence incompatible writers; never round-trip Markdown through the TXT merge.
- [x] Implement occurrence-aware completion, successor creation, movement, span updates and recurrence scope using atomic document transactions.
- [x] Switch existing dated/undated/scratchpad views, scoped entry search, import/export and recovery to Markdown, with an explicit archived developer-workspace conversion. Add hidden source editing, stale-draft recovery and raw startup recovery.
- [ ] Expand search/indexing to arbitrary prose, shared scratchpad and stable-link navigation without adding persistent UI.
- [ ] Add safe Markdown, Mermaid and math rendering with bounded work and source fallback. Define rich-detail promotion behavior for inert hcb examples and deeper lists; unsupported structural edits currently require source review.
- [ ] Build editable day/week/month calendar views with quiet contextual controls, keyboard/touch alternatives, spans, recurrence review and undo. The existing dated list remains the agenda.
- [ ] Benchmark parsing, indexing, search, typing, calendar navigation and durable saves on defined datasets; then validate browsers and actual file/device delivery. Agent/MCP support comes later.

## Delivered foundation

- [x] Dated items, undated lists, details, completion and scratchpad capture.
- [x] Hashtags, text search and tag filters.
- [x] Time blocks, multi-day spans and scheduled or after-completion recurrence.
- [x] Drag to reorder or move items; keyboard sibling creation and detail promotion/demotion.
- [x] Responsive browser layouts, themes, appearance preferences and shared browser popouts.
- [x] Explicit Markdown import, doctor, conflict review and download preview.
- [x] Separate, read-only Google Calendar and Tasks snapshot tools.
- [x] Direct saving to a linked Planner.md file, with a Syncthing workflow, external-change review and file-write recovery.
- [x] Optional Google Drive saving through a Web OAuth client, per-file access and the existing import/conflict review.
- [x] Shared durable sync coordination: frozen submissions, verified receipts, automatic catch-up, conservative merges, cross-tab ownership, draft/undo protection and bounded recovery copies. See [sync behavior and limits](./docs/SYNC.md).
- [x] Immutable revision history for sync folders and new Drive links, with stable retry identities, verified ancestry, explicit concurrent-branch review, bounded scans and safe storage upgrades. See [revision protocol and retention](./docs/REVISION_SYNC.md).
- [x] History and recovery through a query-only palette command: ancestry-ordered versions, bounded comparison previews, complete raw downloads, incoming-branch review and confirmed restoration as a new revision. No extra toolbar or sidebar controls.
- [x] Nextcloud and Dropbox desktop-folder workflows on the shared revision transport: separate branded settings and setup controls, bounded transient retries, exact-name handle resolution, interrupted history transfer, contextual conflict-copy import and a read-only folder inventory check. Automated transfer scenarios are distinct from real provider/device validation; see [setup and verification](./docs/SYNC_FOLDERS.md).
- [x] Corner toast notifications for transient messages, with dismissal and paused timers during interaction.
- [x] Failed-save draft recovery and bounded imports and recurrence projections.
- [x] Quick Today/Tomorrow moves using the journal's time zone, normal recurrence choices and undo.
- [x] All/Open/Done search filters combined with text and hashtags across dated entries, inside the command palette.
- [x] Neutral dark mode and borderless text fields.
- [x] Smooth caret movement while typing and navigating, with an idle pulse and reduced-motion support.
- [x] Command palette for the five existing topbar actions (⌘K / Ctrl+K), using the compact browser palette and scale/fade motion from commit `8f2c2b2`. Journal results, tags and completion filters live in the palette; choosing a result reveals and focuses its entry.

Caret movement covers ordinary text inputs and textareas. Selections, IME composition, touch selection handles, passwords, segmented controls, bidirectional text and editors above 32,768 UTF-16 code units use the native caret. Reduced motion, forced colors and browsers without the Popover API also keep the native caret.

## Next validation

- [x] Investigate the 1,200-item completion/undo regression and retain its unchanged budgets. The source-authoritative runtime now passes the clean local gate; [measurements and limits](./docs/MARKDOWN_PLANNER_PLAN.md#runtime-verification-17-november-2026) distinguish this result from a general speed claim.
- [ ] Validate Nextcloud and Dropbox with actual desktop clients/accounts and two physical devices, including hidden-history exclusions, offline availability, replacement handles, conflict copies, interrupted transfer and matching folder receipts. This implementation uses automated fault models only, as requested; native pickers, provider acknowledgements and device delivery remain unverified.
- [ ] Evaluate OneDrive as the alternative managed provider after the selected Dropbox workflow is dogfooded. A direct Nextcloud WebDAV, Dropbox or Graph adapter needs its own browser/authentication and transport contract; no such API integration is advertised here.
- [ ] Investigate the existing intermittent Chromium mobile-rotation weekday visibility failure if it recurs; preserve assertions and report retries explicitly.
- [ ] Validate Google sign-in, Picker, key restrictions, token expiry and remote conflicts with an actual configured Google Cloud project. Browser automation substitutes these services; tokens stay in memory and reconnecting is required after reload.
- [ ] Run the [sync fault scenarios](./docs/SYNC.md#verification) with real devices and services, especially interrupted saves, stale device copies and simultaneous edits. Automated fault injection covers the app protocol; provider transport and device delivery need separate observation.
- [ ] Validate revision discovery using the same Google OAuth client/account across actual devices; verify private-file access, delayed listings, reserved-ID retry and complete-folder Syncthing transfer. Upgrade all participating writers; single-file compatibility mode keeps its overwrite limitation.
- [ ] Measure snapshot growth during dogfooding. Any automatic compaction needs an explicit offline-device acknowledgement/retention design; this version pauses at its documented history limit and never deletes history automatically.

- [ ] Dogfood linked-file saves with real Syncthing devices, browser permission renewal, concurrent edits and conflict copies. Headless tests use real browser file handles with a substituted OS picker; they do not exercise Syncthing transport or native picker dialogs.

- [ ] Dogfood capture, complete, defer, find and export for two weeks. Record where text loses context or the workflow needs extra steps.
- [ ] Check persistence, import/download and failed-save recovery on actual Safari, Firefox and mobile browsers. Chromium automation and phone viewport tests do not establish compatibility with those browsers or devices.
- [ ] Review keyboard and screen-reader navigation across journal rows, details, dialogs and popouts.
- [ ] Measure real journal sizes and the new resource-limit notices before changing limits or adding a file-size indicator.
- [ ] Validate quick deferral, status search and the command palette during dogfooding. Use observed problems to decide whether fuzzy matching or natural-language entry earns the added complexity. These are candidates, not committed features.

## Retired directions

- Parity with the Google Calendar and Tasks suites, or live calendar-account connections. A calendar over local Markdown entries is now planned in the design document above; it is not implemented yet.
- Automatic deletion of old journal content.
- A hosted journal database or continuous Google Calendar/Tasks account sync. Sync remains based on portable Markdown files, with Syncthing, Nextcloud and Dropbox desktop-folder workflows and optional Google Drive saving.
- Electron, a desktop menubar app or an installable PWA as part of this browser restoration.

Keep the archived developer-workspace records and version-4/protocol-2 rollback compatibility. One-time Shio Pan preference migration, snapshot alias and service-worker retirement remain isolated compatibility paths; there is no permanent TXT file-import mode.

- [ ] Replace the temporary checksum-guarded micromark prefix patch when an inspected upstream release supplies the correction; rerun source/offset and performance suites. See [parser dependency guidance](./docs/PARSER_PERFORMANCE.md).
