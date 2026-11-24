# macOS computer access

HCB can give an ordinary function-calling local or cloud model access to an explicitly selected macOS app. The model reads a bounded accessibility tree and uses opaque control references to press buttons, increment/decrement supported controls or replace ordinary text fields. This path does not require image input, screenshots or OpenAI's computer protocol.

## Use it

1. Open **Settings → Computer access** in the local browser app, or use `/computer`.
2. If setup is required, allow the runtime or its launching terminal in macOS **Privacy & Security → Accessibility**, then refresh. HCB does not change macOS permissions itself. The native driver requires a cgo-enabled macOS build.
3. Open the app you want to share, choose it from the running-app list, and review the selection. The session starts paused. Set up the app and sign in privately before resuming.
4. Resume access and review **Use for next task**. Return to the same chat and submit or queue one task. The grant is consumed by that task; it does not automatically carry into another task or chat.
5. The agent requests approval before activating an app or acting on a control. Review the app/window, control and full replacement text. Approval returns focus to the reviewed app. After dispatch, the harness requires a successful fresh snapshot before accepting a final reply; the model must compare it with the intended outcome.
6. Reopen **Computer access** during work to pause for private takeover or revoke access. Pause/resume changes invalidate older grants. A delayed Resume review cannot override a newer pause. Grant the app to a new task after taking over.

A useful first task is: “Read the approved app's current window and summarize its visible controls. Do not change anything.” Start with a non-sensitive test document before asking for edits.

## What is enforced

- App selection uses bundle IDs from the host's running-app list. Terminal, iTerm, Finder, Keychain and System Settings remain ineligible. The web flow selects one app per session; the existing developer CLI can explicitly allow up to 16.
- `desktop_snapshot` reads only the foreground window of an allowlisted app. Snapshots contain at most 128 elements and a bounded text budget (16 KiB in the native walker, plus small metadata). Partial trees are marked. Text fields expose at most 512 UTF-16 units; fields whose prior content is incomplete cannot be replaced.
- `desktop_action` needs the latest snapshot ID and an enabled element's listed action. References expire after five minutes and are consumed by dispatch. An updated snapshot invalidates earlier references.
- Each mutation requires **Allow once**. “Always” is rejected. Text replacement reviews show the prior field content and the full proposed replacement, including clearing a field. No truncated replacement preview authorizes unseen text.
- The controller rechecks the session policy, foreground app, window ID/PID/bounds and current bounded tree after approval. The native driver checks the tree again immediately before dispatch. Changed targets require a new read and review.
- Secure text fields and detected modal/file dialogs require private takeover. There is no fallback to arbitrary keystrokes, clipboard commands, coordinates, AppleScript, shell commands or permission changes in this text tool surface.
- An ambiguous native `CannotComplete` result consumes the reference and pauses the shared session. The active controller refuses retries; inspect the actual app state privately before granting a new task. A generic dispatch error is not proof that no external effect occurred.
- Plan-first execution classifies desktop mutations separately as `desktop`; inspections require `read`. Plan scope does not replace app grants or exact-action reviews. Scheduled jobs do not receive desktop session grants.

Accessibility text and action reviews can enter task history and the selected model's context. Choosing a local model determines inference location; it does not erase normal HCB task history. This path sends no screenshot bytes. The older developer-only OpenAI screenshot/CUA route remains separate and requires explicit provider-state retention consent; screenshot bytes and continuation IDs keep their existing replay exclusions.

## Practical limits

This is bounded accessibility control, not unrestricted desktop automation. Apps with incomplete or custom accessibility controls may be readable only in part or reject actions. Long fields, menus outside the focused window, arbitrary scrolling, modifier shortcuts, file dialogs, native drag/drop, secrets and background/unapproved apps are not added to this text route. Prefer an existing connector or controlled browser for workflows those tools express more reliably.

macOS apps can change while an operation is in flight. Window/tree checks reduce stale dispatches but do not make desktop actions transactional. A successful AX dispatch and a subsequent read do not establish the semantic success of a payment, message, save or other external operation. Inspect its actual resulting state or receipt; do not retry an uncertain operation automatically.

## Developer verification

The normal `make check` runs controller, review, local-model routing, task-grant and browser Settings tests. The local-model fixture uses deterministic tool calls; it does not qualify any installed model's reasoning quality.

For native acceptance after granting Accessibility:

```sh
HCB_DESKTOP_NATIVE_SMOKE=1 go test -v ./internal/desktop -run '^TestNativeAccessibilityAcceptance$'
```

This opt-in test compiles and opens its own temporary AppKit app, replaces its disposable field, presses its fixture button and reads the resulting value. It kills only its owned fixture process. It skips with **No access** when macOS permission is unavailable, rather than treating a fake driver as native acceptance.

See the [verification record](verification/computer-access-2026-11-24.md) for observed checks and live limitations.
