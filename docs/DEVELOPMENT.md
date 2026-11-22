# Developing Hot Cross Buns

Hot Cross Buns opens as a local web app. Install Go 1.25.13+ and Node 22.12+,
run `make run`, and open the printed address (normally `http://127.0.0.1:4317`).
Click the app name for recent chats and settings. Use Models to select or set up
a provider. Browser reloads reconnect to the running host. Ctrl+C stops the
local server and its conversation processes.

`HOT_CROSS_BUNS_WEB_PORT` changes the local port.
`HOT_CROSS_BUNS_WEB_WORKSPACE` selects a starting folder.
`HOT_CROSS_BUNS_WEB_USER_DATA` selects the directory for app drafts.
The web server owns one foreground chat for the local browser, including when
multiple tabs are open. Use `make web-check` for the loopback gateway tests.

Open **Output preview** from the app menu, or `/?preview=outputs`, for a sample
conversation rendered with the real message renderer. It includes Markdown,
tables, code, HTML, SVG, Mermaid flow and sequence diagrams, and a local animated
GIF. Preview mode does not send messages or write conversation history.

Completed `html`, `svg`, and `mermaid` fenced code blocks render inline with a
Source disclosure. HTML and SVG use opaque sandboxed frames. Self-contained inline scripts, buttons,
selects, CSS animation and SVG animation can run there. The frame policy blocks
network requests, external scripts, nested frames, and form submissions.
Images, including GIFs, use Markdown image syntax. Mermaid
and Markdown dependencies are installed by `make run` and bundled locally at
server startup. Streaming responses show code until the response is complete.

Install Bun 1.4.2+ to run the optional Solid/OpenTUI frontend with `make terminal`.
`make build` builds the runtime and terminal assets. `make check` runs the
cross-surface checks.

```sh
bun ui/launcher/hot-cross-buns.mjs --help
bun ui/launcher/hot-cross-buns.mjs work "Summarize this workspace"
bun ui/launcher/hot-cross-buns.mjs resume <chat-id>
make package PACKAGE_DIR=/tmp/hot-cross-buns-terminal-package
node ui/scripts/install.mjs /tmp/hot-cross-buns-terminal-package /tmp/hot-cross-buns-install
/tmp/hot-cross-buns-install/bin/hot-cross-buns
```

Packaging requires a fresh destination. Installed packages require Bun on PATH;
Go and Node are build requirements. Optional browser and voice features use
explicitly configured native helpers. See [terminal usage](TERMINAL.md).

## Boundaries

- `web/`: local HTTP server, typed host actions, event stream and browser UI.
- `ui/`: terminal rendering, commands, CLI launcher and packaging.
- `app-host/`: local sessions, drafts, uploads, immutable files, exports,
  preferences, voice and verified retained evidence.
- `internal/workapp/`: canonical conversation state, exact reviews and controls.
- `cmd/hot-cross-buns/ui_bridge.go`: JSON-lines application transport.
- Other Go packages: tools, connectors, memory, scheduling, specialists,
  coding, usage and storage. Frontend changes do not grant execution authority.
- `companion/`: optional authenticated phone extension, independent of Electron.

Public Go commands no longer need `HOT_CROSS_BUNS_INTERNAL_COMMANDS`. Use temporary state
and configuration directories for fixtures. Existing profile paths, IDs,
credentials and formats remain compatible. `HOT_CROSS_BUNS_TERMINAL_USER_DATA` selects a
custom application-data location; `HOT_CROSS_BUNS_DESKTOP_USER_DATA` remains a fallback.
No installed app, user profile or enabled service is automatically removed.

```sh
HOT_CROSS_BUNS_STATE_DIR=/tmp/hot-cross-buns-test-state HOT_CROSS_BUNS_CONFIG_DIR=/tmp/hot-cross-buns-test-config go run ./cmd/hot-cross-buns note list
make check
node ui/scripts/verify-install.mjs /tmp/hot-cross-buns-terminal-package
```

Native sign-in, microphone permissions, service startup and terminal rendering
need native execution. Cross-compilation alone does not verify them. Historical
audits retain their original observations; see the [current port inventory](CLI-TUI-PORT.md).


Code blocks and artifact sources include syntax highlighting and a Copy button.
Press Cmd+K / Ctrl+K for commands, loaded chat titles, and text in
the current conversation. Use arrow keys and Enter to select a result, or Escape
to close the palette. This search covers the loaded conversation and menu rows.

