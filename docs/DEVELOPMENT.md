# Developing Hot Cross Buns

Hot Cross Buns opens as a local web app. Install Go 1.25.13+ and Node 22.12+,
run `make run`, and open the printed address (normally `http://127.0.0.1:4317`).
Click the app name for Main chat, other chats, and settings. Use Models to select or set up
a provider. Browser reloads reconnect to the running host. Ctrl+C stops the
local server and its conversation processes.

`HOT_CROSS_BUNS_WEB_PORT` changes the local port.
`HOT_CROSS_BUNS_WEB_WORKSPACE` selects a starting folder.
`HOT_CROSS_BUNS_WEB_USER_DATA` selects the directory for app drafts.
The web server owns one foreground chat for the local browser, including when
multiple tabs are open. Use `make web-check` for the loopback gateway tests.

Cold launches open one persistent **Main chat** for the current profile, regardless
of the last chat visited. Go retains its identity before the first message;
concurrent launches use the same designation. An existing main designation is
reused. Profiles without one get a new empty main conversation; old histories are
not merged or adopted. Opening a chat, choosing a workspace, creating a new chat,
or forking a response does not replace the main designation. **Main chat** in the
app-name menu and command palette returns to its existing owner, allowing side
tasks to keep running. Both chats retain their own drafts, source settings, and
history. Opening the app does not send drafts or retry interrupted work.

Automatic history retention protects the main conversation even while another
chat is selected. Explicit data deletion still applies. If it removes the main
conversation, the next launch or explicit Main chat navigation creates an empty
replacement. Invalid main metadata is reported rather than silently replaced.

Main chat now prepares continuing context for ordinary replies, plans, and
delegated Work: detailed recent text, a durable rolling summary, current editable
memories, relevant older chat excerpts, and unfinished responsibilities. Summary
calls use the selected model and shared usage accounting. Original history is
retained; current corrections and forgetting rules are reapplied before recall.
See [conversation continuity](CONVERSATION-CONTINUITY.md) for bounds, privacy,
failure behavior and verification limits. No additional chat dashboard is added.

Completed `html`, `svg`, and `mermaid` fenced code blocks render inline with a
Source disclosure. HTML and SVG use opaque sandboxed frames. Self-contained inline scripts, buttons,
selects, CSS animation and SVG animation can run there. The frame policy blocks
network requests, external scripts, nested frames, and form submissions.
Images, including GIFs, use Markdown image syntax. Mermaid
and Markdown dependencies are installed by `make run` and bundled locally at
server startup. Streaming responses show code until the response is complete.

`make build` prepares the Go runtime in `runtime/` and browser dependencies.
`make check` tests and vets the Go backend, shared host and browser gateway.
Node and Go are the development requirements; there is no terminal frontend or
Bun packaging dependency.

## Documentation status and verification

This guide, [runtime ownership](WEB-ONLY-RUNTIME.md), and
[conversation continuity](CONVERSATION-CONTINUITY.md) describe the current browser
application. Documents marked as historical retain their original interface,
commands and test results; terminal/Electron acceptance does not establish browser
acceptance. There is no current `desktop/` or terminal frontend package to build.

Use `make web-check` for browser gateway and rendering checks, or `make check`
for the runtime build, Go tests/vet, web tests, shared-host tests and OAuth build
checks. CI adds companion, native-service, race, controlled-browser and Office
validation jobs; those are not all included in `make check`. Live-provider and
physical-device checks require their separately documented setup.

## Boundaries

- `web/`: local HTTP server, typed host actions, event stream and browser UI.
- `runtime/`: generated Go backend binary (not tracked).
- `scripts/build-runtime.mjs`: runtime build, independent of a frontend package.
- `app-host/`: local sessions, drafts, uploads, immutable files, exports,
  preferences, voice and verified retained evidence.
