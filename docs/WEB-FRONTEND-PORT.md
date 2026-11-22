# Web frontend and Swift retirement

22 November 2026. The local web interface is the primary frontend. One
persistent conversation remains the intended interaction; retained chats and
workspace-specific conversations are secondary, explicit navigation.

The previous Swift frontend is preserved in Git checkpoint `f9568a80f`.
Its dedicated `macos/` directory (application, package, tests, build tools,
resources, mascot experiments, generated builds, and native acceptance evidence)
is removed from the working tree after port verification. Historical documents
that discuss that application describe the retired implementation, not current
build instructions. Use [Developing Hot Cross Buns](DEVELOPMENT.md).

| Former Swift capability | Current web implementation | Verification |
| --- | --- | --- |
| Folder choice and workspace context | Workspace modal, local folder browsing, Go canonical resolution, new owner for a different folder | Real-Go gateway test preserves the original draft and rejects stale context; browser folder navigation and selection |
| Exact action correction and plan revision | Separate correction composer in the requesting chat; Go-projected eligibility; original owner and review identity checked before admission | Correction-state tests, controlled protocol integration, browser editing/cancel/reload/submission, canonical Go correction/revision tests |
| Detailed plan review | Structured outcome, steps, effects, sources, inputs, remaining/original budgets and prior attempts; raw review in a disclosure | Rendering tests and browser review/revision checks |
| Other chats working or needing attention | Quiet status icons and a live attention summary in the existing chat menu | DOM tests preserve keyboard focus; browser check using an actual independent Go task waiting for review |
| Word-aware streamed prose | Bounded grapheme-safe adaptive reveal; structured text, reduced motion and disconnects settle to received source | Cursor, backlog, raw-source copy and structured-output tests |
| Copy complete response | Quiet copy control on assistant replies and the live response, retaining full received Markdown | Clipboard byte checks, manual fallback, browser copied-state check |

No mode selector, Plan first toggle, menu-bar/notch access, separate native
windows, or mascot was added. Approval and execution still belong to Go; neither
editing a correction nor opening a review grants authority.

The Go runtime, shared host, terminal frontend, companion, scheduling, memory,
connectors, native OS services, and macOS release/test runners remain. Their
platform support is separate from the retired Swift application.

Verification was run on Linux with local fixtures. No live account mutation,
Gmail send, paid model call, or macOS UI build was performed. The host suite's
Windows-only native handoff test is skipped on Linux. An initial parallel Go
suite lost its command-package process; the serial full-suite rerun passed.

After removal, `make build`, `go test -p 1 ./...`, `go vet ./...`, the terminal
typecheck, all 63 web tests, 143 host tests, and all 15 packaging/OAuth build tests
passed. Browser checks used disposable fixtures and the rebuilt local app; the
existing ordinary draft was preserved.

`GOFLAGS=-p=1 make check` is not fully green. Twelve terminal failures also
reproduce against the original runtime and frontend at checkpoint `f9568a80f`:

- Attachment rejection display (`ui/tests/attachments.test.tsx`, one case).
- Settings command menu (`ui/tests/commands.test.tsx`, one case).
- First-run setup and credential recovery (`ui/tests/first-task.test.tsx`, five cases).
- Local model controls (`ui/tests/local-models.test.tsx`, one case).
- Model selection/setup (`ui/tests/models.test.tsx`, two cases).
- Scheduled-check page navigation (`ui/tests/pages.test.tsx`, one case).
- Provider form setup (`ui/tests/providers.test.tsx`, one case).

The full terminal run was then interrupted by a temporary-filesystem quota error.
Its affected and remaining 15 files were rerun with `TMPDIR` on disk: 38 passed,
one skipped, none failed. The branding test was checked separately and passed.
Across the completed terminal checks, 210 tests passed, the 12 existing cases
failed, and two integrations were skipped (macOS login-service repair and the
opt-in managed browser). These existing terminal issues
were not changed or hidden by the web port. No Swift frontend test was run after
retirement; its dedicated package and native UI no longer form part of the build.
