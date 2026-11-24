# Computer-access verification — 24 November 2026

HCB now offers selected-app macOS accessibility tools to ordinary function-calling models, including text-only local models. Settings → Computer access and `/computer` use the existing host-owned forms/reviews. Grants are scoped to one submitted/queued task in the originating chat; app activations and mutations still require fresh exact-action reviews. Existing OpenAI screenshot/CUA consent remains separate.

## Observed checks

| Check | Result |
| --- | --- |
| `make check`, Node 26.7.0, canonical macOS `TMPDIR` | Passed: runtime build, Go packages, vet, 122 browser tests, 142 host tests and one OAuth build test |
| Controller and review contracts | Passed: frozen app/window/control metadata, single-use/expired refs, full replacement review, Allow-once-only, bounded values, unsupported actions, restricted trees and incomplete fields |
| Revocation/private takeover | Passed: pause/resume invalidates old grants; withdrawal during a snapshot returns no content; uncertain action pauses shared access; stale Resume cannot override newer takeover |
| Text-only local model workflow fixture | Passed: inspect → reviewed button action → rejected premature final reply → fresh read → observed fixture result; screenshot/global-input tools absent |
| Native computer-protocol compatibility fixture | Passed: no retention consent rejected; consented protocol retains its native computer continuation and does not mix AX function tools |
| Chat/task scope | Passed: review required, next task consumes grant, queued tasks do not inherit it, delayed cross-chat grants rejected, takeover panel stays in the running chat |
| Settings route | Passed: Computer access invokes `/computer`; controls use existing host-owned panel/review mechanisms |
| Focused `-race` | Passed for desktop/controller/tools, local Work execution, workapp grants and command controls |
| `CGO_ENABLED=0 go test ./internal/desktop` | Passed: portable controller contracts remain testable without a native driver |
| Disposable AppKit fixture syntax | Passed with Apple Clang |
| Opt-in native AX acceptance | **Skipped: No access.** `AXIsProcessTrusted()` returned false for this test runtime. No fixture app was opened; no existing app content was read or changed |

The initial focused Go run used the ambient macOS temporary-directory spelling and failed an existing sandboxed CLI credential fixture with exit 126. The run with canonical `TMPDIR` passed all focused packages. Two initial standalone Settings-test attempts failed because their test bundler did not resolve the existing render dependency; using the repository's actual dependency entry corrected the test. No runtime authorization or sandbox rule was weakened for either issue.

The full working-tree check includes earlier requested edits. Computer-access commits keep those pre-existing edits separate.

An exported committed snapshot at `5c03e6c0b` passed its desktop, tools, workrun and workapp Go suites, built its own runtime, and passed the standalone Settings route test using installed Node dependencies. Its first command-package run failed 13 tests because the ambient user configuration contains the newer, uncommitted local Codex login mode, which that committed snapshot does not implement. Running the same command suite with an isolated `HOT_CROSS_BUNS_CONFIG_DIR` passed. No user configuration was edited and no earlier feature files were copied into that snapshot. The later native path type guard was compiled and passed the desktop tests; native dispatch remains unverified without Accessibility permission.

Both existing local servers were restarted only after their frames reported idle. Ports 4317 and 4318 returned HTTP 200, connected Go state and the new Settings entry. This is server/bridge verification, not rendered browser layout or real desktop action acceptance.

## Reproduction

```sh
task_tmpdir=$(python3 -c 'import os,tempfile;print(os.path.realpath(tempfile.gettempdir()))')
TMPDIR="$task_tmpdir" fnm exec --using 26.7.0 make check
TMPDIR="$task_tmpdir" go test -race ./internal/desktop ./internal/tools ./internal/workrun ./internal/workapp ./cmd/hot-cross-buns -run 'Test(Accessibility|ReviewedDesktop|DelayedReviewed|DesktopAccessibility|TextOnlyLocalDesktop|NativeComputerProtocol|Computer|DesktopPlan)'
CGO_ENABLED=0 go test ./internal/desktop
HCB_DESKTOP_NATIVE_SMOKE=1 go test -v ./internal/desktop -run '^TestNativeAccessibilityAcceptance$'
```

Session logs: `/tmp/hcb-computer-complete-check.log`, `/tmp/hcb-computer-race-final.log`, `/tmp/hcb-computer-native-acceptance.log`, `/tmp/hcb-computer-committed-check.log`.

## Live limitations

**I cannot verify native desktop interaction in this environment:** macOS Accessibility access is unavailable. The opt-in acceptance test compiles and operates only on its own disposable AppKit app once permission is available. It has not established real-app compatibility, changed-window timing under live user input, native field replacement or actual AX button dispatch here.

No installed local model was exercised. The local-model test uses deterministic tool calls and a fake AX runtime, rather than an Ollama benchmark. No model weights were downloaded, cloud model substituted, OS permission changed, user account modified or external action sent.

Bounded AX trees can omit controls; long fields and unavailable/custom accessibility actions require private takeover or another tool. A post-action read is required but does not prove semantic success of a send/save/payment. AX operations are not transactions. See [computer access](../COMPUTER-ACCESS.md) for current behavior and limits.
