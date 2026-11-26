# Local Work capability matrix

**Interface status:** Hot Cross Buns runs as a local browser app (`make run`). Shell examples below are source-checkout developer operations with an explicit internal opt-in; see [development instructions](DEVELOPMENT.md). They do not install or enable a public CLI.

Hot Cross Buns Work is local-first. Artifact files remain staged until a separate review/publish boundary is used.
Explicitly granted browser, desktop and connected-service tools can change external
state during a run, after their own action reviews. It is not a hosted workstation or a
cloud continuation product.

| Capability | Local Work v1 behavior | Boundary |
| --- | --- | --- |
| DOCX | Create documents; exact text replacements in existing documents, headers, footers and notes, including text split across formatting runs | Ambiguous matches fail. Untouched package parts are copied. Tracked changes, field recalculation and native layout fidelity require further support. |
| PDF | Create PDFs; select/reorder/duplicate, rotate or remove existing pages; add visible text stamps | Stamps are overlays, never secure redaction or semantic text replacement. Verify layout; edits can invalidate signatures. |
| XLSX | Create or edit an existing workbook with bounded structured operations | Existing staged-output contract |
| PPTX | Create decks with text, notes, and fade/push/wipe transitions; inspect and apply bounded text/title/body/note/reorder/add/delete edits to source decks | Untouched OOXML parts are copied through. VBA, embedded objects, media, and unsupported animation data are never read, executed, authored, or regenerated. |
| Public web research | Fetch selected HTTPS sources and discover pages with host-selected TinyFish, Exa, Tavily or Brave search | Queries go to the configured provider; exact selected-origin filtering applies. Snippets are discovery leads, not retained factual evidence. Keys alone grant no site access. See [configuration and boundaries](WEB-SEARCH.md). |
| Live filesystem | Foreground tasks use `filesystem` with absolute or `~/` paths. Inline permission choices resume the pending tool call; Settings → Permissions manages saved folders and full access. | Task-only or persistent read/CRUD scopes, folder identity checks, current-hash replacement/deletion, protected HCB control records, and delegated worker sandbox roots with revocation monitoring. Direct text tools are bounded; see [live filesystem access](LIVE-FILESYSTEM.md). |
| Controlled browser | `hot-cross-buns browser start` or `attach`, followed by a selected session and `hot-cross-buns work --browser-session SESSION` | Only selected tabs and approved origins are visible. Every mutation has a fresh approval. Managed local text models can use snapshots and element references through the same explicit grants and reviews; screenshot tools are excluded for text-only models. See [local-model laptop workflows](LOCAL-MODEL-LAPTOP-WORKFLOWS.md). |
| macOS computer access | **Settings → Computer access** selects an app, private takeover controls and a reviewed next-task grant. Function-calling local and cloud models use bounded accessibility snapshots and element references. | Each activation, control action and text replacement needs fresh approval. Window identity/bounds and control state are rechecked. References are single-use and expire; pause/resume changes invalidate prior task grants. Secure fields and modal dialogs require private takeover. See [computer access](COMPUTER-ACCESS.md). |
| OpenAI computer use | OpenAI Responses structured `computer` calls drive the macOS desktop session | Only an explicit `openai` Work invocation with a desktop session enables it. Local and other provider models use the separate accessibility function tools; they do not receive this screenshot/CUA protocol. A batch can use screenshot, click, double-click, drag, move, scroll, type, keypress, and wait; unsupported actions fail closed. Screenshots are window-only, transient, and stripped from retained Work replay. `--retain-provider-state` is required: it permits the provider's response-chain state only for this local desktop session, and its continuation IDs are never retained in Work replay. |
| Scheduling | `hot-cross-buns job launchagent install` on macOS or `hot-cross-buns job systemd install` on Linux installs a per-user service for the local supervisor | Runs while the host and user manager are active. It is not cloud/laptop-off scheduling. Scheduled jobs have no desktop/CUA session fields and therefore cannot automate apps. |
| Cloud/shared organization work | Not implemented | No hosted execution, cross-device continuation, shared workspace, admin plane, or cloud audit service. |

## PPTX editing guarantees

The presentation writer never uses PowerPoint as an automation dependency. It
validates bounded archive structure before editing and keeps source files
immutable: an edited deck is emitted as a new staged `.pptx` artifact. It
preserves unmodified package-part bytes semantically, but no ZIP rewriter can
promise byte-for-byte identity for container metadata. PowerPoint visual review
is optional and outside the structural writer; use it to review an output that
contains application-specific content not represented in Hot Cross Buns's typed edit
surface.

New deck media import and arbitrary animation authoring are intentionally not
part of v1. Existing media and animation parts survive edits unchanged. This
keeps the writer from flattening a deck simply because it encountered an effect
or an embedded object it does not understand.

## Practical start

```sh
HOT_CROSS_BUNS_INTERNAL_COMMANDS=1 go run ./cmd/hot-cross-buns browser install
HOT_CROSS_BUNS_INTERNAL_COMMANDS=1 go run ./cmd/hot-cross-buns browser start --visual-capture
# Select its tab and approve the needed origin, then:
HOT_CROSS_BUNS_INTERNAL_COMMANDS=1 go run ./cmd/hot-cross-buns work --browser-session BROWSER_SESSION --artifact brief.pptx "Create a product brief deck"

HOT_CROSS_BUNS_INTERNAL_COMMANDS=1 go run ./cmd/hot-cross-buns desktop start --app com.microsoft.Powerpoint --retain-provider-state
HOT_CROSS_BUNS_INTERNAL_COMMANDS=1 go run ./cmd/hot-cross-buns work --provider openai --desktop-session DESKTOP_SESSION --artifact review.md "Review the approved presentation window"
```

The desktop command requires macOS Accessibility permission. Screenshot access
may additionally require the operating system's Screen Recording permission.
Hot Cross Buns fails closed if either required operation is unavailable. Desktop control
also requires a cgo-enabled macOS build; the release workflow now builds
macOS archives natively with cgo so this feature remains available. A custom
`CGO_ENABLED=0` macOS build fails closed with a specific diagnostic.

Existing document editors accept original selected `input/...` files as well as
selected source and retained output mounts. Outputs are separate staged copies.
Use the output Save action (also available conversationally) to review a local
destination; editing never silently overwrites the selected original. PDF page
editing uses pdfcpu v0.15.0, pinned to retain the Go 1.25 toolchain. It runs offline
with its user configuration disabled. No external conversion service is involved.