Drag a Markdown table header's right edge to resize its column. The resize handles
also accept Left/Right arrow keys in 20px steps. Widths survive message rerenders
within the current page. Reloading restores the default table layout.

MathJax renders `$...$` and `\(...\)` inline, and `$$...$$` or `\[...\]` as display
math. Code spans and fences retain their literal source. MathJax is bundled
locally and uses SVG output, with the base, AMS and newcommand TeX packages.

Generated visual content defaults to the app's white, charcoal and muted sage
palette. Explicit user styling takes precedence. HTML frames also supply default
control styles and `--text`, `--muted`, `--line`, `--wash`, `--accent` variables.


The visual caret follows native selection positions in text fields and briefly
marks clicked text in the conversation. Movement uses a 115ms interpolation.
Selections, IME composition, reduced-motion settings, and forced-colors settings
use native caret behavior. Password fields are excluded from caret measurement.

Active work displays the backend's public activity trace with expandable tool
rows, finite result details, and elapsed time. Approval waits, stopping, failure,
and connection loss have distinct states. Finished activity folds above the final
answer into a timed summary.

The current request's checklist grows from the composer, directly above the
input. It opens during work and folds to a short summary when finished.
Checkmarks represent recorded tool outcomes. Proposed steps remain unchecked.
Interface icons come from the locally bundled, pinned Lucide package. Foreground
tools accept an optional `display_icon` name from the shared catalog in
`internal/workactivity/icon-names.json`. The runtime strips this presentation
field before tool validation, scope checks, and execution. It never sets status.
Without a selection, the browser picks an icon from the tool type; completion,
approval waits, and connection loss use their own status icons.
Progress follows the current chat or its delegated task, keeping unrelated work
out of the composer. Connection loss pauses its display.

The clock icon and menu entry open the same **Scheduled tasks** modal, replacing
the separate Following destination. It contains next-run times, timezones, and
the existing revision-checked pause, resume, details, and timing controls. Ongoing
responsibilities and schedule creation open their canonical management views.
The branching icon opens **Delegated work**, a separate sidebar showing public
specialist assignments, status, engine, and the owning chat. Codex, Claude Code,
and Pi use the existing opt-in isolated CLI adapters. Gemini and OpenCode do not
have adapters yet. See [CLI delegation setup](SUBAGENTS_AND_CLI_INTEROP.md).
No CLI is enabled or launched by opening the sidebar.

The app-name menu contains New chat and an internally scrolling **Chats** list.
The list pages through all retained chats, including archived chats, using the
Go native catalog rather than the 24-item recent projection. Fading edges show
scroll position. Opening a row rechecks its catalog version and verifies the
destination owner before focusing it. No arbitrary renderer chat ID is trusted.

Models, Connections, Memory, Saved, Scheduled tasks, and Settings use modals.
Local models use the native provider API for inventory and exact reviewed future
selection, including selection receipts and reconciliation. The old managed
`/model` screen remains blocked; runtime start/stop and downloads are not enabled.
Settings is a hub for real model, connection, privacy, usage, data, and recovery
controls; backend forms keep their view identity and explicit review step.
Saved contains global notes rather than a second personal-memory list.
Output preview opens a gallery that renders one example at a time. Memory preview
uses the same memory controls with explicitly fictional data. These menu entries
stay in the chat instead of navigating to separate pages. The standalone
`/?preview=outputs` demo remains available with its sample composer,
**Replay current task**, fictional schedules, and mock delegates.


The composer has an attach icon, a model selector, and an arrow send control.
The selector uses the backend's configured model list and keeps the current draft.
The small effort selector beside the model uses Low, Standard, or High work
budgets for future messages. It reuses the canonical conversation preference and
is unavailable while current or queued work locks those settings.
Chosen files, dropped files, and pasted images use the same private upload store.
Text pastes longer than 4,000 characters become Pasted text.txt attachments;
shorter text stays in the message field.

Attachment cards show image thumbnails or document snippets. Open a card for a
larger preview, PDF page navigation, or the original download. Office previews
show extracted text or the first worksheet. Long previews are bounded and labeled.
Attachment selections and previews are restored from the saved draft after reload.