- `internal/workapp/`: canonical conversation state, exact reviews and controls.
- `cmd/hot-cross-buns/ui_bridge.go`: JSON-lines application transport.
- Other Go packages: tools, connectors, memory, scheduling, specialists,
  coding, usage and storage. Frontend changes do not grant execution authority.
- `companion/`: optional authenticated phone extension with its own listener and access controls.

Foreground Work gets one additional recovery assessment before finalizing after
an observed tool or specialist failure. The agent is instructed to inspect the
cause and pursue useful authorized recovery rather than repeat an unchanged
failing call or ask the user to retry. This assessment uses the existing step,
time and model-request budgets; it does not replay tools, grant access, or change
the selected provider. Completion validation still applies, and genuine blockers
can be reported after the assessment.

The Go executable is a private application runtime. The browser host, scheduled
workers and optional companion use explicit internal transport roles. It does not
launch a terminal UI or expose a user command-line product. Headless tools and
coding-agent adapters remain backend capabilities. Existing profile paths, IDs,
credentials and formats are retained; no installed user profile or service is
automatically removed.

Native sign-in, microphone permissions and service startup need their platform
checks. Cross-compilation alone does not verify them. Historical audits retain
their original observations; current frontend work lives in `web/`.


Code blocks and artifact sources include syntax highlighting and a Copy button.
Press Cmd+K / Ctrl+K for commands, Cmd+P / Ctrl+P to search retained chats,
and Cmd+F / Ctrl+F to find text within the current chat. All three use the same
palette, with separate commands, chats, and current-chat results. Use arrow keys and Enter to select a result, or Escape
to close the palette. Chat search uses the retained catalog; in-chat Find covers loaded conversation text.

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

The clock icon and Settings open the same **Scheduled tasks** dropdown.
It shares Delegated work’s right-side popover layout, opening/closing motion,
light dismissal, and reduced-motion behavior. Both dropdowns ease content-height
changes over 220ms, retain their viewport cap and internal scrolling, and keep
expanded scheduled tasks open across list updates. The dropdown contains next-run
times, timezones, and the existing revision-checked pause, resume, details, and timing controls. Ongoing
responsibilities and schedule creation open their canonical management views.
The branching icon opens **Delegated work**, a separate sidebar showing public
specialist assignments, status, engine, and the owning chat. Codex, Claude Code,
Pi, OpenCode, Gemini CLI and GitHub Copilot use opt-in isolated CLI adapters.
OpenCode and Copilot use retained-result handoff; Gemini live verification is
currently blocked by missing credentials. See [CLI delegation setup](SUBAGENTS_AND_CLI_INTEROP.md).
No CLI is enabled or launched by opening the sidebar.

The app-name menu uses the same native popover, subtle slide/fade, and measured
height transitions as the task dropdowns. Its management dialogs share animated
opening/closing, a fading backdrop, bounded height changes, and a short incoming
view transition. Switching retained chats uses the same quiet content reveal.
Closing releases focus and interaction immediately, and reduced-motion
preferences disable these effects.

The app-name menu contains Main chat, New chat and an internally scrolling **Chats** list.
The list pages through all retained chats, including archived chats, using the
Go native catalog rather than the 24-item recent projection. Main chat has its
own menu entry and is omitted from the ordinary list; matching main-chat results
remain available when searching. Fading edges show
scroll position. Opening a row rechecks its catalog version and verifies the
destination owner before focusing it. No arbitrary renderer chat ID is trusted.

Models, Connections, Memory, Saved, and Settings use modals.
Local models use the native provider API for inventory and exact reviewed future
selection, including selection receipts and reconciliation. The web host's old
`/model` screen remains blocked. **Models → Local models** offers reviewed
Start/Stop for a separate app-owned Ollama process and curated missing-model
downloads with progress/cancellation. Other runtime processes stay read-only.
See [runtime ownership](WEB-ONLY-RUNTIME.md). The terminal frontend and its
packaging have been retired.
Settings is a hub for real model, connection, privacy, usage, data, and recovery
controls; backend forms keep their view identity and explicit review step.
Saved contains global notes rather than a second personal-memory list.
Output and Memory preview demos have been removed from the app and public assets.
Rich outputs and real memory editing remain available in their normal views.


