# Review queue, memory files and discoverability verification

Verified 2026-11-25 against the current browser implementation.

## Automated checks

- Final `make check` passed with canonical macOS `TMPDIR`: complete Go test suite, `go vet ./...`, 138 browser tests, 145 host tests, and OAuth build tests.
- `go test -race ./internal/personalization ./internal/suggestion ./internal/memory ./internal/tools` passed. The category synchronization package was checked again after its single-pass catalogue optimization.
- Review queue tests use the real managed host/runtime. Listing/inspection do not apply proposals, exact acceptance creates the expected schedule, repeated or stale decisions fail, reject does not apply a proposal, stale browser contexts fail, and composer drafts remain intact.
- Markdown tests cover existing-ID corrections, eight private files, ordinary HCB updates reaching exports, concurrent HCB/file changes, missing/unknown markers, symlink rejection, interrupted export recovery, inactive candidate protection and derived-source invalidation.
- A browser gateway-to-routing test edits `preferences.md` without refreshing Memory and verifies the next conversational model request receives the corrected memory. Forgetting removes its text from the category export.
- Whole-message admission tests include casual project statements and retain temporary-context, quotation, sensitive-content, credential and retention-opt-out checks.
- Frontend detector and `git diff --check` passed.

An initial targeted run without canonical macOS `TMPDIR` hit the known CLI sandbox exit-126 setup issue; canonical-path checks above passed. Optional live-provider evaluation suites remain opt-in and are skipped by ordinary `make check`. This work does not establish compatibility with every local model, external CLI, OS permission or connected account.

## Browser verification

Used disposable local fixtures to inspect the Review entry/count, full schedule proposal, explicit acceptance and count update, and the Memory category file disclosure. Checked desktop and narrow mobile layouts. All test proposals, fixture schedules and provider replies were isolated from the user's profile. The browser reported only the existing missing `favicon.ico` request, with no application-script error observed.

The live user's original project-memory review was inspected and approved only after explicit user confirmation of that exact statement. The task completed before the server was restarted. After restart, read-only gateway checks confirmed one Project context entry, eight Markdown category paths, and one still-pending durable reminder proposal. That reminder was not accepted. No existing user memory was edited as a synthetic test.

The app remains available at `http://127.0.0.1:4317/`. Browser fixture state and screenshots are retained only in ignored local verification artifacts; fixture browsers and servers are closed at handoff.

## Audit scope

See [the 66-command discoverability audit](../UI_COMMAND_DISCOVERABILITY_AUDIT_2026-11-25.md) and [the Markdown editing contract](../MEMORY_MARKDOWN_FILES.md). The audit distinguishes missing entry points, incomplete operations and existing UI adapters. It is not a live execution claim for every audited workflow.