Open **Memory** from the app menu or command palette to inspect saved personal
memories one topic at a time; related notes, goal context, and guidance have their
own sections. Search is scoped to the selected section, with paginated results
and source, status, and scope details. **Add memory** writes an explicit personal
fact, preference, or note through the canonical memory store. Personal memories
and global notes support revision-checked correction and forgetting. Lucide
icons are mapped from persisted memory kinds, including model-assigned kinds;
opening the view does not ask a model to classify or rewrite the saved content.
Goal context and guidance link to their existing management controls. The pane
reads the canonical stores without calling a model or generating a new profile.

Open **Memory preview** from the app menu or `/?preview=memory` for fictional
records in every topic group, including review and disabled statuses. Adding, editing,
forgetting, filtering, and source disclosures reuse the real pane. Changes stay
in browser memory and reset on reload or **Reset samples**. This mode makes no
backend requests and does not modify the profile's canonical memory stores.

Search retained chats from the app-name menu. Search covers titles, folders, and
indexed work messages; conversation-only dialogue is not indexed. Hover or focus
a row to reveal Rename (always visible on touch devices). Renames check the exact
catalog version and preserve the current chat, running work, and unsent draft.

Cmd+F / Ctrl+F opens Find in the loaded chat. Matching visible text is highlighted;
Enter / Shift+Enter and the arrow controls move through matches. Escape closes
Find. It excludes closed source details and embedded preview content, and caps
search at 500 matches and 8 MiB of loaded text. Find is also in the command palette.

Reading positions use stable message anchors and offsets, bounded to 32 chats in
this tab's session storage. Switching chats or reloading restores an available
loaded anchor. A missing anchor falls back to the first loaded message; earlier
history is not fetched automatically. Reading above the end reveals Jump to latest.
New messages follow the bottom only while you are already following it.

Settings → Quick acknowledgements controls confirmed conversational emoji:
Off retains text replies, Subtle displays ordinary acknowledgements, and
Expressive includes greetings. The choice is local to this browser. Exact backend
conversation, turn, revision, kind, and fallback text must match; these chips
never grant approval or establish completion of work.

Task Details is available from the composer's expanded progress, delegated work,
Settings → Recovery, and the command palette. It reads existing owners without
starting replacements. Identity, interrupted requests, retained plans, queued
messages, sealed receipts, and unsealed action attempts stay distinct. Exact
unknown Gmail send receipts allow saved-check inspection or explicitly reviewed
read-only Sent lookup. Recovery preparation uses the original task token and,
when needed, an exact configured-account review. It may use model capacity to
prepare a revised plan; approval and execution remain separate. Missing
acknowledgements retire the submitted selection rather than replaying it.

The [current product direction](CONVERSATIONAL-PRODUCT-DIRECTION.md#current-web-direction--22-november-2026)
favors one persistent conversation. Retained-chat management remains secondary.
Menu-bar/notch access, separate native windows, and the mascot are excluded.

## Web completion of the former Swift surface

Workspace selection is in the app menu and command palette. Its local folder
browser uses Go's canonical resolver; hidden folders can be entered by absolute
path. Choosing a different folder opens a new owner without changing old work.
The chat menu shows real activity and attention states beside retained titles.

Full assistant responses, including a currently streaming response, have a quiet
Copy response control. It copies the received Markdown source, including content
that has not yet finished its visual reveal. Plain streamed prose reveals on a
66 ms word-aware cadence with grapheme boundaries, an 8,192-character bound and
a 2,048-character backlog limit. Structured content, reduced motion, background
tabs, and completed responses settle directly to the received source.

Exact action reviews offer Request correction only when the Go owner reports a
single correctable external action. Source-access prompts are not eligible.
Pending plan reviews offer Request revision only when Go reports readiness.
These open a separate composer draft in the original requesting chat, preserving
its ordinary draft and attachments. The original owner and proposal must still
match before admission. Cancelling restores the ordinary draft. Correction text
is retained by the running host and browser session; after a host replacement the
old target is unavailable and must be reviewed again. No correction approves or
executes a replacement, and unconfirmed submissions retain their admission ID.

Plan reviews display outcomes, ordered steps, effects, sources, changed inputs,
remaining and original budgets, prior attempts, and current state. Exact raw
review data remains in a closed disclosure. Backend revision/digest checks remain
the execution boundary.
