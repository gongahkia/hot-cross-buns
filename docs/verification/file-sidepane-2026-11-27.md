# Shared file and app preview pane

File chips previously downloaded immediately, composer attachments opened a
modal, and prose filenames used a separate sidebar. They now open tabs in the
existing local-app split pane. Apps, files and terminal output can coexist;
opening another tab does not evict earlier tabs. Reopening a selected file reuses its tab; closing a file leaves
other tabs intact. Download is an explicit action for selected uploads and
retained outputs.

Local Markdown links, inline filenames and file references in detail views use
the same pane. Source-file buttons open the exact retained capture, labeled as
an excerpt, rather than guessing a workspace file with the same name. Canvas
remains an explicit editing action. The pane retains loading and error states,
PDF paging, keyboard tab navigation and focus restoration.

Preview routing preserves the existing host checks for selected uploads,
retained output hashes, workspace boundaries and linked files. Absolute paths
are resolved only within the selected workspace. Unsupported formats show their
preview notice; selected files retain the download action. This change does not
grant access to arbitrary paths outside the admitted scope.

## Verification

- `make check` passed with Node 26.7.0 and canonical `TMPDIR`: Go tests and vet,
  202 web tests, 148 host tests and the OAuth build test. The final source-file
  interaction and focus refinements were followed by another full web run:
  all 203 tests passed, with none skipped.
- The initial targeted run exposed the existing macOS `/var` versus
  `/private/var` workspace-test mismatch. The canonical-path full run passed.
- Tests cover mixed app/file tabs without replacing app frames, PDF navigation,
  explicit downloads, reload after errors, duplicate file opens, stale reads
  after context changes, local Markdown links, filenames with spaces, workspace
  escape rejection, retained-file tampering and file-view ownership checks.
- T3 browser checks used the real gateway/native backend with the existing
  controlled-provider fixture. Attachment cards, sent-file chips, prose
  filenames and Sources-file buttons opened the pane. The Sources modal closed
  when its file opened. Desktop used an even split; the 390-pixel layout used
  the existing full-width pane, with no horizontal overflow.
- After an idle-only server restart, the actual local profile's `memo.md` output
  opened successfully in the pane with a separate download action. The original
  conversation was preserved. No cloud-model call or external action was needed
  for that real-profile check.

Temporary fixture processes and the inspection tab were closed after testing.

## Follow-up: terminal tabs and reordering

The terminal activity popup opens each worker's public output in a sidepane tab.
Existing activity snapshots update the log; switching tabs retains its DOM and
scroll position. Closing a terminal tab closes only the view and sends no agent
stop command. These are output views, not interactive shell sessions.

Tabs support drag-and-drop ordering and Alt/Option+Shift+Arrow keys. Ordinary
arrows select adjacent tabs; Delete closes a focused tab. Each tab has its own
close button. The toolbar close button and Escape close the selected tab while
leaving the others open. Reordering moves only labels, so app iframes stay mounted.

- All 205 web tests passed. A subsequent queued-to-running output binding
  refinement and its additional regression passed in the final 89-test rendering
  run. Syntax checks and `git diff --check` passed.
- Regressions cover mixed file/app/terminal ordering, independent closure, more
  than four retained tabs, live and disconnected output, literal HTML log text,
  queued workers acquiring a start time, and rejection of replacement runs or
  other conversation contexts.
- Browser checks reordered actual local-profile file tabs and closed one while
  retaining another. A controlled frontend component check exercised synthesized
  HTML drag events, mixed file/terminal tabs and output updates without selection
  changes. Desktop and 390-pixel layouts were checked; the narrow layout had no
  horizontal page overflow. The controlled terminal output was removed afterward.
- No live CLI agent was launched for this frontend change. Native shell execution
  and agent permissions were unchanged. The backend was left running; refreshing
  the app loads the updated frontend.