The composer has an attach icon, a model selector, and an arrow send control.
Up recalls earlier prompts from the loaded current chat; Down moves forward and
restores the unsent draft. Editing a recalled prompt leaves history navigation.
In a multiline draft, Up starts history navigation only from the first line.
The composer saves Markdown while displaying rich text outside the active span.
Cmd/Ctrl+B toggles bold, Cmd/Ctrl+I italic, Cmd/Ctrl+E inline code, and
Cmd/Ctrl+Shift+X strikethrough. Cmd/Ctrl+Shift+8 and Cmd/Ctrl+Shift+7 toggle
bulleted and numbered lists. Typing `* `, `- ` or `+ ` starts a bullet.
Tab indents a list item; Shift+Tab outdents it. Shift+Enter continues a list,
or exits it from an empty item. Enter sends the message, including from a list.
Outside a list, Shift+Enter inserts an ordinary line break. Links become clickable
when the caret leaves them. Known services use bundled logos; other public HTTPS
sites may load only their origin's favicon, with no draft text or URL query sent.
Undo history resets when changing conversations.

The selector uses the backend's configured model list and keeps the current draft.
The model and effort buttons open one animated picker with provider filters,
model search, and Low, Standard, or High work budgets for future messages.
These are task-step budgets, not provider reasoning-token controls. The picker
reuses the canonical conversation preference and
is unavailable while current or queued work locks those settings.
Chosen files, dropped files, and pasted images use the same private upload store.
Text pastes longer than 4,000 characters become Pasted text.txt attachments;
shorter text stays in the message field.

Attachment cards show image thumbnails or document snippets. Open a card for a
larger preview, PDF page navigation, or the original download. Office previews
show extracted text or the first worksheet. Long previews are bounded and labeled.
Attachment selections and previews are restored from the saved draft after reload.
Selected draft uploads can be prepared inside their preview: crop images and
choose PDF pages such as `1-3, 5`. Drawing, highlighting, text annotations and
annotation notes are unavailable.
Save creates a new private upload and replaces the selected attachment. Original
bytes stay retained. Page selection removes excluded PDF pages. Edits are limited to selected draft
uploads and remain subject to the message's file count and size limits.


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
Assistant replies and user prompts both offer reply, quote and six emoji choices.
A clicked reaction is retained as a browser-local message badge; it does not
submit a synthetic prompt or make a model request. The assistant may choose any
of those six emoji for an eligible conversational message. Standalone emoji-only
messages can finish silently without a reply or reciprocal reaction. Pending
reviews and ambiguous action contexts remain on their ordinary routing path.


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

The composer’s **Plan** indicator appears only while a retained plan is pending
or executing. It uses the same text and icon size as the adjacent model controls.
The user can request planning in their message, and the agent chooses the `plan`
conversation route when the request explicitly asks for planning or its complexity
needs a reviewed proposal. Ordinary drafts do not carry a sticky planning mode.
This route preserves the original admission and only tightens it into planning.
Plans may include up to three structured questions, with choices and a free-text
answer. **Answer plan questions** opens the form; Continue with answers uses the
existing same-task correction flow while preserving the main composer draft.
Questions block approval and dispatch in Go. Their answers produce a revised
proposal that still needs explicit review before implementation starts.

The app-menu **Models** entry opens a separate wide dashboard, while the composer
model and effort buttons retain the quick picker. Models has Orchestrator,
Specialists, and CLI agents tabs, including the allowed orchestrator choices,
effective inherited or overridden specialist models, CLI authentication mode,
continuation type, guidance/question support, edit scope and configured limits.
Local model management and provider setup remain available through their existing
review flows. The native `inventory` read projects only public assignment fields;
it does not launch a model, expose credentials/CLI paths or cancel provider reviews.

The Orchestrator tab separates **Cloud models** and **On this computer**. Search
the built-in provider catalog, then use **Set up** for a suggested model or
**Add a model** for an explicit model/deployment ID. Both open the existing
reviewed API-key and endpoint form for that exact provider. Saved API model IDs
are retained in the non-secret `orchestrator_models` configuration, so switching
providers does not remove them from the composer. Configured choices use the
same stale-state and active-work checks as the quick picker. Configuration
readiness does not establish account entitlement or endpoint availability.

**On this computer** embeds the existing Ollama management interface: inspect
the app-owned or configured runtime, review downloads and select a verified
installed catalog model. The known catalog remains visible when the runtime is
stopped; installed/loaded state stays unknown until observed. Opening the cloud
catalog never contacts a model provider or starts a local runtime. PNG marks
come from the finite bundled branding catalog, including Ollama for the managed
local provider. These choices change the main orchestrator; CLI-agent logins
and specialist overrides remain independent.

Jump to latest uses a smooth scroll, with immediate movement when reduced motion
is requested. Reading-position restoration does not interrupt that animation.
Each observed composer step has its own disclosure for recorded tool, provider,
timing and finite outcome details; opening a step does not run a tool. Expanded
steps survive status updates. Task recovery remains in Settings and the command
palette rather than a generic Details button on the composer.

Usage shows today's totals, seven UTC days of requests or tokens, provider/model
logos and request categories from the shared local usage ledger. Missing days
show zero recorded usage. Estimated usage is labeled, unknown cost is not shown
as zero, and CLI subprocess billing remains separate. Limits and pause/resume
controls retain the existing reviewed backend actions under Limits & controls.

Text selection uses a soft gray highlight. Selecting text within one completed
model response exposes Quote; the composer keeps a removable quote card and a
link back to its source. Reply attaches an excerpt of the response. Quotes and
ordinary draft text are saved together, and the host rechecks the retained
response identity, digest and excerpt before submission. The model receives the
reference as quoted conversation context. The transcript displays it as a quote,
without showing the transport envelope.
With saved drafts disabled, the active quote stays only in host memory until it
is removed, submitted, or the host closes; unsent quote content is not saved.

Response controls include Fork, Reply and React. Right-click model text for the
emoji panel; Shift+right-click keeps the browser menu. Selecting a reaction sends
response-bound conversation input to the model. Reaction chips are cached in this
browser, bounded to the most recent 256 selections; clearing a chip does not
remove the input already sent. Fork creates a new retained conversation through the
chosen response, including earlier completed conversational replies. Later
messages, pending dispatches, captured account scopes and approvals are not
inherited. The parent's unsent draft stays with its original chat. Fork creation
uses a durable request receipt so matching retries do not create another branch.

## File previews, agent activity and Canvas

Hover or focus a local filename in a response to open the file sidebar; click it
for keyboard interaction. Task-linked previews prefer that task's verified retained
output; other files open from the selected workspace with their origin labeled.
Hidden files, traversal paths and
linked files are refused. Previewing does not modify source files. Text previews
can open a separate editable Canvas draft.

A third top-right Lucide robot button appears when multiple specialists are
available for the current work. It shows the local CLI or model engine, status,
timestamps, bounded output and errors. Expanded output remains open during
updates. It exposes supervised output, not private model reasoning or credentials.

The manager uses the configured API provider. New Codex adapter setup defaults
to `--auth codex_login`, using the locally signed-in ChatGPT CLI account with a
private credential copy removed when the child stops. It does not pass the
manager API key to Codex or import the CLI's configuration/history. Explicit
`--auth api_key` retains separate BYOK setup; other adapters keep their own
credential requirements. `make run` loads the ignored root `.env` into the host
process; secrets are not included in browser state.

Emoji reactions are sent as response-bound conversation input so the model can
respond. They never approve an action. Markdown images and GIFs render inline;
direct video links get controls without autoplay. YouTube/Vimeo links load their
player only after clicking Load video. Unsupported links remain ordinary links.
Requested diagrams default to Mermaid guidance; existing ASCII responses are not
rewritten.

Click a localhost or loopback app link to open it beside the chat in a tabbed
preview. Inline-code URLs work too; modified clicks keep the browser’s normal
link behavior. Up to four preview tabs stay mounted until closed; closing the
pane unloads them. Only explicit HTTP(S) loopback URLs on another port are
accepted (`localhost` and `127.0.0.1`; other links stay external). Frames keep their own origin in a sandbox without top-navigation or
popup privileges. The app’s own control surface cannot be embedded. Previewing
does not start a server or bypass another app’s framing policy; Open in browser
is available for apps that refuse embedding. On narrow screens, the preview uses
the available width and its close control returns to chat.

For an editable artifact, ask the agent to use Canvas. A fenced `canvas` block
contains JSON with `id`, `title`, `language`, and full source `content`. The card
opens the sidebar with Preview/Source, local draft versions, Download and Ask
agent. Revisions retain the same ID; incoming agent changes do not overwrite a
user-edited draft without choosing Use agent version. Canvas drafts stay in the
browser; Ask agent sends the chosen source and instruction as a new conversation
input while preserving the normal composer draft.

Productivity account setup and operation boundaries are documented in
[Productivity connections](PRODUCTIVITY-CONNECTORS.md). Chat can prepare reviewed
public account configuration and project MCP configuration/trust. Private tokens
and sign-in stay in Connections. [MCP setup](MCP.md#guided-setup-and-remote-hosts)
includes outbound remote connections and Raspberry Pi tunnel examples.

Composer bullet markers cycle filled disc, hollow circle and square across
nested Markdown list levels. Tab/Shift+Tab indent/outdent list items;
Shift+Enter continues a list and Enter sends the message.

Type `@` in the composer to search supported files from the file-search root
by name or relative path. The default is your home directory, not `/`. Up/Down selects a result; Enter or Tab adds
it, and Escape dismisses the picker. Mouse selection also works. Selection inserts
`@path` (quoted when the path has spaces) and attaches a private copy of the
current file contents using the normal attachment limits and previews. Files are
sent only when the message is submitted; editing/deleting the mention text does
not remove the attachment card. Remove the card to exclude the copied file.
The picker searches only the current working folder and its descendants; recent
files outside it are excluded. Home remains the default when no folder is focused.
Changing folders invalidates old picker selections and the name cache.
It skips symlinks, hidden files and common dependency/build directories,
returns up to 30 matches and bounds each scan to 12,000 entries. Narrow the query
when results are truncated. Files outside the search root can use the existing
attachment picker or the separately reviewed filesystem access flow.

Ask HCB to “use ~/coding/projects/example as my working folder” to prepare a
reviewed navigation change within the same chat. The `@` menu also offers
**Change working folder**, with a folder browser and recent choices. Working
folders are saved per conversation; the search root and up to 50 recent folders
and files are profile metadata. File names are cached in memory for 30 seconds;
file contents are copied only when a file is explicitly selected. Search results
remain bounded, so focus a project when a broad home scan is truncated.

File navigation is separate from a task's immutable snapshot and permission
grants. Changing navigation never snapshots the home directory or retargets
running tasks, sealed history, or existing project chats. HCB can read other
folders through its normal filesystem access review; MCP setup uses the saved
working Git project, or an explicit project directory, without requiring a chat switch.
A combined Connect review saves, trusts and checks tool discovery within the same
response; it does not invoke MCP business tools. Changing the search root
requires an explicit reviewed `folder` update with action `root`.

File suggestions use locally bundled PNG icons from vscode-icons; source revision,
asset hashes and the MIT notice are retained in `web/public/file-icons/`.
Approval dialogs use one dark primary action: “Allow once” for filesystem and
scheduling permission reviews, or the exact approval for ordinary actions and
plans. Persistent/wider grants remain separate secondary choices with unchanged
authorization scope.
